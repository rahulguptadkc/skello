/**
 * Deterministic Rule-Based Property Matchmaking Script for Bangalore Real Estate.
 * Matches Demand leads (Buyers, Rent Seekers, Commercial Lease Seekers)
 * with Supply leads (Sellers, Landlords, Commercial Space Owners)
 * strictly using algorithmic scoring based on:
 * 1. Intent (Demand vs. Supply compatibility)
 * 2. Budget / Price (Normalized numerical feasibility & tolerance)
 * 3. Location (Bangalore Canonical Locality & Proximity)
 * 4. CONFIG (BHK configurations & plot/office dimensions)
 * 5. Type of Residence / Property Type (Apartment, Villa, Plot, Commercial Office, Retail)
 */

import {
  BANGALORE_LOCALITIES,
  matchBangaloreLocality,
} from "./bangalore-locations";
import {
  isRupeeCurrency,
  sanitizeRupeeAmount,
} from "./intent-classifier";
import type {
  ExtractedAILead,
  AILeadMatch,
  LeadIntent,
  MarketSide,
} from "./openai-lead-matcher";

export type PropertyCategory =
  | "apartment"
  | "villa_house"
  | "plot"
  | "commercial_office"
  | "retail_showroom"
  | "warehouse"
  | "general";

export const BANGALORE_NEIGHBORING_AREAS: Record<string, string[]> = {
  "Cooke Town": ["Wheeler Road", "Fraser Town", "Cox Town", "Benson Town", "Richards Town"],
  "Wheeler Road": ["Cooke Town", "Fraser Town", "Cox Town", "Benson Town"],
  "Fraser Town": ["Cooke Town", "Wheeler Road", "Cox Town", "Benson Town", "Pulikeshi Nagar", "Coles Park"],
  "Koramangala": ["HSR Layout", "BTM Layout", "Jayanagar", "Domlur", "Ejipura"],
  "HSR Layout": ["Koramangala", "BTM Layout", "Bellandur", "Sarjapur Road"],
  "BTM Layout": ["Koramangala", "HSR Layout", "Jayanagar", "JP Nagar", "Bannerghatta Road"],
  "Jayanagar": ["JP Nagar", "BTM Layout", "Banashankari", "Basavanagudi", "Koramangala"],
  "JP Nagar": ["Jayanagar", "BTM Layout", "Arekere", "Bannerghatta Road"],
  "Arekere": ["Bannerghatta Road", "Hulimavu", "JP Nagar", "BTM Layout", "Begur"],
  "Bannerghatta Road": ["Arekere", "Hulimavu", "JP Nagar", "BTM Layout", "Gottigere"],
  "Whitefield": ["Brookefield", "Marathahalli", "Hoodi", "Varthur", "Kadugodi"],
  "Brookefield": ["Whitefield", "Marathahalli", "Hoodi", "Kundalahalli"],
  "Marathahalli": ["Whitefield", "Bellandur", "Brookefield", "KR Puram"],
  "Bellandur": ["Marathahalli", "HSR Layout", "Sarjapur Road"],
  "Sarjapur Road": ["Bellandur", "HSR Layout", "Carmelaram", "Kaikondrahalli"],
  "Indiranagar": ["Domlur", "Ulsoor", "CV Raman Nagar", "MG Road"],
  "MG Road": ["Indiranagar", "Richmond Town", "Vasanth Nagar", "Ulsoor"],
  "Hebbal": ["Manyata Tech Park", "Thanisandra", "HBR Layout", "RT Nagar", "Yelahanka"],
  "HBR Layout": ["Hennur", "Kalyan Nagar", "Manyata Tech Park", "Hebbal", "Cooke Town", "Wheeler Road"],
  "MSR North City": ["Hennur", "Thanisandra", "Yelahanka", "HBR Layout"],
  "Manyata Tech Park": ["Hebbal", "Thanisandra", "Nagavara", "HBR Layout"],
};

export interface ParsedPriceInfo {
  type: "monthly_rent" | "total_sale" | "per_sqft" | "unspecified";
  amountInr: number;
  raw: string;
}

