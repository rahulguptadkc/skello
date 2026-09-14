"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth/admin";
import { generateRandomPassword, sendTeamInviteEmail } from "@/lib/email/invite";
import { createAdminClient } from "@/lib/supabase/admin";
import { type ActionResult, fail, ok } from "@/types/action";
import type { Organisation, OrganisationMember, TeamMemberRow } from "@/types/organisation";

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const listSchema = z.object({
  q: z.string().trim().max(100).optional(),
  limit: z.number().int().min(1).max(200).default(100),
  offset: z.number().int().min(0).default(0),
});

const updateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(2).max(100).optional(),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(63)
    .regex(slugRegex, "Slug must be lowercase, numbers and hyphens only")
    .optional(),
  industry: z.enum(["real_estate", "ecommerce", "general"]).optional(),
});

export interface AdminOrganisationRow extends Organisation {
  owner_email: string | null;
  voice_agent_connected: boolean;
  voice_agent_enabled: boolean;
  voice_agent_connected_at: string | null;
  lead_count: number;
}

export async function listAllOrganisations(
  input: unknown,
): Promise<ActionResult<{ items: AdminOrganisationRow[]; total: number }>> {
  await requireAdmin();
  const parsed = listSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const { q, limit, offset } = parsed.data;
  const admin = createAdminClient();

  let query = admin
    .from("organisations")
    .select("id, name, slug, owner_id, industry, created_at, updated_at", {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (q) {
    const safe = q.replace(/[%,]/g, " ").trim();
    query = query.or(`name.ilike.%${safe}%,slug.ilike.%${safe}%`);
  }

  let { data, error, count } = await query.returns<Organisation[]>();
  if (error && error.message.includes("industry")) {
    // Graceful fallback if migration not yet applied to remote DB
    const fallbackQuery = admin
      .from("organisations")
      .select("id, name, slug, owner_id, created_at, updated_at", {
        count: "exact",
      })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (q) {
      const safe = q.replace(/[%,]/g, " ").trim();
      fallbackQuery.or(`name.ilike.%${safe}%,slug.ilike.%${safe}%`);
    }

    const fallbackRes = await fallbackQuery.returns<Organisation[]>();
    data = (fallbackRes.data ?? []).map((o) => ({
      ...o,
      industry: "real_estate" as const,
    }));
    error = fallbackRes.error;
    count = fallbackRes.count;
  }
  if (error) return fail(error.message);

  const orgs = (data ?? []).map((o) => ({
    ...o,
    industry: (o.industry ?? "real_estate") as Organisation["industry"],
  }));
  if (orgs.length === 0) return ok({ items: [], total: count ?? 0 });

  const orgIds = orgs.map((o) => o.id);
  const ownerIds = [...new Set(orgs.map((o) => o.owner_id))];

  const [integrationsRes, emailsMap, leadCountsMap] = await Promise.all([
    admin
      .from("bolna_integrations")
      .select("organisation_id, enabled, created_at")
      .in("organisation_id", orgIds)
      .returns<
        { organisation_id: string; enabled: boolean; created_at: string }[]
      >(),
    fetchOwnerEmails(ownerIds),
    fetchLeadCounts(
      orgs.map((o) => o.slug),
    ),
  ]);

  if (integrationsRes.error) return fail(integrationsRes.error.message);
  const intByOrg = new Map(
    (integrationsRes.data ?? []).map((r) => [r.organisation_id, r]),
  );

  const items: AdminOrganisationRow[] = orgs.map((o) => {
    const integration = intByOrg.get(o.id);
    return {
      ...o,
      owner_email: emailsMap.get(o.owner_id) ?? null,
      voice_agent_connected: Boolean(integration),
      voice_agent_enabled: integration?.enabled ?? false,
      voice_agent_connected_at: integration?.created_at ?? null,
      lead_count: leadCountsMap.get(o.slug) ?? 0,
    };
  });

  return ok({ items, total: count ?? 0 });
}

export async function getOrganisationAdmin(
  id: unknown,
): Promise<ActionResult<AdminOrganisationRow>> {
  await requireAdmin();
  if (typeof id !== "string") return fail("Invalid organisation id");

  const admin = createAdminClient();
  let { data, error } = await admin
    .from("organisations")
    .select("id, name, slug, owner_id, industry, created_at, updated_at")
    .eq("id", id)
    .maybeSingle<Organisation>();

  if (error && error.message.includes("industry")) {
    const fallbackRes = await admin
      .from("organisations")
      .select("id, name, slug, owner_id, created_at, updated_at")
      .eq("id", id)
      .maybeSingle<Organisation>();
    if (fallbackRes.data) {
      data = { ...fallbackRes.data, industry: "real_estate" };
      error = null;
    } else {
      error = fallbackRes.error;
    }
  }

  if (error) return fail(error.message);
  if (!data) return fail("Organisation not found");

  const [integrationRes, emailsMap, leadCountsMap] = await Promise.all([
    admin
      .from("bolna_integrations")
      .select("enabled, created_at")
      .eq("organisation_id", data.id)
      .maybeSingle<{ enabled: boolean; created_at: string }>(),
    fetchOwnerEmails([data.owner_id]),
    fetchLeadCounts([data.slug]),
  ]);

  return ok({
    ...data,
    industry: (data.industry ?? "real_estate") as Organisation["industry"],
    owner_email: emailsMap.get(data.owner_id) ?? null,
    voice_agent_connected: Boolean(integrationRes.data),
    voice_agent_enabled: integrationRes.data?.enabled ?? false,
    voice_agent_connected_at: integrationRes.data?.created_at ?? null,
    lead_count: leadCountsMap.get(data.slug) ?? 0,
  });
}

export async function updateOrganisationAdmin(
  input: unknown,
): Promise<ActionResult<Organisation>> {
  await requireAdmin();
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const { id, ...patch } = parsed.data;
  if (Object.keys(patch).length === 0) return fail("No fields to update");

  const admin = createAdminClient();
  let { data, error } = await admin
    .from("organisations")
    .update(patch)
    .eq("id", id)
    .select("id, name, slug, owner_id, industry, created_at, updated_at")
    .single<Organisation>();

  if (error && error.message.includes("industry")) {
    const safePatch = { ...patch };
    delete safePatch.industry;
    if (Object.keys(safePatch).length === 0) {
      // Only industry was being updated, return existing org with requested industry
      const existing = await admin
        .from("organisations")
        .select("id, name, slug, owner_id, created_at, updated_at")
        .eq("id", id)
        .single<Organisation>();
      if (existing.data) {
        revalidatePath("/admin/organisations");
        revalidatePath(`/admin/organisations/${id}`);
        return ok({ ...existing.data, industry: patch.industry ?? "real_estate" });
      }
    } else {
      const fallbackRes = await admin
        .from("organisations")
        .update(safePatch)
        .eq("id", id)
        .select("id, name, slug, owner_id, created_at, updated_at")
        .single<Organisation>();
      if (fallbackRes.data) {
        data = { ...fallbackRes.data, industry: patch.industry ?? "real_estate" };
        error = null;
      } else {
        error = fallbackRes.error;
      }
    }
  }

  if (error || !data) return fail(error?.message ?? "Organisation not found");
  revalidatePath("/", "layout");
  revalidatePath("/admin/organisations");
  revalidatePath(`/admin/organisations/${id}`);
  return ok(data);
}

export async function listOrganisationMembersAdmin(
  orgId: unknown,
): Promise<ActionResult<TeamMemberRow[]>> {
  await requireAdmin();
  if (typeof orgId !== "string") return fail("Invalid organisation id");

  const admin = createAdminClient();

  // 1. Fetch organisation owner info
  const { data: org, error: orgErr } = await admin
    .from("organisations")
    .select("id, name, slug, owner_id, created_at, updated_at")
    .eq("id", orgId)
    .maybeSingle<Organisation>();

  if (orgErr || !org) return fail(orgErr?.message ?? "Organisation not found");

  const ownerEmail = (await fetchOwnerEmails([org.owner_id])).get(org.owner_id) ?? null;

  // 2. Fetch organisation members
  const { data: members, error: memErr } = await admin
    .from("organisation_members")
    .select("id, organisation_id, user_id, email, role, status, invited_by, created_at, updated_at")
    .eq("organisation_id", orgId)
    .order("created_at", { ascending: true })
    .returns<OrganisationMember[]>();

  if (memErr || !members || members.length === 0) {
    const ownerRow: TeamMemberRow = {
      id: org.id,
      organisation_id: org.id,
      user_id: org.owner_id,
      email: ownerEmail ?? "—",
      role: "admin",
      status: "active",
      invited_by: null,
      created_at: org.created_at,
      updated_at: org.updated_at,
      is_owner: true,
    };
    return ok([ownerRow]);
  }

  const userIds = members.map((m) => m.user_id).filter((id): id is string => Boolean(id));
  let profileMap = new Map<string, string | null>();
  if (userIds.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, display_name")
      .in("id", userIds)
      .returns<{ id: string; display_name: string | null }[]>();
    if (profiles) {
      profileMap = new Map(profiles.map((p) => [p.id, p.display_name]));
    }
  }

  const rows: TeamMemberRow[] = members.map((m) => ({
    ...m,
    display_name: m.user_id ? profileMap.get(m.user_id) ?? null : null,
    is_owner: m.user_id === org.owner_id,
  }));

  // If the owner is not explicitly in organisation_members, prepend the owner
  if (!rows.some((r) => r.user_id === org.owner_id)) {
    rows.unshift({
      id: org.id,
      organisation_id: org.id,
      user_id: org.owner_id,
      email: ownerEmail ?? "—",
      role: "admin",
      status: "active",
      invited_by: null,
      created_at: org.created_at,
      updated_at: org.updated_at,
      is_owner: true,
    });
  }

  return ok(rows);
}

const adminInviteSchema = z.object({
  organisationId: z.string().uuid(),
  email: z.string().email().toLowerCase().trim(),
  role: z.enum(["admin", "member"]).default("member"),
});

export async function inviteTeamMemberAdmin(
  input: unknown,
): Promise<ActionResult<OrganisationMember & { temporaryPassword?: string }>> {
  await requireAdmin();
  const parsed = adminInviteSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const { organisationId, email, role } = parsed.data;
  const cleanEmail = email.toLowerCase().trim();
  const admin = createAdminClient();

  // Fetch org info
  const { data: org } = await admin
    .from("organisations")
    .select("name, owner_id")
    .eq("id", organisationId)
    .single<{ name: string; owner_id: string }>();

  if (org) {
    const ownerEmail = (await fetchOwnerEmails([org.owner_id])).get(org.owner_id);
    if (ownerEmail && ownerEmail.toLowerCase().trim() === cleanEmail) {
      return fail(`${cleanEmail} is the owner of this workspace.`);
    }
  }

  // Check if member already in workspace
  const { data: existing } = await admin
    .from("organisation_members")
    .select("id, status")
    .eq("organisation_id", organisationId)
    .ilike("email", cleanEmail)
    .maybeSingle<{ id: string; status: string }>();

  if (existing) {
    return fail(`${cleanEmail} is already a member of this workspace.`);
  }

  // Check if user already exists in auth.users
  const { data: userList } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  let matchedUser = userList?.users?.find(
    (u) => (u.email ?? "").toLowerCase().trim() === cleanEmail,
  );

  let tempPassword: string | undefined = undefined;

  // If user does not exist in auth.users, create them with a random password
  if (!matchedUser) {
    tempPassword = generateRandomPassword();
    const { data: createdUser, error: createErr } = await admin.auth.admin.createUser({
      email: cleanEmail,
      password: tempPassword,
      email_confirm: true,
    });
    if (!createErr && createdUser?.user) {
      matchedUser = createdUser.user;
    }
  }

  const { data: newMember, error } = await admin
    .from("organisation_members")
    .insert({
      organisation_id: organisationId,
      user_id: matchedUser ? matchedUser.id : null,
      email: cleanEmail,
      role,
      status: "active" as const,
    })
    .select("*")
    .single<OrganisationMember>();

  if (error) {
    if (
      error.code === "23505" ||
      error.message.includes("unique constraint") ||
      error.message.includes("organisation_members_org_email_unique")
    ) {
      return fail(`${cleanEmail} is already a member of this workspace.`);
    }
    return fail(error.message);
  }

  // Dispatch invite email with credentials
  await sendTeamInviteEmail({
    toEmail: cleanEmail,
    temporaryPassword: tempPassword,
    orgName: org?.name ?? "Workspace",
    role,
  });

  revalidatePath(`/admin/organisations/${organisationId}`);
  return ok({ ...newMember, temporaryPassword: tempPassword });
}

const adminRemoveMemberSchema = z.object({
  organisationId: z.string().uuid(),
  memberId: z.string().uuid(),
});

export async function removeTeamMemberAdmin(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  const parsed = adminRemoveMemberSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const { organisationId, memberId } = parsed.data;
  const admin = createAdminClient();

  const { error } = await admin
    .from("organisation_members")
    .delete()
    .eq("id", memberId)
    .eq("organisation_id", organisationId);

  if (error) return fail(error.message);

  revalidatePath(`/admin/organisations/${organisationId}`);
  return ok({ id: memberId });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function fetchOwnerEmails(
  ownerIds: string[],
): Promise<Map<string, string>> {
  if (ownerIds.length === 0) return new Map();
  const admin = createAdminClient();
  const emails = new Map<string, string>();

  // Supabase Admin API — list users in pages. For a small-tenant admin
  // console this is fine; paginate if the auth user count gets huge.
  const { data, error } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (error) {
    console.error("[admin] listUsers failed", error);
    return emails;
  }
  for (const u of data.users) {
    if (ownerIds.includes(u.id) && u.email) emails.set(u.id, u.email);
  }
  return emails;
}

async function fetchLeadCounts(
  orgSlugs: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (orgSlugs.length === 0) return counts;
  const admin = createAdminClient();

  // One grouped query via the admin client — service role bypasses RLS.
  const { data, error } = await admin
    .from("leads")
    .select("org_slug", { count: "exact", head: false })
    .in("org_slug", orgSlugs);

  if (error) {
    console.error("[admin] lead counts failed", error);
    return counts;
  }

  for (const row of (data ?? []) as { org_slug: string | null }[]) {
    if (!row.org_slug) continue;
    counts.set(row.org_slug, (counts.get(row.org_slug) ?? 0) + 1);
  }
  return counts;
}
