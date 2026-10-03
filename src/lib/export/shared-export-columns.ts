import type { SupabaseClient } from "@supabase/supabase-js";
import { type CsvColumn } from "@/lib/csv";
import {
  humaniseFieldKey,
  stringifyCustomValue,
  UNGROUPED_CATEGORIES,
  discoverCustomFields,
  type CustomFieldsCarrier,
} from "@/lib/csv-custom-fields";

export interface ExtractionSourceLocation {
  source_column: "lead_data" | "custom_data";
  category: string;
  key_path: string;
}

export interface ExtractionFieldDef {
  header: string;
  source_column: "lead_data" | "custom_data";
  category: string;
  key_path: string;
  sources?: ExtractionSourceLocation[];
}

export interface UnifiedCallRecord extends CustomFieldsCarrier {
  id: string;
  bolna_call_id?: string | null;
  direction?: string | null;
  status?: string | null;
  agent_id?: string | null;
  agent_label?: string | null;
  to_phone?: string | null;
  from_phone?: string | null;
  counterparty_phone?: string | null;
  started_at?: string | null;
  duration_seconds?: number | null;
  summary?: string | null;
  transcript?: string | null;
  call_outcome?: string | null;
  interest?: string | null;
  lead_intent_extracted?: string | null;
  customer_status?: string | null;
  actionable?: string | null;
  visit_scheduled_at?: string | null;
  connect_on_whatsapp?: boolean | null;
  lead?: { name?: string | null; phone?: string | null } | null;
}

export interface UnifiedLeadRecord extends CustomFieldsCarrier {
  id: string;
  created_at: string;
  updated_at?: string;
  name?: string | null;
  phone?: string | null;
  current_intent?: string | null;
  status?: string | null;
  notes?: string | null;
  latestCall?: UnifiedCallRecord | null;
}

export async function fetchAgentLabels(
  admin: SupabaseClient,
  organisationId: string,
  agentIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (agentIds.length === 0) return out;

  const { data } = await admin
    .from("voice_agents")
    .select("agent_id, label")
    .eq("organisation_id", organisationId)
    .in("agent_id", agentIds);

  for (const r of (data ?? []) as Array<{ agent_id: string; label: string | null }>) {
    if (r.label) out.set(r.agent_id, r.label);
  }
  return out;
}

export async function getExportExtractionDefinitions(
  admin: SupabaseClient,
  organisationId: string,
  rows: CustomFieldsCarrier[],
): Promise<ExtractionFieldDef[]> {
  const { data: rawDefs } = await admin
    .from("lead_field_definitions")
    .select("source_column, category, key_path, label, display_order")
    .eq("organisation_id", organisationId)
    .in("source_column", ["lead_data", "custom_data"])
    .order("display_order", { ascending: true })
    .order("key_path", { ascending: true });

  const excludedKeys = new Set([
    "name",
    "phone",
    "business_slug",
    "id",
    "call_id",
    "summary",
    "call summary",
    "call_summary",
    "transcript",
    "call transcript",
    "call_transcript",
  ]);

  const out: ExtractionFieldDef[] = [];
  const defsByNormHeader = new Map<string, ExtractionFieldDef>();

  function registerExtraction(
    source_column: "lead_data" | "custom_data",
    category: string,
    key_path: string,
    label?: string | null,
  ) {
    const keyLower = key_path.toLowerCase();
    if (excludedKeys.has(keyLower)) return;

    const cat = category ?? "";
    const header =
      label?.trim() ||
      (cat && !UNGROUPED_CATEGORIES.has(cat.toLowerCase())
        ? `${humaniseFieldKey(cat)} > ${humaniseFieldKey(key_path)}`
        : humaniseFieldKey(key_path));

    const normKey = header.trim().toLowerCase();
    const existing = defsByNormHeader.get(normKey);

    const loc: ExtractionSourceLocation = {
      source_column,
      category: cat,
      key_path,
    };

    if (existing) {
      if (!existing.sources) {
        existing.sources = [
          {
            source_column: existing.source_column,
            category: existing.category,
            key_path: existing.key_path,
          },
        ];
      }
      const already = existing.sources.some(
        (s) =>
          s.source_column === source_column &&
          s.category === cat &&
          s.key_path.toLowerCase() === key_path.toLowerCase(),
      );
      if (!already) {
        existing.sources.push(loc);
      }
    } else {
      const def: ExtractionFieldDef = {
        header,
        source_column,
        category: cat,
        key_path,
        sources: [loc],
      };
      defsByNormHeader.set(normKey, def);
      out.push(def);
    }
  }

  for (const d of rawDefs ?? []) {
    registerExtraction(
      d.source_column as "lead_data" | "custom_data",
      d.category ?? "",
      d.key_path,
      d.label,
    );
  }

  // Also discover any extra fields present in rows that weren't in catalog
  const discovered = discoverCustomFields(rows, excludedKeys);
  for (const disc of discovered) {
    registerExtraction(disc.source, disc.category, disc.key, disc.header);
  }

  return out;
}

