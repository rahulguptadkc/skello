import { matchBangaloreLocality } from "./bangalore-locations";

// Classification of real estate messages captured from WhatsApp groups.
// Categorizes messages into: "buy", "rent", "sell", "lease", or "general".
// Extracts key metadata like configuration (e.g. 3BHK), budget/price, and location.

export type PropertyIntent = "buy" | "rent" | "sell" | "lease" | "general";

export interface ExtractedPropertyDetails {
  intent: PropertyIntent;
  confidence: number;
  configuration?: string;
  budgetOrPrice?: string;
  location?: string;
  tags: string[];
}

const RENT_PATTERNS = [
  /\b(on\s+rent|for\s+rent|to\s+let|wtr|available\s+for\s+rent|need\s+on\s+rent|renting|rental|rented)\b/i,
  /\b(tenant|tenants|flatmate|flatmates|roommate|paying\s+guest|pg)\b/i,
  /\b(rent\s*:\s*\d+k?|deposit\s*:\s*\d+k?|maintenance\s+included)\b/i,
  /\b(\d+\s*k\s*\/\s*(month|pm|mo))\b/i,
];

const LEASE_PATTERNS = [
  /\b(commercial\s+lease|long[\s-]?term\s+lease|corporate\s+lease|lock[\s-]?in|floor\s+plate|bare\s+shell|warm\s+shell)\b/i,
  /\b(on\s+lease|available\s+on\s+lease|office\s+space\s+on\s+lease)\b/i,
];

const SELL_PATTERNS = [
  /\b(for\s+sale|available\s+for\s+sale|direct\s+sale|resale|wts|urgent\s+sale|distress\s+sale)\b/i,
  /\b(sell|selling|seller|sellers|ready\s+to\s+move\s+sale)\b/i,
  /\b(demand\s*:\s*\d+(\.\d+)?\s*(cr|crore|l|lac|lakh)?|asking\s*:\s*₹?\s*\d+)\b/i,
];

const BUY_PATTERNS = [
  /\b(buy|buying|buyer|buyers|purchase|purchasing|wtb|looking\s+to\s+buy|want\s+to\s+buy|direct\s+buyer)\b/i,
  /\b(looking\s+for|require|required|requirement|needed|urgent\s+requirement)\b/i,
  /\b(need\s+(a\s+)?\d\s*bhk)\b/i,
  /\b(client\s+(needs|requires|looking))\b/i,
];

export const CONFIG_PATTERN =
  /\b([1-6][\s-]*bhk|[1-6][\s-]*rk|villa|penthouse|plot|studio|farmhouse|commercial\s+(office|space|retail|showroom)|office\s+space|showroom|shop|duplex)\b/i;

// Price / Budget regexes.
// Crucial rule: Square footage (sqft, sft, sq ft, etc.) is NEVER a rupee budget.
// Only rupee formats like ₹..., 20K, 20,000, ₹10000, 1.50 Lakhs, 2.25 Cr are considered rupees.
export const PRICE_PATTERNS = [
  // 1. Explicit ₹ / Rs / INR with Crore/Lakh/K or raw digits (No \b before ₹ because ₹ is not a word char)
  /(?:₹|rs\.?|inr)\s*\d+(?:\.\d+)?(?:\s*(?:cr|crore|crores|l|lac|lacs|lakh|lakhs|k\b))?/i,
  // 2. Explicit ₹ / Rs / INR with comma-formatted numbers like ₹20,000 or ₹ 1,50,000
  /(?:₹|rs\.?|inr)\s*\d{1,3}(?:,\d{2,3})+(\s*\/\s*(?:month|m|mo|pm))?/i,
  // 3. Crore denominations (e.g. 2.25 Cr, 4 Crore)
  /\b(\d+(\.\d+)?[\s-]*(?:cr|crore|crores))\b/i,
  // 4. Lakh denominations (e.g. 1.50 Lakhs, 75 lacs)
  /\b(\d+(\.\d+)?[\s-]*(?:lac|lacs|lakh|lakhs))\b/i,
  // 5. K notation (e.g. 20K, 40k/month, 60k nego)
  /\b(\d+(\.\d+)?\s*k\s*(?:\/|\s)*(?:month|pm|mo)?)\b/i,
  // 6. Formatted comma numbers alone like 20,000 or 50,000 (NOT sqft)
  /\b(\d{1,3}(?:,\d{2,3})+(\s*\/\s*(?:month|pm|mo))?)\b/i,
  // 7. Rate per sqft (e.g. 11,500 per Sft or 12000/sqft)
  /\b(\d{1,3}(?:,\d{2,3})+\s*(?:per\s*sft|per\s*sqft|\/\s*sft|\/\s*sqft))\b/i,
];

/**
 * Checks if a string represents a valid Rupee currency amount.
 * Rule:
 * 1. If text contains sqft, sft, sq ft, square feet, sqm, acres, etc., it is NOT a rupee budget.
 *    (Exception: "per sft" or "/sqft" rates)
 * 2. Only valid rupee formats (₹, 20K, 20,000, ₹10000, Lakhs, Cr) are considered rupees.
 */
