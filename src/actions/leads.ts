"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getOrgForUser } from "@/lib/auth/org-access";
import {
  leadCreateSchema,
  leadIdSchema,
  leadListSchema,
  leadUpdateSchema,
} from "@/lib/validations/lead";
import { type ActionResult, fail, ok } from "@/types/action";
import type { Lead, LeadIntent } from "@/types/lead";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// New-shape columns only. Per-call data (interest, summary, actionable,
// recording_url, customer_status, wants_to_connect_on_watsapp,
// visit_date_time) is reconstructed below by reading from lead_data or
// the latest call. external_id no longer exists at the lead level.
const LEAD_COLUMNS =
  "id, created_at, updated_at, organisation_id, org_slug, " +
  "name, phone, phone_normalized, first_seen_at, last_contact_at, " +
  "current_intent, current_intent_score, owner_label, " +
  "city, pincode, notes, source, status, pending_action, " +
  "lead_data, custom_data";

interface LeadRow {
  id: string;
  created_at: string;
  updated_at: string;
  organisation_id: string;
  org_slug: string | null;
  name: string | null;
  phone: string | null;
  phone_normalized: string | null;
  first_seen_at: string | null;
  last_contact_at: string | null;
  current_intent: LeadIntent | null;
  current_intent_score: number | null;
  owner_label: string | null;
  city: string | null;
  pincode: string | null;
  notes: string | null;
  source: Lead["source"];
  status: Lead["status"];
  pending_action: boolean;
  lead_data: Record<string, unknown> | null;
  custom_data: Record<string, Record<string, unknown>> | null;
}