function getFromRecordCaseInsensitive(
  rec: Record<string, unknown> | null | undefined,
  key: string,
): unknown {
  if (!rec || typeof rec !== "object") return undefined;
  if (key in rec && rec[key] !== undefined && rec[key] !== null) {
    return rec[key];
  }
  const keyLower = key.toLowerCase();
  for (const k of Object.keys(rec)) {
    if (k.toLowerCase() === keyLower && rec[k] !== undefined && rec[k] !== null) {
      return rec[k];
    }
  }
  return undefined;
}

export function resolveCallExtractionValue(
  c: UnifiedCallRecord,
  ext: ExtractionFieldDef,
): unknown {
  const sources =
    ext.sources && ext.sources.length > 0
      ? ext.sources
      : [
          {
            source_column: ext.source_column,
            category: ext.category,
            key_path: ext.key_path,
          },
        ];

  for (const src of sources) {
    if (src.source_column === "lead_data") {
      const val = getFromRecordCaseInsensitive(c.lead_data, src.key_path);
      if (val !== undefined && val !== null && val !== "") return val;

      const key = src.key_path.toLowerCase();
      if (key === "interest" && c.interest) return c.interest;
      if (key === "customer_status" && c.customer_status) return c.customer_status;
      if (key === "actionable" && c.actionable) return c.actionable;
      if (
        (key === "visit_scheduled_at" || key === "date_and_time_of_visit") &&
        c.visit_scheduled_at
      )
        return c.visit_scheduled_at;
      if (
        (key === "connect_on_whatsapp" || key === "wants_to_connect_on_watsapp") &&
        c.connect_on_whatsapp !== null &&
        c.connect_on_whatsapp !== undefined
      )
        return c.connect_on_whatsapp;
      if (key === "call_outcome" && c.call_outcome) return c.call_outcome;
      if (key === "lead_intent" && c.lead_intent_extracted)
        return c.lead_intent_extracted;
    } else {
      const cd = c.custom_data as Record<string, unknown> | undefined;
      if (cd && typeof cd === "object") {
        if (src.category) {
          const catObj = cd[src.category] as Record<string, unknown> | undefined;
          const val = getFromRecordCaseInsensitive(catObj, src.key_path);
          if (val !== undefined && val !== null && val !== "") return val;
        }
        const flatObj = cd[""] as Record<string, unknown> | undefined;
        const valFlat = getFromRecordCaseInsensitive(flatObj, src.key_path);
        if (valFlat !== undefined && valFlat !== null && valFlat !== "")
          return valFlat;

        const valRoot = getFromRecordCaseInsensitive(cd, src.key_path);
        if (valRoot !== undefined && valRoot !== null && valRoot !== "")
          return valRoot;
      }
    }
  }

  // Fallback: cross-check known properties (e.g. if extraction is interest)
  const keyLower = ext.key_path.toLowerCase();
  if (keyLower === "interest") {
    if (c.interest) return c.interest;
    const inLead = getFromRecordCaseInsensitive(c.lead_data, "interest");
    if (inLead !== undefined && inLead !== null && inLead !== "") return inLead;
    const cd = c.custom_data as Record<string, unknown> | undefined;
    if (cd) {
      const val =
        getFromRecordCaseInsensitive(cd[""] as Record<string, unknown>, "interest") ??
        getFromRecordCaseInsensitive(cd, "interest");
      if (val !== undefined && val !== null && val !== "") return val;
    }
  }

  return null;
}

