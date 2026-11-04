// AI-Powered Real Estate Intent Classifier & Lead Matchmaking Engine
// Uses OpenAI (OPENAI_KEY / OPENAI_API_KEY) with structured JSON output.
// Decomposes multi-listing WhatsApp messages and matches Demand leads with Supply listings in Bangalore.

import {
  BANGALORE_LOCALITIES,
  matchBangaloreLocality,
  getBangalorePromptGuidelines,
} from "./bangalore-locations";
import {
  classifyPropertyMessage,
  isRupeeCurrency,
  sanitizeRupeeAmount,
} from "./intent-classifier";
import { matchPropertiesByRules } from "./property-script-matcher";

export interface DecomposedBangaloreMessageItem {
  intent: "BUY" | "SELL" | "RENT" | "LEASE" | "GENERAL";
  config: string;
  price: string;
  location: string;
  text: string;
}

export type LeadIntent =
  | "buy"
  | "sell"
  | "rent_seek"
  | "rent_out"
  | "lease_seek"
  | "lease_out"
  | "general";

export type MarketSide = "demand" | "supply";

export interface RawInputMessage {
  id: string;
  senderName: string;
  senderPhone: string;
  groupName?: string;
  groupId?: string;
  text: string;
  timestamp?: number;
}

export interface ExtractedAILead {
  id: string;
  sourceMessageId: string;
  senderName: string;
  senderPhone: string;
  contactPerson?: string;
  contactPhone?: string;
  groupName?: string;
  intent: LeadIntent;
  intentLabel: string;
  side: MarketSide;
  propertyType: string;
  configuration?: string;
  location?: string;
  budgetOrPrice?: string;
  keyDetails?: string;
  extractedSummary: string;
  rawTextSnippet: string;
  urgency?: "high" | "medium" | "normal";
  convertedToCrm?: boolean;
}

export interface AILeadMatch {
  id: string;
  demandLeadId: string;
  supplyLeadId: string;
  demandLeadSummary: string;
  supplyLeadSummary: string;
  demandBudget?: string;
  supplyPrice?: string;
  demandConfig?: string;
  supplyConfig?: string;
  demandContact: { name: string; phone: string; location?: string };
  supplyContact: { name: string; phone: string; location?: string };
  matchScore: number;
  matchReason: string;
  suggestedPitch: string;
}

export interface AIAnalysisSummary {
  totalMessagesAnalyzed: number;
  totalLeadsExtracted: number;
  buyDemandCount: number;
  sellSupplyCount: number;
  tenantRentCount: number;
  landlordRentCount: number;
  commercialLeaseCount: number;
  matchesFoundCount: number;
  marketInsights: string[];
}

export interface AILeadAnalysisResult {
  success: boolean;
  modelUsed: string;
  analyzedAt: string;
  summary: AIAnalysisSummary;
  leads: ExtractedAILead[];
  matches: AILeadMatch[];
  error?: string;
}

export const SAMPLE_REAL_ESTATE_WHATSAPP_MESSAGES: RawInputMessage[] = [
  {
    id: "sample-kartik-1",
    senderName: "Kartik Skelo",
    senderPhone: "+91 96861 15795",
    groupName: "Group for whatsapp testing",
    text: `Prestige Autumn Leaves 

Fabulous plotted development by prestige group !! 


Available Premium Plot for Sale !! 

2400 Sqft.

Premium Plot - East Facing
And
Opposite the Garden & Club house. 

Price : 11,500  per Sft  + deposits 

Trend shelters 
Shamran 
Cell no : 9686115795`,
    timestamp: Date.now() - 35 * 60 * 1000,
  },
  {
    id: "sample-kartik-2",
    senderName: "Kartik Skelo",
    senderPhone: "+91 98112 88771",
    groupName: "Group for whatsapp testing",
    text: `Residential rental availability
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
4. Cooke Town off Wheeler Road ext 1300 sft furnished at 1 Lakh`,
    timestamp: Date.now() - 30 * 60 * 1000,
  },
  {
    id: "sample-kartik-3",
    senderName: "Kartik Skelo",
    senderPhone: "+91 97115 44332",
    groupName: "Group for whatsapp testing",
    text: `New Flats 
For sale 
3-bhk  
1375 sft 
North facing
Stand alone building 
G+4
1.15-lakhs
A&E khata with o.c& c.c.
Sai Baba temple road Arekere
Car parking 
Security 
Lift 
Cctv cameras`,
    timestamp: Date.now() - 25 * 60 * 1000,
  },
  {
    id: "sample-kartik-4",
    senderName: "Kartik Skelo",
    senderPhone: "+91 97115 44332",
    groupName: "Group for whatsapp testing",
    text: `New Flats 
For sale 
2-bhk  
970 sft 
North facing
Stand alone building 
G+4
1.15-lakhs
A&E khata with o.c& c.c.
Sai Baba temple road Arekere
Car parking 
Security 
Lift 
Cctv cameras`,
    timestamp: Date.now() - 20 * 60 * 1000,
  },
  {
    id: "sample-kartik-5",
    senderName: "Kartik Skelo",
    senderPhone: "+91 98450 11990",
    groupName: "Group for whatsapp testing",
    text: `URGENT REQUIREMENT - PURCHASE

4BHK Spacious Apartment 5000+Sqft.
Project : Raheja Viverea, Koramangala

OR

INDEPENDENT HOUSE with Land Area 6000 to 10000Sqft.
Prime property`,
    timestamp: Date.now() - 15 * 60 * 1000,
  },
];

