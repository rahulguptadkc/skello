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
  calculateBangaloreDistanceKm,
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
  type: "monthly_rent" | "total_sale" | "per_sqft" | "per_acre" | "unspecified";
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

  // Per-acre rates must stay distinct from a total sale price.
  const perAcreMatch = lower.match(
    /(\d+(?:,\d{3})*(?:\.\d+)?)\s*(cr(?:ore)?|crores?|lakh(?:s)?|lac(?:s)?|k)?\s*(?:per\s*acre|\/\s*acre)\b/i,
  );
  if (perAcreMatch) {
    const value = Number(perAcreMatch[1].replace(/,/g, ""));
    const unit = (perAcreMatch[2] || "").toLowerCase();
    const amountInr = value * (
      unit.startsWith("cr") ? 10_000_000 :
      unit.startsWith("l") ? 100_000 :
      unit === "k" ? 1_000 : 1
    );
    return { type: "per_acre", amountInr, raw };
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
  if (bhkDemand || bhkSupply) {
    return { score: 0.2, reason: "BHK configuration is missing on one side" };
  }

  const parseAcres = (value: string): { min: number; max: number } | null => {
    const range = value.match(/(\d+(?:\.\d+)?)\s*(?:to|[-–])\s*(\d+(?:\.\d+)?)\s*acres?\b/i);
    if (range) return { min: Number(range[1]), max: Number(range[2]) };
    const single = value.match(/\b(\d+(?:\.\d+)?)\s*acres?\b/i);
    if (single) {
      const size = Number(single[1]);
      return { min: size, max: size };
    }
    return null;
  };
  const demandAcres = parseAcres(cd);
  const supplyAcres = parseAcres(cs);
  if (demandAcres) {
    if (!supplyAcres) {
      return { score: 0, reason: "Supply acreage not specified" };
    }
    const overlaps = supplyAcres.min <= demandAcres.max && supplyAcres.max >= demandAcres.min;
    return overlaps
      ? { score: 1, reason: `Acreage matches requirement (${supplyAcres.min}–${supplyAcres.max} acres)` }
      : { score: 0, reason: `Acreage does not match (${demandAcres.min}–${demandAcres.max} vs ${supplyAcres.min}–${supplyAcres.max} acres)` };
  }

  const configKind = (value: string): string | null => {
    if (/\b(plot|site|land|acres?|guntas?)\b/i.test(value)) return "land";
    if (/\b(apartment|flat|villa|house|bungalow|duplex|bhk)\b/i.test(value)) return "residential";
    if (/\b(office|commercial|bare shell|warm shell|workstations?)\b/i.test(value)) return "commercial";
    if (/\b(showroom|retail|shop)\b/i.test(value)) return "retail";
    if (/\b(warehouse|godown|industrial shed)\b/i.test(value)) return "warehouse";
    return null;
  };
  const demandKind = configKind(cd);
  const supplyKind = configKind(cs);
  if (demandKind && demandKind === supplyKind) {
    return { score: 1, reason: `Property configuration type matches (${demandKind})` };
  }
  if (supplyAcres) {
    return { score: 0.2, reason: "Demand acreage is not specified" };
  }

  const parseSqft = (value: string): { min: number; max: number } | null => {
    const normalized = value.replace(/,/g, "");
    const range = normalized.match(
      /(\d+(?:\.\d+)?)\s*(?:to|[-–])\s*(\d+(?:\.\d+)?)\s*(?:sq\.?\s*ft|sqft|sft)\b/i,
    );
    if (range) return { min: Number(range[1]), max: Number(range[2]) };
    const single = normalized.match(/\b(\d+(?:\.\d+)?)\s*(?:sq\.?\s*ft|sqft|sft)\b/i);
    if (single) {
      const size = Number(single[1]);
      return { min: size, max: size };
    }
    const dimensions = normalized.match(/\b(\d{2,4})\s*[x*]\s*(\d{2,4})\b/i);
    if (dimensions) {
      const size = Number(dimensions[1]) * Number(dimensions[2]);
      return { min: size, max: size };
    }
    return null;
  };
  const demandSqft = parseSqft(cd);
  const supplySqft = parseSqft(cs);
  if (demandSqft && supplySqft) {
    const overlaps = supplySqft.min <= demandSqft.max && supplySqft.max >= demandSqft.min;
    return overlaps
      ? { score: 1, reason: `Area configuration matches (${supplySqft.min}–${supplySqft.max} sqft)` }
      : { score: 0.35, reason: `Area differs (${demandSqft.min}–${demandSqft.max} vs ${supplySqft.min}–${supplySqft.max} sqft)` };
  }
  if (demandSqft || supplySqft) {
    return { score: 0.2, reason: "Sqft configuration is missing on one side" };
  }

  // No concrete configuration on both sides is not evidence of a config match.
  return { score: 0.2, reason: "Configuration details are not specified" };
}