export function resolveLeadExtractionValue(
  l: UnifiedLeadRecord,
  ext: ExtractionFieldDef,
): unknown {
  const sources =
    ext.sources && ext.sources.length > 0
      ? ext.sources
      : [
          {
            source_column: ext.source_column,
            category: ext.category,
            key_path: ext.key_path,
          },
        ];

  for (const src of sources) {
    if (src.source_column === "lead_data") {
      const val = getFromRecordCaseInsensitive(l.lead_data, src.key_path);
      if (val !== undefined && val !== null && val !== "") return val;

      const key = src.key_path.toLowerCase();
      if (key === "lead_intent" || key === "intent") {
        if (l.current_intent) return l.current_intent;
      }
    } else {
      const cd = l.custom_data as Record<string, unknown> | undefined;
      if (cd && typeof cd === "object") {
        if (src.category) {
          const catObj = cd[src.category] as Record<string, unknown> | undefined;
          const val = getFromRecordCaseInsensitive(catObj, src.key_path);
          if (val !== undefined && val !== null && val !== "") return val;
        }
        const flatObj = cd[""] as Record<string, unknown> | undefined;
        const valFlat = getFromRecordCaseInsensitive(flatObj, src.key_path);
        if (valFlat !== undefined && valFlat !== null && valFlat !== "")
          return valFlat;

        const valRoot = getFromRecordCaseInsensitive(cd, src.key_path);
        if (valRoot !== undefined && valRoot !== null && valRoot !== "")
          return valRoot;
      }
    }
  }

  // Fallback for lead interest
  const keyLower = ext.key_path.toLowerCase();
  if (keyLower === "interest") {
    const inLead = getFromRecordCaseInsensitive(l.lead_data, "interest");
    if (inLead !== undefined && inLead !== null && inLead !== "") return inLead;
    const cd = l.custom_data as Record<string, unknown> | undefined;
    if (cd) {
      const val =
        getFromRecordCaseInsensitive(cd[""] as Record<string, unknown>, "interest") ??
        getFromRecordCaseInsensitive(cd, "interest");
      if (val !== undefined && val !== null && val !== "") return val;
    }
  }

  return null;
}


export function resolveSummaryValue(
  call?: UnifiedCallRecord | null,
  lead?: UnifiedLeadRecord | null,
): string | null {
  if (call) {
    if (call.summary && call.summary.trim()) return call.summary.trim();
    const cdGen = (call.custom_data as Record<string, unknown> | null)?.General as Record<string, unknown> | undefined;
    if (cdGen && typeof cdGen["Call Summary"] === "string" && cdGen["Call Summary"].trim()) {
      return cdGen["Call Summary"].trim();
    }
    const cdFlat = (call.custom_data as Record<string, unknown> | null)?.[""] as Record<string, unknown> | undefined;
    if (cdFlat && typeof cdFlat["Call Summary"] === "string" && cdFlat["Call Summary"].trim()) {
      return cdFlat["Call Summary"].trim();
    }
    if (call.lead_data && typeof call.lead_data.summary === "string" && call.lead_data.summary.trim()) {
      return call.lead_data.summary.trim();
    }
  }
  if (lead?.notes && lead.notes.trim()) return lead.notes.trim();
  return null;
}

export function resolveTranscriptValue(
  call?: UnifiedCallRecord | null,
): string | null {
  if (!call) return null;
  if (call.transcript && call.transcript.trim()) return call.transcript.trim();
  const cdFlat = (call.custom_data as Record<string, unknown> | null)?.[""] as Record<string, unknown> | undefined;
  if (cdFlat && typeof cdFlat.transcript === "string" && cdFlat.transcript.trim()) {
    return cdFlat.transcript.trim();
  }
  if (call.lead_data && typeof call.lead_data.transcript === "string" && call.lead_data.transcript.trim()) {
    return call.lead_data.transcript.trim();
  }
  return null;
}