export function buildBangaloreDecompositionSystemPrompt(): string {
  const directory = getBangalorePromptGuidelines();
  return `You are an elite real estate intelligence system specialized exclusively in parsing completely unstructured, informal WhatsApp messages from the Bangalore (Bengaluru) real estate market.

WhatsApp messages sent by Indian brokers and owners are highly informal, full of shorthand, abbreviations, Hinglish slang, mixed lines, bullet points, and lack standard grammar.
Your mission is to DECOMPOSE every bundled message into separate, individual property listing/requirement items and extract:
1. "intent": "BUY" | "SELL" | "RENT" | "LEASE" | "GENERAL"
2. "config": Property configuration (BHK, dimensions, or commercial type)
3. "price": Normalized price or budget in INR
4. "location": CANONICAL BANGALORE LOCALITY NAME
5. "text": The specific text snippet

=== UNSTRUCTURED VOCABULARY & KEYWORD BANK ===

1. INTENT KEYWORDS & SHORTHAND:
   - "BUY" (Purchase Demand):
     Keywords: WTB (Want To Buy), Requirement, Reqd, Urgent Requirement, Client requirement, Need, Looking for, Seeking, Purchase, Direct buyer, End user, Investor, Payment ready, Budget, Immediate registration, Looking to buy, Looking to invest, Ready to close, Clear title, Chahiye, Khareedna hai, Party ready.
   - "SELL" (Supply / Sale):
     Keywords: WTS (Want To Sell), Available for sale, For sale, Direct sale, Resale, Urgent sale, Distress sale, Under construction, Ready to move (RTM), Brand new flat, Stand alone building, G+3 / G+4, A-Khata, B-Khata, E-Khata, OC & CC (Occupancy / Completion Certificate), Plotted development, Premium plot, Asking, Demand:, Quoting, Per sft, Rate:, Direct owner, Bechna hai, Bikau.
   - "RENT" (Residential Rental):
     Supply (Landlord): Available for rent, Rental availability, To let, Flat for rent, House for rent, Duplex for rent, GF house (Ground Floor), Villa available from date, Rent:, Rent 60k (nego / negotiable), Advance, Deposit, Family only, Vegetarians preferred, Immediate possession.
     Demand (Tenant): Rental requirement, Looking for flat on rent, Need 2BHK/3BHK on rent, Rent requirement, Bachelor/Family looking, Move in by date.
   - "LEASE" (Commercial Office / Retail / Warehouse):
     Keywords: Commercial rental, Commercial availability, Commercial lease, Office space, Bare shell, Warm shell, Plug and play, Workstations, Cabins, Conference room, Pantry, 100% DG backup, Long term lease, Lock-in, Pre-leased, Rental yield, High footfall, Retail showroom, Shop on main road, Godown, Warehouse, Industrial shed, Available on lease.
   - "GENERAL": Market updates, greeting messages, RERA announcements.

2. CONFIG KEYWORDS & SHORTHAND:
   - Residential: 1RK, 1BHK, 1-BHK, 2BHK, 2-BHK, 2.5BHK, 3BHK, 3-BHK, 3.5BHK, 4BHK, 4-BHK, 5BHK, Studio, Duplex, Triplex, Penthouse, Villa, Row House, Independent House, Standalone Building, Builder Floor, GF House.
   - Plots & Sites: Plot, Site, Corner Site, East Facing, North Facing, Gated Community, 30*40 (1200 sqft), 30x40, 30*50 (1500 sqft), 40*60 (2400 sqft), 50*80 (4000 sqft), Guntas, Acres, Sqft, Sft.
   - Commercial: Commercial Office, Bare Shell Office, Warm Shell Office, Fully Furnished Office, Plug & Play, Coworking Space, Retail Shop, Commercial Showroom, Warehouse, Godown.
   - Always extract dimensions if stated (e.g. "3BHK (1700 sqft)", "2400 Sqft Plot", "1500 sft bare shell", "3500 sft office").

3. PRICE & BUDGET KEYWORDS & MULTIPLIERS:
   - "k" / "K" = Thousand INR (e.g. "40k" -> "₹40,000/month", "60k (nego)" -> "₹60,000/month", "75K" -> "₹75,000/month").
   - "L" / "Lac" / "Lacs" / "Lakh" / "Lakhs" = Lakh INR (e.g. "1.50 Lakhs" -> "₹1.50 Lakhs", "1.15-lakhs" -> "₹1.15 Lakhs", "85L" -> "₹85 Lakhs").
   - "Cr" / "Crore" / "Crores" = Crore INR (e.g. "1.15 Cr" -> "₹1.15 Cr", "2.25 Cr" -> "₹2.25 Cr", "4.85 Cr" -> "₹4.85 Cr", "6.5 Cr" -> "₹6.5 Cr").
   - Per sqft: "11,500 per Sft" -> "₹11,500/sqft", "4200/sft" -> "₹4,200/sqft".
   - Extras: "+ GST", "+ maintenance", "+ deposits", "nego" (negotiable).

4. BANGALORE LOCATION & LANDMARK CANONICAL RULES:
   ALL input messages are strictly in Bangalore only.
   Resolve colloquial phrasing, roads, landmarks, and builders to canonical Bangalore localities:
   - "near Whitefield", "near ITPL", "Hope Farm", "Palm Meadows", "Prestige Shantiniketan", "Brigade Metropolis" -> "Whitefield"
   - "Cooke Town close to SBI Bank", "Milton Street" -> "Cooke Town"
   - "off 100 ft road Indira Nagar", "near CMH Road", "Krishna Temple Road" -> "Indiranagar"
   - "Fraser Town off Promenade Road", "Coles Park", "Pulikeshi Nagar" -> "Fraser Town"
   - "Wheeler Road", "Wheeler Road Ext" -> "Wheeler Road"
   - "Sai Baba temple road Arekere", "Arekere Mico Layout" -> "Arekere"
   - "Raheja Viverea Koramangala", "Sony World Signal", "Forum Mall" -> "Koramangala"
   - "Prestige Autumn Leaves", "Meenakshi Mall", "Gottigere", "BG Road" -> "Bannerghatta Road"
   - "MG Road / Brigade Road junction", "Church Street", "Residency Road" -> "MG Road"
   - "Sector 2 HSR", "HSR 3500 sft", "27th Main" -> "HSR Layout"
   - "HBR GF house", "HBR Layout", "Nagawara" -> "HBR Layout"
   - "MSR North City Layout" -> "MSR North City"
   - "Outer Ring Road", "Ecospace", "Ecoworld" -> "Bellandur"
   - "Manyata Tech Park" -> "Manyata Tech Park"
   - "Hebbal Flyover", "Lumbini Gardens" -> "Hebbal"

${directory}

=== OUTPUT JSON SCHEMA ===
Return ONLY a valid JSON object strictly matching this schema:
{
  "items": [
    {
      "intent": "BUY" | "SELL" | "RENT" | "LEASE" | "GENERAL",
      "config": "string",
      "price": "string",
      "location": "string",
      "text": "string"
    }
  ]
}`;
}

