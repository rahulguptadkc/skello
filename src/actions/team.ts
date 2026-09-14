"use server";

import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/auth/session";
import { userCanManageOrg } from "@/lib/auth/org-access";
import { generateRandomPassword, sendTeamInviteEmail } from "@/lib/email/invite";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  inviteTeamMemberSchema,
  removeMemberSchema,
  updateRoleSchema,
} from "@/lib/validations/team";
import { type ActionResult, fail, ok } from "@/types/action";
import type { OrganisationMember, OrgRole, TeamMemberRow } from "@/types/organisation";

export async function listTeamMembers(): Promise<ActionResult<TeamMemberRow[]>> {
  const session = await requireSession();
  const admin = createAdminClient();

  const { data: members, error } = await admin
    .from("organisation_members")
    .select("id, organisation_id, user_id, email, role, status, invited_by, created_at, updated_at")
    .eq("organisation_id", session.organisation.id)
    .order("created_at", { ascending: true })
    .returns<OrganisationMember[]>();

  if (error) {
    // Graceful fallback if migration not yet applied to remote DB
    const ownerRow: TeamMemberRow = {
      id: session.organisation.id,
      organisation_id: session.organisation.id,
      user_id: session.organisation.owner_id,
      email: session.email,
      role: "admin",
      status: "active",
      invited_by: null,
      created_at: session.organisation.created_at,
      updated_at: session.organisation.updated_at,
      is_owner: true,
    };
    return ok([ownerRow]);
  }

  const userIds = (members ?? []).map((m) => m.user_id).filter((id): id is string => Boolean(id));

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

  const rows: TeamMemberRow[] = (members ?? []).map((m) => ({
    ...m,
    display_name: m.user_id ? profileMap.get(m.user_id) ?? null : null,
    is_owner: m.user_id === session.organisation.owner_id,
  }));

  // Ensure workspace owner is always listed at the top
  if (!rows.some((r) => r.user_id === session.organisation.owner_id)) {
    rows.unshift({
      id: session.organisation.id,
      organisation_id: session.organisation.id,
      user_id: session.organisation.owner_id,
      email: session.email,
      role: "admin",
      status: "active",
      invited_by: null,
      created_at: session.organisation.created_at,
      updated_at: session.organisation.updated_at,
      is_owner: true,
    });
  }

  return ok(rows);
}

export async function inviteTeamMember(
  input: unknown,
): Promise<ActionResult<OrganisationMember & { temporaryPassword?: string }>> {
  const session = await requireSession();
  const supabase = await createClient();

  const canManage = await userCanManageOrg(
    supabase,
    session.userId,
    session.organisation.id,
  );
  if (!canManage) {
    return fail("Only workspace admins can invite new team members.");
  }

  const parsed = inviteTeamMemberSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const { email, role } = parsed.data;
  const cleanEmail = email.toLowerCase().trim();

  // Check if the email belongs to the workspace owner
  if (session.email.toLowerCase().trim() === cleanEmail) {
    return fail(`${cleanEmail} is the owner of this workspace.`);
  }

  const admin = createAdminClient();

  // Check if member already in workspace (using admin client to bypass RLS and case-insensitive check)
  const { data: existing } = await admin
    .from("organisation_members")
    .select("id, status")
    .eq("organisation_id", session.organisation.id)
    .ilike("email", cleanEmail)
    .maybeSingle<{ id: string; status: string }>();

  if (existing) {
    if (existing.status === "active") {
      return fail(`${cleanEmail} is already an active member of this workspace.`);
    }
    return fail(`${cleanEmail} has already been invited to this workspace.`);
  }

  // Check if user already exists in auth.users via admin client
  const { data: userList } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  let matchedUser = userList?.users?.find(
    (u) => (u.email ?? "").toLowerCase().trim() === cleanEmail,
  );

  const tempPassword = generateRandomPassword();

  // If user does not exist in auth.users, create them; otherwise update password so emailed credentials always work
  if (!matchedUser) {
    const { data: createdUser, error: createErr } = await admin.auth.admin.createUser({
      email: cleanEmail,
      password: tempPassword,
      email_confirm: true,
    });
    if (!createErr && createdUser?.user) {
      matchedUser = createdUser.user;
    }
  } else {
    await admin.auth.admin.updateUserById(matchedUser.id, {
      password: tempPassword,
      email_confirm: true,
    });
  }

  const insertData = {
    organisation_id: session.organisation.id,
    user_id: matchedUser ? matchedUser.id : null,
    email: cleanEmail,
    role,
    status: "active" as const,
    invited_by: session.userId,
  };

  const { data: newMember, error } = await admin
    .from("organisation_members")
    .insert(insertData)
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
    toEmail: email,
    temporaryPassword: tempPassword,
    orgName: session.organisation.name,
    inviterEmail: session.email,
    role,
  });

  revalidatePath("/settings/team");
  return ok({ ...newMember, temporaryPassword: tempPassword });
}