export function isRupeeCurrency(val?: string): boolean {
  if (!val || !val.trim() || val === "—") return false;
  const clean = val.trim();
  const lower = clean.toLowerCase();

  // If text mentions sqft / sft / dimensions without a per-sft rate, it is NOT rupees
  if (
    /\b(sqft|sft|sq\.?\s*ft|square\s*feet|sqm|acres?|guntas?)\b/i.test(lower) &&
    !lower.includes("per") &&
    !lower.includes("/")
  ) {
    return false;
  }

  // Pure digits without formatting, symbol or denomination are ambiguous unless comma-formatted like "20,000"
  if (/^\+?\d+[\s\+]*$/i.test(lower)) {
    return false;
  }

  // Must have currency symbol OR denomination OR K notation OR comma-formatted number OR monthly rent
  const hasCurrencySymbol = /(?:₹|rs\.?|inr)/i.test(lower);
  const hasDenomination = /\b(cr|crore|crores|lakh|lakhs|lac|lacs)\b/i.test(lower);
  const hasKNotation = /\b\d+(\.\d+)?\s*k\b/i.test(lower);
  const hasCommaNumber = /\b\d{1,3}(?:,\d{2,3})+\b/.test(clean);
  const hasMonthlyRent = /\b\d+\s*\/\s*(month|pm|mo)\b/i.test(lower);

  return (
    hasCurrencySymbol ||
    hasDenomination ||
    hasKNotation ||
    hasCommaNumber ||
    hasMonthlyRent
  );
}

/**
 * Sanitizes and returns the rupee string if valid, otherwise undefined.
 */
export function sanitizeRupeeAmount(val?: string): string | undefined {
  if (!val || !isRupeeCurrency(val)) return undefined;
  return val.trim();
}

export function classifyPropertyMessage(text: string): ExtractedPropertyDetails {
  if (!text || !text.trim()) {
    return { intent: "general", confidence: 0, tags: [] };
  }

  const clean = text.trim();
  const tags: string[] = [];

  let buyScore = 0;
  let rentScore = 0;
  let sellScore = 0;
  let leaseScore = 0;

  // Check specific intents first: Lease & Rent have very strong signals
  for (const p of LEASE_PATTERNS) {
    if (p.test(clean)) leaseScore += 4;
  }
  for (const p of RENT_PATTERNS) {
    if (p.test(clean)) rentScore += 4;
  }
  for (const p of SELL_PATTERNS) {
    if (p.test(clean)) sellScore += 3.5;
  }

  // Only assign buy score if not explicitly rental/lease or if buy keywords are distinct
  for (const p of BUY_PATTERNS) {
    if (p.test(clean)) {
      if (rentScore > 0 || leaseScore > 0) {
        // If it's "need 3bhk on rent", the "need 3bhk" should reinforce rent, not buy
        if (rentScore > 0) rentScore += 1;
        if (leaseScore > 0) leaseScore += 1;
      } else {
        buyScore += 3;
      }
    }
  }

  // Configuration extraction
  const configMatch = clean.match(CONFIG_PATTERN);
  const configuration = configMatch ? configMatch[0].toUpperCase() : undefined;
  if (configuration) tags.push(configuration);

  // Price / Budget extraction: strictly validates rupee formats
  let budgetOrPrice: string | undefined;
  for (const pp of PRICE_PATTERNS) {
    const pm = clean.match(pp);
    if (pm) {
      const candidate = pm[0].trim();
      if (isRupeeCurrency(candidate)) {
        budgetOrPrice = candidate;
        tags.push(budgetOrPrice);
        break;
      }
    }
  }

  // Location matching: prioritizes Bangalore localities, with fallback to legacy pattern
  const blrLocation = matchBangaloreLocality(clean);
  const locMatch = clean.match(
    /\b(sector\s*\d+[a-z]?|dlf\s*phase\s*\d|golf\s*course\s*(road|ext)?|cyber\s*city|bandra|sohna\s*road|hiranandani|indiranagar|whitefield|koramangala|powai|andheri|greater\s*kailash\s*\d?|gk\s*[1-2])\b/i,
  );
  const location = blrLocation || (locMatch ? locMatch[0] : undefined);
  if (location) tags.push(location);

  // Determine winning intent
  const scores: Record<PropertyIntent, number> = {
    lease: leaseScore,
    rent: rentScore,
    sell: sellScore,
    buy: buyScore,
    general: 0.5,
  };

  const sortedIntents = (Object.keys(scores) as PropertyIntent[]).sort(
    (a, b) => scores[b] - scores[a],
  );

  const winningIntent = scores[sortedIntents[0]] > 1 ? sortedIntents[0] : "general";
  const confidence = Math.min(0.98, Math.max(0.5, scores[winningIntent] / 6));

  return {
    intent: winningIntent,
    confidence,
    configuration,
    budgetOrPrice,
    location,
    tags,
  };
}