interface LatestCallSnapshot {
  summary: string | null;
  actionable: string | null;
  recording_url: string | null;
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

// Hydrate the back-compat fields on the Lead shape. Reads dynamic fields
// from lead_data and falls back to "" or null. The latest-call snapshot
// is fetched in batch by hydrateLeads().
function buildLead(row: LeadRow, snapshot: LatestCallSnapshot | null): Lead {
  const ld = row.lead_data ?? {};
  const resolvedName =
    row.name ||
    pickJsonString(ld, "customer_name") ||
    pickJsonString(ld, "name") ||
    pickJsonString(ld, "first_name") ||
    null;

  return {
    id: row.id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    organisation_id: row.organisation_id,
    org_slug: row.org_slug,
    phone: row.phone,
    phone_normalized: row.phone_normalized,
    first_seen_at: row.first_seen_at,
    last_contact_at: row.last_contact_at,
    name: resolvedName,
    current_intent: row.current_intent,
    current_intent_score: row.current_intent_score,
    city: row.city,
    pincode: row.pincode,
    notes: row.notes,
    owner_label: row.owner_label,
    status: row.status,
    pending_action: row.pending_action,
    source: row.source,
    lead_data: ld,
    custom_data: row.custom_data ?? {},
    // Back-compat fields:
    lead_intent: row.current_intent,
    interest: pickJsonString(ld, "interest"),
    customer_status: pickJsonString(ld, "customer_status"),
    wants_to_connect_on_watsapp: pickJsonBool(ld, "connect_on_whatsapp"),
    visit_date_time: pickJsonDate(ld, "date_and_time_of_visit"),
    summary: snapshot?.summary ?? null,
    actionable: snapshot?.actionable ?? null,
    recording_url: snapshot?.recording_url ?? null,
    external_id: null,
  };
}

// Batch-fetch the latest call's summary/actionable/recording_url for the
// given lead ids. One round trip; the DISTINCT ON keeps us at one row per
// lead. Returns a Map for O(1) lookup during hydrate.
async function fetchLatestCallSnapshots(
  organisationId: string,
  leadIds: string[],
): Promise<Map<string, LatestCallSnapshot>> {
  const out = new Map<string, LatestCallSnapshot>();
  if (leadIds.length === 0) return out;
  const admin = createAdminClient();
  const CHUNK_SIZE = 500;

  for (let i = 0; i < leadIds.length; i += CHUNK_SIZE) {
    const chunk = leadIds.slice(i, i + CHUNK_SIZE);
    const { data } = await admin
      .from("calls")
      .select("lead_id, summary, actionable, recording_url, started_at")
      .eq("organisation_id", organisationId)
      .in("lead_id", chunk)
      // Admin client bypasses RLS; exclude soft-deleted calls so a hidden
      // campaign dial can't surface as a still-visible lead's latest snapshot.
      .is("deleted_at", null)
      .order("started_at", { ascending: false });

    for (const row of (data ?? []) as Array<{
      lead_id: string;
      summary: string | null;
      actionable: string | null;
      recording_url: string | null;
    }>) {
      if (!out.has(row.lead_id)) {
        out.set(row.lead_id, {
          summary: row.summary,
          actionable: row.actionable,
          recording_url: row.recording_url,
        });
      }
    }
  }

  return out;
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

async function userOwnsOrgBySlug(
  _supabase: SupabaseServerClient | null,
  userId: string,
  orgSlug: string,
  userEmail?: string,
): Promise<{ id: string; slug: string } | null> {
  return getOrgForUser(userId, { slug: orgSlug }, userEmail);
}

// Resolve the caller's active organisation without taking a slug from
// input. Used by read-by-id paths (getLead, deleteLead, etc.)
async function getUserOwnedOrg(
  _supabase: SupabaseServerClient | null,
  userId: string,
  userEmail?: string,
): Promise<{ id: string; slug: string } | null> {
  const admin = createAdminClient();
  const { data: member } = await admin
    .from("organisation_members")
    .select("organisation_id, invited_by, role")
    .eq("user_id", userId)
    .neq("status", "suspended")
    .limit(1)
    .maybeSingle<{ organisation_id: string; invited_by: string | null; role: string }>();

  if (member?.organisation_id) {
    const { data: org } = await admin
      .from("organisations")
      .select("id, slug")
      .eq("id", member.organisation_id)
      .maybeSingle<{ id: string; slug: string }>();
    if (org) return org;
  }

  const { data: ownedOrg } = await admin
    .from("organisations")
    .select("id, slug")
    .eq("owner_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<{ id: string; slug: string }>();
  if (ownedOrg) return ownedOrg;

  if (userEmail) {
    const { data: memberByEmail } = await admin
      .from("organisation_members")
      .select("organisation_id")
      .ilike("email", userEmail.toLowerCase().trim())
      .neq("status", "suspended")
      .limit(1)
      .maybeSingle<{ organisation_id: string }>();
    if (memberByEmail?.organisation_id) {
      const { data: org } = await admin
        .from("organisations")
        .select("id, slug")
        .eq("id", memberByEmail.organisation_id)
        .maybeSingle<{ id: string; slug: string }>();
      if (org) return org;
    }
  }

  return null;
}

export async function listLeads(
  input: unknown,
): Promise<ActionResult<{ items: Lead[]; total: number }>> {
  const parsed = leadListSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const {
    org_slug,
    limit,
    offset,
    q,
    lead_intent,
    pending_action,
    has_phone,
    source,
    status,
  } = parsed.data;

  const { user } = await requireUser();
  if (!user) return fail("Not authenticated");
  const org = await userOwnsOrgBySlug(null, user.id, org_slug, user.email);
  if (!org) return fail("Forbidden");

  const admin = createAdminClient();
  let query = admin
    .from("leads")
    .select(LEAD_COLUMNS, { count: "exact" })
    .eq("organisation_id", org.id)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  // current_intent replaces the old lead_intent column.
  if (lead_intent) query = query.eq("current_intent", lead_intent);
  if (source) query = query.eq("source", source);
  if (status) query = query.eq("status", status);
  if (typeof pending_action === "boolean") {
    query = query.eq("pending_action", pending_action);
  }
  if (has_phone === true) query = query.not("phone", "is", null);
  if (has_phone === false) query = query.is("phone", null);
  if (q && q.trim().length > 0) {
    // Search the new tsvector for richer matches (covers name, notes, and
    // any value in lead_data). Falls back to name/phone ilike if the
    // query is too short to be a useful tsvector input.
    const safe = q.replace(/[%,]/g, " ").trim();
    if (safe.length >= 2) {
      query = query.or(
        `name.ilike.%${safe}%,phone.ilike.%${safe}%`,
      );
    }
  }

  const { data, error, count } = await query;
  if (error) return fail(error.message);

  const rows = (data ?? []) as unknown as LeadRow[];

  // For any leads missing a name, check campaign_contacts and calls to resolve and persist their name
  const unnamedPhoneRows = rows.filter((r) => !r.name);
  if (unnamedPhoneRows.length > 0) {
    const admin = createAdminClient();
    const phones = unnamedPhoneRows.map((r) => r.phone!).filter(Boolean);
    const leadIds = unnamedPhoneRows.map((r) => r.id);

    const allSearchPhones: string[] = [];
    for (const p of phones) {
      allSearchPhones.push(p);
      const digits = p.replace(/[^0-9]/g, "");
      if (digits) {
        allSearchPhones.push(digits);
        allSearchPhones.push("+" + digits);
        if (digits.length >= 10) {
          allSearchPhones.push(digits.slice(-10));
          allSearchPhones.push("+91" + digits.slice(-10));
          allSearchPhones.push("91" + digits.slice(-10));
        }
      }
    }
    const uniqueSearchPhones = Array.from(new Set(allSearchPhones));

    const [{ data: contacts }, { data: calls }] = await Promise.all([
      uniqueSearchPhones.length > 0
        ? admin
            .from("campaign_contacts")
            .select("phone, name")
            .eq("organisation_id", org.id)
            .in("phone", uniqueSearchPhones)
            .not("name", "is", null)
        : Promise.resolve({ data: null }),
      admin
        .from("calls")
        .select("lead_id, name_extracted, lead_data")
        .eq("organisation_id", org.id)
        .in("lead_id", leadIds),
    ]);

    const nameByPhone = new Map<string, string>();
    for (const c of contacts ?? []) {
      if (c.name && c.name.trim()) {
        const trimmed = c.name.trim();
        nameByPhone.set(c.phone, trimmed);
        const digits = c.phone.replace(/[^0-9]/g, "");
        if (digits) {
          nameByPhone.set(digits, trimmed);
          if (digits.length >= 10) {
            nameByPhone.set(digits.slice(-10), trimmed);
          }
        }
      }
    }

    const nameByLeadId = new Map<string, string>();
    for (const call of calls ?? []) {
      if (call.name_extracted && call.name_extracted.trim()) {
        nameByLeadId.set(call.lead_id, call.name_extracted.trim());
      } else if (call.lead_data && typeof call.lead_data === "object") {
        const ld = call.lead_data as Record<string, unknown>;
        const nameFromLd =
          (typeof ld.customer_name === "string" && ld.customer_name.trim()) ||
          (typeof ld.name === "string" && ld.name.trim()) ||
          (typeof ld.first_name === "string" && ld.first_name.trim()) ||
          null;
        if (nameFromLd) {
          nameByLeadId.set(call.lead_id, nameFromLd);
        }
      }
    }

    for (const r of rows) {
      if (!r.name) {
        const digits = (r.phone || "").replace(/[^0-9]/g, "");
        const last10 = digits.slice(-10);
        const resolved =
          (r.phone ? nameByPhone.get(r.phone) : undefined) ||
          (digits ? nameByPhone.get(digits) : undefined) ||
          (last10 ? nameByPhone.get(last10) : undefined) ||
          nameByLeadId.get(r.id);

        if (resolved) {
          r.name = resolved;
          void admin.from("leads").update({ name: resolved }).eq("id", r.id);
        }
      }
    }
  }

  const snapshots = await fetchLatestCallSnapshots(
    org.id,
    rows.map((r) => r.id),
  );
  const items = rows.map((r) => buildLead(r, snapshots.get(r.id) ?? null));

  return ok({ items, total: count ?? 0 });
}

export async function getLead(id: unknown): Promise<ActionResult<Lead>> {
  const parsed = leadIdSchema.safeParse(id);
  if (!parsed.success) return fail("Invalid lead id");

  const { user } = await requireUser();
  if (!user) return fail("Not authenticated");

  // Resolve the caller's org first, then scope the lead read by both
  // id AND organisation_id. Foreign-org IDs and truly missing IDs
  // return the same generic error — no existence oracle on UUIDs from
  // other tenants.
  const org = await getUserOwnedOrg(null, user.id, user.email);
  if (!org) return fail("Lead not found");

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("leads")
    .select(LEAD_COLUMNS)
    .eq("id", parsed.data)
    .eq("organisation_id", org.id)
    .maybeSingle<LeadRow>();

  if (error) return fail(error.message);
  if (!data) return fail("Lead not found");

  if (!data.name && data.phone) {
    const admin = createAdminClient();
    const raw = data.phone;
    const digits = raw.replace(/[^0-9]/g, "");
    const searchPhones = [raw, digits, "+" + digits];
    if (digits.length >= 10) {
      searchPhones.push(digits.slice(-10), "+91" + digits.slice(-10), "91" + digits.slice(-10));
    }

    const [{ data: contact }, { data: calls }] = await Promise.all([
      admin
        .from("campaign_contacts")
        .select("name")
        .eq("organisation_id", org.id)
        .in("phone", Array.from(new Set(searchPhones)))
        .not("name", "is", null)
        .limit(1)
        .maybeSingle<{ name: string | null }>(),
      admin
        .from("calls")
        .select("name_extracted, lead_data")
        .eq("lead_id", data.id)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle<{ name_extracted: string | null; lead_data: Record<string, unknown> | null }>(),
    ]);

    let resolvedName = contact?.name || calls?.name_extracted || null;
    if (!resolvedName && calls?.lead_data && typeof calls.lead_data === "object") {
      const ld = calls.lead_data as Record<string, unknown>;
      resolvedName =
        (typeof ld.customer_name === "string" && ld.customer_name.trim()) ||
        (typeof ld.name === "string" && ld.name.trim()) ||
        (typeof ld.first_name === "string" && ld.first_name.trim()) ||
        null;
    }

    if (resolvedName) {
      data.name = resolvedName;
      void admin.from("leads").update({ name: resolvedName }).eq("id", data.id);
    }
  }

  const snapshots = await fetchLatestCallSnapshots(org.id, [data.id]);
  return ok(buildLead(data, snapshots.get(data.id) ?? null));
}

// Translates the create/update form input into the (a) lead-row columns
// and (b) lead_data jsonb keys. The dynamic-field keys map to the same
// names the LLM emits, so a manual edit and a subsequent LLM extraction
// land in the same jsonb slot.
function splitWrites(
  patch: Record<string, unknown>,
): {
  rowPatch: Record<string, unknown>;
  leadDataPatch: Record<string, unknown>;
} {
  const rowPatch: Record<string, unknown> = {};
  const leadDataPatch: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    switch (k) {
      // First-class columns:
      case "name":
      case "phone":
      case "city":
      case "pincode":
      case "notes":
      case "status":
      case "source":
      case "pending_action":
      case "current_intent_score":
      case "owner_label":
        rowPatch[k] = v;
        break;
      case "lead_intent":
      case "current_intent":
        rowPatch.current_intent = v;
        break;
      // Dynamic / lead_data keys:
      case "interest":
        leadDataPatch.interest = v;
        break;
      case "customer_status":
        leadDataPatch.customer_status = v;
        break;
      case "wants_to_connect_on_watsapp":
        leadDataPatch.connect_on_whatsapp = v;
        break;
      case "visit_date_time":
        leadDataPatch.date_and_time_of_visit = v;
        break;
      default:
        break;
    }
  }

  return { rowPatch, leadDataPatch };
}

export async function createLead(
  input: unknown,
): Promise<ActionResult<Lead>> {
  const parsed = leadCreateSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const { user } = await requireUser();
  if (!user) return fail("Not authenticated");
  const org = await userOwnsOrgBySlug(null, user.id, parsed.data.org_slug, user.email);
  if (!org) return fail("Forbidden");

  const { rowPatch, leadDataPatch } = splitWrites({ ...parsed.data });

  const insertRow: Record<string, unknown> = {
    organisation_id: org.id,
    org_slug: org.slug,
    ...rowPatch,
  };
  if (Object.keys(leadDataPatch).length > 0) {
    insertRow.lead_data = leadDataPatch;
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("leads")
    .insert(insertRow)
    .select(LEAD_COLUMNS)
    .single<LeadRow>();

  if (error) {
    if (error.code === "23505") {
      return fail(
        "A lead with this phone number already exists in this workspace.",
      );
    }
    return fail(error.message);
  }

  revalidatePath("/leads");
  return ok(buildLead(data, null));
}

export async function updateLead(
  id: unknown,
  input: unknown,
): Promise<ActionResult<Lead>> {
  const idParsed = leadIdSchema.safeParse(id);
  if (!idParsed.success) return fail("Invalid lead id");

  const parsed = leadUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  if (Object.keys(parsed.data).length === 0) return fail("No fields to update");

  const { user } = await requireUser();
  if (!user) return fail("Not authenticated");

  const admin = createAdminClient();
  const { data: existing, error: fetchErr } = await admin
    .from("leads")
    .select("org_slug, organisation_id, lead_data, custom_data")
    .eq("id", idParsed.data)
    .maybeSingle<{
      org_slug: string | null;
      organisation_id: string;
      lead_data: Record<string, unknown> | null;
      custom_data: Record<string, Record<string, unknown>> | null;
    }>();

  if (fetchErr) return fail(fetchErr.message);
  if (!existing) return fail("Lead not found");
  if (!existing.org_slug) return fail("Forbidden");
  const org = await userOwnsOrgBySlug(null, user.id, existing.org_slug, user.email);
  if (!org) return fail("Forbidden");

  // Catalog-driven patches arrive separately — keep them out of the
  // first-class `splitWrites` mapping so they don't get silently dropped
  // by the default branch.
  const { lead_data_patch, custom_data_patch, ...firstClass } = parsed.data;
  const { rowPatch, leadDataPatch } = splitWrites({ ...firstClass });

  // Start lead_data merge from existing + first-class field rewrites.
  let nextLeadData: Record<string, unknown> | null = null;
  if (
    Object.keys(leadDataPatch).length > 0 ||
    (lead_data_patch && Object.keys(lead_data_patch).length > 0)
  ) {
    nextLeadData = {
      ...(existing.lead_data ?? {}),
      ...leadDataPatch,
      ...(lead_data_patch ?? {}),
    };
  }

  // Deep-merge custom_data per category. Null leaf values drop the key so
  // operators can clear a captured field from the edit form.
  let nextCustomData: Record<string, Record<string, unknown>> | null = null;
  if (custom_data_patch && Object.keys(custom_data_patch).length > 0) {
    const base: Record<string, Record<string, unknown>> = {};
    for (const [cat, bag] of Object.entries(existing.custom_data ?? {})) {
      base[cat] = { ...(bag ?? {}) };
    }
    for (const [cat, bag] of Object.entries(custom_data_patch)) {
      const target = (base[cat] ??= {});
      for (const [k, v] of Object.entries(bag)) {
        if (v === null) delete target[k];
        else target[k] = v;
      }
      if (Object.keys(target).length === 0) delete base[cat];
    }
    nextCustomData = base;
  }

  const updatePatch: Record<string, unknown> = { ...rowPatch };
  if (nextLeadData !== null) updatePatch.lead_data = nextLeadData;
  if (nextCustomData !== null) updatePatch.custom_data = nextCustomData;
  if (Object.keys(updatePatch).length === 0) return fail("No fields to update");

  const { data, error } = await admin
    .from("leads")
    .update(updatePatch)
    .eq("id", idParsed.data)
    .select(LEAD_COLUMNS)
    .single<LeadRow>();

  if (error) return fail(error.message);

  const snapshots = await fetchLatestCallSnapshots(
    existing.organisation_id,
    [data.id],
  );
  revalidatePath("/leads");
  return ok(buildLead(data, snapshots.get(data.id) ?? null));
}

export async function deleteLead(
  id: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = leadIdSchema.safeParse(id);
  if (!parsed.success) return fail("Invalid lead id");

  const { user } = await requireUser();
  if (!user) return fail("Not authenticated");

  const org = await getUserOwnedOrg(null, user.id, user.email);
  if (!org) return fail("Lead not found");

  const admin = createAdminClient();
  // Scope the existence probe by org so cross-tenant UUIDs collapse
  // to "Lead not found" rather than "Forbidden".
  const { data: existing, error: fetchErr } = await admin
    .from("leads")
    .select("id")
    .eq("id", parsed.data)
    .eq("organisation_id", org.id)
    .maybeSingle<{ id: string }>();

  if (fetchErr) return fail(fetchErr.message);
  if (!existing) return fail("Lead not found");

  const { error } = await admin
    .from("leads")
    .delete()
    .eq("id", parsed.data)
    .eq("organisation_id", org.id);
  if (error) return fail(error.message);

  revalidatePath("/leads");
  return ok({ id: parsed.data });
}

export async function toggleLeadPendingAction(
  id: unknown,
): Promise<ActionResult<Lead>> {
  const parsed = leadIdSchema.safeParse(id);
  if (!parsed.success) return fail("Invalid lead id");

  const { user } = await requireUser();
  if (!user) return fail("Not authenticated");

  const org = await getUserOwnedOrg(null, user.id, user.email);
  if (!org) return fail("Lead not found");

  const admin = createAdminClient();
  const { data: existing, error: fetchErr } = await admin
    .from("leads")
    .select("pending_action")
    .eq("id", parsed.data)
    .eq("organisation_id", org.id)
    .maybeSingle<{ pending_action: boolean | null }>();

  if (fetchErr) return fail(fetchErr.message);
  if (!existing) return fail("Lead not found");

  // Admin client write is safe — we've already proven the lead is in
  // the caller's org above, and the .eq("organisation_id", org.id)
  // filter below is belt-and-braces against the unlikely case the
  // user holds another org id in their session.
  const { data, error } = await admin
    .from("leads")
    .update({ pending_action: !existing.pending_action })
    .eq("id", parsed.data)
    .eq("organisation_id", org.id)
    .select(LEAD_COLUMNS)
    .single<LeadRow>();

  if (error) return fail(error.message);

  const snapshots = await fetchLatestCallSnapshots(
    org.id,
    [data.id],
  );
  revalidatePath("/leads");
  return ok(buildLead(data, snapshots.get(data.id) ?? null));
}
