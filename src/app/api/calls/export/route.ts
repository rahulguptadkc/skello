import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { logSkeloError } from "@/lib/errors";
import { requireSession } from "@/lib/auth/session";
import { toCsv, withBom } from "@/lib/csv";
import { applyCallFilters } from "@/lib/queries/call-filters";
import { checkRateLimit, tooManyRequestsResponse } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  callDirectionSchema,
  callStatusSchema,
} from "@/lib/validations/call";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Per-export row cap. We paginate Supabase PostgREST in batches of BATCH_SIZE
// (since PostgREST defaults to a 1,000 max-rows per-request limit) up to EXPORT_CAP
// so that large datasets are fully exported without silent row truncations.
const EXPORT_CAP = 50_000;
const BATCH_SIZE = 1_000;

// Backend contract: the frontend resolves a preset (or custom date inputs)
// into concrete from/to ISO timestamps and posts them as query params.
// `range` is carried through for the filename only; the query uses from/to.
// `null` on either bound means "open" on that side. The filter block mirrors
// the conversations table — `direction`, `status`, `agent_id`, `q`, plus an
// optional `lead_id` for "export everything on this lead" flows. Each
// filter is independent; omit the param to skip it.
const isoDatetimeSchema = z.string().datetime({ offset: true });
const exportInputSchema = z.object({
  from: isoDatetimeSchema.optional(),
  to: isoDatetimeSchema.optional(),
  range: z.string().trim().max(40).optional(),
  direction: callDirectionSchema.optional(),
  status: callStatusSchema.optional(),
  agent_id: z.string().trim().min(1).max(200).optional(),
  q: z.string().trim().max(200).optional(),
  lead_id: z.string().uuid().optional(),
});

// recording_url / transcript_url are intentionally omitted — downloadable
// CSVs must not leak signed audio links. The `transcript` text body IS
// included now (admins asked for it); it can bloat the file on long calls,
// but that's a conscious tradeoff vs. the previous "ready/pending" string
// being the only transcript-related column.
const CALL_COLUMNS =
  "id, bolna_call_id, direction, status, agent_id, to_phone, from_phone, " +
  "started_at, answered_at, ended_at, duration_seconds, language, summary, " +
  "name_extracted, interest, lead_intent_extracted, customer_status, " +
  "actionable, visit_scheduled_at, connect_on_whatsapp, transcript_status, " +
  "transcript, lead_data, custom_data, error_code, error_message, " +
  "call_outcome, " +
  "lead:leads(name, phone)";

interface CallRow {
  id: string;
  bolna_call_id: string | null;
  direction: "inbound" | "outbound";
  status: string;
  agent_id: string;
  to_phone: string | null;
  from_phone: string | null;
  started_at: string;
  answered_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  language: string | null;
  summary: string | null;
  name_extracted: string | null;
  interest: string | null;
  lead_intent_extracted: "hot" | "warm" | "cold" | null;
  customer_status: string | null;
  actionable: string | null;
  visit_scheduled_at: string | null;
  connect_on_whatsapp: boolean | null;
  transcript_status: string | null;
  transcript: string | null;
  call_outcome: string | null;
  lead_data: Record<string, unknown> | null;
  custom_data: Record<string, Record<string, unknown>> | null;
  error_code: string | null;
  error_message: string | null;
  lead: { name: string | null; phone: string | null } | null;
}

import {
  buildCallExportCsvColumns,
  fetchAgentLabels,
  getExportExtractionDefinitions,
  type UnifiedCallRecord,
} from "@/lib/export/shared-export-columns";

export async function GET(request: NextRequest) {
  const session = await requireSession();

  // 5 exports per minute per user. Same envelope as the leads export
  // — keeps the database from being saturated by a tab-spamming user
  // without blocking the dialog's count-then-export flow.
  const rl = await checkRateLimit({
    key: `calls-export:user:${session.userId}`,
    windowSeconds: 60,
    max: 5,
  });
  if (!rl.allowed) {
    return tooManyRequestsResponse(rl.retryAfterSeconds);
  }

  const sp = request.nextUrl.searchParams;
  const parsedInput = exportInputSchema.safeParse({
    from: sp.get("from") ?? undefined,
    to: sp.get("to") ?? undefined,
    range: sp.get("range") ?? undefined,
    direction: sp.get("direction") ?? undefined,
    status: sp.get("status") ?? undefined,
    agent_id: sp.get("agent_id") ?? undefined,
    q: sp.get("q") ?? undefined,
    lead_id: sp.get("lead_id") ?? undefined,
  });
  if (!parsedInput.success) {
    return NextResponse.json(
      {
        error:
          "Invalid filter set. `from`/`to` must be ISO datetimes; `direction`, `status`, `agent_id`, `q`, `lead_id` are optional.",
      },
      { status: 400 },
    );
  }
  const { from, to, range, direction, status, agent_id, q, lead_id } =
    parsedInput.data;

  const admin = createAdminClient();
  const allCalls: CallRow[] = [];
  let offset = 0;
  let hasMore = true;
  let truncated = false;

  while (hasMore) {
    let query = admin
      .from("calls")
      .select(CALL_COLUMNS)
      .eq("organisation_id", session.organisation.id)
      .order("started_at", { ascending: false })
      .range(offset, offset + BATCH_SIZE - 1);

    query = applyCallFilters(query, {
      from,
      to,
      direction,
      status,
      agent_id,
      q,
      lead_id,
    });

    const { data, error } = await query.returns<CallRow[]>();
    if (error) {
      const message = logSkeloError("EXPORT", "Call export query failed", {
        organisationId: session.organisation.id,
        cause: error,
      });
      return NextResponse.json({ error: message }, { status: 500 });
    }

    const batch = data ?? [];
    allCalls.push(...batch);

    if (batch.length < BATCH_SIZE) {
      hasMore = false;
    } else if (allCalls.length >= EXPORT_CAP) {
      hasMore = false;
      truncated = true;
    } else {
      offset += BATCH_SIZE;
    }
  }

  const calls = truncated ? allCalls.slice(0, EXPORT_CAP) : allCalls;

  // Resolve agent labels in one round trip. Falls back to the raw agent_id
  // when no voice_agents row exists (e.g. a legacy / unregistered agent).
  const agentIds = Array.from(new Set(calls.map((c) => c.agent_id).filter(Boolean)));
  const labelById = await fetchAgentLabels(admin, session.organisation.id, agentIds);

  const rows: UnifiedCallRecord[] = calls.map((c) => ({
    ...c,
    agent_label: labelById.get(c.agent_id) ?? null,
    counterparty_phone: c.direction === "inbound" ? c.from_phone : c.to_phone,
  }));

  const extractions = await getExportExtractionDefinitions(
    admin,
    session.organisation.id,
    rows,
  );
  const csvColumns = buildCallExportCsvColumns(extractions);
  const body = withBom(toCsv(rows, csvColumns));
  const stamp = new Date().toISOString().slice(0, 10);
  const rangeLabel = (range ?? "custom").replace(/[^a-z0-9_-]+/gi, "_");
  const filename = `skelo-calls-${rangeLabel}-${stamp}.csv`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      // Forensic + UX headers: the dialog reads these to surface a toast
      // confirming row count and (when relevant) the cap being hit. They
      // are also useful for anyone inspecting the response in DevTools.
      "X-Export-Cap": String(EXPORT_CAP),
      "X-Export-Rows": String(calls.length),
      "X-Export-Truncated": truncated ? "true" : "false",
    },
  });
}
