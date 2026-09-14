import "server-only";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Organisation, OrgRole } from "@/types/organisation";

export interface Session {
  userId: string;
  email: string;
  organisation: Organisation;
  role: OrgRole;
  memberId?: string;
}

export async function getSession(): Promise<Session | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const userEmail = (user.email ?? "").toLowerCase().trim();
  const admin = createAdminClient();

  // 1. Try finding an active or invited membership by user_id or email
  try {
    const memberQuery = admin
      .from("organisation_members")
      .select("id, organisation_id, role, status, user_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle<{
        id: string;
        organisation_id: string;
        role: OrgRole;
        status: string;
        user_id: string | null;
      }>();

    let { data: member } = await memberQuery;

    // Fallback: check by email if not linked by user_id
    if (!member && userEmail) {
      const { data: byEmail } = await admin
        .from("organisation_members")
        .select("id, organisation_id, role, status, user_id")
        .ilike("email", userEmail)
        .limit(1)
        .maybeSingle<{
          id: string;
          organisation_id: string;
          role: OrgRole;
          status: string;
          user_id: string | null;
        }>();
      member = byEmail;
    }

    if (member) {
      // Ensure user_id is bound and status is active
      if (member.user_id !== user.id || member.status !== "active") {
        await admin
          .from("organisation_members")
          .update({ user_id: user.id, status: "active" })
          .eq("id", member.id);
      }

      const { data: org } = await admin
        .from("organisations")
        .select("id, name, slug, owner_id, created_at, updated_at")
        .eq("id", member.organisation_id)
        .maybeSingle<Organisation>();

      if (org) {
        return {
          userId: user.id,
          email: user.email ?? "",
          organisation: {
            ...org,
            industry: (org as unknown as { industry?: Organisation["industry"] }).industry ?? "real_estate",
          },
          role: member.role,
          memberId: member.id,
        };
      }
    }
  } catch {
    // Ignore schema cache errors
  }

  // 2. Fallback to owner_id check on organisations
  const { data: org } = await admin
    .from("organisations")
    .select("id, name, slug, owner_id, created_at, updated_at")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<Organisation>();

  if (org) {
    return {
      userId: user.id,
      email: user.email ?? "",
      organisation: {
        ...org,
        industry: (org as unknown as { industry?: Organisation["industry"] }).industry ?? "real_estate",
      },
      role: "admin",
    };
  }

  return null;
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect("/login");
    redirect("/onboarding");
  }
  return session;
}

