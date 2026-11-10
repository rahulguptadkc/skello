/**
 * Property Inquiry Deduplicator for WhatsApp Inquiries Feed.
 * If all 5 fields are the same:
 * 1. Intent (e.g. Buy, Sell, Rent, Lease)
 * 2. Configuration (e.g. 3 BHK, 4 BHK, 3.5 Acre)
 * 3. Budget / Price (e.g. ₹5 Cr, 50K/month)
 * 4. Project Name (e.g. Sobha Dream Acres, Prestige Shantiniketan)
 * 5. Location (e.g. Koramangala, Whitefield)
 *
 * Then we keep the LATEST one (by raw_timestamp / timestamp) and remove the earlier duplicate.
 * Pure TypeScript utility safe for both Node.js server and Next.js client browser.
 */

export function normalizeField(val: string | null | undefined): string {
  if (!val) return "";
  let cleaned = String(val).trim().toLowerCase().replace(/\s+/g, " ");
  if (cleaned === "—" || cleaned === "-" || cleaned === "null" || cleaned === "undefined") {
    return "";
  }
  // Normalize "3bhk" -> "3 bhk"
  cleaned = cleaned.replace(/(\d+)\s*bhk\b/g, "$1 bhk");
  // Normalize "sq.ft" or "sqft" -> "sqft"
  cleaned = cleaned.replace(/sq\.?\s*ft/g, "sqft");
  return cleaned;
}

export function normalizePriceField(val: string | null | undefined): string {
  if (!val) return "";
  let cleaned = String(val).trim().toLowerCase().replace(/\s+/g, " ");
  if (cleaned === "—" || cleaned === "-" || cleaned === "null" || cleaned === "undefined") {
    return "";
  }
  // Strip rupee symbol, commas, and extra symbols
  cleaned = cleaned.replace(/[₹,]/g, "").trim();
  // Normalize crore / cr
  cleaned = cleaned.replace(/\s*crores?\b/g, " cr").replace(/\s*cr\b/g, " cr");
  // Normalize lakh / lac / l
  cleaned = cleaned.replace(/\s*lakhs?\b|\s*lacs?\b/g, " l").replace(/\s*l\b/g, " l");
  // Normalize /month or pm
  cleaned = cleaned.replace(/\s*\/\s*(?:month|mo|pm)\b/g, "/month").replace(/\s+pm\b/g, "/month");
  return cleaned.replace(/\s+/g, " ");
}

export interface DedupablePropertyRecord {
  id?: string;
  intent?: string | null;
  configuration?: string | null;
  budget_or_price?: string | null;
  budgetOrPrice?: string | null;
  project_name?: string | null;
  projectName?: string | null;
  location?: string | null;
  raw_timestamp?: number;
  rawTimestamp?: number;
  timestamp?: string;
}

export function getPropertyDedupSignature(record: DedupablePropertyRecord): string {
  const intent = normalizeField(record.intent);
  const config = normalizeField(record.configuration);
  const price = normalizePriceField(record.budget_or_price || record.budgetOrPrice);
  const project = normalizeField(record.project_name || record.projectName);
  const location = normalizeField(record.location);

  return `${intent}::${config}::${price}::${project}::${location}`;
}

export function deduplicateCapturedMessages<T extends DedupablePropertyRecord>(items: T[]): T[] {
  if (!Array.isArray(items) || items.length <= 1) return items;

  // Sort descending by timestamp: newest / latest first
  const sorted = [...items].sort((a, b) => {
    const tsA = Number(a.raw_timestamp ?? a.rawTimestamp ?? (a.timestamp ? Date.parse(a.timestamp) : 0)) || 0;
    const tsB = Number(b.raw_timestamp ?? b.rawTimestamp ?? (b.timestamp ? Date.parse(b.timestamp) : 0)) || 0;
    return tsB - tsA;
  });

  const seenSignatures = new Set<string>();
  const deduplicated: T[] = [];

  for (const item of sorted) {
    const config = normalizeField(item.configuration);
    const price = normalizePriceField(item.budget_or_price || item.budgetOrPrice);
    const project = normalizeField(item.project_name || item.projectName);
    const location = normalizeField(item.location);

    // If all property fields are completely missing, don't accidentally collapse separate general notes
    if (!config && !price && !project && !location) {
      deduplicated.push(item);
      continue;
    }

    const sig = getPropertyDedupSignature(item);
    if (!seenSignatures.has(sig)) {
      seenSignatures.add(sig);
      deduplicated.push(item);
    }
    // Duplicate with matching intent, config, price, project, location is excluded
  }

  return deduplicated;
}
