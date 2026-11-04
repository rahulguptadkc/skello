import { describe, expect, it } from "vitest";
import {
  classifyPropertyMessage,
  isRupeeCurrency,
  sanitizeRupeeAmount,
} from "./intent-classifier";

describe("isRupeeCurrency", () => {
  it("rejects square footage / dimensions as rupees", () => {
    expect(isRupeeCurrency("5000+ sqft")).toBe(false);
    expect(isRupeeCurrency("2400 sqft")).toBe(false);
    expect(isRupeeCurrency("1500 sft")).toBe(false);
    expect(isRupeeCurrency("3400 sq ft")).toBe(false);
    expect(isRupeeCurrency("6000-10000 sqft")).toBe(false);
    expect(isRupeeCurrency("30x40")).toBe(false);
    expect(isRupeeCurrency("5000+")).toBe(false);
  });

  it("accepts valid rupee formats", () => {
    expect(isRupeeCurrency("₹10000")).toBe(true);
    expect(isRupeeCurrency("₹20,000")).toBe(true);
    expect(isRupeeCurrency("20,000")).toBe(true);
    expect(isRupeeCurrency("20K")).toBe(true);
    expect(isRupeeCurrency("40k")).toBe(true);
    expect(isRupeeCurrency("₹40K/month")).toBe(true);
    expect(isRupeeCurrency("1.50 Lakhs")).toBe(true);
    expect(isRupeeCurrency("₹2.25 Cr")).toBe(true);
    expect(isRupeeCurrency("11,500 per Sft")).toBe(true);
  });
});

describe("classifyPropertyMessage", () => {
  it("does not classify area/sqft as budget or price", () => {
    const res = classifyPropertyMessage(
      "URGENT REQUIREMENT - PURCHASE\n4BHK Spacious Apartment 5000+Sqft.\nProject : Raheja Viverea, Koramangala",
    );
    expect(res.intent).toBe("buy");
    expect(res.budgetOrPrice).toBeUndefined();
    expect(res.configuration).toBe("4BHK");
  });

  it("extracts valid rupee formats like ₹10000, 20,000, 20K", () => {
    const r1 = classifyPropertyMessage("Need 1BHK in Indiranagar, rent ₹10000");
    expect(r1.budgetOrPrice).toBe("₹10000");

    const r2 = classifyPropertyMessage("Available 2BHK in Cooke Town for rent 20,000");
    expect(r2.budgetOrPrice).toBe("20,000");

    const r3 = classifyPropertyMessage("Client looking for 2BHK, budget 20K");
    expect(r3.budgetOrPrice).toBe("20K");
  });
  it("classifies buy requirements correctly", () => {
    const res = classifyPropertyMessage(
      "Looking to buy 3BHK in Sector 54 Gurgaon, budget around 3.5 Cr. Direct buyers only.",
    );
    expect(res.intent).toBe("buy");
    expect(res.configuration).toBe("3BHK");
    expect(res.location?.toLowerCase()).toContain("sector 54");
    expect(res.budgetOrPrice?.toLowerCase()).toContain("3.5 cr");
  });

  it("classifies rental requirements / offerings correctly", () => {
    const res = classifyPropertyMessage(
      "Available for rent: 2BHK fully furnished apartment in DLF Phase 2. Rent 45k/month.",
    );
    expect(res.intent).toBe("rent");
    expect(res.configuration).toBe("2BHK");
    expect(res.location?.toLowerCase()).toContain("dlf phase 2");
    expect(res.budgetOrPrice?.toLowerCase()).toContain("45k");

    const rentalReq = classifyPropertyMessage(
      "Urgent requirement: Need 3BHK on rent in Sector 54, budget 75k - 85k/month.",
    );
    expect(rentalReq.intent).toBe("rent");
    expect(rentalReq.configuration).toBe("3BHK");
  });

  it("classifies sell offerings correctly", () => {
    const res = classifyPropertyMessage(
      "Direct resale: 4BHK Penthouse on Golf Course Road. Urgent sale, asking 6.2 Cr.",
    );
    expect(res.intent).toBe("sell");
    expect(res.configuration).toBe("4BHK");
    expect(res.location?.toLowerCase()).toContain("golf course road");
  });

  it("classifies commercial lease offerings correctly", () => {
    const res = classifyPropertyMessage(
      "Commercial office space available on long term lease in Cyber City. 8,000 sq ft warm shell.",
    );
    expect(res.intent).toBe("lease");
    expect(res.location?.toLowerCase()).toContain("cyber city");
  });

  it("falls back to general for unclassifiable messages", () => {
    const res = classifyPropertyMessage("Good morning everyone! Please check the document.");
    expect(res.intent).toBe("general");
  });
});

