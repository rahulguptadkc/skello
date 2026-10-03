import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  type LeadActivityFilter,
  leadActivityFilterSchema,
} from "@/lib/validations/lead-activity";
import { logSkeloError } from "@/lib/errors";
import { requireSession } from "@/lib/auth/session";
import { toCsv, withBom } from "@/lib/csv";
import { checkRateLimit, tooManyRequestsResponse } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildLeadExportCsvColumns,
  fetchAgentLabels,
  getExportExtractionDefinitions,
  type UnifiedCallRecord,
  type UnifiedLeadRecord,
} from "@/lib/export/shared-export-columns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Per-export row cap. We paginate Supabase PostgREST in batches
// (since PostgREST defaults to a 1,000 max-rows per-request limit) up to EXPORT_CAP
// so that large datasets are fully exported without silent row truncations.
const EXPORT_CAP = 50_000;
const BATCH_SIZE = 1_000;

const isoDatetimeSchema = z.string().datetime({ offset: true });
const filtersJsonSchema = z
  .string()
  .max(8_000)
  .transform((raw, ctx) => {
    try {
      const parsed = JSON.parse(raw);
      return z.array(leadActivityFilterSchema).max(20).parse(parsed);
    } catch (err) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          err instanceof Error
            ? `Invalid filters JSON: ${err.message}`
            : "Invalid filters JSON",
      });
      return z.NEVER;
    }
  });

const exportInputSchema = z.object({
  from: isoDatetimeSchema.optional(),
  to: isoDatetimeSchema.optional(),
  range: z.string().trim().max(40).optional(),
  filters: filtersJsonSchema.optional(),
  search: z.string().trim().max(200).optional(),
});

const LEAD_COLUMNS =
  "id, created_at, updated_at, name, phone, phone_normalized, current_intent, " +
  "current_intent_score, source, status, pending_action, notes, city, pincode, " +
  "owner_label, lead_data, custom_data";

interface RawLeadRow {
  id: string;
  created_at: string;
  updated_at?: string;
  name: string | null;
  phone: string | null;
  current_intent: string | null;
  source: string | null;
  status: string;
  pending_action: boolean;
  notes: string | null;
  city: string | null;
  pincode: string | null;
  owner_label: string | null;
  lead_data: Record<string, unknown> | null;
  custom_data: Record<string, Record<string, unknown>> | null;
}

export async function GET(request: NextRequest) {
  const session = await requireSession();

  // 5 exports per minute per user. Sized to prevent database saturation.
  const rl = await checkRateLimit({
    key: `leads-export:user:${session.userId}`,
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
    filters: sp.get("filters") ?? undefined,
    search: sp.get("search") ?? undefined,
  });
  if (!parsedInput.success) {
    return NextResponse.json(
      {
        error:
          parsedInput.error.issues[0]?.message ??
          "Invalid query. `from`/`to` must be ISO datetimes; `filters` must be JSON.",
      },
      { status: 400 },
    );
  }
  const { from, to, range, filters, search } = parsedInput.data;

  const admin = createAdminClient();
  const allLeads: RawLeadRow[] = [];
  let offset = 0;
  let hasMore = true;
  let truncated = false;

  while (hasMore) {
    let query = admin
      .from("leads")
      .select(LEAD_COLUMNS)
      .eq("organisation_id", session.organisation.id)
      .order("created_at", { ascending: false })
      .range(offset, offset + BATCH_SIZE - 1);

    if (from) query = query.gte("created_at", from);
    if (to) query = query.lte("created_at", to);

    if (search && search.trim().length > 0) {
      const safe = search.replace(/[%,]/g, " ").trim();
      if (safe.length >= 1) {
        query = query.or(`name.ilike.%${safe}%,phone.ilike.%${safe}%`);
      }
    }

    if (filters && filters.length > 0) {
      query = applyLeadFilters(query, filters);
    }

    const { data, error } = await query.returns<RawLeadRow[]>();
    if (error) {
      const message = logSkeloError("EXPORT", "Lead export query failed", {
        organisationId: session.organisation.id,
        cause: error,
      });
      return NextResponse.json({ error: message }, { status: 500 });
    }

    const batch = data ?? [];
    allLeads.push(...batch);

    if (batch.length < BATCH_SIZE) {
      hasMore = false;
    } else if (allLeads.length >= EXPORT_CAP) {
      hasMore = false;
      truncated = true;
    } else {
      offset += BATCH_SIZE;
    }
  }

  const leads = truncated ? allLeads.slice(0, EXPORT_CAP) : allLeads;

  // Batch-fetch latest call per lead
  const snapshots = await fetchLatestCallSnapshots(
    admin,
    session.organisation.id,
    leads.map((l) => l.id),
  );

  const rows: UnifiedLeadRecord[] = leads.map((l) => ({
    ...l,
    latestCall: snapshots.get(l.id) ?? null,
  }));

  const extractions = await getExportExtractionDefinitions(
    admin,
    session.organisation.id,
    rows,
  );

  const csvColumns = buildLeadExportCsvColumns(extractions);
  const body = withBom(toCsv(rows, csvColumns));
  const stamp = new Date().toISOString().slice(0, 10);
  const rangeLabel = (range ?? "custom").replace(/[^a-z0-9_-]+/gi, "_");
  const filename = `skelo-leads-${rangeLabel}-${stamp}.csv`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Export-Cap": String(EXPORT_CAP),
      "X-Export-Rows": String(leads.length),
      "X-Export-Truncated": truncated ? "true" : "false",
    },
  });
}