/**
 * Parses informal Indian price strings into standardized INR numerical values.
 * Handles "40K", "60k (nego)", "1.50 Lakhs", "₹2.25 Cr", "11,500 per sft", etc.
 */
export function parsePriceToInr(priceStr?: string): ParsedPriceInfo {
  if (!priceStr || !priceStr.trim() || priceStr === "—" || priceStr.toLowerCase().includes("request")) {
    return { type: "unspecified", amountInr: 0, raw: priceStr || "—" };
  }

  const raw = priceStr.trim();
  const lower = raw.toLowerCase();

  // Reject area / dimensions (sqft, sft, sq ft, etc.) unless it's a rate per sqft
  if (
    /\b(sqft|sft|sq\.?\s*ft|square\s*feet|sqm|acres?|guntas?)\b/i.test(lower) &&
    !lower.includes("per") &&
    !lower.includes("/")
  ) {
    return { type: "unspecified", amountInr: 0, raw: priceStr || "—" };
  }

  // 1. Per sqft / sft
  if (lower.includes("per sft") || lower.includes("per sqft") || lower.includes("/sqft") || lower.includes("/sft")) {
    const numMatch = lower.replace(/,/g, "").match(/\d+(\.\d+)?/);
    const amount = numMatch ? parseFloat(numMatch[0]) : 0;
    return { type: "per_sqft", amountInr: amount, raw };
  }

  // 2. Crore amounts (e.g. ₹2.25 Cr, 4.85 Crore, 1.15 Cr)
  if (lower.includes("cr") || lower.includes("crore")) {
    const numMatch = lower.replace(/,/g, "").match(/\d+(\.\d+)?/);
    const amount = numMatch ? parseFloat(numMatch[0]) * 10000000 : 0;
    return { type: "total_sale", amountInr: amount, raw };
  }

  // 3. Lakh amounts (e.g. 1.50 Lakhs, 85L, 75 lacs, 1.15-lakhs)
  if (lower.includes("lakh") || lower.includes("lac") || /\b\d+(\.\d+)?\s*l\b/i.test(lower)) {
    const numMatch = lower.replace(/,/g, "").match(/\d+(\.\d+)?/);
    const amount = numMatch ? parseFloat(numMatch[0]) * 100000 : 0;
    // If it's a rental message or under 5 Lakhs with "month" or "rent", it's monthly rent
    const isMonthly = lower.includes("month") || lower.includes("pm") || lower.includes("rent") || amount <= 500000;
    return {
      type: isMonthly ? "monthly_rent" : "total_sale",
      amountInr: amount,
      raw,
    };
  }

  // 4. Thousand amounts (e.g. 40k, 60k, 75K, 42k/month, 45,000)
  if (lower.includes("k") || lower.includes("thousand") || lower.includes("/month") || lower.includes("pm")) {
    let amount = 0;
    const kMatch = lower.match(/(\d+(\.\d+)?)\s*k/i);
    if (kMatch) {
      amount = parseFloat(kMatch[1]) * 1000;
    } else {
      const numMatch = lower.replace(/,/g, "").match(/\d+(\.\d+)?/);
      amount = numMatch ? parseFloat(numMatch[0]) : 0;
    }
    return { type: "monthly_rent", amountInr: amount, raw };
  }

  // 5. Raw formatted integer like "11,500" or "45000"
  const cleanDigits = lower.replace(/,/g, "").match(/\d+/);
  if (cleanDigits) {
    const num = parseInt(cleanDigits[0], 10);
    return {
      type: num > 1000000 ? "total_sale" : "monthly_rent",
      amountInr: num,
      raw,
    };
  }

  return { type: "unspecified", amountInr: 0, raw };
}

/**
 * Classifies property into one of the canonical real estate categories.
 */
