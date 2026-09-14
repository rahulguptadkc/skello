import { describe, expect, it } from "vitest";

import { generateRandomPassword } from "./invite";

describe("generateRandomPassword", () => {
  it("generates a random temporary password with at least 10 characters", () => {
    const pwd = generateRandomPassword();
    expect(pwd.length).toBeGreaterThanOrEqual(10);
  });

  it("generates distinct passwords across multiple calls", () => {
    const p1 = generateRandomPassword();
    const p2 = generateRandomPassword();
    expect(p1).not.toBe(p2);
  });
});
