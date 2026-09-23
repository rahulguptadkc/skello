import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { leadActivityFilterSchema } from "@/lib/validations/lead-activity";
import { humaniseFieldKey } from "@/lib/format/keys";
import {
  type CustomFieldsCarrier,
  stringifyCustomValue,
} from "@/lib/csv-custom-fields";
import { logSkeloError } from "@/lib/errors";
import { requireSession } from "@/lib/auth/session";
import { type CsvColumn, toCsv, withBom } from "@/lib/csv";
import { checkRateLimit, tooManyRequestsResponse } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Per-export row cap. We paginate Supabase PostgREST in batches
// (since PostgREST defaults to a 1,000 max-rows per-request limit) up to EXPORT_CAP
// so that large datasets are fully exported without silent row truncations.
const EXPORT_CAP = 50_000;

// Backend contract: the frontend resolves a preset (or custom date inputs)
// into concrete from/to ISO timestamps and posts them as query params.
// `range` is carried through for the filename only; the query uses
// from/to. `null` on either bound means "open" on that side.
//
// `filters` and `search` mirror the leads-table state and flow into the
// `lead_call_activity` RPC via p_filters / p_search. The route does NOT
// validate the filter set's referential integrity (key existence in the
// catalog) — the RPC silently drops filters whose `source` it doesn't
// recognise, and any wrong-type comparison turns into "no rows match"
// (safer than returning everything by accident).
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

// The RPC `lead_call_activity` returns LeadRow's fields + the per-row call
// snapshot (latest_call_interest/summary/recording_url) + the aggregate
// columns. The export only consumes the LeadRow fields here; downstream
// code doesn't read the aggregates so they're typed as unknown extras.
interface LeadRow extends CustomFieldsCarrier {
  id: string;
  created_at: string;
  updated_at: string;
  name: string | null;
  phone: string | null;
  current_intent: string | null;
  source: string | null;
  status: string;
  pending_action: boolean;
  notes: string | null;
  city: string | null;
  pincode: string | null;
  owner_label?: string | null;
  inbound_calls?: number | string | null;
  outbound_calls?: number | string | null;
  total_calls?: number | string | null;
  last_call_at?: string | null;
  first_call_at?: string | null;
  total_duration_seconds?: number | string | null;
}

// Per-call snapshot fields surfaced into the CSV. recording_url was
// intentionally dropped — exporters don't need playback URLs, and surfacing
// them invites leaking signed audio links to anyone who downloads the CSV.
interface CallSnapshot {
  interest: string | null;
  summary: string | null;
  actionable: string | null;
  customer_status: string | null;
  visit_scheduled_at: string | null;
}

interface ExportRow extends LeadRow {
  interest: string | null;
  summary: string | null;
  actionable: string | null;
  customer_status: string | null;
  visit_scheduled_at: string | null;
  wants_to_connect_on_watsapp: boolean | null;
}

function pickJsonString(blob: Record<string, unknown> | null, key: string): string | null {
  if (!blob) return null;
  const v = blob[key];
  if (typeof v === "string" && v.trim().length > 0) return v;
  return null;
}

function pickJsonBool(blob: Record<string, unknown> | null, key: string): boolean | null {
  if (!blob) return null;
  const v = blob[key];
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const lower = v.toLowerCase().trim();
    if (["true", "yes", "1"].includes(lower)) return true;
    if (["false", "no", "0"].includes(lower)) return false;
  }
  return null;
}

