import { describe, it, expect } from "vitest";
import { GET, POST } from "./route";

describe("/api/whatsapp-ai-match", () => {
  it("GET returns API status and model configuration", async () => {
    const res = await GET();
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json).toHaveProperty("hasOpenAiKey");
    expect(json).toHaveProperty("model");
  });

  it("POST executes analysis and returns structured leads and matches", async () => {
    const req = new Request("http://localhost:3000/api/whatsapp-ai-match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageIds: [] }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toBeDefined();
    expect(Array.isArray(json.data.leads)).toBe(true);
    expect(Array.isArray(json.data.matches)).toBe(true);
    expect(json.data.summary).toBeDefined();
    expect(json.data.summary.totalLeadsExtracted).toBeGreaterThanOrEqual(5);
  });
});

