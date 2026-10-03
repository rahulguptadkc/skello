import { z } from "zod";

import { parseProviderTimestamp } from "@/lib/time";
import { type CallOutcome, KNOWN_CALL_OUTCOMES } from "@/types/call";

// Per-field caps bound the work the webhook does on a single payload. Bolna's
// real-world values are well under these; the limits exist so a leaked webhook
// secret or a buggy provider payload can't push multi-MB strings into the DB.
const REASONING_MAX = 5_000;

// Resilience: every field carries `.catch(...)` so an unexpected shape from the
// provider (e.g. `confidence` sent as the string "0.8", or `subjective` sent as
// an object) degrades that ONE field to a safe fallback instead of failing the
// whole payload — which would 400 the webhook and lose the entire call result +
// campaign/recovery disposition. We read these defensively (see pickValue), so a
// null fallback is harmless.
const bolnaFieldSchema = z
  .object({
    subjective: z
      .union([z.string(), z.number(), z.boolean(), z.null()])
      .optional()
      .catch(null),
    objective: z
      .union([z.string(), z.number(), z.boolean(), z.null()])
      .optional()
      .catch(null),
    // Bolna leaves the per-side reasoning string `null` when only the
    // opposite side was filled, so both reasoning fields must accept null.
    reasoning_subjective: z.string().max(REASONING_MAX).nullish().catch(null),
    reasoning_objective: z.string().max(REASONING_MAX).nullish().catch(null),
    confidence: z.number().nullish().catch(null),
    confidence_label: z.string().max(200).nullish().catch(null),
    validation: z.unknown().nullish(),
  })
  .passthrough();