export async function updateTeamMemberRole(
  input: unknown,
): Promise<ActionResult<{ memberId: string; role: OrgRole }>> {
  const session = await requireSession();
  const supabase = await createClient();

  const canManage = await userCanManageOrg(
    supabase,
    session.userId,
    session.organisation.id,
  );
  if (!canManage) {
    return fail("Only workspace admins can update member roles.");
  }

  const parsed = updateRoleSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const { memberId, role } = parsed.data;

  const admin = createAdminClient();

  // Fetch the target member
  const { data: target } = await admin
    .from("organisation_members")
    .select("id, user_id, email, role")
    .eq("id", memberId)
    .eq("organisation_id", session.organisation.id)
    .maybeSingle<OrganisationMember>();

  if (!target) return fail("Team member not found.");

  // Cannot demote workspace primary owner
  if (target.user_id === session.organisation.owner_id && role !== "admin") {
    return fail("The workspace owner must remain an Admin.");
  }

  // If caller is demoting themselves, ensure at least one other admin exists
  if (target.user_id === session.userId && role !== "admin") {
    const { count } = await admin
      .from("organisation_members")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", session.organisation.id)
      .eq("role", "admin")
      .eq("status", "active");

    if ((count ?? 0) <= 1) {
      return fail("You cannot demote yourself as you are the only Admin.");
    }
  }

  const { error } = await admin
    .from("organisation_members")
    .update({ role })
    .eq("id", memberId)
    .eq("organisation_id", session.organisation.id);

  if (error) return fail(error.message);

  revalidatePath("/settings/team");
  return ok({ memberId, role });
}

export async function removeTeamMember(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const session = await requireSession();
  const supabase = await createClient();

  const canManage = await userCanManageOrg(
    supabase,
    session.userId,
    session.organisation.id,
  );
  if (!canManage) {
    return fail("Only workspace admins can remove team members.");
  }

  const parsed = removeMemberSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const { memberId } = parsed.data;
  const admin = createAdminClient();

  // Fetch target member
  const { data: target } = await admin
    .from("organisation_members")
    .select("id, user_id, email, role")
    .eq("id", memberId)
    .eq("organisation_id", session.organisation.id)
    .maybeSingle<OrganisationMember>();

  if (!target) return fail("Team member not found.");

  // Protect workspace owner
  if (target.user_id === session.organisation.owner_id) {
    return fail("The workspace owner cannot be removed from the workspace.");
  }

  // Prevent admin from removing themselves if they're the last admin
  if (target.user_id === session.userId) {
    return fail("You cannot remove yourself. Ask another admin to remove you.");
  }

  const { error } = await admin
    .from("organisation_members")
    .delete()
    .eq("id", memberId)
    .eq("organisation_id", session.organisation.id);

  if (error) return fail(error.message);

  revalidatePath("/settings/team");
  return ok({ id: memberId });
}
