import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth/session";
import { userCanManageOrg } from "@/lib/auth/org-access";
import { generateRandomPassword, sendTeamInviteEmail } from "@/lib/email/invite";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const inviteBodySchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Email is required")
    .email("Please enter a valid email address")
    .toLowerCase(),
  role: z.enum(["admin", "member"]).default("member"),
  organisationId: z.string().uuid().optional(),
});

/**
 * POST /api/team/invite
 * Authenticated API route to onboard a team member with random password & Resend email.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized. Please sign in." },
        { status: 401 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const parsed = inviteBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: parsed.error.issues[0]?.message ?? "Invalid input",
        },
        { status: 400 },
      );
    }

    const { email: rawEmail, role, organisationId } = parsed.data;
    const cleanEmail = rawEmail.toLowerCase().trim();
    const targetOrgId = organisationId || session.organisation.id;

    const supabase = await createClient();
    const canManage = await userCanManageOrg(
      supabase,
      session.userId,
      targetOrgId,
    );

    if (!canManage) {
      return NextResponse.json(
        {
          success: false,
          error: "Forbidden. Only workspace admins can invite new members.",
        },
        { status: 403 },
      );
    }

    // Check if the email belongs to the current user or owner
    if (session.email.toLowerCase().trim() === cleanEmail) {
      return NextResponse.json(
        {
          success: false,
          error: `${cleanEmail} is the owner of this workspace.`,
        },
        { status: 400 },
      );
    }

    const admin = createAdminClient();

    // Check existing member in workspace
    const { data: existing } = await admin
      .from("organisation_members")
      .select("id, status")
      .eq("organisation_id", targetOrgId)
      .ilike("email", cleanEmail)
      .maybeSingle<{ id: string; status: string }>();

    if (existing) {
      return NextResponse.json(
        {
          success: false,
          error: `${cleanEmail} is already a member of this workspace.`,
        },
        { status: 400 },
      );
    }

    // Look up or provision auth user
    const { data: userList } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    let matchedUser = userList?.users?.find(
      (u) => (u.email ?? "").toLowerCase().trim() === cleanEmail,
    );

    const tempPassword = generateRandomPassword();

    if (!matchedUser) {
      const { data: createdUser, error: createErr } =
        await admin.auth.admin.createUser({
          email: cleanEmail,
          password: tempPassword,
          email_confirm: true,
        });

      if (createErr) {
        return NextResponse.json(
          {
            success: false,
            error: `Failed to create user account: ${createErr.message}`,
          },
          { status: 500 },
        );
      }

      if (createdUser?.user) {
        matchedUser = createdUser.user;
      }
    } else {
      await admin.auth.admin.updateUserById(matchedUser.id, {
        password: tempPassword,
        email_confirm: true,
      });
    }

    const insertData = {
      organisation_id: targetOrgId,
      user_id: matchedUser ? matchedUser.id : null,
      email: cleanEmail,
      role,
      status: "active" as const,
      invited_by: session.userId,
    };

    const { data: newMember, error: insertErr } = await admin
      .from("organisation_members")
      .insert(insertData)
      .select("*")
      .single();

    if (insertErr) {
      if (
        insertErr.code === "23505" ||
        insertErr.message.includes("unique constraint") ||
        insertErr.message.includes("organisation_members_org_email_unique")
      ) {
        return NextResponse.json(
          {
            success: false,
            error: `${cleanEmail} is already a member of this workspace.`,
          },
          { status: 400 },
        );
      }
      return NextResponse.json(
        { success: false, error: insertErr.message },
        { status: 500 },
      );
    }

    // Dispatch onboarding invite email with credentials via Resend
    const emailResult = await sendTeamInviteEmail({
      toEmail: cleanEmail,
      temporaryPassword: tempPassword,
      orgName: session.organisation.name,
      inviterEmail: session.email,
      role,
    });

    return NextResponse.json({
      success: true,
      member: newMember,
      temporaryPassword: tempPassword,
      emailSent: emailResult.success,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal Server Error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
