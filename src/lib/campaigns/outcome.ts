import "server-only";

import {
  decideOutcome,
  isTerminalCallStatus,
} from "@/lib/campaigns/outcome-decision";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CallOutcome, CallStatus } from "@/types/call";
import type { CampaignRetryTrigger } from "@/types/campaign";
import { getWorkflowRulesForOrg } from "@/lib/campaigns/workflow-store";
import {
  FALLBACK_OUTCOME_KEY,
  type OutcomeAction,
  type ResolvedOutcomePolicy,
} from "@/types/outcome-policy";

// Safe policy when an org has none (brand-new, pre-backfill): treat every
// outcome as a success — the pre-config default — so nothing ever stalls.
const EMPTY_POLICY: ResolvedOutcomePolicy = {
  actions: {},
  fallbackAction: "succeed",
};

// Build the resolved outcome policy for an org from org_outcome_policies.
// Exported so the inbound-callback scheduler resolves the `callback` action
// against the SAME policy the campaign applier uses — one source of truth.
export async function loadOutcomePolicy(
  admin: ReturnType<typeof createAdminClient>,
  organisationId: string,
): Promise<ResolvedOutcomePolicy> {
  const { data } = await admin
    .from("org_outcome_policies")
    .select("outcome_key, action, is_fallback")
    .eq("organisation_id", organisationId)
    .returns<
      { outcome_key: string; action: OutcomeAction; is_fallback: boolean }[]
    >();

  if (!data || data.length === 0) return EMPTY_POLICY;

  const actions: Record<string, OutcomeAction> = {};
  let fallbackAction: OutcomeAction | null = null;
  for (const row of data) {
    actions[row.outcome_key] = row.action;
    if (row.is_fallback) fallbackAction = row.action;
  }
  return {
    actions,
    fallbackAction:
      fallbackAction ?? actions[FALLBACK_OUTCOME_KEY] ?? "succeed",
  };
}

interface ApplyOutcomeInput {
  contactId: string;
  callId: string;
  callStatus: CallStatus;
  // Semantic disposition + requested callback time, available only on the final
  // (extracted_data) webhook. Omitted on the status-only path — a `completed`
  // call with no disposition falls back to "succeeded".
  callOutcome?: CallOutcome | null;
  leadIntent?: string | null;
  interest?: string | null;
  customerStatus?: string | null;
  leadData?: Record<string, unknown> | null;
  customData?: Record<string, Record<string, unknown>> | null;
  requestedCallbackAt?: string | null;
}

import type { OutcomeRule } from "@/types/workflow";

interface ContactRow {
  id: string;
  campaign_id: string;
  organisation_id: string;
  phone: string;
  name: string | null;
  metadata?: Record<string, unknown>;
  attempt: number;
  connected_count?: number;
  callback_count: number;
  status: string;
  lead_id: string | null;
  last_call_id: string | null;
  campaign: {
    id: string;
    max_attempts: number;
    max_connected_attempts?: number;
    max_callbacks: number;
    retry_interval_seconds: number;
    retry_on: CampaignRetryTrigger[];
    organisation_id: string;
    workflow_id?: string | null;
  } | null;
}

/**
 * Run after a Bolna webhook updates a call row. Loads the contact, asks the
 * pure {@link decideOutcome} core what to do, then applies it (the only I/O
 * here: the contact load, the lead conversion on success, and the write).
 *
 * The decision branches on TWO axes — the technical `callStatus` and the
 * semantic `call_outcome` disposition — see outcome-decision.ts for the table.
 *
 * Idempotent: every write is guarded by `.eq('status','in_flight')`, so a
 * duplicate webhook delivery for an already-finalised contact is a no-op.
 */
