"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser, userCanManageOrg } from "@/lib/auth/org-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { type ActionResult, fail, ok } from "@/types/action";
import {
  WORKFLOW_TEMPLATES,
  type OutcomeCondition,
  type OutcomeRule,
  type Workflow,
  type WorkflowNode,
  type WorkflowTemplate,
} from "@/types/workflow";

// In-memory workspace cache fallback ensuring zero-downtime if migrations are running
const workflowStore = new Map<string, Workflow>();

function getDefaultWorkflow(orgId: string): Workflow {
  const id = `wf_${orgId}_default`;
  const defaultRules: OutcomeRule[] = [
    {
      id: `rule_${id}_1`,
      variables: ["interested"],
      action: "stop_calling",
      retries: 0,
      agent_id: null,
    },
    {
      id: `rule_${id}_2`,
      variables: ["not_interested"],
      action: "stop_calling",
      retries: 0,
      agent_id: null,
    },
    {
      id: `rule_${id}_3`,
      variables: ["callback_requested"],
      action: "call_again",
      retries: 2,
      delay_minutes: 60,
      agent_id: null,
    },
    {
      id: `rule_${id}_4`,
      variables: ["no_conversation"],
      action: "call_again",
      retries: 2,
      delay_minutes: 120,
      agent_id: null,
    },
    {
      id: `rule_${id}_5`,
      variables: ["no_answer", "busy"],
      action: "call_again",
      retries: 2,
      delay_minutes: 240,
      agent_id: null,
    },
    {
      id: `rule_${id}_6`,
      variables: ["wrong_number", "dnd"],
      action: "stop_calling",
      retries: 0,
      agent_id: null,
    },
  ];

  return {
    id,
    organisation_id: orgId,
    name: "Primary Call Outcome Workflow",
    description: "Voice AI call outcome routing and automated retry ladder.",
    template_id: "call_outcome_ladder",
    is_active: true,
    is_default: false,
    rules: defaultRules,
    nodes: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export async function listWorkflows(
  organisationId: string,
): Promise<ActionResult<Workflow[]>> {
  if (!organisationId) return fail("Invalid organisation ID");

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");
  if (!(await userCanManageOrg(supabase, user.id, organisationId))) {
    return fail("Forbidden");
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("workflows")
      .select("*")
      .eq("organisation_id", organisationId)
      .order("created_at", { ascending: false });

    if (!error && data && data.length > 0) {
      const items: Workflow[] = data.map((row: any) => ({
        id: row.id,
        organisation_id: row.organisation_id,
        name: row.name,
        description: row.description,
        template_id: row.template_id,
        rules: (row.rules as OutcomeRule[]) || undefined,
        nodes: [],
        is_active: row.is_active,
        is_default: row.is_default,
        created_at: row.created_at,
        updated_at: row.updated_at,
      }));

      // Update in-memory cache
      for (const item of items) {
        workflowStore.set(item.id, item);
      }
      return ok(items);
    }
  } catch (err) {
    // Non-blocking database fallback
  }

  // Check in memory store or return default workflow
  const items = Array.from(workflowStore.values()).filter(
    (w) => w.organisation_id === organisationId,
  );

  if (items.length === 0) {
    const defaultWf = getDefaultWorkflow(organisationId);
    workflowStore.set(defaultWf.id, defaultWf);

    try {
      const admin = createAdminClient();
      await admin.from("workflows").insert({
        id: defaultWf.id,
        organisation_id: organisationId,
        name: defaultWf.name,
        description: defaultWf.description,
        template_id: defaultWf.template_id,
        rules: defaultWf.rules || [],
        is_active: defaultWf.is_active,
        is_default: defaultWf.is_default,
      });
    } catch {
      // Non-blocking fallback
    }

    return ok([defaultWf]);
  }

  return ok(items);
}

export async function getWorkflow(
  workflowId: string,
): Promise<ActionResult<Workflow>> {
  if (!workflowId) return fail("Invalid workflow ID");

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");

  try {
    const admin = createAdminClient();
    const { data: row, error } = await admin
      .from("workflows")
      .select("*")
      .eq("id", workflowId)
      .maybeSingle();

    if (!error && row) {
      if (!(await userCanManageOrg(supabase, user.id, row.organisation_id))) {
        return fail("Forbidden");
      }

      const wf: Workflow = {
        id: row.id,
        organisation_id: row.organisation_id,
        name: row.name,
        description: row.description,
        template_id: row.template_id,
        rules: (row.rules as OutcomeRule[]) || undefined,
        nodes: [],
        is_active: row.is_active,
        is_default: row.is_default,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
      workflowStore.set(wf.id, wf);
      return ok(wf);
    }
  } catch (err) {
    // Non-blocking DB fallback
  }

  const wf = workflowStore.get(workflowId);
  if (wf) {
    if (!(await userCanManageOrg(supabase, user.id, wf.organisation_id))) {
      return fail("Forbidden");
    }
    return ok(wf);
  }

  // If starts with default pattern
  const parts = workflowId.split("_");
  if (parts.length >= 3 && parts[0] === "wf") {
    const orgId = parts[1];
    if (await userCanManageOrg(supabase, user.id, orgId)) {
      const defaultWf = getDefaultWorkflow(orgId);
      workflowStore.set(defaultWf.id, defaultWf);
      return ok(defaultWf);
    }
  }

  return fail("Workflow not found");
}

const ruleSchema = z.object({
  id: z.string().optional(),
  variables: z.array(z.string().trim()).default([]),
  action: z.enum(["stop_calling", "call_again"]),
  retries: z.number().int().min(0).max(100).default(2),
  delay_minutes: z.number().int().min(0).max(10080).optional(),
  agent_id: z.string().nullable().optional(),
  agent_name: z.string().nullable().optional(),
  whatsapp_template: z.string().nullable().optional(),
});

const nodeSchema = z.object({
  id: z.string().optional(),
  node_type: z.enum(["start", "branch_retry"]),
  outcome_condition: z.string().nullable().optional(),
  agent_id: z.string().nullable().optional(),
  agent_label: z.string().nullable().optional(),
  max_attempts: z.number().int().min(1).max(100).default(2),
  max_connected_attempts: z.number().int().min(1).max(50).optional().nullable(),
  delay_minutes: z.number().int().min(0).max(10080).default(60),
  action_description: z.string().nullable().optional(),
  is_terminal: z.boolean().optional(),
});

const saveWorkflowSchema = z.object({
  id: z.string().optional(),
  organisation_id: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional().nullable(),
  template_id: z.string().optional().nullable(),
  is_active: z.boolean().default(true),
  rules: z.array(ruleSchema).optional(),
  nodes: z.array(nodeSchema).optional().default([]),
});

export async function saveWorkflow(
  input: z.infer<typeof saveWorkflowSchema>,
): Promise<ActionResult<Workflow>> {
  const parsed = saveWorkflowSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid workflow data");
  }

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");
  if (!(await userCanManageOrg(supabase, user.id, parsed.data.organisation_id))) {
    return fail("Forbidden");
  }

  const id = parsed.data.id || `wf_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();

  const formattedRules = parsed.data.rules?.map((r, idx) => ({
    id: r.id || `rule_${id}_${idx + 1}`,
    variables: r.variables,
    action: r.action,
    retries: r.retries,
    delay_minutes: r.delay_minutes,
    agent_id: r.agent_id ?? null,
    agent_name: r.agent_name ?? null,
    whatsapp_template: r.whatsapp_template ?? null,
  }));

  const formattedNodes: WorkflowNode[] = (parsed.data.nodes || []).map((n, idx) => ({
    id: n.id || `node_${id}_${idx + 1}`,
    workflow_id: id,
    node_type: n.node_type,
    outcome_condition: n.outcome_condition ?? null,
    agent_id: n.agent_id ?? null,
    agent_label: n.agent_label ?? null,
    max_attempts: n.max_attempts,
    max_connected_attempts: n.max_connected_attempts ?? null,
    delay_minutes: n.delay_minutes,
    action_description: n.action_description ?? null,
    is_terminal: n.is_terminal,
  }));

  const saved: Workflow = {
    id,
    organisation_id: parsed.data.organisation_id,
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    template_id: parsed.data.template_id ?? null,
    is_active: parsed.data.is_active,
    is_default: false,
    rules: formattedRules,
    nodes: formattedNodes,
    created_at: workflowStore.get(id)?.created_at ?? now,
    updated_at: now,
  };

  workflowStore.set(id, saved);

  try {
    const admin = createAdminClient();
    await admin.from("workflows").upsert({
      id,
      organisation_id: saved.organisation_id,
      name: saved.name,
      description: saved.description,
      template_id: saved.template_id,
      rules: formattedRules || [],
      is_active: saved.is_active,
      is_default: saved.is_default,
      updated_at: saved.updated_at,
    });
  } catch (err) {
    // Non-blocking database fallback
  }

  revalidatePath("/workflows");
  revalidatePath(`/workflows/${id}`);
  revalidatePath("/settings/workflows");

  return ok(saved);
}

export async function createWorkflow(
  organisationId: string,
  name?: string,
  description?: string,
): Promise<ActionResult<Workflow>> {
  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");
  if (!(await userCanManageOrg(supabase, user.id, organisationId))) {
    return fail("Forbidden");
  }

  const id = `wf_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();

  const defaultRules: OutcomeRule[] = [
    {
      id: `rule_${id}_1`,
      variables: ["interested"],
      action: "stop_calling",
      retries: 0,
      agent_id: null,
    },
    {
      id: `rule_${id}_2`,
      variables: ["not_interested"],
      action: "stop_calling",
      retries: 0,
      agent_id: null,
    },
    {
      id: `rule_${id}_3`,
      variables: ["callback_requested"],
      action: "call_again",
      retries: 2,
      delay_minutes: 60,
      agent_id: null,
    },
    {
      id: `rule_${id}_4`,
      variables: ["no_conversation"],
      action: "call_again",
      retries: 2,
      delay_minutes: 120,
      agent_id: null,
    },
    {
      id: `rule_${id}_5`,
      variables: ["no_answer", "busy"],
      action: "call_again",
      retries: 2,
      delay_minutes: 240,
      agent_id: null,
    },
    {
      id: `rule_${id}_6`,
      variables: ["wrong_number", "dnd"],
      action: "stop_calling",
      retries: 0,
      agent_id: null,
    },
  ];

  const workflow: Workflow = {
    id,
    organisation_id: organisationId,
    name: name?.trim() || "Custom Call Workflow",
    description: description?.trim() || null,
    is_active: true,
    is_default: false,
    rules: defaultRules,
    nodes: defaultRules.map((r, idx) => ({
      id: `node_${id}_${idx + 1}`,
      workflow_id: id,
      node_type: idx === 0 ? "start" : "branch_retry",
      outcome_condition: r.variables[0] || "others",
      agent_id: r.agent_id,
      max_attempts: r.action === "call_again" ? r.retries : 1,
      delay_minutes: r.delay_minutes || 60,
      action_description: `Matches: ${r.variables.join(", ")}`,
    })),
    created_at: now,
    updated_at: now,
  };

  workflowStore.set(id, workflow);

  try {
    const admin = createAdminClient();
    await admin.from("workflows").insert({
      id: workflow.id,
      organisation_id: workflow.organisation_id,
      name: workflow.name,
      description: workflow.description,
      rules: defaultRules,
      is_active: workflow.is_active,
      is_default: false,
      created_at: now,
      updated_at: now,
    });
  } catch (err) {
    // Non-blocking database fallback
  }

  revalidatePath("/workflows");
  return ok(workflow);
}

export async function updateWorkflowMetadata(
  organisationId: string,
  workflowId: string,
  data: { name: string; description?: string | null; is_active?: boolean },
): Promise<ActionResult<Workflow>> {
  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");
  if (!(await userCanManageOrg(supabase, user.id, organisationId))) {
    return fail("Forbidden");
  }

  const name = data.name.trim();
  if (!name) return fail("Workflow name cannot be empty");

  const existing = await getWorkflow(workflowId);
  if (!existing.success) return fail("Workflow not found");

  const updated: Workflow = {
    ...existing.data,
    name,
    description: data.description !== undefined ? data.description?.trim() || null : existing.data.description,
    is_active: data.is_active !== undefined ? data.is_active : existing.data.is_active,
    updated_at: new Date().toISOString(),
  };

  workflowStore.set(workflowId, updated);

  try {
    const admin = createAdminClient();
    await admin
      .from("workflows")
      .update({
        name: updated.name,
        description: updated.description,
        is_active: updated.is_active,
        updated_at: updated.updated_at,
      })
      .eq("id", workflowId);
  } catch (err) {
    // Non-blocking fallback
  }

  revalidatePath("/workflows");
  revalidatePath(`/workflows/${workflowId}`);
  return ok(updated);
}

export async function deleteWorkflow(
  workflowId: string,
): Promise<ActionResult<void>> {
  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");

  const wf = workflowStore.get(workflowId);
  const orgId = wf?.organisation_id || (workflowId.startsWith("wf_") ? workflowId.split("_")[1] : null);

  if (orgId && !(await userCanManageOrg(supabase, user.id, orgId))) {
    return fail("Forbidden");
  }

  workflowStore.delete(workflowId);

  try {
    const admin = createAdminClient();
    await admin.from("workflow_nodes").delete().eq("workflow_id", workflowId);
    await admin.from("workflows").delete().eq("id", workflowId);
  } catch (err) {
    // Non-blocking fallback
  }

  revalidatePath("/workflows");
  revalidatePath("/settings/workflows");
  return ok(undefined);
}