/** Evaluates Bangalore location compatibility using locality-center distance. */
export function evaluateLocationCompatibility(locDemand?: string, locSupply?: string): {
  score: number;
  reason: string;
} {
  const distance = calculateBangaloreDistanceKm(locDemand, locSupply);
  if (!distance) {
    return {
      score: 0.2,
      reason: "Distance unavailable: one or both locations lack a recognized locality",
    };
  }

  if (distance.distanceKm <= 5) {
    return {
      score: 1,
      reason: `Approx. ${distance.distanceKm.toFixed(1)} km straight-line (${distance.demandLocality} to ${distance.supplyLocality})`,
    };
  }

  return {
    score: 0.0,
    reason: `Approx. ${distance.distanceKm.toFixed(1)} km straight-line, exceeds 5 km (${distance.demandLocality} to ${distance.supplyLocality})`,
  };
}

/**
 * Evaluates budget and price feasibility with a symmetric ±10% band.
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

  // If either price is unspecified or missing, the budget column does NOT match
  if (
    pDem.type === "unspecified" ||
    pSup.type === "unspecified" ||
    pDem.amountInr <= 0 ||
    pSup.amountInr <= 0
  ) {
    return {
      score: 0.2,
      reason: "Budget or asking price not specified",
    };
  }

  // Compare amounts
  const budget = pDem.amountInr;
  const asking = pSup.amountInr;

  if (pDem.type !== pSup.type) {
    return { score: 0.0, reason: "Budget and asking price use different price bases" };
  }

  const ratio = asking / budget;
  const variancePct = Math.abs(ratio - 1) * 100;
  if (ratio >= 0.9 && ratio <= 1.1) {
    return {
      score: variancePct < 0.01 ? 1 : 0.85,
      reason: `Price (${pSup.raw}) is within ${variancePct.toFixed(1)}% of budget (${pDem.raw})`,
    };
  }

  return {
    score: 0.2,
    reason: `Price (${pSup.raw}) differs from budget (${pDem.raw}) by ${variancePct.toFixed(1)}%, outside the ±10% range`,
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
 * Checks whether two leads originate from the same WhatsApp message.
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

  return false;
}

/**
 * Script-Based Property Matchmaker.
 * Evaluates all Demand leads against Supply leads and returns ranked matches.
 */