export async function applyCampaignContactOutcome({
  contactId,
  callId,
  callStatus,
  callOutcome = null,
  leadIntent = null,
  interest = null,
  customerStatus = null,
  leadData = null,
  customData = null,
  requestedCallbackAt = null,
}: ApplyOutcomeInput): Promise<void> {
  // Cheap guard before the DB read — non-terminal statuses are no-ops.
  if (!isTerminalCallStatus(callStatus)) return;

  const admin = createAdminClient();

  let { data: contact, error: contactErr } = await admin
    .from("campaign_contacts")
    .select(
      "id, campaign_id, organisation_id, phone, name, metadata, attempt, connected_count, callback_count, status, lead_id, last_call_id, campaign:campaigns!campaign_id(id, max_attempts, max_connected_attempts, max_callbacks, retry_interval_seconds, retry_on, organisation_id, workflow_id)",
    )
    .eq("id", contactId)
    .maybeSingle<ContactRow>();

  if (
    contactErr &&
    (contactErr.message.includes("connected_count") ||
      contactErr.message.includes("max_connected_attempts") ||
      contactErr.message.includes("workflow_id") ||
      contactErr.message.includes("does not exist"))
  ) {
    const fallbackRes = await admin
      .from("campaign_contacts")
      .select(
        "id, campaign_id, organisation_id, phone, name, metadata, attempt, callback_count, status, lead_id, last_call_id, campaign:campaigns!campaign_id(id, max_attempts, max_callbacks, retry_interval_seconds, retry_on, organisation_id)",
      )
      .eq("id", contactId)
      .maybeSingle<ContactRow>();
    contact = fallbackRes.data;
  }

  if (!contact) {
    console.warn(`[campaigns/outcome] Contact not found: ${contactId}`);
    return;
  }
  if (!contact.campaign) {
    console.warn(
      `[campaigns/outcome] Campaign not found for contact ${contactId} (campaign_id: ${contact.campaign_id})`,
    );
    return;
  }
  // Only act on a contact we currently hold the dial claim for. Guards against
  // a duplicate/late webhook re-deciding an already-resolved contact.
  if (contact.status !== "in_flight") {
    console.warn(
      `[campaigns/outcome] Skipped outcome evaluation: contact ${contactId} status is "${contact.status}" (expected "in_flight")`,
    );
    return;
  }

  // Load workflow rules for the campaign (with cache and org fallback)
  const workflowRules = await getWorkflowRulesForOrg(
    contact.organisation_id,
    contact.campaign.workflow_id,
  );

  console.log("[campaigns/outcome] evaluating contact outcome", {
    contactId: contact.id,
    contactPhone: contact.phone,
    contactName: contact.name,
    currentAttempt: contact.attempt,
    callStatus,
    callOutcome,
    leadIntent,
    interest,
    customerStatus,
    leadData,
    customData,
    workflowId: contact.campaign.workflow_id ?? "fallback-to-org",
    workflowRulesFound: workflowRules?.length ?? 0,
    rules: workflowRules?.map((r) => ({
      vars: r.variables,
      action: r.action,
      retries: r.retries,
      agentId: r.agent_id,
      agentName: r.agent_name,
    })),
  });

  // The outcome policy only matters for the disposition tier (completed calls);
  // technical statuses (no_answer/busy/…) are decided from retry_on alone, so
  // skip the extra query on that hot path.
  const policy =
    callStatus === "completed"
      ? await loadOutcomePolicy(admin, contact.organisation_id)
      : EMPTY_POLICY;

  const decision = decideOutcome({
    callStatus,
    callOutcome,
    leadIntent,
    interest,
    customerStatus,
    leadData,
    customData,
    requestedCallbackAt,
    callId,
    attempt: contact.attempt,
    connectedCount: contact.connected_count ?? 0,
    callbackCount: contact.callback_count,
    contactMetadata: contact.metadata,
    campaign: {
      max_attempts: contact.campaign.max_attempts,
      max_connected_attempts: contact.campaign.max_connected_attempts ?? 1,
      max_callbacks: contact.campaign.max_callbacks,
      retry_interval_seconds: contact.campaign.retry_interval_seconds,
      retry_on: contact.campaign.retry_on,
    },
    workflowRules,
    policy,
    now: Date.now(),
  });

  if (decision.kind === "noop") {
    console.log(`[campaigns/outcome] decision for contact ${contact.id}: NOOP`);
    return;
  }

  const updatePayload: Record<string, unknown> = {
    ...decision.patch,
    ...(callStatus === "completed"
      ? { connected_count: (contact.connected_count ?? 0) + 1 }
      : {}),
  };

  const retryAgentId =
    updatePayload.metadata && typeof updatePayload.metadata === "object"
      ? (updatePayload.metadata as Record<string, unknown>).retry_agent_id
      : null;

  console.log(
    `\n============================================================\n` +
      `[POST-CALL OUTCOME DECIDED]\n` +
      `  Contact: ${contact.name || "Unknown"} (${contact.phone}) [ID: ${contact.id}]\n` +
      `  Call ID: ${callId}\n` +
      `  Call Status: ${callStatus}\n` +
      `  Call Outcome: ${callOutcome ?? "none"}\n` +
      `  Decision Kind: ${decision.kind.toUpperCase()}\n` +
      `  New Status: ${String(updatePayload.status ?? "")}\n` +
      `  Next Attempt At: ${String(updatePayload.next_attempt_at ?? "None (No further retries)")}\n` +
      `  Retry Agent ID: ${retryAgentId ? String(retryAgentId) : "None"}\n` +
      `  Last Error: ${String(updatePayload.last_error ?? "None")}\n` +
      `============================================================\n`,
  );

  if (decision.kind === "succeed") {
    // Lead conversion is the one I/O the decision can't make itself.
    let leadId = contact.lead_id;
    if (!leadId) {
      leadId = await convertContactToLead({
        organisationId: contact.organisation_id,
        phone: contact.phone,
        name: contact.name,
      });
    }
    const { error: updErr } = await admin
      .from("campaign_contacts")
      .update({ ...updatePayload, lead_id: leadId })
      .eq("id", contact.id)
      .eq("status", "in_flight");

    if (updErr) {
      console.error(
        `[campaigns/outcome] Failed to update contact ${contact.id} to succeeded:`,
        updErr,
      );
    } else {
      console.log(
        `[campaigns/outcome] Contact ${contact.id} finalized as SUCCEEDED (leadId: ${leadId ?? "none"})`,
      );
    }
    return;
  }

  // fail / rearm — the patch is complete as decided.
  const { error: updErr } = await admin
    .from("campaign_contacts")
    .update(updatePayload)
    .eq("id", contact.id)
    .eq("status", "in_flight");

  if (updErr) {
    console.error(
      `[campaigns/outcome] Failed to update contact ${contact.id}:`,
      updErr,
    );
  } else {
    console.log(
      `[campaigns/outcome] Contact ${contact.id} updated successfully: status=${updatePayload.status}, next_attempt_at=${updatePayload.next_attempt_at ?? "none"}`,
    );
  }
}

