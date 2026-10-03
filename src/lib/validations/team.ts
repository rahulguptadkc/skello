import { z } from "zod";

export const inviteTeamMemberSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Email is required")
    .email("Please enter a valid email address")
    .toLowerCase(),
  role: z.enum(["admin", "member"]).default("member"),
});

export const updateRoleSchema = z.object({
  memberId: z.string().uuid("Invalid member ID"),
  role: z.enum(["admin", "member"]),
});

export const removeMemberSchema = z.object({
  memberId: z.string().uuid("Invalid member ID"),
});

export type InviteTeamMemberInput = z.infer<typeof inviteTeamMemberSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