export function buildCallExportCsvColumns(
  extractions: ExtractionFieldDef[],
): CsvColumn<UnifiedCallRecord>[] {
  const cols: CsvColumn<UnifiedCallRecord>[] = [
    { header: "Call ID", value: (c) => c.id },
    {
      header: "To Number",
      value: (c) =>
        c.to_phone ||
        (c.direction === "outbound"
          ? c.lead?.phone || c.counterparty_phone
          : c.lead?.phone || null),
    },
    {
      header: "From Number",
      value: (c) =>
        c.from_phone ||
        (c.direction === "inbound"
          ? c.lead?.phone || c.counterparty_phone
          : null),
    },
    { header: "Date & Time", value: (c) => c.started_at },
    { header: "Duration (sec)", value: (c) => c.duration_seconds },
    {
      header: "Direction",
      value: (c) =>
        c.direction
          ? c.direction.charAt(0).toUpperCase() + c.direction.slice(1)
          : null,
    },
    {
      header: "Outcome",
      value: (c) =>
        c.status ? c.status.charAt(0).toUpperCase() + c.status.slice(1) : null,
    },
    {
      header: "Disposition",
      value: (c) =>
        c.call_outcome ?? c.interest ?? c.lead_intent_extracted ?? null,
    },
  ];

  for (const ext of extractions) {
    cols.push({
      header: ext.header,
      value: (c) => stringifyCustomValue(resolveCallExtractionValue(c, ext)),
    });
  }

  cols.push(
    { header: "Agent", value: (c) => c.agent_label ?? c.agent_id ?? null },
    { header: "Summary", value: (c) => resolveSummaryValue(c, null) },
    { header: "Transcript", value: (c) => resolveTranscriptValue(c) },
  );

  return cols;
}

export function buildLeadExportCsvColumns(
  extractions: ExtractionFieldDef[],
): CsvColumn<UnifiedLeadRecord>[] {
  const cols: CsvColumn<UnifiedLeadRecord>[] = [
    { header: "Call ID", value: (l) => l.latestCall?.id ?? null },
    {
      header: "To Number",
      value: (l) =>
        l.latestCall?.to_phone ||
        (l.latestCall?.direction === "outbound"
          ? l.phone || l.latestCall?.counterparty_phone
          : l.phone || null),
    },
    {
      header: "From Number",
      value: (l) =>
        l.latestCall?.from_phone ||
        (l.latestCall?.direction === "inbound"
          ? l.phone || l.latestCall?.counterparty_phone
          : null),
    },
    {
      header: "Date & Time",
      value: (l) => l.latestCall?.started_at || l.created_at,
    },
    {
      header: "Duration (sec)",
      value: (l) => l.latestCall?.duration_seconds ?? null,
    },
    {
      header: "Direction",
      value: (l) =>
        l.latestCall?.direction
          ? l.latestCall.direction.charAt(0).toUpperCase() +
            l.latestCall.direction.slice(1)
          : null,
    },
    {
      header: "Outcome",
      value: (l) =>
        l.latestCall?.status
          ? l.latestCall.status.charAt(0).toUpperCase() +
            l.latestCall.status.slice(1)
          : l.status
            ? l.status.charAt(0).toUpperCase() + l.status.slice(1)
            : null,
    },
    {
      header: "Disposition",
      value: (l) =>
        l.latestCall?.call_outcome ??
        l.latestCall?.interest ??
        l.latestCall?.lead_intent_extracted ??
        (l.current_intent
          ? l.current_intent.charAt(0).toUpperCase() +
            l.current_intent.slice(1)
          : null),
    },
  ];

  for (const ext of extractions) {
    cols.push({
      header: ext.header,
      value: (l) => {
        let raw = l.latestCall
          ? resolveCallExtractionValue(l.latestCall, ext)
          : null;
        if (raw === null || raw === undefined) {
          raw = resolveLeadExtractionValue(l, ext);
        }
        return stringifyCustomValue(raw);
      },
    });
  }

  cols.push(
    {
      header: "Agent",
      value: (l) =>
        l.latestCall?.agent_label ?? l.latestCall?.agent_id ?? null,
    },
    { header: "Summary", value: (l) => resolveSummaryValue(l.latestCall, l) },
    { header: "Transcript", value: (l) => resolveTranscriptValue(l.latestCall) },
  );

  return cols;
}
