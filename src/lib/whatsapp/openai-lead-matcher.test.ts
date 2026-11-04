import { describe, expect, it } from "vitest";
import {
  runFallbackRuleBasedAnalysis,
  SAMPLE_REAL_ESTATE_WHATSAPP_MESSAGES,
  type RawInputMessage,
} from "./openai-lead-matcher";

describe("openai-lead-matcher", () => {
  it("processes sample messages and decomposes multi-listing messages correctly", () => {
    const result = runFallbackRuleBasedAnalysis(
      SAMPLE_REAL_ESTATE_WHATSAPP_MESSAGES,
      "Test Execution",
    );

    expect(result.success).toBe(true);
    expect(result.leads.length).toBeGreaterThanOrEqual(5);

    // Verify Buyer intent
    const buyerLead = result.leads.find((l) => l.intent === "buy");
    expect(buyerLead).toBeDefined();
    expect(buyerLead?.location).toContain("Koramangala");
    expect(buyerLead?.side).toBe("demand");

    // Verify Seller intent (Prestige Plot)
    const sellerLead = result.leads.find(
      (l) => l.intent === "sell" && l.location?.includes("Prestige Autumn Leaves"),
    );
    expect(sellerLead).toBeDefined();
    expect(sellerLead?.contactPhone).toBe("9686115795");
    expect(sellerLead?.side).toBe("supply");

    // Verify Rent Seeker (Cooke Town)
    const rentSeeker = result.leads.find(
      (l) => l.intent === "rent_seek" && l.location?.includes("Cooke Town"),
    );
    expect(rentSeeker).toBeDefined();
    expect(rentSeeker?.side).toBe("demand");
    expect(rentSeeker?.budgetOrPrice).toBe("₹40K/month");

    // Verify Landlord Rent Out (Wheeler Road)
    const rentOut = result.leads.find(
      (l) => l.intent === "rent_out" && l.location?.includes("Wheeler Road"),
    );
    expect(rentOut).toBeDefined();
    expect(rentOut?.side).toBe("supply");

    // Verify Matches Found
    expect(result.matches.length).toBeGreaterThan(0);
    const cookeMatch = result.matches.find((m) =>
      m.demandLeadSummary.includes("Cooke Town"),
    );
    expect(cookeMatch).toBeDefined();
    expect(cookeMatch?.matchScore).toBeGreaterThan(0.7);
  });

  it("handles empty or generic messages without crashing", () => {
    const custom: RawInputMessage[] = [
      {
        id: "c1",
        senderName: "Direct Agent",
        senderPhone: "+91 99999 11111",
        text: "Looking for 3BHK flat on rent in Indiranagar under 50k",
      },
    ];

    const result = runFallbackRuleBasedAnalysis(custom, "Custom Test");
    expect(result.success).toBe(true);
    expect(result.leads.length).toBe(1);
    expect(result.leads[0].intent).toBe("rent_seek");
  });

  it("analyzeWhatsAppMessagesWithLLM returns valid structured results", async () => {
    const { analyzeWhatsAppMessagesWithLLM } = await import("./openai-lead-matcher");
    const result = await analyzeWhatsAppMessagesWithLLM(SAMPLE_REAL_ESTATE_WHATSAPP_MESSAGES);
    expect(result.success).toBe(true);
    expect(result.leads.length).toBeGreaterThanOrEqual(5);
    expect(result.summary.totalLeadsExtracted).toBe(result.leads.length);
  });
});