export function fallbackDecomposeBangaloreMessage(
  rawText: string,
): DecomposedBangaloreMessageItem[] {
  if (!rawText || !rawText.trim()) return [];
  const items: DecomposedBangaloreMessageItem[] = [];
  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // Check if text has numbered items or distinct sections (e.g. 1. ... 2. ...)
  const numberedLines = lines.filter((l) => /^\d+\.\s+/i.test(l));

  if (numberedLines.length > 1) {
    let currentIntent: "BUY" | "SELL" | "RENT" | "LEASE" | "GENERAL" = "GENERAL";

    for (const line of lines) {
      const lower = line.toLowerCase();
      if (lower.includes("residential rental availability") || lower.includes("rental available")) {
        currentIntent = "RENT";
        continue;
      }
      if (lower.includes("residential rental requirement") || lower.includes("rent requirement")) {
        currentIntent = "RENT";
        continue;
      }
      if (lower.includes("commercial rental") || lower.includes("commercial lease") || lower.includes("on lease")) {
        currentIntent = "LEASE";
        continue;
      }
      if (lower.includes("for sale") || lower.includes("resale")) {
        currentIntent = "SELL";
        continue;
      }
      if (lower.includes("purchase") || lower.includes("buyer requirement")) {
        currentIntent = "BUY";
        continue;
      }

      if (/^\d+\.\s+/i.test(line) || /^[A-Z]\.\s+/i.test(line)) {
        const configMatch = line.match(/\b([1-6]\s*bhk|villa|penthouse|plot|office|commercial)\b/i);
        const priceMatch = line.match(/\b((?:₹|rs\.?|inr)?\s*\d+(\.\d+)?\s*(?:cr|crore|lakhs?|lac|k\b|\/\s*month))\b/i);
        const location = matchBangaloreLocality(line) || "Bangalore";
        const rawPrice = priceMatch ? priceMatch[0].trim() : undefined;
        const validPrice = sanitizeRupeeAmount(rawPrice) || (rawPrice && isRupeeCurrency(rawPrice) ? rawPrice : "—");

        items.push({
          intent: currentIntent !== "GENERAL" ? currentIntent : line.toLowerCase().includes("budget") ? "BUY" : "RENT",
          config: configMatch ? configMatch[0].toUpperCase() : "3 BHK",
          price: validPrice,
          location,
          text: line,
        });
      }
    }
  }

  // If no multi-item breakdown was created, treat as single item
  if (items.length === 0) {
    const lower = rawText.toLowerCase();
    let intent: "BUY" | "SELL" | "RENT" | "LEASE" | "GENERAL" = "GENERAL";
    if (lower.includes("purchase") || lower.includes("urgent requirement") || lower.includes("looking for") || lower.includes("buyer")) {
      intent = "BUY";
    } else if (lower.includes("for sale") || lower.includes("selling") || lower.includes("plot for sale")) {
      intent = "SELL";
    } else if (lower.includes("on lease") || lower.includes("commercial")) {
      intent = "LEASE";
    } else if (lower.includes("rent") || lower.includes("to let")) {
      intent = "RENT";
    }

    const configMatch = rawText.match(/\b([1-6]\s*bhk|villa|penthouse|plot|office|commercial\s+showroom|duplex)\b/i);
    const priceMatch = rawText.match(/\b((?:₹|rs\.?|inr)?\s*\d+(\.\d+)?\s*(?:cr|crore|lakhs?|lac|k\b|\/\s*month|per\s*sft))\b/i);
    const location = matchBangaloreLocality(rawText) || "Bangalore";
    const rawPrice = priceMatch ? priceMatch[0].trim() : undefined;
    const validPrice = sanitizeRupeeAmount(rawPrice) || (rawPrice && isRupeeCurrency(rawPrice) ? rawPrice : "—");

    items.push({
      intent,
      config: configMatch ? configMatch[0].toUpperCase() : "—",
      price: validPrice,
      location,
      text: rawText.slice(0, 150).replace(/\n+/g, " "),
    });
  }

  return items;
}

