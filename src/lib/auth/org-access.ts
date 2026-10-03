import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * The session user, on a cookie-backed client.
 *
 * Returns `user: null` rather than redirecting — Server Actions answer with
 * `fail("Not authenticated")`, they don't navigate.
 */
export async function requireUser(): Promise<{
  supabase: SupabaseServerClient;
  user: { id: string; email?: string } | null;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user: user ? { id: user.id, email: user.email } : null };
}

/**
 * May this user access this organisation?
 *
 * Allowed if:
 * 1. Platform staff (`profiles.is_admin`)
 * 2. The organisation's primary creator/owner (`organisations.owner_id`)
 * 3. Any active/invited member in `organisation_members` (by user_id or email)
 */
export async function userCanAccessOrg(
  userId: string,
  organisationId: string,
  userEmail?: string,
): Promise<boolean> {
  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("profiles")
    .select("is_admin")
    .eq("id", userId)
    .maybeSingle<{ is_admin: boolean }>();
  if (profile?.is_admin) return true;

  const { data: org } = await admin
    .from("organisations")
    .select("id")
    .eq("id", organisationId)
    .eq("owner_id", userId)
    .maybeSingle<{ id: string }>();
  if (org) return true;

  const { data: member } = await admin
    .from("organisation_members")
    .select("id, user_id")
    .eq("organisation_id", organisationId)
    .eq("user_id", userId)
    .neq("status", "suspended")
    .limit(1)
    .maybeSingle<{ id: string; user_id: string | null }>();
  if (member) return true;

  if (userEmail) {
    const cleanEmail = userEmail.toLowerCase().trim();
    const { data: memberByEmail } = await admin
      .from("organisation_members")
      .select("id, user_id")
      .eq("organisation_id", organisationId)
      .ilike("email", cleanEmail)
      .neq("status", "suspended")
      .limit(1)
      .maybeSingle<{ id: string; user_id: string | null }>();

    if (memberByEmail) {
      if (!memberByEmail.user_id) {
        await admin
          .from("organisation_members")
          .update({ user_id: userId, status: "active" })
          .eq("id", memberByEmail.id);
      }
      return true;
    }
  }

  return false;
}

/**
 * Resolve an organisation by id or slug if the user has access.
 */
export async function getOrgForUser(
  userId: string,
  identifier: { id?: string; slug?: string },
  userEmail?: string,
): Promise<{ id: string; slug: string; name: string } | null> {
  const admin = createAdminClient();
  let query = admin
    .from("organisations")
    .select("id, slug, name, owner_id");

  if (identifier.id) {
    query = query.eq("id", identifier.id);
  } else if (identifier.slug) {
    query = query.eq("slug", identifier.slug);
  } else {
    return null;
  }

  const { data: org } = await query.maybeSingle<{
    id: string;
    slug: string;
    name: string;
    owner_id: string;
  }>();

  if (!org) return null;

  if (org.owner_id === userId) {
    return { id: org.id, slug: org.slug, name: org.name };
  }

  const allowed = await userCanAccessOrg(userId, org.id, userEmail);
  if (!allowed) return null;

  return { id: org.id, slug: org.slug, name: org.name };
}

/**
 * May this user administer this organisation?
 *
 * Three ways in:
 * 1. Platform staff (`profiles.is_admin`)
 * 2. The organisation's primary creator/owner (`organisations.owner_id`)
 * 3. An assigned organisation admin in `organisation_members` with `role = 'admin'`
 */
export async function userCanManageOrg(
  _supabase: SupabaseServerClient | null,
  userId: string,
  organisationId: string,
  userEmail?: string,
): Promise<boolean> {
  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("profiles")
    .select("is_admin")
    .eq("id", userId)
    .maybeSingle<{ is_admin: boolean }>();
  if (profile?.is_admin) return true;

  const { data: org } = await admin
    .from("organisations")
    .select("id")
    .eq("id", organisationId)
    .eq("owner_id", userId)
    .maybeSingle<{ id: string }>();
  if (org) return true;

  const { data: member } = await admin
    .from("organisation_members")
    .select("id")
    .eq("organisation_id", organisationId)
    .eq("user_id", userId)
    .eq("role", "admin")
    .neq("status", "suspended")
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (member) return true;

  if (userEmail) {
    const cleanEmail = userEmail.toLowerCase().trim();
    const { data: memberByEmail } = await admin
      .from("organisation_members")
      .select("id")
      .eq("organisation_id", organisationId)
      .ilike("email", cleanEmail)
      .eq("role", "admin")
      .neq("status", "suspended")
      .limit(1)
      .maybeSingle<{ id: string }>();
    if (memberByEmail) return true;
  }

  return false;
}

