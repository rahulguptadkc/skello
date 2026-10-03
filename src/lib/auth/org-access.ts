import "server-only";

import { createClient } from "@/lib/supabase/server";

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
 * May this user administer this organisation?
 *
 * Three ways in:
 * 1. Platform staff (`profiles.is_admin`)
 * 2. The organisation's primary creator/owner (`organisations.owner_id`)
 * 3. An assigned organisation admin in `organisation_members` with `role = 'admin'`
 */
export async function userCanManageOrg(
  supabase: SupabaseServerClient,
  userId: string,
  organisationId: string,
): Promise<boolean> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", userId)
    .maybeSingle<{ is_admin: boolean }>();
  if (profile?.is_admin) return true;

  const { data: org } = await supabase
    .from("organisations")
    .select("id")
    .eq("id", organisationId)
    .eq("owner_id", userId)
    .maybeSingle<{ id: string }>();
  if (org) return true;

  const { data: member } = await supabase
    .from("organisation_members")
    .select("id")
    .eq("organisation_id", organisationId)
    .eq("user_id", userId)
    .eq("role", "admin")
    .eq("status", "active")
    .maybeSingle<{ id: string }>();

  return !!member;
}