export function categorizeProperty(propertyType?: string, config?: string, text?: string): PropertyCategory {
  const combined = `${propertyType || ""} ${config || ""} ${text || ""}`.toLowerCase();

  if (/\b(plot|site|land|plotted)\b/i.test(combined)) {
    return "plot";
  }
  if (/\b(villa|independent\s+house|row\s+house|bungalow|duplex\s+house)\b/i.test(combined)) {
    return "villa_house";
  }
  if (/\b(office|commercial\s+space|bare\s+shell|warm\s+shell|workstation)\b/i.test(combined)) {
    return "commercial_office";
  }
  if (/\b(showroom|retail|shop)\b/i.test(combined)) {
    return "retail_showroom";
  }
  if (/\b(warehouse|godown|industrial\s+shed)\b/i.test(combined)) {
    return "warehouse";
  }
  if (/\b(bhk|apartment|flat|penthouse|studio|residential)\b/i.test(combined)) {
    return "apartment";
  }

  return "general";
}

/**
 * Checks intent compatibility between Demand and Supply.
 */
export function isIntentCompatible(
  demandIntent: LeadIntent | string,
  supplyIntent: LeadIntent | string,
): boolean {
  const d = demandIntent.toLowerCase();
  const s = supplyIntent.toLowerCase();

  if (d === "buy" && s === "sell") return true;
  if ((d === "rent_seek" || d === "rent") && (s === "rent_out" || s === "rent")) return true;
  if ((d === "lease_seek" || d === "lease") && (s === "lease_out" || s === "lease")) return true;
  return false;
}

/**
 * Evaluates Property Type / Residence Type compatibility.
 */
export function evaluateTypeCompatibility(demandType: PropertyCategory, supplyType: PropertyCategory, demandLead: ExtractedAILead): {
  score: number;
  reason: string;
} {
  // Exact category match
  if (demandType === supplyType && demandType !== "general") {
    return { score: 1.0, reason: `Exact property type match: ${demandType.replace("_", " ").toUpperCase()}` };
  }

  // Cross-residence allowance (e.g. buyer open to Apartment OR Independent House)
  const demandText = `${demandLead.configuration || ""} ${demandLead.propertyType || ""} ${demandLead.rawTextSnippet || ""}`.toLowerCase();
  if (
    (demandType === "apartment" && supplyType === "villa_house") ||
    (demandType === "villa_house" && supplyType === "apartment")
  ) {
    if (demandText.includes("independent house") || demandText.includes("or") || demandText.includes("villa")) {
      return { score: 0.95, reason: "Compatible residential type: Buyer considers both Apartment and Villa/Independent House" };
    }
    return { score: 0.65, reason: "Residential cross-type match (Apartment / Villa)" };
  }

  // Commercial Office vs Retail
  if (
    (demandType === "commercial_office" && supplyType === "retail_showroom") ||
    (demandType === "retail_showroom" && supplyType === "commercial_office")
  ) {
    return { score: 0.5, reason: "Commercial property cross-category" };
  }

  return { score: 0.0, reason: `Incompatible property types (${demandType} vs ${supplyType})` };
}

/**
 * Evaluates Configuration compatibility (strictly BHK configuration for residences).
 * Does not require plot dimensions or commercial floor area matching.
 */
export function evaluateConfigCompatibility(configDemand?: string, configSupply?: string): {
  score: number;
  reason: string;
} {
  const cd = (configDemand || "").toLowerCase();
  const cs = (configSupply || "").toLowerCase();

  const bhkDemand = cd.match(/(\d+)\s*bhk/);
  const bhkSupply = cs.match(/(\d+)\s*bhk/);

  if (bhkDemand && bhkSupply) {
    const dVal = parseInt(bhkDemand[1], 10);
    const sVal = parseInt(bhkSupply[1], 10);

    if (dVal === sVal) {
      return { score: 1.0, reason: `Exact ${dVal} BHK configuration match` };
    }
    if (Math.abs(dVal - sVal) === 1) {
      return { score: 0.75, reason: `Close configuration: ${dVal} BHK requirement vs ${sVal} BHK availability` };
    }
    return { score: 0.35, reason: `Configuration divergence: ${dVal} BHK vs ${sVal} BHK` };
  }

  // Non-BHK properties (Plots, Commercial, General) do not require dimension / floor area matching
  return { score: 1.0, reason: "Property configuration compatible" };
}