function pickJsonDate(blob: Record<string, unknown> | null, key: string): string | null {
  const v = pickJsonString(blob, key);
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

import type { LeadFieldDefinition } from "@/types/lead-field-definition";

function resolveLeadFieldValue(
  row: ExportRow,
  def: Pick<
    LeadFieldDefinition,
    "source_column" | "category" | "key_path" | "data_type"
  >,
): string | number | null {
  if (def.source_column === "column") {
    switch (def.key_path) {
      case "inbound_calls":
        return row.inbound_calls !== undefined && row.inbound_calls !== null
          ? Number(row.inbound_calls)
          : 0;
      case "outbound_calls":
        return row.outbound_calls !== undefined && row.outbound_calls !== null
          ? Number(row.outbound_calls)
          : 0;
      case "total_calls":
        return row.total_calls !== undefined && row.total_calls !== null
          ? Number(row.total_calls)
          : 0;
      case "last_call_at":
        return row.last_call_at ?? null;
      case "first_call_at":
        return row.first_call_at ?? null;
      case "current_intent": {
        const val = row.current_intent;
        if (typeof val === "string" && val.trim()) {
          return val.charAt(0).toUpperCase() + val.slice(1);
        }
        return null;
      }
      case "pending_action":
        return row.pending_action ? "Pending" : "No";
      case "status":
        return row.status
          ? row.status.charAt(0).toUpperCase() + row.status.slice(1)
          : null;
      case "source":
        return row.source ?? null;
      case "notes":
        return row.notes ?? null;
      case "city":
        return row.city ?? null;
      case "pincode":
        return row.pincode ?? null;
      case "owner_label":
        return row.owner_label ?? null;
      case "created_at":
        return row.created_at ?? null;
      case "updated_at":
        return row.updated_at ?? null;
      default: {
        const raw = (row as unknown as Record<string, unknown>)[def.key_path];
        return stringifyCustomValue(raw);
      }
    }
  }

  let raw: unknown = null;
  if (def.source_column === "lead_data") {
    raw = row.lead_data?.[def.key_path];
    if (raw === undefined || raw === null) {
      if (def.key_path === "interest") raw = row.interest;
      else if (def.key_path === "summary") raw = row.summary;
      else if (def.key_path === "actionable") raw = row.actionable;
      else if (def.key_path === "customer_status") raw = row.customer_status;
      else if (
        def.key_path === "date_and_time_of_visit" ||
        def.key_path === "visit_scheduled_at"
      )
        raw = row.visit_scheduled_at;
      else if (
        def.key_path === "connect_on_whatsapp" ||
        def.key_path === "wants_to_connect_on_watsapp"
      )
        raw = row.wants_to_connect_on_watsapp;
    }
  } else if (def.source_column === "custom_data") {
    const cd = row.custom_data;
    if (cd) {
      const cat = def.category ?? "";
      if (cat === "") {
        raw = cd[def.key_path];
      } else {
        raw = cd[cat]?.[def.key_path];
      }
    }
  }

  if (raw === undefined || raw === null) return null;

  if (def.data_type === "boolean") {
    const truthy =
      raw === true ||
      (typeof raw === "string" &&
        ["true", "yes", "1"].includes(raw.toLowerCase()));
    return truthy ? "Yes" : "No";
  }
  if (def.data_type === "number") {
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  if (def.data_type === "date") {
    if (typeof raw === "string") return raw;
    if (raw instanceof Date) return raw.toISOString();
    return String(raw);
  }

  return stringifyCustomValue(raw);
}

function buildVisibleCsvColumns(
  defs: Array<
    Pick<
      LeadFieldDefinition,
      "source_column" | "category" | "key_path" | "label" | "data_type"
    >
  >,
): CsvColumn<ExportRow>[] {
  const columns: CsvColumn<ExportRow>[] = [
    { header: "Name", value: (l) => l.name },
    { header: "Phone", value: (l) => l.phone },
  ];

  if (defs.length === 0) {
    return [
      ...columns,
      {
        header: "Intent",
        value: (l) =>
          l.current_intent
            ? l.current_intent.charAt(0).toUpperCase() +
              l.current_intent.slice(1)
            : null,
      },
      {
        header: "Status",
        value: (l) =>
          l.status
            ? l.status.charAt(0).toUpperCase() + l.status.slice(1)
            : null,
      },
      { header: "Source", value: (l) => l.source },
      { header: "Notes", value: (l) => l.notes },
      { header: "Created At", value: (l) => l.created_at },
    ];
  }

  for (const def of defs) {
    const keyLower = def.key_path.toLowerCase();
    const labelLower = def.label?.trim().toLowerCase();
    if (
      keyLower === "name" ||
      keyLower === "phone" ||
      labelLower === "name" ||
      labelLower === "phone" ||
      keyLower === "business_slug"
    ) {
      continue;
    }

    const header =
      def.label?.trim() ||
      (def.source_column === "column" && def.key_path === "inbound_calls"
        ? "In"
        : def.source_column === "column" && def.key_path === "outbound_calls"
          ? "Out"
          : humaniseFieldKey(def.key_path));

    columns.push({
      header,
      value: (row) => resolveLeadFieldValue(row, def),
    });
  }

  return columns;
}

export async function GET(request: NextRequest) {
  const session = await requireSession();

  // 5 exports per minute per user. Each request runs the full
  // lead_call_activity RPC up to 10k rows; the cap keeps a tab-spamming
  // user from saturating the database without being so tight that the
  // dialog's count-then-export flow gets blocked.
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
  // Use the same RPC as the leads table so the export's WHERE clause stays
  // in lockstep with the in-app filter logic — same catalog awareness for
  // dynamic JSONB fields, same column allowlist, same date-range handling.
  const BATCH_SIZE = 1_000;
  const allLeads: LeadRow[] = [];
  let offset = 0;
  let hasMore = true;
  let truncated = false;

  while (hasMore) {
    const { data, error } = await admin.rpc("lead_call_activity", {
      p_org_id: session.organisation.id,
      p_org_slug: session.organisation.slug,
      p_include_zero_calls: true,
      p_limit: BATCH_SIZE,
      p_offset: offset,
      p_filters: filters ?? [],
      p_sort_by: {
        source: "column",
        key: "created_at",
        dir: "desc",
        type: "date",
      },
      p_search: search ?? null,
      p_from: from ?? null,
      p_to: to ?? null,
    });
    if (error) {
      const message = logSkeloError("EXPORT", "Lead export query failed", {
        organisationId: session.organisation.id,
        cause: error,
      });
      return NextResponse.json({ error: message }, { status: 500 });
    }

    const batch = (data ?? []) as LeadRow[];
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

  // Batch-fetch the most recent call per lead for the snapshot fields.
  // Single round trip; DISTINCT ON pinned via in-memory pick to avoid an
  // RPC. Acceptable up to ~10k rows.
  const snapshots = await fetchLatestCallSnapshots(
    session.organisation.id,
    leads.map((l) => l.id),
  );

  const rows: ExportRow[] = leads.map((l) => {
    const snap = snapshots.get(l.id);
    return {
      ...l,
      interest: snap?.interest ?? pickJsonString(l.lead_data, "interest"),
      summary: snap?.summary ?? null,
      actionable: snap?.actionable ?? pickJsonString(l.lead_data, "actionable"),
      customer_status:
        snap?.customer_status ?? pickJsonString(l.lead_data, "customer_status"),
      visit_scheduled_at:
        snap?.visit_scheduled_at ??
        pickJsonDate(l.lead_data, "date_and_time_of_visit"),
      wants_to_connect_on_watsapp: pickJsonBool(l.lead_data, "connect_on_whatsapp"),
    };
  });

  const { data: rawDefs } = await admin
    .from("lead_field_definitions")
    .select(
      "id, source_column, category, key_path, label, data_type, visible_in_table, display_order",
    )
    .eq("organisation_id", session.organisation.id)
    .eq("visible_in_table", true)
    .order("display_order", { ascending: true })
    .order("key_path", { ascending: true });

  const csvColumns = buildVisibleCsvColumns(rawDefs ?? []);
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
      // Forensic + UX headers: the dialog reads these to surface a toast
      // confirming row count and (when relevant) the cap being hit.
      "X-Export-Cap": String(EXPORT_CAP),
      "X-Export-Rows": String(leads.length),
      "X-Export-Truncated": truncated ? "true" : "false",
    },
  });
}