// Bolna fires the webhook three times per call (in-progress → disconnected →
// completed). Only the final event has `extracted_data` populated; the first
// two send it as `null`. The schema must accept the missing case so we can
// short-circuit them with a 200 instead of failing validation with a 400.
//
// extracted_data carries `lead_data` (the canonical, first-class category)
// plus any number of additional category buckets — e.g. extra_data, finance,
// vehicle. The catchall captures every other top-level key under
// extracted_data without enumerating it; each one must still be a record of
// BolnaField entries so the merge pipeline can rely on the shape.
export const bolnaLeadPayloadSchema = z
  .object({
    // `.catch({})` on each record value: a bucket entry that isn't a field
    // object at all (e.g. a bare string) drops to `{}` instead of failing the
    // record. The whole `extracted_data` also `.catch(null)`s so a wholly
    // malformed shape (e.g. lead_data sent as an array) degrades to the
    // pre-extraction path (status update only) rather than 400-ing the webhook.
    extracted_data: z
      .object({
        lead_data: z.record(z.string(), bolnaFieldSchema.catch({})),
      })
      .catchall(z.record(z.string(), bolnaFieldSchema.catch({})))
      .nullable()
      .optional()
      .catch(null),
    status: z.string().nullish(),
    user_number: z.string().nullish(),
    agent_number: z.string().nullish(),
    transcript: z.string().nullish(),
    summary: z.string().nullish(),
    agent_id: z.string().nullish(),
    conversation_duration: z.number().nullish(),
    created_at: z.string().nullish(),
    updated_at: z.string().nullish(),
    initiated_at: z.string().nullish(),
    total_cost: z.number().nullish(),
    error_message: z.string().nullish(),
    telephony_data: z
      .object({
        to_number: z.string().nullish(),
        from_number: z.string().nullish(),
        recording_url: z.string().nullish(),
        call_type: z.string().nullish(),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();

export type BolnaField = z.infer<typeof bolnaFieldSchema>;
export type BolnaLeadPayload = z.infer<typeof bolnaLeadPayloadSchema>;

/**
 * Bolna returns each field with both `subjective` and `objective` candidates.
 * Prefer subjective; fall back to objective. Treat empty strings as absent.
 */
export function pickValue(field: BolnaField | undefined): string | null {
  if (!field) return null;
  const s = field.subjective;
  if (s !== null && s !== undefined && String(s).trim() !== "") return String(s);
  const o = field.objective;
  if (o !== null && o !== undefined && String(o).trim() !== "") return String(o);
  return null;
}

export function toBoolean(v: string | null): boolean | null {
  if (v === null) return null;
  const lower = v.toLowerCase().trim();
  if (["true", "yes", "1"].includes(lower)) return true;
  if (["false", "no", "0"].includes(lower)) return false;
  return null;
}

// Agent-extracted times (callback_at, date_and_time_of_visit) are spoken in the
// customer's LOCAL zone and usually arrive without a timezone. Interpret them in
// the app's configured zone, not the server's — see parseProviderTimestamp.
export function toTimestamp(v: string | null): string | null {
  return parseProviderTimestamp(v);
}

// Normalise any outcome-ish string to a stable key: trim, lowercase, and
// collapse runs of non-alphanumeric characters to a single underscore. The
// admin UI stores outcome keys through the SAME function, so the label the
// voice agent emits and the org's configured key match. Examples:
//   "Call me later!" → "call_me_later"
//   "Not Interested" → "not_interested"
export function normalizeOutcomeKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// Common spoken/spacey variants of the SEVEN seeded defaults → their canonical
// key, so an out-of-the-box org works even when the agent says "call me later"
// instead of "callback_requested". Keyed by the NORMALISED form. Custom outcome
// keys an org defines are matched verbatim against its policy, so they pass
// through untouched here.
const OUTCOME_ALIASES: Record<string, CallOutcome> = {
  uninterested: "not_interested",
  no: "not_interested",
  nahi: "not_interested",
  na: "not_interested",
  not_interested: "not_interested",
  callback: "callback_requested",
  call_back: "callback_requested",
  call_later: "callback_requested",
  call_me_later: "callback_requested",
  call_again: "callback_requested",
  dnc: "do_not_call",
  remove_me: "do_not_call",
  meeting_scheduled: "meeting_booked",
  appointment_booked: "meeting_booked",
  booked: "meeting_booked",
  undecided: "no_decision",
  yes: "interested",
  ha: "interested",
  haan: "interested",
  no_contact: "no_conversation",
  no_conv: "no_conversation",
  no_response: "no_conversation",
  hung_up: "no_conversation",
  call_dropped: "no_conversation",
};

// Resolve the agent's raw `call_outcome` string to a stable outcome key. Known
// defaults (and their aliases) map to canonical keys; any other value passes
// through as a normalised custom key. The PER-ORG policy decides what an
// unconfigured key does at decision time (it resolves to the org's fallback).
export function coerceCallOutcome(raw: string | null): CallOutcome | null {
  if (!raw) return null;
  const key = normalizeOutcomeKey(raw);
  if (!key) return null;
  if ((KNOWN_CALL_OUTCOMES as readonly string[]).includes(key)) return key;
  return OUTCOME_ALIASES[key] ?? key;
}

export interface ExtractedLead {
  business_slug: string | null;
  name: string | null;
  interest: string | null;
  customer_status: string | null;
  lead_intent: string | null;
  /** Raw 0-100 buying-intent score; coerced and range-checked downstream. */
  intent_score: string | null;
  actionable: string | null;
  connect_on_whatsapp: boolean | null;
  visit_scheduled_at: string | null;
  call_outcome: CallOutcome | null;
  requested_callback_at: string | null;
  confidence: Record<string, number>;
  summary: string | null;
}

export function findFieldValue(
  record: Record<string, BolnaField> | undefined,
  ...candidateKeys: string[]
): string | null {
  if (!record) return null;
  const normCandidates = candidateKeys.map((k) =>
    k.toLowerCase().replace(/[^a-z0-9]/g, ""),
  );
  for (const [key, field] of Object.entries(record)) {
    const normKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (normCandidates.includes(normKey)) {
      const val = pickValue(field);
      if (val !== null && val.trim() !== "") return val.trim();
    }
  }
  return null;
}

export function extractLead(
  leadData: Record<string, BolnaField>,
): ExtractedLead {
  const ld = leadData;

  const confidence: Record<string, number> = {};
  for (const [key, field] of Object.entries(ld)) {
    if (typeof field?.confidence === "number") confidence[key] = field.confidence;
  }

  const outcomeRaw =
    findFieldValue(ld, "call_outcome", "outcome", "callOutcome") ||
    findFieldValue(ld, "customer_status", "status") ||
    findFieldValue(ld, "lead_intent", "intent") ||
    findFieldValue(ld, "interest") ||
    findFieldValue(ld, "disposition");

  return {
    business_slug: findFieldValue(ld, "business_slug", "slug"),
    name: findFieldValue(ld, "name", "customer_name", "lead_name"),
    interest: findFieldValue(ld, "interest"),
    customer_status: findFieldValue(ld, "customer_status", "status"),
    lead_intent: findFieldValue(ld, "lead_intent", "intent"),
    intent_score: findFieldValue(ld, "intent_score", "score"),
    actionable: findFieldValue(ld, "actionable"),
    connect_on_whatsapp: toBoolean(findFieldValue(ld, "connect_on_whatsapp", "whatsapp")),
    visit_scheduled_at: toTimestamp(findFieldValue(ld, "date_and_time_of_visit", "visit_scheduled_at")),
    call_outcome: coerceCallOutcome(outcomeRaw),
    requested_callback_at: toTimestamp(findFieldValue(ld, "callback_at", "call_back_time", "callback_time")),
    confidence,
    summary: buildSummary(ld),
  };
}

export function extractLeadFromExtractedData(
  extractedData:
    | Record<string, Record<string, BolnaField> | undefined>
    | null
    | undefined,
): ExtractedLead {
  if (!extractedData) return extractLead({});

  const primary = extractedData.lead_data ?? {};
  function find(candidateKeys: string[]): string | null {
    const inPrimary = findFieldValue(primary, ...candidateKeys);
    if (inPrimary !== null) return inPrimary;
    for (const [cat, fields] of Object.entries(extractedData || {})) {
      if (cat === "lead_data" || !fields || typeof fields !== "object") continue;
      const inCat = findFieldValue(fields as Record<string, BolnaField>, ...candidateKeys);
      if (inCat !== null) return inCat;
    }
    return null;
  }

  const outcomeRaw =
    find(["call_outcome", "callOutcome", "outcome", "disposition"]) ||
    find(["interest"]) ||
    find(["customer_status", "status"]) ||
    find(["lead_intent", "intent"]);

  const confidence: Record<string, number> = {};
  for (const fields of Object.values(extractedData || {})) {
    if (fields && typeof fields === "object" && !Array.isArray(fields)) {
      for (const [k, f] of Object.entries(fields)) {
        if (typeof (f as BolnaField)?.confidence === "number") {
          confidence[k] = (f as BolnaField).confidence!;
        }
      }
    }
  }

  return {
    business_slug: find(["business_slug", "slug"]),
    name: find(["name", "customer_name", "lead_name"]),
    interest: find(["interest"]),
    customer_status: find(["customer_status", "status"]),
    lead_intent: find(["lead_intent", "intent"]),
    intent_score: find(["intent_score", "score"]),
    actionable: find(["actionable"]),
    connect_on_whatsapp: toBoolean(find(["connect_on_whatsapp", "whatsapp"])),
    visit_scheduled_at: toTimestamp(find(["date_and_time_of_visit", "visit_scheduled_at"])),
    call_outcome: coerceCallOutcome(outcomeRaw),
    requested_callback_at: toTimestamp(find(["callback_at", "call_back_time", "callback_time"])),
    confidence,
    summary: buildSummary(primary),
  };
}

// Bolna emits a `reasoning_subjective` string on each `lead_data` field
// describing why the model chose that value. We concatenate these into a
// single human-readable summary keyed by field label.
const SUMMARY_MAX = 10_000;

export function buildSummary(
  leadData: Record<string, BolnaField>,
): string | null {
  const parts: string[] = [];
  for (const [key, field] of Object.entries(leadData)) {
    const reasoning = field?.reasoning_subjective?.trim();
    if (!reasoning) continue;
    parts.push(`${humaniseFieldKey(key)}: ${reasoning}`);
  }
  if (parts.length === 0) return null;
  const joined = parts.join("\n\n");
  return joined.length > SUMMARY_MAX ? joined.slice(0, SUMMARY_MAX) : joined;
}

function humaniseFieldKey(key: string): string {
  return key
    .split("_")
    .map((word) => (word.length === 0 ? word : word[0].toUpperCase() + word.slice(1)))
    .join(" ");
}