/**
 * Evaluates Bangalore locality matching (same locality, neighboring locality, same zone).
 */
export function evaluateLocationCompatibility(locDemand?: string, locSupply?: string): {
  score: number;
  reason: string;
} {
  const ld = matchBangaloreLocality(locDemand || "") || locDemand || "";
  const ls = matchBangaloreLocality(locSupply || "") || locSupply || "";

  if (!ld || !ls) {
    return { score: 0.6, reason: "Bangalore metropolitan area match" };
  }

  const ldNorm = ld.trim().toLowerCase();
  const lsNorm = ls.trim().toLowerCase();

  // 1. Exact canonical locality match
  if (ldNorm === lsNorm) {
    return { score: 1.0, reason: `Exact locality match in ${ld}` };
  }

  // 2. Neighboring localities (e.g. Cooke Town & Wheeler Road, Koramangala & HSR)
  const neighborsOfDemand = BANGALORE_NEIGHBORING_AREAS[ld] || [];
  const isNeighbor = neighborsOfDemand.some((n) => n.toLowerCase() === lsNorm);
  if (isNeighbor) {
    return { score: 0.88, reason: `Neighboring localities: ${ld} and ${ls} are adjacent corridors (<2 km)` };
  }

  // 3. Same Bangalore Zone check
  const zoneDemand = BANGALORE_LOCALITIES.find((l) => l.name.toLowerCase() === ldNorm)?.zone;
  const zoneSupply = BANGALORE_LOCALITIES.find((l) => l.name.toLowerCase() === lsNorm)?.zone;

  if (zoneDemand && zoneSupply && zoneDemand === zoneSupply) {
    return { score: 0.72, reason: `Same Bangalore zone: Both in ${zoneDemand} Bangalore (${ld} & ${ls})` };
  }

  return { score: 0.45, reason: `Different corridors in Bangalore: ${ld} vs ${ls}` };
}

/**
 * Evaluates budget and price feasibility.
 */
export function evaluateBudgetCompatibility(
  priceDemand?: string,
  priceSupply?: string,
  demandSide?: MarketSide,
): {
  score: number;
  reason: string;
} {
  const pDem = parsePriceToInr(priceDemand);
  const pSup = parsePriceToInr(priceSupply);

  // If either price is unspecified, assign neutral feasibility
  if (pDem.type === "unspecified" || pSup.type === "unspecified" || pDem.amountInr === 0 || pSup.amountInr === 0) {
    return { score: 0.75, reason: "Price subject to mutual negotiation (direct owner/broker rate)" };
  }

  // Compare amounts
  const budget = pDem.amountInr;
  const asking = pSup.amountInr;

  // Supply asking is at or below demand budget
  if (asking <= budget) {
    return {
      score: 1.0,
      reason: `Asking rate (${pSup.raw}) is completely within buyer/tenant budget (${pDem.raw})`,
    };
  }

  // Supply asking is within 10-25% negotiable buffer
  const ratio = asking / budget;
  if (ratio <= 1.25) {
    return {
      score: 0.85,
      reason: `Asking rate (${pSup.raw}) is slightly above budget (${pDem.raw}) but within standard negotiable margin`,
    };
  }

  if (ratio <= 1.5) {
    return {
      score: 0.6,
      reason: `Asking rate (${pSup.raw}) exceeds budget (${pDem.raw}) but can be negotiated for serious closer`,
    };
  }

  return {
    score: 0.3,
    reason: `Significant budget gap (${pDem.raw} budget vs ${pSup.raw} asking)`,
  };
}

/**
 * Formulates a tailored, ready-to-send WhatsApp pitch message between Demand and Supply parties.
 */
