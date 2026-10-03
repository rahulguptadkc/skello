import "server-only";

import { coerceToE164 } from "@/lib/phone";

const DEFAULT_BASE = "https://api.bolna.ai";

export class BolnaApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "BolnaApiError";
  }
}

export interface InitiateCallInput {
  apiKey: string;
  agentId: string;
  recipientPhone: string;
  // E.164 calling code for the recipient's market, when the caller knows it.
  // Without it a local-format number outside the default market can't be
  // rendered — see lib/phone.ts.
  recipientDialCode?: string | null;
  fromPhone?: string | null;
  metadata?: Record<string, unknown>;
}

export interface InitiateCallResult {
  bolnaCallId: string;
  status: string;
}

function bolnaBaseUrl(): string {
  const url = process.env.BOLNA_API_BASE_URL?.trim();
  return url && url.length > 0 ? url.replace(/\/+$/, "") : DEFAULT_BASE;
}

export interface ExecutionTelephonyData {
  to_number?: string | null;
  from_number?: string | null;
}

export interface ExecutionPayload {
  id: string;
  status?: string;
  conversation_time?: number;
  transcript?: string | null;
  telephony_data?: ExecutionTelephonyData | null;
  extracted_data?: Record<string, unknown> | null;
  answered_by_voice_mail?: boolean | null;
  error_message?: string | null;
  created_at?: string;
  updated_at?: string;
}

export async function fetchBolnaExecution(input: {
  apiKey: string;
  executionId: string;
}): Promise<ExecutionPayload> {
  const response = await fetch(
    `${bolnaBaseUrl()}/executions/${encodeURIComponent(input.executionId)}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${input.apiKey}` },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new BolnaApiError(
      response.status,
      text || `Voice provider returned ${response.status}`,
    );
  }

  const body = (await response.json().catch(() => null)) as
    | ExecutionPayload
    | null;
  if (!body || typeof body !== "object" || !body.id) {
    throw new BolnaApiError(502, "Voice provider returned malformed execution");
  }
  return body;
}

export interface PingResult {
  ok: boolean;
  status: number;
  // Raw response body, truncated to 1000 chars. We surface this verbatim so
  // operators can read Bolna's exact rejection wording.
  body: string;
}

// Lightweight probe: hits Bolna's "list executions for agent" endpoint with
// page_size=1. A 200 means both the API key and the agent_id are accepted by
// the same Bolna workspace. Non-200 responses (incl. "Unrecognized access
// token") are surfaced verbatim. Does NOT place a call.
export async function pingBolna(input: {
  apiKey: string;
  agentId: string;
}): Promise<PingResult> {
  const url = `${bolnaBaseUrl()}/v2/agent/${encodeURIComponent(
    input.agentId,
  )}/executions?page_size=1`;
  const response = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${input.apiKey}` },
    cache: "no-store",
  });
  const text = (await response.text().catch(() => "")) ?? "";
  return {
    ok: response.ok,
    status: response.status,
    body: text.slice(0, 1000),
  };
}

export async function initiateBolnaCall(
  input: InitiateCallInput,
): Promise<InitiateCallResult> {
  // Coerce to E.164 with a default country code — Bolna rejects bare local
  // numbers (common in Shopify checkout phones). See lib/phone.ts.
  const recipient = coerceToE164(input.recipientPhone, input.recipientDialCode);
  if (!recipient) {
    // Not only "empty" any more: coerceToE164 also refuses a number it cannot
    // render as E.164 — a 9-digit national number from a market we have no dial
    // code for, or one outside E.164's 8-15 digit bounds. Saying "empty" sent
    // people looking for a blank field when the value was right there.
    throw new BolnaApiError(
      400,
      "Recipient phone is missing or not a dialable E.164 number",
    );
  }
  const fromPhone = coerceToE164(input.fromPhone);

  const rawMetadata =
    input.metadata && typeof input.metadata === "object"
      ? { ...input.metadata }
      : {};

  const resolvedCustomer =
    (typeof rawMetadata.customer === "string" && rawMetadata.customer.trim()) ||
    (typeof rawMetadata.customer_name === "string" && rawMetadata.customer_name.trim()) ||
    (typeof rawMetadata.contact_name === "string" && rawMetadata.contact_name.trim()) ||
    (typeof rawMetadata.name === "string" && rawMetadata.name.trim()) ||
    (typeof rawMetadata.first_name === "string" && rawMetadata.first_name.trim()) ||
    (typeof rawMetadata.lead_name === "string" && rawMetadata.lead_name.trim()) ||
    (typeof rawMetadata.recipient_name === "string" && rawMetadata.recipient_name.trim()) ||
    null;

  const customerNameFields = resolvedCustomer
    ? {
        customer: resolvedCustomer,
        customer_name: resolvedCustomer,
        contact_name: resolvedCustomer,
        name: resolvedCustomer,
        first_name: resolvedCustomer,
        recipient_name: resolvedCustomer,
      }
    : {};

  // Strip null and undefined values so provider doesn't omit fields or receive nulls
  const cleanedMetadata: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(rawMetadata)) {
    if (val !== null && val !== undefined) {
      cleanedMetadata[key] = val;
    }
  }

  const finalMetadata = {
    ...cleanedMetadata,
    ...customerNameFields,
  };

  const requestBody = {
    agent_id: input.agentId,
    recipient_phone_number: recipient,
    ...(fromPhone ? { from_phone_number: fromPhone } : {}),
    ...(resolvedCustomer
      ? {
          customer: resolvedCustomer,
          customer_name: resolvedCustomer,
        }
      : {}),
    ...(Object.keys(finalMetadata).length > 0
      ? {
          user_data: finalMetadata,
          recipient_data: finalMetadata,
        }
      : {}),
  };

  console.log("[bolna] POST /call payload dispatch:", {
    agent_id: input.agentId,
    recipient_phone: recipient ? `${recipient.slice(0, 4)}****${recipient.slice(-4)}` : null,
    customer: resolvedCustomer,
    customer_name: resolvedCustomer,
    passing_customer: Boolean(resolvedCustomer),
    user_data_keys: Object.keys(finalMetadata),
    has_from_phone: Boolean(fromPhone),
  });

  const response = await fetch(`${bolnaBaseUrl()}/call`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify(requestBody),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new BolnaApiError(
      response.status,
      text || `Voice provider returned ${response.status}`,
    );
  }

  // Bolna's POST /call success body looks like:
  //   { "message": "done", "status": "queued", "execution_id": "<uuid>" }
  // The identifier field is `execution_id`; older deployments returned
  // `call_id` / `id`, so we accept any of them. The literal `message: "done"`
  // is a status string, NOT an error — do not fall back to it.
  const body = (await response.json().catch(() => null)) as
    | {
        execution_id?: string;
        call_id?: string;
        id?: string;
        status?: string;
        message?: string;
      }
    | null;

  const callId = body?.execution_id ?? body?.call_id ?? body?.id;
  if (!callId) {
    throw new BolnaApiError(
      502,
      body?.message
        ? `Voice provider response missing execution_id (message: ${body.message})`
        : "Voice provider response missing execution_id",
    );
  }

  return { bolnaCallId: callId, status: body?.status ?? "queued" };
}