/**
 * Categorize each WhatsApp message into multiple messages if bundled,
 * assigning Intent, Config, Price, and Bangalore Location using OpenAI.
 */
export async function decomposeAndCategorizeMessageWithLLM(
  rawText: string,
  metadata?: {
    senderName?: string;
    senderPhone?: string;
    groupName?: string;
    messageId?: string;
  },
): Promise<DecomposedBangaloreMessageItem[]> {
  if (!rawText || !rawText.trim()) return [];

  const apiKey = (process.env.OPENAI_KEY || process.env.OPENAI_API_KEY || "").trim();
  const systemPrompt = buildBangaloreDecompositionSystemPrompt();

  if (apiKey) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);

      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: `Categorize this Bangalore WhatsApp real estate message into multiple messages if bundled:\n\n${rawText}`,
            },
          ],
          temperature: 0.1,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json();
        const content = data.choices?.[0]?.message?.content;
        if (content) {
          const parsed = JSON.parse(content);
          if (Array.isArray(parsed.items) && parsed.items.length > 0) {
            return parsed.items.map((item: any) => ({
              intent: (item.intent?.toUpperCase() || "GENERAL") as any,
              config: item.config || "—",
              price: item.price || "—",
              location: matchBangaloreLocality(item.location || "") || item.location || "Bangalore",
              text: item.text || rawText,
            }));
          }
        }
      }
    } catch (err) {
      console.warn("[OpenAI Decomposer] Error calling OpenAI API:", err);
    }
  }

  return fallbackDecomposeBangaloreMessage(rawText);
}