export function generateSuggestedPitch(
  demandLead: ExtractedAILead,
  supplyLead: ExtractedAILead,
  reason: string,
): string {
  const demandName = demandLead.contactPerson || demandLead.senderName || "Client";
  const supplyLoc = supplyLead.location || "Bangalore";
  const supplyConfig = supplyLead.configuration || supplyLead.propertyType || "Property";
  const supplyPrice = supplyLead.budgetOrPrice || "competitive rate";

  if (demandLead.intent === "buy") {
    return `Hi ${demandName}! We noticed your purchase requirement for ${demandLead.configuration || "property"} in ${demandLead.location || "Bangalore"}. We have an available direct option: ${supplyConfig} in ${supplyLoc} quoting ${supplyPrice} with clear title. Let me know if you would like full details and photos.`;
  }

  if (demandLead.intent === "rent_seek") {
    return `Hi ${demandName}! In reference to your rental requirement in ${demandLead.location || "Bangalore"}, we have an available ${supplyConfig} in ${supplyLoc} at ${supplyPrice} (negotiable). Ready for immediate move-in. Would you like to schedule an inspection?`;
  }

  if (demandLead.intent === "lease_seek") {
    return `Hi ${demandName}! We have a commercial space matching your lease requirement: ${supplyConfig} in ${supplyLoc} at ${supplyPrice}. Warm shell / furnished with 100% DG backup. Would you like to review the floor layout?`;
  }

  return `Hi ${demandName}! We found an active property match for your requirement: ${supplyConfig} in ${supplyLoc} (${supplyPrice}). Please let me know if you would like more details.`;
}

/**
 * Checks whether two leads originate from the same message, same contact phone,
 * or same broker / person. A lead must NEVER match against itself or the same sender.
 */
