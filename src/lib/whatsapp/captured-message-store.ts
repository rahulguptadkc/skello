import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { formatWhatsAppTimestamp } from "@/lib/whatsapp/timestamp";

export interface StoredWhatsAppCapture {
  id: string;
  group_id: string;
  raw_timestamp: number;
  [key: string]: unknown;
}

interface WhatsAppCaptureInput {
  id: string;
  group_id: string;
  raw_timestamp: number;
  sender_name?: string;
  sender_phone?: string;
  intent?: string;
  confidence?: number;
  configuration?: string;
  budget_or_price?: string;
  project_name?: string;
  location?: string;
  timestamp?: string;
  code?: string;
  property_type?: string;
  deal_type?: string;
  size_display?: string;
  price_basis?: string;
  price_flag?: string;
  price_note?: string;
  localities?: string[];
  tags?: string[];
  contact_name?: string;
  contact_numbers?: string[];
  message_text?: string;
  is_active?: boolean;
  convertedToLead?: boolean;
  converted_to_lead?: boolean;
}

const TABLE = "whatsapp_captured_messages";
const PAGE_SIZE = 500;

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function getMissingTableHint(message: string): string | null {
  if (/search_whatsapp_captured_messages.*(schema cache|does not exist|could not find)/i.test(message)) {
    return " Apply supabase/migrations/20261110000001_whatsapp_captured_message_fields.sql to the connected Supabase project, then reload the PostgREST schema cache.";
  }
  if (/whatsapp_captured_messages.*(schema cache|does not exist)|could not find the table/i.test(message)) {
    return " Apply supabase/migrations/20261110000000_whatsapp_captured_messages.sql to the connected Supabase project, then reload the PostgREST schema cache.";
  }
  return null;
}

export async function storeWhatsAppCaptures<T extends WhatsAppCaptureInput>(
  organisationId: string,
  messages: T[],
  ignoreDuplicates = true,
) {
  if (messages.length === 0) return;
  const admin = createAdminClient();

  for (let offset = 0; offset < messages.length; offset += PAGE_SIZE) {
    const rows = messages.slice(offset, offset + PAGE_SIZE).map((message) => {
      const payload = message as unknown as Record<string, unknown>;
      return {
        organisation_id: organisationId,
        message_id: message.id,
        group_id: message.group_id,
        sender_name: asNullableString(payload.sender_name),
        sender_phone: asNullableString(payload.sender_phone),
        intent: asNullableString(payload.intent),
        confidence: typeof payload.confidence === "number" ? payload.confidence : null,
        configuration: asNullableString(payload.configuration),
        budget_or_price: asNullableString(payload.budget_or_price),
        project_name: asNullableString(payload.project_name),
        location: asNullableString(payload.location),
        timestamp_label: formatWhatsAppTimestamp(message.raw_timestamp),
        raw_timestamp: Math.trunc(message.raw_timestamp),
        code: asNullableString(payload.code),
        property_type: asNullableString(payload.property_type),
        deal_type: asNullableString(payload.deal_type),
        size_display: asNullableString(payload.size_display),
        price_basis: asNullableString(payload.price_basis),
        price_flag: asNullableString(payload.price_flag),
        price_note: asNullableString(payload.price_note),
        localities: asStringArray(payload.localities),
        tags: asStringArray(payload.tags),
        contact_name: asNullableString(payload.contact_name),
        contact_numbers: asStringArray(payload.contact_numbers),
        message_text: asNullableString(payload.message_text),
        is_active: payload.is_active !== false,
        converted_to_lead: payload.convertedToLead === true || payload.converted_to_lead === true,
        message_payload: message,
      };
    });
    const { error } = await admin.from(TABLE).upsert(rows, {
      onConflict: "organisation_id,message_id",
      ignoreDuplicates,
    });
    if (error) {
      const hint = getMissingTableHint(error.message) ?? "";
      throw new Error(`Unable to persist WhatsApp captures: ${error.message}.${hint}`);
    }
  }
}

export async function readWhatsAppCaptures(args: {
  organisationId: string;
  since?: number | null;
  todayStart?: number | null;
  groupIds?: string[];
  search?: string | null;
  codePrefix?: string | null;
}): Promise<StoredWhatsAppCapture[]> {
  const admin = createAdminClient();
  const messages: StoredWhatsAppCapture[] = [];
  let offset = 0;

  while (true) {
    let data: { message_payload: unknown }[] | null = null;
    let error: { message: string } | null = null;
    if (args.search?.trim()) {
      ({ data, error } = await admin.rpc("search_whatsapp_captured_messages", {
        p_organisation_id: args.organisationId,
        p_query: args.search.trim(),
        p_group_ids: args.groupIds?.length ? args.groupIds : null,
        p_since: args.since == null ? null : Math.trunc(args.since),
        p_code_prefix: args.codePrefix || null,
        p_limit: PAGE_SIZE,
        p_offset: offset,
      }));
    } else {
      let query = admin
        .from(TABLE)
        .select("message_payload")
        .eq("organisation_id", args.organisationId)
        .order("raw_timestamp", { ascending: false })
        .order("message_id", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);

      if (args.since != null) query = query.gte("raw_timestamp", Math.trunc(args.since));
      if (args.todayStart != null) query = query.gte("raw_timestamp", Math.trunc(args.todayStart));
      if (args.groupIds?.length) query = query.in("group_id", args.groupIds);
      if (args.codePrefix) query = query.like("code", `${args.codePrefix}%`);

      ({ data, error } = await query);
    }
    if (error) {
      const hint = getMissingTableHint(error.message);
      throw new Error(`Unable to read WhatsApp captures: ${error.message}${hint ? `.${hint}` : ""}`);
    }

    const page = (data ?? [])
      .map((row) => row.message_payload)
      .filter((value): value is StoredWhatsAppCapture =>
        Boolean(value && typeof value === "object" && "id" in value && "group_id" in value && "raw_timestamp" in value),
      );
    messages.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return messages;
}

export async function hasWhatsAppCaptures(organisationId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from(TABLE)
    .select("message_id")
    .eq("organisation_id", organisationId)
    .limit(1);
  if (error) {
    const hint = getMissingTableHint(error.message);
    throw new Error(`Unable to check WhatsApp captures: ${error.message}${hint ? `.${hint}` : ""}`);
  }
  return (data?.length ?? 0) > 0;
}

export async function markWhatsAppCaptureConvertedToLead(
  organisationId: string,
  messageId: string,
): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error: readError } = await admin
    .from(TABLE)
    .select("message_payload")
    .eq("organisation_id", organisationId)
    .eq("message_id", messageId)
    .maybeSingle();

  if (readError) {
    const hint = getMissingTableHint(readError.message);
    throw new Error(`Unable to load WhatsApp capture: ${readError.message}${hint ? `.${hint}` : ""}`);
  }
  if (!data) return false;

  const oldPayload = data.message_payload && typeof data.message_payload === "object"
    ? data.message_payload as Record<string, unknown>
    : {};
  const { error: updateError } = await admin
    .from(TABLE)
    .update({
      converted_to_lead: true,
      message_payload: { ...oldPayload, convertedToLead: true, converted_to_lead: true },
    })
    .eq("organisation_id", organisationId)
    .eq("message_id", messageId);

  if (updateError) throw new Error(`Unable to mark WhatsApp capture as a lead: ${updateError.message}`);
  return true;
}
