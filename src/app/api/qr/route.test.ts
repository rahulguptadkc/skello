import { describe, it, expect, vi } from "vitest";
import { GET } from "./route";

describe("GET /api/qr", () => {
  it("returns status and qr properties matching the Baileys contract", async () => {
    const res = await GET();
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json).toHaveProperty("status");
    expect(json).toHaveProperty("qr");
  });
});

