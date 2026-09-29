import { describe, expect, it } from "vitest";
import { resolveContactName } from "@/lib/campaigns/dispatch";

describe("resolveContactName", () => {
  it("resolves direct contact.name when present", () => {
    expect(resolveContactName({ name: "Raina Dwivedi", metadata: {} })).toBe(
      "Raina Dwivedi",
    );
  });

  it("trims direct contact.name whitespace", () => {
    expect(resolveContactName({ name: "  Raina  ", metadata: {} })).toBe(
      "Raina",
    );
  });

  it("falls back to metadata.customer if name is null", () => {
    expect(
      resolveContactName({
        name: null,
        metadata: { customer: "Raina" },
      }),
    ).toBe("Raina");
  });

  it("falls back to metadata.customer_name if name is null", () => {
    expect(
      resolveContactName({
        name: null,
        metadata: { customer_name: "Raina Sharma" },
      }),
    ).toBe("Raina Sharma");
  });

  it("falls back to metadata.contact_name if name is empty string", () => {
    expect(
      resolveContactName({
        name: "   ",
        metadata: { contact_name: "रैना" },
      }),
    ).toBe("रैना");
  });

  it("falls back to metadata.name or first_name if other keys missing", () => {
    expect(
      resolveContactName({
        name: null,
        metadata: { first_name: "Raina" },
      }),
    ).toBe("Raina");
  });

  it("returns null if no name candidates exist", () => {
    expect(
      resolveContactName({
        name: null,
        metadata: { city: "Delhi", car: "Honda Dio" },
      }),
    ).toBeNull();
  });
});
