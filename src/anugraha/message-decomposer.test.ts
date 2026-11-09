import { describe, it, expect, vi } from "vitest";
import {
  matchBangaloreLocality,
  getBangalorePromptGuidelines,
  BANGALORE_LOCALITIES,
} from "./bangalore-locations";
import {
  fallbackDecomposeBangaloreMessage,
  buildBangaloreDecompositionSystemPrompt,
  decomposeAndCategorizeMessageWithLLM,
} from "./openai-lead-matcher";

describe("Bangalore Real Estate Locality Resolver", () => {
  it("resolves major Bangalore localities and colloquial aliases", () => {
    expect(matchBangaloreLocality("Looking for flat near Whitefield")).toBe("Whitefield");
    expect(matchBangaloreLocality("Location : Cooke Town close to SBI Bank, 2 BHK")).toBe("Cooke Town");
    expect(matchBangaloreLocality("Indira Nagar - 3 options - Off 100 ft road")).toBe("Indiranagar");
    expect(matchBangaloreLocality("Sai Baba temple road Arekere")).toBe("Arekere");
    expect(matchBangaloreLocality("Raheja Viverea, Koramangala")).toBe("Koramangala");
    expect(matchBangaloreLocality("Prestige Autumn Leaves plotted development")).toBe("Bannerghatta Road");
    expect(matchBangaloreLocality("Fraser Town, off Promenade Road")).toBe("Fraser Town");
    expect(matchBangaloreLocality("Wheeler Road - 3 Bhk, 1700 sft")).toBe("Wheeler Road");
    expect(matchBangaloreLocality("HBR GF house 3 Bhk duplex")).toBe("HBR Layout");
    expect(matchBangaloreLocality("MSR North City Layout - 3 bhk Villa")).toBe("MSR North City");
    expect(matchBangaloreLocality("HSR 3500 sft fully furnished office space")).toBe("HSR Layout");
    expect(matchBangaloreLocality("Commercial Showroom on MG Road / Brigade Road junction")).toBe("MG Road");
    expect(matchBangaloreLocality("Luxury 4BHK Villa in Palm Meadows, Whitefield")).toBe("Whitefield");
  });

  it("returns null for non-Bangalore text or blank text", () => {
    expect(matchBangaloreLocality("")).toBeNull();
    expect(matchBangaloreLocality("Random non real estate text")).toBeNull();
  });

  it("provides comprehensive prompt guidelines for Bangalore LLM instructions", () => {
    const guidelines = getBangalorePromptGuidelines();
    expect(guidelines).toContain("BANGALORE LOCALITY DIRECTORY");
    expect(guidelines).toContain("Whitefield");
    expect(guidelines).toContain("Indiranagar");
    expect(guidelines).toContain("Koramangala");
    expect(guidelines).toContain("Arekere");
    expect(guidelines).toContain("Cooke Town");
  });
});

describe("Bangalore Multi-Listing Decomposition & Categorization", () => {
  const sampleMultiListing = `Residential rental availability
1. Wheeler Road  - 3 Bhk, 1700 sft, West Facing at 60k (nego).
2. HBR GF house 3 Bhk duplex Negotiable rent 50K*
3. MSR North City Layout - 3 bhk Villa from August 15th at 75K
4. Fraser Town 3 bhk with servant's room, swimming pool etc at 1.50 Lakhs

Residential Rental Requirement
1. Location : Cooke Town close to SBI Bank, 2 BHK, Semi Furnished. Budget 40K

Commercial Rental Availability
1. Location : Fraser Town, off Promenade Road, Ground floor, bare shell, 1500 sft at 1 Lakh + GST
2. Indira Nagar - 3 options - A. Off 100 ft road, B. Off CMH Road & C. On Krishna Temple road
3. HSR 3500 sft fully furnished office space at 4 Lakhs
4. Cooke Town off Wheeler Road ext 1300 sft furnished at 1 Lakh`;

  it("decomposes a bundled multi-listing message into separate categorized items with fallback engine", () => {
    const decomposed = fallbackDecomposeBangaloreMessage(sampleMultiListing);
    expect(decomposed.length).toBeGreaterThanOrEqual(9);

    // Verify first item: Wheeler Road
    const wheeler = decomposed.find((d) => d.location === "Wheeler Road");
    expect(wheeler).toBeDefined();
    expect(wheeler?.intent).toBe("RENT");
    expect(wheeler?.price).toContain("60k");

    // Verify Cooke Town requirement
    const cooke = decomposed.find((d) => d.location === "Cooke Town" && d.text.includes("close to SBI Bank"));
    expect(cooke).toBeDefined();
    expect(cooke?.price).toContain("40K");

    // Verify Fraser Town commercial
    const fraserComm = decomposed.find(
      (d) => d.location === "Fraser Town" && (d.text.includes("bare shell") || d.text.includes("1500")),
    );
    expect(fraserComm).toBeDefined();
    expect(fraserComm?.intent).toBe("LEASE");
    expect(fraserComm?.price).toContain("1 Lakh");

    // Verify HSR commercial
    const hsr = decomposed.find((d) => d.location === "HSR Layout");
    expect(hsr).toBeDefined();
    expect(hsr?.intent).toBe("LEASE");
    expect(hsr?.price).toContain("4 Lakhs");
  });

  it("builds a system prompt specifying Bangalore constraints and output schema", () => {
    const prompt = buildBangaloreDecompositionSystemPrompt();
    expect(prompt).toContain("Bangalore");
    expect(prompt).toContain("intent");
    expect(prompt).toContain("config");
    expect(prompt).toContain("price");
    expect(prompt).toContain("location");
    expect(prompt).toContain("near Whitefield");
    expect(prompt).toContain("Raheja Viverea Koramangala");
    expect(prompt).toContain("Sai Baba temple road Arekere");
  });

  it("uses OpenAI when OPENAI_KEY is set or falls back gracefully", async () => {
    const singleMsg = `URGENT BUYER REQUIREMENT - PURCHASE:
Looking for 3BHK high-rise apartment in Whitefield.
Budget up to ₹2.25 Cr. Immediate registration.`;

    const result = await decomposeAndCategorizeMessageWithLLM(singleMsg);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].intent).toBe("BUY");
    expect(result[0].location).toBe("Whitefield");
    expect(result[0].price).toContain("2.25 Cr");
  });
});