export function matchPropertiesByRules(leads: ExtractedAILead[]): AILeadMatch[] {
  const matches: AILeadMatch[] = [];

  // Collapse reposts of the exact same listing from the same sender in the
  // current feed. Budget/price is part of the signature so a changed asking
  // price remains a separate, potentially matchable listing.
  const normalized = (value?: string) => (value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const duplicateKey = (lead: ExtractedAILead) => {
    const sender = normalized(lead.senderPhone) || normalized(lead.senderName);
    const price = parsePriceToInr(lead.budgetOrPrice);
    const priceKey = price.type !== "unspecified" && price.amountInr > 0
      ? `${price.type}:${price.amountInr}`
      : normalized(lead.budgetOrPrice);
    const propertyType = normalized(lead.propertyType);
    const configuration = normalized(lead.configuration);
    const location = normalized(lead.location);
    const hasListingDetails = Boolean(configuration || location || priceKey || (propertyType && propertyType !== "property"));
    const identity = hasListingDetails
      ? [propertyType, configuration, location, priceKey].join("|")
      : normalized(lead.rawTextSnippet);
    return [sender, lead.side, lead.intent, identity].join("|");
  };
  const leadsBySignature = new Map<string, Array<{ lead: ExtractedAILead; index: number }>>();
  leads.forEach((lead, index) => {
    const key = duplicateKey(lead);
    const sameMessageGroup = lead.sourceMessageId || lead.id;
    const group = leadsBySignature.get(key) || [];
    // Multiple listings in one bundled WhatsApp post are separate records;
    // duplicate replacement only applies across different source messages.
    if (group.some(({ lead: existing }) => (existing.sourceMessageId || existing.id) === sameMessageGroup)) {
      group.push({ lead, index });
      leadsBySignature.set(key, group);
      return;
    }
    const latestExisting = group.reduce<{ lead: ExtractedAILead; index: number } | undefined>(
      (latest, current) => {
        if (!latest) return current;
        const currentTime = current.lead.timestamp ?? Number.NEGATIVE_INFINITY;
        const latestTime = latest.lead.timestamp ?? Number.NEGATIVE_INFINITY;
        return currentTime > latestTime || (currentTime === latestTime && current.index > latest.index)
          ? current
          : latest;
      },
      undefined,
    );
    const candidateTime = lead.timestamp ?? Number.NEGATIVE_INFINITY;
    const latestTime = latestExisting?.lead.timestamp ?? Number.NEGATIVE_INFINITY;
    if (!latestExisting || candidateTime > latestTime || (candidateTime === latestTime && index > latestExisting.index)) {
      leadsBySignature.set(key, [{ lead, index }]);
    }
  });
  const currentLeads = [...leadsBySignature.values()].flatMap((group) => group.map(({ lead }) => lead));

  // Separate into Demand and Supply
  const demandLeads = currentLeads.filter(
    (l) => l.side === "demand" || l.intent === "buy" || l.intent === "rent_seek" || l.intent === "lease_seek",
  );
  const supplyLeads = currentLeads.filter(
    (l) => l.side === "supply" || l.intent === "sell" || l.intent === "rent_out" || l.intent === "lease_out",
  );

  for (const demand of demandLeads) {
    for (const supply of supplyLeads) {
      // A listing cannot be matched to itself or another extraction of the same message.
      if (areLeadsFromSameSourceOrPerson(demand, supply)) {
        continue;
      }

      // 1. Intent check
      if (!isIntentCompatible(demand.intent, supply.intent)) {
        continue;
      }

      // Evaluate all three matching criteria independently.
      const configEval = evaluateConfigCompatibility(demand.configuration, supply.configuration);
      const locEval = evaluateLocationCompatibility(demand.location, supply.location);
      const budgetEval = evaluateBudgetCompatibility(demand.budgetOrPrice, supply.budgetOrPrice, demand.side);

      // A potential match must be close enough geographically, even when its
      // configuration or price is the criterion that otherwise qualifies it.
      if (locEval.score < 0.7) continue;

      const demandPrice = parsePriceToInr(demand.budgetOrPrice);
      const supplyPrice = parsePriceToInr(supply.budgetOrPrice);
      const hasComparablePrices =
        demandPrice.type !== "unspecified" &&
        supplyPrice.type !== "unspecified" &&
        demandPrice.amountInr > 0 &&
        supplyPrice.amountInr > 0 &&
        demandPrice.type === supplyPrice.type;

      // A known, comparable price outside ±10% is a hard disqualifier, even
      // when configuration or location matches.
      if (hasComparablePrices && budgetEval.score < 0.8) continue;

      const matchedCriteria = [
        configEval.score >= 0.6 ? { name: "Configuration", ...configEval } : null,
        budgetEval.score >= 0.8 ? { name: "Budget/price", ...budgetEval } : null,
        locEval.score >= 0.7 ? { name: "Location", ...locEval } : null,
      ].filter((criterion): criterion is { name: string; score: number; reason: string } => criterion !== null);

      // Intent compatibility is mandatory. Any ONE of configuration,
      // budget/price, or location is enough to qualify the pair.
      if (matchedCriteria.length === 0) continue;

      const averageCriterionScore =
        matchedCriteria.reduce((total, criterion) => total + criterion.score, 0) / matchedCriteria.length;
      const compositeScore = Math.min(
        0.98,
        0.65 + averageCriterionScore * 0.25 + (matchedCriteria.length - 1) * 0.05,
      );
      const matchReasons = matchedCriteria.map(
        (criterion) => `${criterion.name}: ${criterion.reason}`,
      );

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
        demandProject: demand.projectName,
        supplyProject: supply.projectName,
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

  // Keep every qualifying alternative. A single requirement can match
  // multiple distinct listings, including listings with different prices.
  matches.sort((a, b) => b.matchScore - a.matchScore);
  return matches;
}