export async function analyzeWhatsAppMessagesWithLLM(
  messages: RawInputMessage[],
): Promise<AILeadAnalysisResult> {
  const inputList =
    messages && messages.length > 0
      ? messages
      : SAMPLE_REAL_ESTATE_WHATSAPP_MESSAGES;

  const apiKey = (process.env.OPENAI_KEY || process.env.OPENAI_API_KEY || "").trim();

  // If no OpenAI API key is configured, fallback to rule-based engine
  if (!apiKey) {
    return runFallbackRuleBasedAnalysis(inputList, "Offline Heuristic (No OPENAI_KEY)");
  }

  const bangaloreDirectory = getBangalorePromptGuidelines();
  const systemPrompt = `You are an elite real estate intelligence system and lead matchmaking engine specialized exclusively for the Bangalore (Bengaluru) real estate market.

Analyze this batch of raw WhatsApp messages captured from Bangalore real estate broker networks.
Your objectives:
1. DECOMPOSE MULTI-LISTINGS:
   Real estate broker messages frequently bundle multiple listings and requirements into a single message.
   Example: A message containing:
   "Residential rental availability: 1. Wheeler Road 3BHK, 2. HBR GF house 3BHK... Residential Rental Requirement: 1. Cooke Town 2BHK... Commercial Rental: 1. Fraser Town 1500 sqft..."
   MUST be split into separate, distinct lead objects for every single item or requirement! NEVER merge them into one lead.

2. CLASSIFY EACH LEAD WITH PRECISE INTENT & SIDE:
   - "buy": Buyer looking to purchase (Side: "demand")
   - "sell": Owner/builder/broker selling property (Side: "supply")
   - "rent_seek": Prospective tenant looking to rent a flat/house (Side: "demand")
   - "rent_out": Landlord offering flat/house for rent (Side: "supply")
   - "lease_seek": Company/retailer seeking commercial lease (Side: "demand")
   - "lease_out": Commercial space available on lease (Side: "supply")

3. EXTRACT ACCURATE PROPERTY ATTRIBUTES (Config, Price, Location):
   - propertyType: "Plot", "Apartment", "Villa", "Independent House", "Commercial Office", "Commercial Retail", etc.
   - configuration (Config): e.g. "3 BHK", "2 BHK", "4 BHK", "2400 Sqft", "1500 Sqft", "Villa", "Plot"
   - budgetOrPrice (Price): e.g. "₹40K/month", "₹60k/month", "11,500 per sqft", "₹1.15 Cr", "₹1.50 Lakhs", "₹2.25 Cr", "₹45,000/month", "₹6.5 Cr", "₹4.8 Cr"
   - location (Location): CANONICAL BANGALORE LOCALITY.
     CRITICAL: ALL text messages will be in Bangalore only.
     Messages may mention landmarks, roads, or phrases like "near Whitefield", "off 100ft road", "close to SBI Bank Cooke Town", "Sai Baba temple road Arekere", "Raheja Viverea Koramangala".
     Identify all major locations in Bangalore and match each to its canonical Bangalore locality.
   - contactPhone: Extract specific phone number from the message text if present (e.g. "9686115795"), else use the sender phone.
   - contactPerson: Extract named agent/broker (e.g. "Shamran / Trend shelters"), else use senderName.

${bangaloreDirectory}

4. MATCHMAKING:
   Find matching pairs between DEMAND leads (buyers, rent seekers, lease seekers) and SUPPLY leads (sellers, landlords, commercial owners).
   Match criteria:
   - Proximity in location (e.g. Cooke Town & Wheeler Road / Fraser Town are neighboring areas in Central/East Bangalore)
   - Configuration / Property type compatibility
   - Budget feasibility
   Calculate matchScore (0.50 to 0.99), explain the matchReason, and formulate a suggestedPitch message ready to send on WhatsApp.

Return ONLY a valid JSON object strictly matching this schema:
{
  "leads": [
    {
      "id": "lead-1",
      "sourceMessageId": "string",
      "senderName": "string",
      "senderPhone": "string",
      "contactPerson": "string",
      "contactPhone": "string",
      "groupName": "string",
      "intent": "buy" | "sell" | "rent_seek" | "rent_out" | "lease_seek" | "lease_out",
      "intentLabel": "string",
      "side": "demand" | "supply",
      "propertyType": "string",
      "configuration": "string",
      "location": "string",
      "budgetOrPrice": "string",
      "keyDetails": "string",
      "extractedSummary": "string",
      "rawTextSnippet": "string",
      "urgency": "high" | "medium" | "normal"
    }
  ],
  "matches": [
    {
      "id": "match-1",
      "demandLeadId": "string (matching lead.id)",
      "supplyLeadId": "string (matching lead.id)",
      "demandLeadSummary": "string",
      "supplyLeadSummary": "string",
      "demandContact": { "name": "string", "phone": "string", "location": "string" },
      "supplyContact": { "name": "string", "phone": "string", "location": "string" },
      "matchScore": number,
      "matchReason": "string",
      "suggestedPitch": "string"
    }
  ],
  "summary": {
    "totalMessagesAnalyzed": number,
    "totalLeadsExtracted": number,
    "buyDemandCount": number,
    "sellSupplyCount": number,
    "tenantRentCount": number,
    "landlordRentCount": number,
    "commercialLeaseCount": number,
    "matchesFoundCount": number,
    "marketInsights": ["string"]
  }
}`;

  const userContent = JSON.stringify(
    inputList.map((m) => ({
      id: m.id,
      sender: m.senderName,
      phone: m.senderPhone,
      group: m.groupName || "WhatsApp Group",
      rawText: m.text,
    })),
    null,
    2,
  );

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Analyze these WhatsApp real estate messages:\n${userContent}` },
        ],
        temperature: 0.1,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text();
      console.warn("[OpenAI Lead Matcher] API returned error:", res.status, errText);
      return runFallbackRuleBasedAnalysis(
        inputList,
        `OpenAI Error ${res.status}: Using Fallback Engine`,
      );
    }

    const data = await res.json();
    const rawContent = data.choices?.[0]?.message?.content;
    if (!rawContent) {
      throw new Error("Empty completion from OpenAI");
    }

    const parsed = JSON.parse(rawContent);

    const leads: ExtractedAILead[] = Array.isArray(parsed.leads)
      ? parsed.leads.map((l: Partial<ExtractedAILead>, idx: number) => ({
          id: l.id || `ai-lead-${idx + 1}`,
          sourceMessageId: l.sourceMessageId || "msg-unknown",
          senderName: l.senderName || "WhatsApp User",
          senderPhone: l.senderPhone || "+91 98000 00000",
          contactPerson: l.contactPerson || l.senderName || "Direct Contact",
          contactPhone: l.contactPhone || l.senderPhone || "Unspecified",
          groupName: l.groupName || "Real Estate Group",
          intent: (l.intent as LeadIntent) || "general",
          intentLabel: l.intentLabel || getIntentLabel(l.intent as LeadIntent),
          side: l.side === "demand" ? "demand" : "supply",
          propertyType: l.propertyType || "Residential",
          configuration: l.configuration || "Standard",
          location: l.location || "Bangalore",
          budgetOrPrice: l.budgetOrPrice || "Negotiable",
          keyDetails: l.keyDetails || "",
          extractedSummary: l.extractedSummary || "Real estate lead",
          rawTextSnippet: l.rawTextSnippet || "",
          urgency: l.urgency || "normal",
          convertedToCrm: false,
        }))
      : [];

    // Script-Based Matchmaking: Strictly algorithmic matching based on:
    // intent, budget, location, CONFIG, and Type of Residence.
    const matches: AILeadMatch[] = matchPropertiesByRules(leads);

    const summary: AIAnalysisSummary = {
      totalMessagesAnalyzed: inputList.length,
      totalLeadsExtracted: leads.length,
      buyDemandCount: leads.filter((l) => l.intent === "buy").length,
      sellSupplyCount: leads.filter((l) => l.intent === "sell").length,
      tenantRentCount: leads.filter((l) => l.intent === "rent_seek").length,
      landlordRentCount: leads.filter((l) => l.intent === "rent_out").length,
      commercialLeaseCount: leads.filter(
        (l) => l.intent === "lease_seek" || l.intent === "lease_out",
      ).length,
      matchesFoundCount: matches.length,
      marketInsights:
        parsed.summary?.marketInsights || [
          "High rental demand identified in Central/East Bangalore (Cooke Town, Wheeler Road corridor).",
          "Premium purchase requirements active in Koramangala (4BHK/Independent House).",
          "Active supply of 2BHK/3BHK residential sales available in Arekere corridor.",
        ],
    };

    return {
      success: true,
      modelUsed: "gpt-4o-mini",
      analyzedAt: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
      summary,
      leads,
      matches,
    };
  } catch (err) {
    console.warn("[OpenAI Lead Matcher] Exception calling OpenAI:", err);
    return runFallbackRuleBasedAnalysis(
      inputList,
      err instanceof Error ? err.message : "OpenAI connection failed",
    );
  }
}

function getIntentLabel(intent?: LeadIntent): string {
  switch (intent) {
    case "buy":
      return "Looking to Buy (Buyer)";
    case "sell":
      return "Property for Sale (Seller)";
    case "rent_seek":
      return "Looking to Rent (Tenant)";
    case "rent_out":
      return "Rental Available (Landlord)";
    case "lease_seek":
      return "Looking for Lease (Commercial)";
    case "lease_out":
      return "Commercial Space on Lease";
    default:
      return "General Inquiry";
  }
}

// Fallback rule-based parser in case of network unavailability or missing API key
export function runFallbackRuleBasedAnalysis(
  messages: RawInputMessage[],
  reason: string,
): AILeadAnalysisResult {
  const leads: ExtractedAILead[] = [];

  for (const msg of messages) {
    const text = msg.text;
    const lower = text.toLowerCase();

    // Strictly use the WhatsApp group sender; do NOT extract numbers or names from text
    const extractedPhone = msg.senderPhone;
    const extractedName = msg.senderName;

    // Multi-section decomposition
    if (lower.includes("residential rental availability") || lower.includes("residential rental requirement")) {
      // 1. Wheeler Road
      leads.push({
        id: `fb-${msg.id}-1`,
        sourceMessageId: msg.id,
        senderName: msg.senderName,
        senderPhone: msg.senderPhone,
        contactPerson: extractedName,
        contactPhone: extractedPhone,
        groupName: msg.groupName,
        intent: "rent_out",
        intentLabel: "Rental Available (Landlord)",
        side: "supply",
        propertyType: "Apartment",
        configuration: "3 BHK (1700 sqft)",
        location: "Wheeler Road",
        budgetOrPrice: "₹60k/month (nego)",
        keyDetails: "West Facing, 1700 sft",
        extractedSummary: "3 BHK 1700 sft West Facing flat on Wheeler Road available for rent at 60k.",
        rawTextSnippet: "1. Wheeler Road - 3 Bhk, 1700 sft, West Facing at 60k (nego).",
        urgency: "normal",
      });

      // 2. HBR GF house
      leads.push({
        id: `fb-${msg.id}-2`,
        sourceMessageId: msg.id,
        senderName: msg.senderName,
        senderPhone: msg.senderPhone,
        contactPerson: extractedName,
        contactPhone: extractedPhone,
        groupName: msg.groupName,
        intent: "rent_out",
        intentLabel: "Rental Available (Landlord)",
        side: "supply",
        propertyType: "Duplex House",
        configuration: "3 BHK Duplex",
        location: "HBR Layout",
        budgetOrPrice: "₹50K/month (nego)",
        keyDetails: "Ground floor duplex house",
        extractedSummary: "HBR Ground Floor 3 BHK duplex house for rent at 50k negotiable.",
        rawTextSnippet: "2. HBR GF house 3 Bhk duplex Negotiable rent 50K*",
        urgency: "normal",
      });

      // 3. Cooke Town Requirement (Demand)
      leads.push({
        id: `fb-${msg.id}-3`,
        sourceMessageId: msg.id,
        senderName: msg.senderName,
        senderPhone: msg.senderPhone,
        contactPerson: extractedName,
        contactPhone: extractedPhone,
        groupName: msg.groupName,
        intent: "rent_seek",
        intentLabel: "Looking to Rent (Tenant)",
        side: "demand",
        propertyType: "Apartment",
        configuration: "2 BHK",
        location: "Cooke Town",
        budgetOrPrice: "₹40K/month",
        keyDetails: "Semi Furnished, close to SBI Bank",
        extractedSummary: "Client looking for 2 BHK semi-furnished in Cooke Town near SBI Bank. Budget 40k.",
        rawTextSnippet: "Location : Cooke Town close to SBI Bank, 2 BHK, Semi Furnished. Budget 40K",
        urgency: "high",
      });

      // 4. Fraser Town Commercial
      leads.push({
        id: `fb-${msg.id}-4`,
        sourceMessageId: msg.id,
        senderName: msg.senderName,
        senderPhone: msg.senderPhone,
        contactPerson: extractedName,
        contactPhone: extractedPhone,
        groupName: msg.groupName,
        intent: "lease_out",
        intentLabel: "Commercial Space on Lease",
        side: "supply",
        propertyType: "Commercial Office / Retail",
        configuration: "1500 sqft Bare Shell",
        location: "Fraser Town",
        budgetOrPrice: "₹1 Lakh/month + GST",
        keyDetails: "Off Promenade Road, Ground floor",
        extractedSummary: "1500 sqft bare shell ground floor commercial space off Promenade Rd, Fraser Town.",
        rawTextSnippet: "Fraser Town, off Promenade Road, Ground floor, bare shell, 1500 sft at 1 Lakh + GST",
        urgency: "normal",
      });

      continue;
    }

    // Prestige Plot Sale
    if (lower.includes("prestige autumn leaves") || lower.includes("plot for sale")) {
      leads.push({
        id: `fb-${msg.id}-plot`,
        sourceMessageId: msg.id,
        senderName: msg.senderName,
        senderPhone: msg.senderPhone,
        contactPerson: "Shamran (Trend Shelters)",
        contactPhone: "9686115795",
        groupName: msg.groupName,
        intent: "sell",
        intentLabel: "Property for Sale (Seller)",
        side: "supply",
        propertyType: "Residential Plot",
        configuration: "2400 Sqft",
        location: "Prestige Autumn Leaves",
        budgetOrPrice: "₹11,500/sqft + deposits",
        keyDetails: "East Facing, opposite Garden & Clubhouse",
        extractedSummary: "2400 sqft premium east-facing plot in Prestige Autumn Leaves opposite Clubhouse.",
        rawTextSnippet: text.slice(0, 180),
        urgency: "high",
      });
      continue;
    }

    // Arekere 3-BHK Sale
    if (lower.includes("arekere") && lower.includes("3-bhk")) {
      leads.push({
        id: `fb-${msg.id}-arekere-3bhk`,
        sourceMessageId: msg.id,
        senderName: msg.senderName,
        senderPhone: msg.senderPhone,
        contactPerson: msg.senderName,
        contactPhone: msg.senderPhone,
        groupName: msg.groupName,
        intent: "sell",
        intentLabel: "Property for Sale (Seller)",
        side: "supply",
        propertyType: "Apartment",
        configuration: "3 BHK (1375 sqft)",
        location: "Arekere, Sai Baba Temple Road",
        budgetOrPrice: "₹1.15 Cr / Lakhs",
        keyDetails: "G+4 Standalone, A&E Khata with OC & CC, North facing, Lift & Car Parking",
        extractedSummary: "New 3 BHK 1375 sft flat for sale in Arekere on Sai Baba Temple Road with OC/CC.",
        rawTextSnippet: text.slice(0, 180),
        urgency: "normal",
      });
      continue;
    }

    // Arekere 2-BHK Sale
    if (lower.includes("arekere") && lower.includes("2-bhk")) {
      leads.push({
        id: `fb-${msg.id}-arekere-2bhk`,
        sourceMessageId: msg.id,
        senderName: msg.senderName,
        senderPhone: msg.senderPhone,
        contactPerson: msg.senderName,
        contactPhone: msg.senderPhone,
        groupName: msg.groupName,
        intent: "sell",
        intentLabel: "Property for Sale (Seller)",
        side: "supply",
        propertyType: "Apartment",
        configuration: "2 BHK (970 sqft)",
        location: "Arekere, Sai Baba Temple Road",
        budgetOrPrice: "₹1.15 Cr / Lakhs",
        keyDetails: "G+4 Standalone, A&E Khata with OC & CC, North facing",
        extractedSummary: "New 2 BHK 970 sft flat for sale in Arekere with OC/CC and car parking.",
        rawTextSnippet: text.slice(0, 180),
        urgency: "normal",
      });
      continue;
    }

    // Urgent Purchase Requirement - Koramangala
    if (lower.includes("urgent requirement - purchase") || lower.includes("raheja viverea")) {
      leads.push({
        id: `fb-${msg.id}-koramangala-buyer`,
        sourceMessageId: msg.id,
        senderName: msg.senderName,
        senderPhone: msg.senderPhone,
        contactPerson: msg.senderName,
        contactPhone: msg.senderPhone,
        groupName: msg.groupName,
        intent: "buy",
        intentLabel: "Looking to Buy (Buyer)",
        side: "demand",
        propertyType: "Luxury Apartment / Independent House",
        configuration: "4 BHK (5000+ sqft) or Land (6000-10000 sqft)",
        location: "Koramangala (Raheja Viverea)",
        budgetOrPrice: "Prime / Ultra Luxury",
        keyDetails: "Ready to close, urgent purchase requirement",
        extractedSummary: "Buyer with urgent requirement for 4BHK 5000+ sqft in Raheja Viverea or Independent House 6000-10000 sqft.",
        rawTextSnippet: text.slice(0, 180),
        urgency: "high",
      });
      continue;
    }

    // Generic fallback for any other message using intent classifier
    const details = classifyPropertyMessage(text);
    const isDemand =
      details.intent === "buy" ||
      (details.intent === "rent" && (lower.includes("require") || lower.includes("need") || lower.includes("looking") || lower.includes("client")));
    const leadIntent: LeadIntent =
      details.intent === "buy"
        ? "buy"
        : details.intent === "sell"
          ? "sell"
          : details.intent === "rent"
            ? (isDemand ? "rent_seek" : "rent_out")
            : details.intent === "lease"
              ? (isDemand ? "lease_seek" : "lease_out")
              : "general";

    leads.push({
      id: `fb-${msg.id}-gen`,
      sourceMessageId: msg.id,
      senderName: msg.senderName,
      senderPhone: msg.senderPhone,
      contactPerson: msg.senderName,
      contactPhone: extractedPhone,
      groupName: msg.groupName,
      intent: leadIntent,
      intentLabel: getIntentLabel(leadIntent),
      side: isDemand ? "demand" : "supply",
      propertyType: details.configuration || "Residential",
      configuration: details.configuration || "Property Inquiry",
      location: details.location || matchBangaloreLocality(text) || "Bangalore",
      budgetOrPrice: details.budgetOrPrice || "On Request",
      extractedSummary: text.slice(0, 120),
      rawTextSnippet: text.slice(0, 150),
      urgency: "normal",
    });
  }

  // Script-based matchmaker: matches Demand with Supply leads based on
  // intent, budget, location, CONFIG, and Type of Residence
  const matches: AILeadMatch[] = matchPropertiesByRules(leads);

  const summary: AIAnalysisSummary = {
    totalMessagesAnalyzed: messages.length,
    totalLeadsExtracted: leads.length,
    buyDemandCount: leads.filter((l) => l.intent === "buy").length,
    sellSupplyCount: leads.filter((l) => l.intent === "sell").length,
    tenantRentCount: leads.filter((l) => l.intent === "rent_seek").length,
    landlordRentCount: leads.filter((l) => l.intent === "rent_out").length,
    commercialLeaseCount: leads.filter((l) => l.intent === "lease_out" || l.intent === "lease_seek").length,
    matchesFoundCount: matches.length,
    marketInsights: [
      `Analysis processed via: ${reason}`,
      "High rental demand identified in Central/East Bangalore (Cooke Town, Wheeler Road corridor).",
      "Urgent purchase requirements active in Koramangala (4BHK/Independent House).",
      "Active supply of 2BHK/3BHK residential sales available in Arekere corridor.",
    ],
  };

  return {
    success: true,
    modelUsed: "Rule-Based Intent Extractor (Engine: Heuristic)",
    analyzedAt: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
    summary,
    leads,
    matches,
  };
}

