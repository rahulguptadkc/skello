import { describe, expect, it } from "vitest";
import {
  parsePriceToInr,
  categorizeProperty,
  isIntentCompatible,
  evaluateLocationCompatibility,
  evaluateConfigCompatibility,
  evaluateBudgetCompatibility,
  matchPropertiesByRules,
} from "./property-script-matcher";
import type { ExtractedAILead } from "./openai-lead-matcher";

describe("property-script-matcher (Algorithmic Matchmaking)", () => {
  describe("Price / Budget Parser", () => {
    it("parses informal Indian price notations correctly", () => {
      const p1 = parsePriceToInr("40K");
      expect(p1.type).toBe("monthly_rent");
      expect(p1.amountInr).toBe(40000);

      const p2 = parsePriceToInr("60k (nego)");
      expect(p2.type).toBe("monthly_rent");
      expect(p2.amountInr).toBe(60000);

      const p3 = parsePriceToInr("1.50 Lakhs");
      expect(p3.type).toBe("monthly_rent");
      expect(p3.amountInr).toBe(150000);

      const p4 = parsePriceToInr("₹2.25 Cr");
      expect(p4.type).toBe("total_sale");
      expect(p4.amountInr).toBe(22500000);

      const p5 = parsePriceToInr("11,500 per Sft");
      expect(p5.type).toBe("per_sqft");
      expect(p5.amountInr).toBe(11500);

      const p6 = parsePriceToInr("—");
      expect(p6.type).toBe("unspecified");
      expect(p6.amountInr).toBe(0);
    });
  });

  describe("Property Category Resolver", () => {
    it("categorizes property types from unstructured descriptions", () => {
      expect(categorizeProperty("Apartment", "3BHK")).toBe("apartment");
      expect(categorizeProperty("Luxury Villa", "4BHK")).toBe("villa_house");
      expect(categorizeProperty("Plotted development", "2400 Sqft")).toBe("plot");
      expect(categorizeProperty("Commercial Office", "3500 sft bare shell")).toBe("commercial_office");
      expect(categorizeProperty("Commercial Showroom", "1800 sqft")).toBe("retail_showroom");
    });
  });

  describe("Intent Compatibility Check", () => {
    it("matches complementary sides and rejects same sides", () => {
      expect(isIntentCompatible("buy", "sell")).toBe(true);
      expect(isIntentCompatible("rent_seek", "rent_out")).toBe(true);
      expect(isIntentCompatible("lease_seek", "lease_out")).toBe(true);

      // Incompatible
      expect(isIntentCompatible("buy", "buy")).toBe(false);
      expect(isIntentCompatible("sell", "sell")).toBe(false);
      expect(isIntentCompatible("buy", "rent_out")).toBe(false);
      expect(isIntentCompatible("rent_seek", "sell")).toBe(false);
    });
  });

  describe("Location Compatibility", () => {
    it("scores exact, neighboring, and zonal Bangalore locations", () => {
      // Exact
      const exact = evaluateLocationCompatibility("Whitefield", "Whitefield");
      expect(exact.score).toBe(1.0);

      // Neighboring Central Bangalore (<2 km)
      const neighbor = evaluateLocationCompatibility("Cooke Town", "Wheeler Road");
      expect(neighbor.score).toBeGreaterThanOrEqual(0.85);
      expect(neighbor.reason).toContain("adjacent");

      // Neighboring South Bangalore
      const southNeighbor = evaluateLocationCompatibility("Koramangala", "HSR Layout");
      expect(southNeighbor.score).toBeGreaterThanOrEqual(0.85);

      // Same Zone (East Bangalore: Whitefield & Bellandur)
      const sameZone = evaluateLocationCompatibility("Whitefield", "Bellandur");
      expect(sameZone.score).toBeGreaterThanOrEqual(0.7);
    });
  });

  describe("Config & Budget Evaluation", () => {
    it("evaluates BHK configuration match without requiring plot dimensions or commercial floor areas", () => {
      expect(evaluateConfigCompatibility("3 BHK", "3 BHK").score).toBe(1.0);
      expect(evaluateConfigCompatibility("2 BHK", "3 BHK").score).toBe(0.75);
      // Plots or Commercial spaces do not require dimension matching
      expect(evaluateConfigCompatibility("Plot", "Plot 2400 sqft").score).toBe(1.0);
      expect(evaluateConfigCompatibility("Commercial Office", "3500 sft bare shell").score).toBe(1.0);
    });

    it("evaluates budget compatibility", () => {
      // Within budget
      const within = evaluateBudgetCompatibility("₹50K/month", "45k");
      expect(within.score).toBe(1.0);

      // Negotiable margin within 10% (40k budget vs 44k asking)
      const nego = evaluateBudgetCompatibility("40K", "44K");
      expect(nego.score).toBe(0.85);

      // Large divergence
      const mismatch = evaluateBudgetCompatibility("20K", "80K");
      expect(mismatch.score).toBeLessThanOrEqual(0.5);
    });
  });

  describe("Script-Based Matchmaker (matchPropertiesByRules)", () => {
    const testLeads: ExtractedAILead[] = [
      // Demand 1: Tenant in Cooke Town
      {
        id: "lead-cooke-tenant",
        sourceMessageId: "msg-1",
        senderName: "Kartik Skelo",
        senderPhone: "+91 98450 11990",
        contactPerson: "Kartik Skelo",
        contactPhone: "+91 98450 11990",
        intent: "rent_seek",
        intentLabel: "Looking to Rent",
        side: "demand",
        propertyType: "Apartment",
        configuration: "2 BHK",
        location: "Cooke Town",
        budgetOrPrice: "40K",
        extractedSummary: "Looking for 2BHK in Cooke Town, budget 40K",
        rawTextSnippet: "Location : Cooke Town close to SBI Bank, 2 BHK, Semi Furnished. Budget 40K",
      },
      // Supply 1: Landlord on Wheeler Road
      {
        id: "lead-wheeler-flat",
        sourceMessageId: "msg-2",
        senderName: "Wheeler Landlord",
        senderPhone: "+91 99887 76655",
        contactPerson: "Wheeler Landlord",
        contactPhone: "+91 99887 76655",
        intent: "rent_out",
        intentLabel: "Rental Available",
        side: "supply",
        propertyType: "Apartment",
        configuration: "3 BHK",
        location: "Wheeler Road",
        budgetOrPrice: "42k (nego)",
        extractedSummary: "Wheeler Road 3 BHK 1700 sft for rent at 42k negotiable",
        rawTextSnippet: "Wheeler Road - 3 Bhk, 1700 sft, West Facing at 42k (nego).",
      },
      // Demand 2: Buyer in Whitefield
      {
        id: "lead-whitefield-buyer",
        sourceMessageId: "msg-3",
        senderName: "Kartik Skelo",
        senderPhone: "+91 98450 11990",
        contactPerson: "Kartik Skelo",
        contactPhone: "+91 98450 11990",
        intent: "buy",
        intentLabel: "Looking to Buy",
        side: "demand",
        propertyType: "Apartment",
        configuration: "3 BHK",
        location: "Whitefield",
        budgetOrPrice: "₹2.25 Cr",
        extractedSummary: "Buyer for 3BHK in Whitefield up to 2.25 Cr",
        rawTextSnippet: "Looking for 3BHK high-rise apartment in Whitefield. Budget up to ₹2.25 Cr.",
      },
      // Supply 2: Seller in Whitefield
      {
        id: "lead-whitefield-resale",
        sourceMessageId: "msg-4",
        senderName: "Direct Seller",
        senderPhone: "+91 98112 00000",
        contactPerson: "Direct Seller",
        contactPhone: "+91 98112 00000",
        intent: "sell",
        intentLabel: "Property for Sale",
        side: "supply",
        propertyType: "Apartment",
        configuration: "3 BHK",
        location: "Whitefield",
        budgetOrPrice: "₹2.10 Cr",
        extractedSummary: "3 BHK apartment in Whitefield for sale at 2.10 Cr",
        rawTextSnippet: "3BHK apartment for sale in Whitefield Prestige Shantiniketan. Demanding 2.10 Cr.",
      },
      // Supply 3: Commercial Office on Indiranagar 100ft road
      {
        id: "lead-indiranagar-comm",
        sourceMessageId: "msg-5",
        senderName: "Office Broker",
        senderPhone: "+91 97110 55443",
        intent: "lease_out",
        intentLabel: "Commercial Lease",
        side: "supply",
        propertyType: "Commercial Office",
        configuration: "2400 sqft Office",
        location: "Indiranagar",
        budgetOrPrice: "₹1.80 Lakhs/month + GST",
        extractedSummary: "2400 sqft office on 100ft road Indiranagar",
        rawTextSnippet: "Commercial Office Space available for lease on Indiranagar 100ft Road.",
      },
    ];

    it("matches property leads using purely deterministic script without LLM", () => {
      const matches = matchPropertiesByRules(testLeads);
      expect(matches.length).toBeGreaterThanOrEqual(2);

      // Verify Cooke Town - Wheeler Road match
      const cookeMatch = matches.find(
        (m) => m.demandLeadId === "lead-cooke-tenant" && m.supplyLeadId === "lead-wheeler-flat",
      );
      expect(cookeMatch).toBeDefined();
      expect(cookeMatch?.demandBudget).toBe("40K");
      expect(cookeMatch?.supplyPrice).toBe("42k (nego)");
      expect(cookeMatch?.matchScore).toBeGreaterThanOrEqual(0.75);
      expect(cookeMatch?.matchReason).toContain("Wheeler Road");
      expect(cookeMatch?.suggestedPitch).toContain("Wheeler Road");

      // Verify Whitefield Buyer - Seller match
      const whitefieldMatch = matches.find(
        (m) => m.demandLeadId === "lead-whitefield-buyer" && m.supplyLeadId === "lead-whitefield-resale",
      );
      expect(whitefieldMatch).toBeDefined();
      expect(whitefieldMatch?.demandBudget).toBe("₹2.25 Cr");
      expect(whitefieldMatch?.supplyPrice).toBe("₹2.10 Cr");
      expect(whitefieldMatch?.matchScore).toBeGreaterThanOrEqual(0.85);
      expect(whitefieldMatch?.matchReason).toContain("Whitefield");
      expect(whitefieldMatch?.suggestedPitch).toContain("2.10 Cr");

      // Verify Commercial is NOT matched with residential
      const invalidMatch = matches.find(
        (m) => m.supplyLeadId === "lead-indiranagar-comm" && m.demandLeadId === "lead-cooke-tenant",
      );
      expect(invalidMatch).toBeUndefined();
    });

    it("blocks matching when demand and supply are from the same person or message", () => {
      const sameSenderLeads: ExtractedAILead[] = [
        {
          id: "kartik-demand",
          sourceMessageId: "msg-kartik-1",
          senderName: "Kartik",
          senderPhone: "+91 95912 92090",
          intent: "buy",
          intentLabel: "Looking to Buy",
          side: "demand",
          propertyType: "Plot",
          configuration: "3000 sqft",
          location: "Bangalore",
          budgetOrPrice: "Rs. 15cr",
          extractedSummary: "Looking for 3000 sqft plot in Bangalore",
          rawTextSnippet: "Urgently require 3000 sqft plot in Bangalore. Budget 15cr",
        },
        {
          id: "kartik-supply",
          sourceMessageId: "msg-kartik-1",
          senderName: "Kartik",
          senderPhone: "+91 95912 92090",
          intent: "sell",
          intentLabel: "Property for Sale",
          side: "supply",
          propertyType: "Plot",
          configuration: "3000 sqft",
          location: "Bangalore",
          budgetOrPrice: "Rs 10cr",
          extractedSummary: "3000 sqft plot available for sale in Bangalore",
          rawTextSnippet: "Plot available for sale in Bangalore at 10cr",
        },
      ];

      const matches = matchPropertiesByRules(sameSenderLeads);
      expect(matches.length).toBe(0);
    });
  });
});