/**
 * Look up an existing lead by exact phone within the org's slug; create one
 * if absent. Leads use `org_slug` (text) as the tenant column, so we resolve
 * the slug before writing.
 */
async function convertContactToLead({
  organisationId,
  phone,
  name,
}: {
  organisationId: string;
  phone: string;
  name: string | null;
}): Promise<string | null> {
  const admin = createAdminClient();

  const { data: org } = await admin
    .from("organisations")
    .select("slug")
    .eq("id", organisationId)
    .maybeSingle<{ slug: string }>();
  if (!org) return null;

  const { data: existing } = await admin
    .from("leads")
    .select("id, name")
    .eq("org_slug", org.slug)
    .eq("phone", phone)
    .maybeSingle<{ id: string; name: string | null }>();
  if (existing) {
    if (!existing.name && name) {
      await admin
        .from("leads")
        .update({ name })
        .eq("id", existing.id);
    }
    return existing.id;
  }

  const { data: created, error } = await admin
    .from("leads")
    .insert({
      organisation_id: organisationId,
      org_slug: org.slug,
      name: name,
      phone,
      source: "manual",
      status: "contacted",
    })
    .select("id")
    .single<{ id: string }>();

  if (error) {
    console.error("[campaigns] lead conversion failed", error);
    return null;
  }
  return created.id;
}
