"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { calculateNextRunAt } from "@/lib/automations/schedule";
import { executeAutomation } from "@/lib/automations/dispatch";
import {
  createAutomationSchema,
  updateAutomationSchema,
} from "@/lib/validations/automation";
import { type ActionResult, fail, ok } from "@/types/action";
import type { WorkspaceAutomation } from "@/types/automation";

function revalidate(orgId: string) {
  revalidatePath(`/admin/organisations/${orgId}/automations`);
  revalidatePath(`/admin/organisations/${orgId}`);
}

export async function listWorkspaceAutomations(
  organisationId: unknown,
): Promise<ActionResult<WorkspaceAutomation[]>> {
  await requireAdmin();
  if (typeof organisationId !== "string") return fail("Invalid organisation ID");

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("workspace_automations")
    .select("*")
    .eq("organisation_id", organisationId)
    .order("created_at", { ascending: false })
    .returns<WorkspaceAutomation[]>();

  if (error) return fail(error.message);
  return ok(data ?? []);
}

export async function createWorkspaceAutomation(
  input: unknown,
): Promise<ActionResult<WorkspaceAutomation>> {
  await requireAdmin();
  const parsed = createAutomationSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();
  const now = new Date();
  const nextRunAt = parsed.data.is_active
    ? calculateNextRunAt(parsed.data, now)
    : null;

  const insertPayload = {
    ...parsed.data,
    next_run_at: nextRunAt,
  };

  const { data, error } = await admin
    .from("workspace_automations")
    .insert(insertPayload)
    .select("*")
    .single<WorkspaceAutomation>();

  if (error || !data) {
    return fail(error?.message ?? "Could not create workspace automation");
  }

  revalidate(parsed.data.organisation_id);
  return ok(data);
}

export async function updateWorkspaceAutomation(
  input: unknown,
): Promise<ActionResult<WorkspaceAutomation>> {
  await requireAdmin();
  const parsed = updateAutomationSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();
  const now = new Date();

  // If timing or active status changed, recalculate next_run_at
  const { data: existing } = await admin
    .from("workspace_automations")
    .select("*")
    .eq("id", parsed.data.id)
    .maybeSingle<WorkspaceAutomation>();

  if (!existing) return fail("Automation not found");

  const updatedRecord = { ...existing, ...parsed.data };
  let nextRunAt = existing.next_run_at;

  if (parsed.data.is_active === false) {
    nextRunAt = null;
  } else if (
    parsed.data.is_active === true ||
    parsed.data.schedule_time !== undefined ||
    parsed.data.schedule_frequency !== undefined ||
    parsed.data.schedule_interval_days !== undefined ||
    parsed.data.schedule_days_of_week !== undefined
  ) {
    nextRunAt = calculateNextRunAt(updatedRecord, now);
  }

  const { data, error } = await admin
    .from("workspace_automations")
    .update({
      ...parsed.data,
      next_run_at: nextRunAt,
      updated_at: now.toISOString(),
    })
    .eq("id", parsed.data.id)
    .select("*")
    .single<WorkspaceAutomation>();

  if (error || !data) {
    return fail(error?.message ?? "Could not update automation");
  }

  revalidate(parsed.data.organisation_id);
  return ok(data);
}

export async function deleteWorkspaceAutomation(
  id: unknown,
  organisationId: unknown,
): Promise<ActionResult<{ success: boolean }>> {
  await requireAdmin();
  if (typeof id !== "string" || typeof organisationId !== "string") {
    return fail("Invalid parameters");
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("workspace_automations")
    .delete()
    .eq("id", id)
    .eq("organisation_id", organisationId);

  if (error) return fail(error.message);

  revalidate(organisationId);
  return ok({ success: true });
}

export async function toggleWorkspaceAutomation(
  id: unknown,
  organisationId: unknown,
  isActive: unknown,
): Promise<ActionResult<{ is_active: boolean }>> {
  await requireAdmin();
  if (
    typeof id !== "string" ||
    typeof organisationId !== "string" ||
    typeof isActive !== "boolean"
  ) {
    return fail("Invalid parameters");
  }

  const admin = createAdminClient();
  const now = new Date();

  let nextRunAt: string | null = null;
  if (isActive) {
    const { data: auto } = await admin
      .from("workspace_automations")
      .select("*")
      .eq("id", id)
      .maybeSingle<WorkspaceAutomation>();
    if (auto) {
      nextRunAt = calculateNextRunAt(auto, now);
    }
  }

  const { error } = await admin
    .from("workspace_automations")
    .update({
      is_active: isActive,
      next_run_at: nextRunAt,
      updated_at: now.toISOString(),
    })
    .eq("id", id)
    .eq("organisation_id", organisationId);

  if (error) return fail(error.message);

  revalidate(organisationId);
  return ok({ is_active: isActive });
}

export async function triggerWorkspaceAutomationNow(
  id: unknown,
  organisationId: unknown,
): Promise<
  ActionResult<{ leadsFound: number; campaignId: string | null }>
> {
  await requireAdmin();
  if (typeof id !== "string" || typeof organisationId !== "string") {
    return fail("Invalid parameters");
  }

  const admin = createAdminClient();
  const { data: auto, error } = await admin
    .from("workspace_automations")
    .select("*")
    .eq("id", id)
    .eq("organisation_id", organisationId)
    .maybeSingle<WorkspaceAutomation>();

  if (error || !auto) return fail("Automation not found");

  const result = await executeAutomation(auto);
  if (result.error) return fail(result.error);

  revalidate(organisationId);
  return ok({
    leadsFound: result.leadsFound,
    campaignId: result.campaignId,
  });
}
