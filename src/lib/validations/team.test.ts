import { describe, expect, it } from "vitest";

import {
  inviteTeamMemberSchema,
  removeMemberSchema,
  updateRoleSchema,
} from "./team";

describe("inviteTeamMemberSchema", () => {
  it("accepts a valid member invite input", () => {
    const res = inviteTeamMemberSchema.safeParse({
      email: "teammate@company.com",
      role: "member",
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.email).toBe("teammate@company.com");
      expect(res.data.role).toBe("member");
    }
  });

  it("defaults role to 'member' when omitted", () => {
    const res = inviteTeamMemberSchema.safeParse({
      email: "Admin@Company.com",
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.email).toBe("admin@company.com");
      expect(res.data.role).toBe("member");
    }
  });

  it("accepts 'admin' role", () => {
    const res = inviteTeamMemberSchema.safeParse({
      email: "boss@company.com",
      role: "admin",
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.role).toBe("admin");
    }
  });

  it("rejects invalid emails", () => {
    const res = inviteTeamMemberSchema.safeParse({
      email: "not-an-email",
    });
    expect(res.success).toBe(false);
  });
});

describe("updateRoleSchema", () => {
  it("validates uuid and role", () => {
    const res = updateRoleSchema.safeParse({
      memberId: "11111111-1111-4111-8111-111111111111",
      role: "admin",
    });
    expect(res.success).toBe(true);
  });

  it("rejects invalid roles", () => {
    const res = updateRoleSchema.safeParse({
      memberId: "11111111-1111-4111-8111-111111111111",
      role: "super-owner",
    });
    expect(res.success).toBe(false);
  });
});

describe("removeMemberSchema", () => {
  it("validates uuid", () => {
    const res = removeMemberSchema.safeParse({
      memberId: "11111111-1111-4111-8111-111111111111",
    });
    expect(res.success).toBe(true);
  });
});
