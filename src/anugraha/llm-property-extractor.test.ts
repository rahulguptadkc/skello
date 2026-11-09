import { describe, expect, it } from "vitest";
import {
  isPotentialPropertyMessage,
  ruleBasedPropertyExtract,
  formatListingConfigDisplay,
  formatListingPriceDisplay,
  extractProjectName,
  BROKER_EXTRACTOR_SYSTEM_PROMPT,
} from "./llm-property-extractor";

describe("llm-property-extractor", () => {
  describe("isPotentialPropertyMessage filter", () => {
    it("identifies property messages with bhk, available, rupee, sell, rent, land", () => {
      expect(isPotentialPropertyMessage("3 BHK in Koramangala available for rent at 60k")).toBe(true);
      expect(isPotentialPropertyMessage("Available Premium Plot for Sale !! 2400 Sqft")).toBe(true);
      expect(isPotentialPropertyMessage("Residential rental availability")).toBe(true);
      expect(isPotentialPropertyMessage("REQUIRED FOR PURCHASE AGRICULTURE LAND BETWEEN 2 to 2.5 acres")).toBe(true);
      expect(isPotentialPropertyMessage("Salarpuria bird view 1/2/3 bhk 1 cr onwards Near Koramangala")).toBe(true);
      expect(isPotentialPropertyMessage("Commercial land for Sale 💐 Best Sites")).toBe(true);
      expect(isPotentialPropertyMessage("Urgently Require 1.5 - 2 Acres Land for Purchase in Sadarahalli")).toBe(true);
      expect(isPotentialPropertyMessage("Price: ₹40,000/month")).toBe(true);
      expect(isPotentialPropertyMessage("Need 4BHK apartment 5000+sqft")).toBe(true);
    });

    it("rejects non-property chatter so they do not clutter the listings table", () => {
      expect(isPotentialPropertyMessage("okay okay")).toBe(false);
      expect(isPotentialPropertyMessage("Time?")).toBe(false);
      expect(isPotentialPropertyMessage("Let’s get on a call tonight")).toBe(false);
      expect(isPotentialPropertyMessage("Hey, abhi connect kar sakte hai?")).toBe(false);
      expect(isPotentialPropertyMessage("Done")).toBe(false);
      expect(isPotentialPropertyMessage("Let me confirm you.")).toBe(false);
      expect(isPotentialPropertyMessage("Morning kitne bje connect kare?")).toBe(false);
      expect(isPotentialPropertyMessage("Thankssss")).toBe(false);
      expect(isPotentialPropertyMessage("Should I go with this?")).toBe(false);
      expect(isPotentialPropertyMessage("Works")).toBe(false);
      expect(isPotentialPropertyMessage("Chalegaa")).toBe(false);
      expect(isPotentialPropertyMessage("Yessss")).toBe(false);
      expect(isPotentialPropertyMessage("At 12 ?")).toBe(false);
      expect(isPotentialPropertyMessage("Ye ig abhi aap script se matching karva rahe ho ri")).toBe(false);
      expect(isPotentialPropertyMessage("But this is before we do llm call or after ?")).toBe(false);
    });
  });

  describe("ruleBasedPropertyExtract & formatters", () => {
    it("decomposes bundled listings into separate records with codes", () => {
      const sample = `Residential rental availability
1. Wheeler Road  - 3 Bhk, 1700 sft, West Facing at 60k (nego).
2. HBR GF house 3 Bhk duplex Negotiable rent 50K*
3. MSR North City Layout - 3 bhk Villa from August 15th at 75K`;

      const result = ruleBasedPropertyExtract({
        id: "test-msg-1",
        senderName: "Kartik",
        senderPhone: "+91 70428 46062",
        text: sample,
      });

      expect(result.message_type).toBe("listings");
      expect(result.listings.length).toBe(3);

      const l1 = result.listings[0];
      expect(l1.code).toBe("ARA");
      expect(l1.intent).toBe("AR");
      expect(l1.property_type).toBe("A");
      expect(formatListingConfigDisplay(l1)).toContain("3 BHK");
      expect(formatListingConfigDisplay(l1)).toContain("1700 sqft");
      expect(formatListingPriceDisplay(l1)).toBe("₹60,000/month");
      expect(l1.localities).toContain("Wheeler Road");

      const l3 = result.listings[2];
      expect(l3.property_type).toBe("V");
      expect(formatListingPriceDisplay(l3)).toBe("₹75,000/month");
    });

    it("parses single property listing with plot / land", () => {
      const sample = "Available Premium Plot for Sale !! 2400 Sqft. Price: 11,500 per Sft";
      const result = ruleBasedPropertyExtract({
        id: "test-plot",
        senderName: "Shamran",
        senderPhone: "+91 96861 15795",
        text: sample,
      });

      expect(result.message_type).toBe("listings");
      expect(result.listings.length).toBe(1);
      const l = result.listings[0];
      expect(l.code).toBe("ASL");
      expect(l.intent).toBe("AS");
      expect(l.property_type).toBe("L");
      expect(formatListingConfigDisplay(l)).toContain("PLOT / LAND");
      expect(formatListingPriceDisplay(l)).toBe("₹11,500/sqft");
    });

    it("extracts agricultural land purchase requirement (Mohini message)", () => {
      const text = `REQUIRED FOR PURCHASE AGRICULTURE LAND BETWEEN 
2 to 2.5 acres only 
In and around Budigere 
Bagalur / Razzack Palya and surrounding areas. 
Budget Rs. 7.5 cr per acre 
Call 9880230700 with options and details`;

      const result = ruleBasedPropertyExtract({
        id: "msg-mohini",
        senderName: "Mohini",
        senderPhone: "+188609311318233",
        text,
      });

      expect(result.message_type).toBe("listings");
      expect(result.listings.length).toBe(1);
      const l = result.listings[0];
      expect(l.code).toBe("WBL");
      expect(l.intent).toBe("WB");
      expect(l.property_type).toBe("L");
      expect(formatListingConfigDisplay(l)).toContain("PLOT / LAND");
      expect(formatListingPriceDisplay(l)).toBe("₹7.50 Cr/acre");
      expect(l.contact_numbers).toContain("9880230700");
    });

    it("extracts multi-item numbered listings with bracket notation (Kartik message)", () => {
      const text = `1) Urgently Require 1.5 - 2 Acres Land for Purchase in Sadarahalli, Chikkajala surroundings.....immediate finalization

2) Urgently Require 1 Acre Land for Purchase in Bagalur, Mittaganahalli, Airport surrounding for Apartments .....immediate finalization Budget Rs.15cr

3) STRR 70 Acres Land available for Sale at Rs.10cr per Acre

6) JD proposal ( Only for apartment)
 *Devanahalli Airport back side.* 
 *3.5acre* 

7) Cooke Town D costa Layout 3025sft Plot with 5BHK House available for Sale at Rs 9.10cr

Call : 9591292090 / 9845007923`;

      const result = ruleBasedPropertyExtract({
        id: "msg-kartik-multi",
        senderName: "Kartik",
        senderPhone: "+91 98450 11990",
        text,
      });

      expect(result.message_type).toBe("listings");
      expect(result.listings.length).toBe(5);

      // 1) Land purchase
      expect(result.listings[0].code).toBe("WBL");
      expect(result.listings[0].intent).toBe("WB");
      expect(result.listings[0].contact_numbers).toContain("9591292090");

      // 3) STRR land for sale per acre
      expect(result.listings[2].code).toBe("ASL");
      expect(result.listings[2].intent).toBe("AS");
      expect(formatListingPriceDisplay(result.listings[2])).toBe("₹10.00 Cr/acre");

      // 6) JD proposal
      expect(result.listings[3].code).toBe("ASL");
      expect(result.listings[3].deal_type).toBe("JD");

      // 7) Plot with House
      expect(result.listings[4].code).toBe("ASH");
      expect(result.listings[4].property_type).toBe("H");
      expect(formatListingPriceDisplay(result.listings[4])).toBe("₹9.10 Cr");
    });

    it("splits OR alternative listings and shares option_group", () => {
      const text = `*URGENT REQUIREMENT - PURCHASE*

*4BHK Spacious Apartment* 5000+Sqft.
*Project : Raheja Viverea, Koramangala*

*OR*

*INDEPENDENT HOUSE* with Land Area 6000 to 10000Sqft.
*Prime property* 

Koramangala, HSR Layout`;

      const result = ruleBasedPropertyExtract({
        id: "msg-or-test",
        senderName: "Kartik",
        senderPhone: "+91 98450 11990",
        text,
      });

      expect(result.message_type).toBe("listings");
      expect(result.listings.length).toBe(2);

      const alt1 = result.listings[0];
      const alt2 = result.listings[1];

      expect(alt1.code).toBe("WBA");
      expect(alt1.option_group).toBe("msg-or-test-g1");
      expect(alt1.project_name).toBe("Raheja Viverea");
      expect(formatListingConfigDisplay(alt1)).toContain("4 BHK");
      expect(formatListingPriceDisplay(alt1)).toBe("—"); // Never 5000+ sqft as price!

      expect(alt2.code).toBe("WBH");
      expect(alt2.option_group).toBe("msg-or-test-g1");
      expect(alt2.project_name).toBe("Raheja Viverea");
      expect(formatListingConfigDisplay(alt2)).toContain("HOUSE");
    });
  });

  describe("extractProjectName helper", () => {
    it("extracts project name from explicit Project: / Building: label", () => {
      expect(
        extractProjectName("URGENT REQUIREMENT: 4BHK Apartment\nProject : Raheja Viverea, Koramangala"),
      ).toBe("Raheja Viverea");
      expect(
        extractProjectName("Commercial office space on long term lease in Cyber City building 9."),
      ).toBe("Cyber City building 9");
    });

    it("extracts project name from builder brands & known layouts", () => {
      expect(
        extractProjectName("Prestige Autumn Leaves \n\nFabulous plotted development by prestige group !!"),
      ).toBe("Prestige Autumn Leaves");
      expect(
        extractProjectName("Available for sale: 4BHK Luxury Apartment in DLF Phase 2, 3400 sq ft"),
      ).toBe("DLF Phase 2");
      expect(
        extractProjectName("Direct Buyer: Looking to buy a 3BHK ready to move flat in DLF Phase 5"),
      ).toBe("DLF Phase 5");
      expect(
        extractProjectName("Luxury 4BHK Villa For Sale in Palm Meadows, Whitefield."),
      ).toBe("Palm Meadows");
      expect(
        extractProjectName("3 bhk Villa in MSR North City Layout from August 15th at 75K"),
      ).toBe("MSR North City Layout");
      expect(
        extractProjectName("Looking for 3BHK in Prestige Shantiniketan, Whitefield"),
      ).toBe("Prestige Shantiniketan");
    });

    it("returns undefined when no project or society is specified", () => {
      expect(
        extractProjectName("3 BHK in Koramangala available for rent at 60k"),
      ).toBeUndefined();
      expect(
        extractProjectName("1 Acre Land for sale in Bagalur, Airport surrounding"),
      ).toBeUndefined();
    });
  });

  describe("System prompt content", () => {
    it("contains required steps and guidance", () => {
      expect(BROKER_EXTRACTOR_SYSTEM_PROMPT).toContain("# ROLE");
      expect(BROKER_EXTRACTOR_SYSTEM_PROMPT).toContain("Bangalore property broker");
      expect(BROKER_EXTRACTOR_SYSTEM_PROMPT).toContain("STEP 3: INTENT");
      expect(BROKER_EXTRACTOR_SYSTEM_PROMPT).toContain("STEP 4: PROPERTY TYPE");
      expect(BROKER_EXTRACTOR_SYSTEM_PROMPT).toContain("STEP 5: DEAL TYPE");
      expect(BROKER_EXTRACTOR_SYSTEM_PROMPT).toContain("STEP 6: NUMBERS");
      expect(BROKER_EXTRACTOR_SYSTEM_PROMPT).toContain("STEP 7: LOCATION");
      expect(BROKER_EXTRACTOR_SYSTEM_PROMPT).toContain("project_name");
    });
  });
});

