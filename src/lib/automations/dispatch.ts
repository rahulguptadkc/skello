import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { calculateNextRunAt } from "@/lib/automations/schedule";
import { dispatchDueCampaignContacts } from "@/lib/campaigns/dispatch";
import type { WorkspaceAutomation } from "@/types/automation";

const AUTOMATION_BATCH_LEADS_LIMIT = 200;

interface ExecutionResult {
  automationId: string;
  automationName: string;
  leadsFound: number;
  campaignId: string | null;
  error?: string;
}

/**
 * Executes a single workspace automation job.
 * Finds matching cohort leads (e.g. hot leads) below the global call cap,
 * launches a targeted campaign with the assigned workflow, and sets next_run_at.
 */
export async function executeAutomation(
  automation: WorkspaceAutomation,
): Promise<ExecutionResult> {
  const admin = createAdminClient();
  const now = new Date();

  try {
    // 1. Resolve voice agent and integration numbers
    const { data: integration } = await admin
      .from("bolna_integrations")
      .select("agent_id, from_phone_number, from_phone_numbers, enabled")
      .eq("organisation_id", automation.organisation_id)
      .maybeSingle<{
        agent_id: string;
        from_phone_number: string | null;
        from_phone_numbers: string[];
        enabled: boolean;
      }>();

    const targetAgentId = automation.agent_id || integration?.agent_id || null;
    const fromPhone = integration?.from_phone_number ?? null;
    const phonePool = integration?.from_phone_numbers && integration.from_phone_numbers.length > 0
      ? integration.from_phone_numbers
      : fromPhone ? [fromPhone] : [];

    // 2. Resolve workflow name if configured
    let workflowName: string | null = null;
    if (automation.workflow_id) {
      const { data: wf } = await admin
        .from("workflows")
        .select("name")
        .eq("id", automation.workflow_id)
        .maybeSingle<{ name: string }>();
      if (wf?.name) workflowName = wf.name;
    }

    // 3. Build cohort query for leads
    const cohort = automation.cohort_filters || {};
    let leadsQuery = admin
      .from("leads")
      .select("id, name, phone, current_intent, current_intent_score, status")
      .eq("organisation_id", automation.organisation_id)
      .not("phone", "is", null)
      .order("created_at", { ascending: false })
      .limit(500);

    // Apply intent filter (default to 'hot' if specified or omitted)
    if (Array.isArray(cohort.intent) && cohort.intent.length > 0) {
      leadsQuery = leadsQuery.in("current_intent", cohort.intent);
    } else {
      leadsQuery = leadsQuery.eq("current_intent", "hot");
    }

    if (typeof cohort.min_intent_score === "number") {
      leadsQuery = leadsQuery.gte("current_intent_score", cohort.min_intent_score);
    }

    if (Array.isArray(cohort.statuses) && cohort.statuses.length > 0) {
      leadsQuery = leadsQuery.in("status", cohort.statuses);
    }

    const { data: rawLeads, error: leadsErr } = await leadsQuery;
    if (leadsErr) throw new Error(`Failed to query leads: ${leadsErr.message}`);

    const candidateLeads = rawLeads ?? [];
    if (candidateLeads.length === 0) {
      // Advance next_run_at and finish
      const nextRun = calculateNextRunAt(automation, now);
      await admin
        .from("workspace_automations")
        .update({
          last_run_at: now.toISOString(),
          next_run_at: nextRun,
          updated_at: now.toISOString(),
        })
        .eq("id", automation.id);

      return {
        automationId: automation.id,
        automationName: automation.name,
        leadsFound: 0,
        campaignId: null,
      };
    }

    // 4. Enforce Max Global Limit on each user (cap total calls per lead)
    const leadIds = candidateLeads.map((l) => l.id);
    const { data: callCounts } = await admin
      .from("calls")
      .select("lead_id")
      .in("lead_id", leadIds);

    const callCountMap = new Map<string, number>();
    for (const c of callCounts ?? []) {
      if (c.lead_id) {
        callCountMap.set(c.lead_id, (callCountMap.get(c.lead_id) || 0) + 1);
      }
    }

    const maxLimit = automation.max_global_limit_per_user || 5;
    const eligibleLeads = candidateLeads
      .filter((l) => (callCountMap.get(l.id) || 0) < maxLimit)
      .slice(0, AUTOMATION_BATCH_LEADS_LIMIT);

    if (eligibleLeads.length === 0) {
      const nextRun = calculateNextRunAt(automation, now);
      await admin
        .from("workspace_automations")
        .update({
          last_run_at: now.toISOString(),
          next_run_at: nextRun,
          updated_at: now.toISOString(),
        })
        .eq("id", automation.id);

      return {
        automationId: automation.id,
        automationName: automation.name,
        leadsFound: 0,
        campaignId: null,
      };
    }

    // 5. Create targeted campaign
    const retryConfig = automation.retry_config || {
      max_retries: 2,
      retry_interval_minutes: 30,
      max_connected_attempts: 1,
    };

    const campaignDate = now.toLocaleDateString("en-IN", {
      timeZone: automation.schedule_timezone || "Asia/Kolkata",
      day: "numeric",
      month: "short",
    });

    const campaignInsertPayload = {
      organisation_id: automation.organisation_id,
      name: `[Auto] ${automation.name} (${campaignDate})`,
      agent_id: targetAgentId,
      from_phone_number: fromPhone,
      from_phone_numbers: phonePool,
      workflow_id: automation.workflow_id,
      workflow_name: workflowName,
      status: "in_progress",
      started_at: now.toISOString(),
      max_attempts: (retryConfig.max_retries ?? 2) + 1,
      max_connected_attempts: retryConfig.max_connected_attempts ?? 1,
      retry_interval_seconds: (retryConfig.retry_interval_minutes ?? 30) * 60,
    };

    const { data: campaign, error: campErr } = await admin
      .from("campaigns")
      .insert(campaignInsertPayload)
      .select("id")
      .single<{ id: string }>();

    if (campErr || !campaign) {
      throw new Error(`Failed to create automated campaign: ${campErr?.message}`);
    }

    // 6. Ingest eligible leads into campaign_contacts
    const contactRows = eligibleLeads.map((l) => ({
      campaign_id: campaign.id,
      organisation_id: automation.organisation_id,
      phone: l.phone!,
      raw_phone: l.phone!,
      name: l.name ?? null,
      metadata: {
        customer: l.name ?? "",
        customer_name: l.name ?? "",
        contact_name: l.name ?? "",
        name: l.name ?? "",
        lead_id: l.id,
        automation_id: automation.id,
        automation_name: automation.name,
      },
      status: "pending" as const,
      next_attempt_at: now.toISOString(),
    }));

    const { error: contactsErr } = await admin
      .from("campaign_contacts")
      .insert(contactRows);

    if (contactsErr) {
      await admin.from("campaigns").delete().eq("id", campaign.id);
      throw new Error(`Failed to insert campaign contacts: ${contactsErr.message}`);
    }

    // 7. Advance schedule
    const nextRun = calculateNextRunAt(automation, now);
    await admin
      .from("workspace_automations")
      .update({
        last_run_at: now.toISOString(),
        last_run_campaign_id: campaign.id,
        next_run_at: nextRun,
        updated_at: now.toISOString(),
      })
      .eq("id", automation.id);

    // 8. Trigger immediate campaign dispatch
    try {
      await dispatchDueCampaignContacts();
    } catch (dispErr) {
      console.error("[automations] dispatch tick error", dispErr);
    }

    return {
      automationId: automation.id,
      automationName: automation.name,
      leadsFound: eligibleLeads.length,
      campaignId: campaign.id,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[automations] Execution error for ${automation.name}:`, err);
    return {
      automationId: automation.id,
      automationName: automation.name,
      leadsFound: 0,
      campaignId: null,
      error: message,
    };
  }
}

/**
 * Checks for all active workspace automations due to run and executes them.
 * Designed to be called by the cron job on every tick.
 */
export async function dispatchDueAutomations(): Promise<{
  executed: number;
  results: ExecutionResult[];
}> {
  const admin = createAdminClient();
  const now = new Date().toISOString();

  // Find active automations whose scheduled run time has arrived
  const { data: dueAutomations, error } = await admin
    .from("workspace_automations")
    .select("*")
    .eq("is_active", true)
    .lte("next_run_at", now)
    .returns<WorkspaceAutomation[]>();

  if (error || !dueAutomations || dueAutomations.length === 0) {
    return { executed: 0, results: [] };
  }

  const results: ExecutionResult[] = [];
  for (const auto of dueAutomations) {
    const res = await executeAutomation(auto);
    results.push(res);
  }

  return { executed: results.length, results };
}