function applyLeadFilters(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: any,
  filters: LeadActivityFilter[],
) {
  let q = query;
  for (const f of filters) {
    if (f.source === "column") {
      if (f.op === "eq") q = q.eq(f.key, f.value);
      else if (f.op === "neq") q = q.neq(f.key, f.value);
      else if (f.op === "contains") q = q.ilike(f.key, `%${f.value}%`);
      else if (f.op === "lt") q = q.lt(f.key, f.value);
      else if (f.op === "lte") q = q.lte(f.key, f.value);
      else if (f.op === "gt") q = q.gt(f.key, f.value);
      else if (f.op === "gte") q = q.gte(f.key, f.value);
    } else if (f.source === "lead_data") {
      const op = f.op === "contains" ? "ilike" : f.op;
      const val = f.op === "contains" ? `%${f.value}%` : f.value;
      q = q.filter(`lead_data->>${f.key}`, op, val);
    } else if (f.source === "custom_data") {
      const op = f.op === "contains" ? "ilike" : f.op;
      const val = f.op === "contains" ? `%${f.value}%` : f.value;
      const path = f.category
        ? `custom_data->${f.category}->>${f.key}`
        : `custom_data->>${f.key}`;
      q = q.filter(path, op, val);
    }
  }
  return q;
}

async function fetchLatestCallSnapshots(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  organisationId: string,
  leadIds: string[],
): Promise<Map<string, UnifiedCallRecord>> {
  const out = new Map<string, UnifiedCallRecord>();
  if (leadIds.length === 0) return out;

  const CHUNK_SIZE = 100;
  const chunks: string[][] = [];
  for (let i = 0; i < leadIds.length; i += CHUNK_SIZE) {
    chunks.push(leadIds.slice(i, i + CHUNK_SIZE));
  }

  const CONCURRENCY = 8;
  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    const pool = chunks.slice(i, i + CONCURRENCY);
    await Promise.all(
      pool.map(async (chunk) => {
        let offset = 0;
        let hasMore = true;
        const BATCH = 1_000;

        while (hasMore) {
          const { data, error } = await admin
            .from("calls")
            .select(
              "id, bolna_call_id, lead_id, direction, status, agent_id, to_phone, from_phone, started_at, duration_seconds, summary, transcript, call_outcome, interest, lead_intent_extracted, customer_status, actionable, visit_scheduled_at, connect_on_whatsapp, lead_data, custom_data",
            )
            .eq("organisation_id", organisationId)
            .in("lead_id", chunk)
            .order("started_at", { ascending: false })
            .range(offset, offset + BATCH - 1);

          if (error) {
            logSkeloError("EXPORT", "Latest-call snapshot fetch failed", {
              organisationId,
              cause: error,
            });
            break;
          }

          const rows = (data ?? []) as Array<UnifiedCallRecord & { lead_id: string }>;
          for (const row of rows) {
            if (!out.has(row.lead_id)) {
              out.set(row.lead_id, row);
            }
          }

          if (rows.length < BATCH) {
            hasMore = false;
          } else {
            offset += BATCH;
          }
        }
      }),
    );
  }

  // Resolve agent labels
  const agentIds = Array.from(
    new Set(
      Array.from(out.values())
        .map((c) => c.agent_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const agentLabels = await fetchAgentLabels(admin, organisationId, agentIds);
  for (const c of out.values()) {
    if (c.agent_id) {
      c.agent_label = agentLabels.get(c.agent_id) ?? null;
    }
  }

  return out;
}
