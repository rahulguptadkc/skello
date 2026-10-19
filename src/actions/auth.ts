"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import {
  checkRateLimit,
  clientIpFromHeaders,
} from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loginSchema, signupSchema } from "@/lib/validations/auth";
import { type ActionResult, fail, ok } from "@/types/action";
import type { Organisation } from "@/types/organisation";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

export async function signUp(
  input: unknown,
): Promise<ActionResult<{ userId: string; organisationId: string }>> {
  const parsed = signupSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  // 3 signup attempts per hour per IP. Stops automated org-spam scripts
  // from burning through anon auth.signUp + admin-client org inserts.
  // Failing open on RPC error is acceptable here — signup is high-cost
  // (sends an email) so even unlimited bursts are self-limiting.
  const ip = clientIpFromHeaders(await headers());
  const rl = await checkRateLimit({
    key: `signup:ip:${ip}`,
    windowSeconds: 3600,
    max: 3,
  });
  if (!rl.allowed) {
    return fail(
      `Too many signups from this address. Try again in ${rl.retryAfterSeconds}s.`,
    );
  }

  const { email, password, organisationName } = parsed.data;
  const supabase = await createClient();

  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
  });

  if (authError) return fail(authError.message);
  if (!authData.user) return fail("Could not create user");

  const baseSlug = slugify(organisationName) || "org";
  const uniqueSlug = `${baseSlug}-${authData.user.id.slice(0, 8)}`;

  // Admin client bypasses RLS. Required because the user's session isn't bound
  // to this request yet (and won't be at all if email confirmation is on),
  // so the standard cookie client would insert as `anon` and trip the
  // `organisations_insert_own` policy. We control owner_id server-side from
  // the just-created auth user, so multi-tenancy is still enforced.
  const admin = createAdminClient();
  const { data: org, error: orgError } = await admin
    .from("organisations")
    .insert({
      name: organisationName,
      slug: uniqueSlug,
      owner_id: authData.user.id,
    })
    .select("id")
    .single<Pick<Organisation, "id">>();

  if (orgError) return fail(orgError.message);

  revalidatePath("/", "layout");
  return ok({ userId: authData.user.id, organisationId: org.id });
}

export async function login(
  input: unknown,
): Promise<ActionResult<{ redirectTo: string }>> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  // Concurrently resolve headers/IP and Supabase client
  const [headerList, supabase] = await Promise.all([
    headers(),
    createClient(),
  ]);
  const ip = clientIpFromHeaders(headerList);

  // Parallelize IP rate limit check and password authentication over the wire
  // instead of paying for two sequential round trips.
  const [rl, authRes] = await Promise.all([
    checkRateLimit({
      key: `login:ip:${ip}`,
      windowSeconds: 60,
      max: 5,
    }),
    supabase.auth.signInWithPassword(parsed.data),
  ]);

  if (!rl.allowed) {
    return fail(
      `Too many login attempts. Try again in ${rl.retryAfterSeconds}s.`,
    );
  }

  if (authRes.error) return fail(authRes.error.message);

  const user = authRes.data.user;
  if (!user) {
    return ok({ redirectTo: "/login" });
  }

  const admin = createAdminClient();
  const userEmail = (user.email ?? "").toLowerCase().trim();

  // Concurrently resolve admin status, organisation membership (checking user_id
  // and email in a single OR filter), and owned organisation in ONE parallel round-trip.
  const [profileRes, memberRes, ownedOrgRes] = await Promise.all([
    admin
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .maybeSingle<{ is_admin: boolean }>(),
    admin
      .from("organisation_members")
      .select("id, organisation_id, user_id, status")
      .or(
        userEmail
          ? `user_id.eq.${user.id},email.ilike.${userEmail}`
          : `user_id.eq.${user.id}`,
      )
      .neq("status", "suspended")
      .limit(1)
      .maybeSingle<{
        id: string;
        organisation_id: string;
        user_id: string | null;
        status: string;
      }>(),
    admin
      .from("organisations")
      .select("id")
      .eq("owner_id", user.id)
      .limit(1)
      .maybeSingle<{ id: string }>(),
  ]);

  let redirectTo = "/dashboard";
  if (profileRes.data?.is_admin) {
    redirectTo = "/admin";
  } else if (memberRes.data) {
    const member = memberRes.data;
    // Bind invited user_id or activate membership if pending
    if (member.user_id !== user.id || member.status !== "active") {
      await admin
        .from("organisation_members")
        .update({ user_id: user.id, status: "active" })
        .eq("id", member.id);
    }
    redirectTo = "/dashboard";
  } else {
    redirectTo = ownedOrgRes.data ? "/dashboard" : "/onboarding";
  }

  return ok({ redirectTo });
}

export async function logout(): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();

  if (error) return fail(error.message);

  revalidatePath("/", "layout");
  redirect("/login");
}

export async function getCurrentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