export function areLeadsFromSameSourceOrPerson(
  demand: ExtractedAILead,
  supply: ExtractedAILead,
): boolean {
  // 1. Same Lead ID
  if (demand.id === supply.id) return true;

  // 2. Same source WhatsApp message ID
  if (
    demand.sourceMessageId &&
    supply.sourceMessageId &&
    demand.sourceMessageId === supply.sourceMessageId
  ) {
    return true;
  }

  // 3. Multi-listing decomposed from the same parent message (e.g. "msg-1-list-1" and "msg-1-list-2")
  const baseDemandId = demand.id.split("-list-")[0].split("-item-")[0];
  const baseSupplyId = supply.id.split("-list-")[0].split("-item-")[0];
  if (baseDemandId && baseSupplyId && baseDemandId === baseSupplyId) {
    return true;
  }

  // 4. Same sender or contact phone number
  const cleanDigits = (p?: string): string => {
    if (!p) return "";
    const d = p.replace(/[^0-9]/g, "");
    if (d.length === 12 && d.startsWith("91")) return d.slice(2);
    if (d.length === 11 && d.startsWith("0")) return d.slice(1);
    return d;
  };

  const dPhones = [
    cleanDigits(demand.senderPhone),
    cleanDigits(demand.contactPhone),
  ].filter((p) => p.length >= 10);
  const sPhones = [
    cleanDigits(supply.senderPhone),
    cleanDigits(supply.contactPhone),
  ].filter((p) => p.length >= 10);

  for (const dp of dPhones) {
    for (const sp of sPhones) {
      if (dp === sp || dp.endsWith(sp) || sp.endsWith(dp)) {
        return true;
      }
    }
  }

  // 5. Same sender or contact name (excluding generic placeholders)
  const genericNames = new Set([
    "whatsapp member",
    "whatsapp user",
    "unknown",
    "direct contact",
    "",
  ]);
  const dNames = [demand.senderName, demand.contactPerson]
    .filter(Boolean)
    .map((n) => n!.trim().toLowerCase())
    .filter((n) => !genericNames.has(n));
  const sNames = [supply.senderName, supply.contactPerson]
    .filter(Boolean)
    .map((n) => n!.trim().toLowerCase())
    .filter((n) => !genericNames.has(n));

  for (const dn of dNames) {
    for (const sn of sNames) {
      if (dn === sn) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Script-Based Property Matchmaker.
 * Evaluates all Demand leads against Supply leads and returns ranked matches.
 */
export function matchPropertiesByRules(leads: ExtractedAILead[]): AILeadMatch[] {
  const matches: AILeadMatch[] = [];

  // Separate into Demand and Supply
  const demandLeads = leads.filter(
    (l) => l.side === "demand" || l.intent === "buy" || l.intent === "rent_seek" || l.intent === "lease_seek",
  );
  const supplyLeads = leads.filter(
    (l) => l.side === "supply" || l.intent === "sell" || l.intent === "rent_out" || l.intent === "lease_out",
  );

  for (const demand of demandLeads) {
    for (const supply of supplyLeads) {
      // 0. Ensure both potential leads are completely DIFFERENT entities / brokers / messages
      if (areLeadsFromSameSourceOrPerson(demand, supply)) {
        continue;
      }

      // 1. Intent check
      if (!isIntentCompatible(demand.intent, supply.intent)) {
        continue;
      }

      // 2. Type of Residence / Property Type check
      const dType = categorizeProperty(demand.propertyType, demand.configuration, demand.rawTextSnippet);
      const sType = categorizeProperty(supply.propertyType, supply.configuration, supply.rawTextSnippet);
      const typeEval = evaluateTypeCompatibility(dType, sType, demand);
      if (typeEval.score <= 0.2) {
        continue; // Incompatible property types (e.g. plot vs office)
      }

      // 3. Configuration check
      const configEval = evaluateConfigCompatibility(demand.configuration, supply.configuration);

      // 4. Location check
      const locEval = evaluateLocationCompatibility(demand.location, supply.location);
      if (locEval.score <= 0.3) {
        continue; // Complete location divergence across Bangalore
      }

      // 5. Budget / Price check
      const budgetEval = evaluateBudgetCompatibility(demand.budgetOrPrice, supply.budgetOrPrice, demand.side);

      // Calculate composite score (Weights: Intent=0.20, Type=0.25, Location=0.25, Config=0.15, Budget=0.15)
      const compositeScore = Math.min(
        0.98,
        Math.max(
          0.5,
          1.0 * 0.2 +
            typeEval.score * 0.25 +
            locEval.score * 0.25 +
            configEval.score * 0.15 +
            budgetEval.score * 0.15,
        ),
      );

      // Only qualify matches with score >= 0.65
      if (compositeScore >= 0.65) {
        const matchReasons = [
          typeEval.reason,
          locEval.reason,
          configEval.reason,
          budgetEval.reason,
        ].filter(Boolean);

        const id = `match-${demand.id}-${supply.id}`;
        const validDemandBudget =
          sanitizeRupeeAmount(demand.budgetOrPrice) ||
          (demand.budgetOrPrice && isRupeeCurrency(demand.budgetOrPrice)
            ? demand.budgetOrPrice
            : undefined);
        const validSupplyPrice =
          sanitizeRupeeAmount(supply.budgetOrPrice) ||
          (supply.budgetOrPrice && isRupeeCurrency(supply.budgetOrPrice)
            ? supply.budgetOrPrice
            : undefined);

        matches.push({
          id,
          demandLeadId: demand.id,
          supplyLeadId: supply.id,
          demandLeadSummary: `${demand.configuration || demand.propertyType} in ${demand.location || "Bangalore"}${validDemandBudget ? ` (${validDemandBudget})` : ""}`,
          supplyLeadSummary: `${supply.configuration || supply.propertyType} in ${supply.location || "Bangalore"}${validSupplyPrice ? ` (${validSupplyPrice})` : ""}`,
          demandBudget: validDemandBudget || "On Request",
          supplyPrice: validSupplyPrice || "On Request",
          demandConfig: demand.configuration || demand.propertyType,
          supplyConfig: supply.configuration || supply.propertyType,
          demandContact: {
            name: demand.contactPerson || demand.senderName,
            phone: demand.contactPhone || demand.senderPhone,
            location: demand.location,
          },
          supplyContact: {
            name: supply.contactPerson || supply.senderName,
            phone: supply.contactPhone || supply.senderPhone,
            location: supply.location,
          },
          matchScore: Math.round(compositeScore * 100) / 100,
          matchReason: matchReasons.join(" · "),
          suggestedPitch: generateSuggestedPitch(demand, supply, matchReasons[0]),
        });
      }
    }
  }

  // Sort matches by descending match score
  matches.sort((a, b) => b.matchScore - a.matchScore);
  return matches;
}