async function fetchLatestCallSnapshots(
  organisationId: string,
  leadIds: string[],
): Promise<Map<string, CallSnapshot>> {
  const out = new Map<string, CallSnapshot>();
  if (leadIds.length === 0) return out;
  const admin = createAdminClient();
  // Safe chunk size (100 UUIDs ~ 3.7KB query string) to avoid exceeding
  // HTTP server/parser URL and header length limits (typically 16KB max).
  const CHUNK_SIZE = 100;
  const BATCH_SIZE = 1_000;

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

        while (hasMore) {
          const { data, error } = await admin
            .from("calls")
            .select(
              "lead_id, interest, summary, actionable, customer_status, visit_scheduled_at, started_at",
            )
            .eq("organisation_id", organisationId)
            .in("lead_id", chunk)
            .order("started_at", { ascending: false })
            .range(offset, offset + BATCH_SIZE - 1);

          if (error) {
            logSkeloError("EXPORT", "Latest-call snapshot fetch failed", {
              organisationId,
              cause: error,
            });
            break;
          }

          const rows = data ?? [];
          for (const row of rows as Array<{
            lead_id: string;
            interest: string | null;
            summary: string | null;
            actionable: string | null;
            customer_status: string | null;
            visit_scheduled_at: string | null;
          }>) {
            if (!out.has(row.lead_id)) {
              out.set(row.lead_id, {
                interest: row.interest,
                summary: row.summary,
                actionable: row.actionable,
                customer_status: row.customer_status,
                visit_scheduled_at: row.visit_scheduled_at,
              });
            }
          }

          if (rows.length < BATCH_SIZE) {
            hasMore = false;
          } else {
            offset += BATCH_SIZE;
          }
        }
      }),
    );
  }

  return out;
}
