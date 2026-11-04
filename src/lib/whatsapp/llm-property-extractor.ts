import fs from "fs";
import path from "path";
import { matchBangaloreLocality } from "./bangalore-locations";
import { sanitizeRupeeAmount } from "./intent-classifier";

export type BrokerDealIntent = "AR" | "AS" | "WR" | "WB";
export type BrokerPropertyType = "A" | "V" | "H" | "L" | "O" | "C" | "B";

export interface ExtractedPropertyListing {
  code: string; // e.g. "ARA", "WBA", "ASL"
  intent: BrokerDealIntent;
  property_type: BrokerPropertyType;
  type_assumed?: boolean;
  deal_type?: "standard" | "JD" | "JV";
  bhk_min?: number | null;
  bhk_max?: number | null;
  built_up_sqft_min?: number | null;
  built_up_sqft_max?: number | null;
  land_sqft_min?: number | null;
  land_sqft_max?: number | null;
  size_display?: string | null;
  size_strict?: boolean;
  price_basis?: "per_month" | "total" | "per_sqft" | "per_acre" | "none";
  price_min?: number | null;
  price_max?: number | null;
  price_rate?: number | null;
  price_flag?: "ok" | "missing" | "unclear";
  price_note?: string | null;
  city?: string;
  localities?: string[];
  streets?: string[];
  nearby?: string[];
  locality_strict?: boolean;
  project_name?: string | null;
  project_strict?: boolean;
  land_use?:
    | "residential"
    | "commercial"
    | "agricultural"
    | "industrial"
    | "mixed"
    | "unknown"
    | "not_applicable";
  road_width_ft?: number | null;
  main_road?: boolean | null;
  purpose_or_use?: string[];
  urgency?: "high" | "normal";
  deadline?: string | null;
  contact_name?: string | null;
  contact_numbers?: string[];
  confidence?: "high" | "medium" | "low";
  option_group?: string | null;
  raw_text?: string;
}

export interface ExtractedMessageResponse {
  message_type: "listings" | "ignore";
  listings: ExtractedPropertyListing[];
}

export interface RawInputMessage {
  id: string;
  senderName: string;
  senderPhone: string;
  groupName?: string;
  groupId?: string;
  text: string;
  timestamp?: number;
}

export { isWhatsAppLid } from "./intent-classifier";

// Regex list to test if a message is potentially related to real estate properties
export const PROPERTY_KEYWORDS = [
  /\b[1-6]\s*bhk\b/i,
  /\b[1-6]\s*rk\b/i,
  /\bavailab/i,
  /₹/,
  /\brs\.?\s*\d/i,
  /\binr\b/i,
  /\b(?:price|budget|demand|cost)\b/i,
  /\b\d+\s*(?:k|lac|lacs|lakh|lakhs|cr|crore|crores)\b/i,
  /\bsell\b/i,
  /\bsale\b/i,
  /\bresale\b/i,
  /\brent\b/i,
  /\brental\b/i,
  /\blease\b/i,
  /\bto\s*let\b/i,
  /\bbuy\b/i,
  /\bbuyer\b/i,
  /\bpurchase\b/i,
  /\brequire\b/i,
  /\brequirement\b/i,
  /\blooking\s*for\b/i,
  /\bneeded?\b/i,
  /\bclient\s*(?:wants|requires|needs)\b/i,
  /\bflat\b/i,
  /\bflats\b/i,
  /\bapartment\b/i,
  /\bapartments\b/i,
  /\bvilla\b/i,
  /\bvillas\b/i,
  /\bplot\b/i,
  /\bplots\b/i,
  /\bsite\b/i,
  /\bsites\b/i,
  /\bland\b/i,
  /\bacres?\b/i,
  /\bguntas?\b/i,
  /\bcent\b/i,
  /\bsq\.?\s*ft\b/i,
  /\bsft\b/i,
  /\bsqft\b/i,
  /\bsquare\s*feet\b/i,
  /\boffice\b/i,
  /\bcommercial\b/i,
  /\bshowroom\b/i,
  /\bshop\b/i,
  /\bwarehouse\b/i,
  /\bbare\s*shell\b/i,
  /\bwarm\s*shell\b/i,
  /\bworkstations?\b/i,
  /\bhouse\b/i,
  /\bduplex\b/i,
  /\bbungalow\b/i,
  /\bbuilding\b/i,
  /\bjd\b/i,
  /\bjv\b/i,
  /\bjoint\s*development\b/i,
  /\bkhata\b/i,
  /\bfurnished\b/i,
  /\bfacing\b/i,
];

/**
 * Filter messages: returns true if message contains property keywords (bhk, available, rupee symbol, sell, rent, land, etc.)
 */
export function isPotentialPropertyMessage(text: string): boolean {
  if (!text || !text.trim()) return false;
  return PROPERTY_KEYWORDS.some((rx) => rx.test(text));
}

export const BROKER_EXTRACTOR_SYSTEM_PROMPT = `# ROLE

You are a real estate data extractor for a Bangalore property broker. The broker sits in many WhatsApp groups where sub brokers post what their clients have (supply) and what their clients want (demand). You read ONE WhatsApp message at a time and turn every property listing or requirement inside it into a structured record. A Python script later uses these records to remove duplicates and match demand against supply, so accuracy and consistency matter more than anything else.

You never invent facts. If something is not in the message, leave it null (or an empty list). A missing value is fine. A wrong value causes a bad match.

# INPUT

Each user turn looks like this:

\`\`\`
message_id: <id>
sent_at: <ISO date-time, IST>
group: <WhatsApp group name, or "Direct message">
text:
"""
<the raw message>
"""
\`\`\`

# OUTPUT

Return JSON that follows the provided schema exactly:

- \`message_type\`: "listings" if the message has at least one property listing or requirement, otherwise "ignore".
- \`listings\`: one object per listing or requirement. Empty list when \`message_type\` is "ignore".

# STEP 1: IGNORE OR NOT

Set \`message_type: "ignore"\` for greetings, festival wishes, jokes, "deal closed" posts, "call me", "please share", forwarded news, loan or insurance ads, polls, and anything that has no specific property supply or demand.

# STEP 2: SPLIT INTO LISTINGS

One message often contains many listings. Create a separate record for EACH one.

- Numbered or bulleted items are separate listings. Broker numbering often skips numbers. Ignore the numbering.
- Section headers apply to every item under them until the next header. Example: under "Residential Rental Requirement", every item is WR even if the item itself never says "wanted".
- One shared contact at the end of the message applies to every listing in it.
- "OR" alternatives for the same client (for example "4 BHK in Raheja Vivarea OR an independent house with 6000 to 10000 sqft land") become separate records that share the same \`option_group\` value. Use \`"<message_id>-g1"\`, \`"<message_id>-g2"\` and so on. Records that are not alternatives get \`option_group: null\`.
- A line listing several places with no separate details ("Indiranagar, 3 options: off 100 Ft Road, off CMH Road, Krishna Temple Road") is ONE record with all places in \`streets\`, and \`confidence: "low"\` if size and price are missing.
- "2 BHK and 3 BHK available" with different sizes or prices is two records.

# STEP 3: INTENT (first two letters of the code)

| Intent | Meaning | Typical words |
|---|---|---|
| AR | Available for rent or lease | "available for rent", "to let", "rental availability", "for lease" |
| AS | Available for sale (including JD / JV offers by landowners) | "for sale", "available", "selling price", "new flats" |
| WR | Wants to rent or lease | "rental requirement", "looking for rent", "client wants on rent" |
| WB | Wants to buy | "requirement", "required", "require", "need", "looking for", "purchase", "buyer" |

Rules:
- "Requirement", "required", "need", "looking for" on their own mean DEMAND. Decide rent vs buy from words like rent, lease, budget per month (WR) or purchase, buy, registration, budget in crores (WB).
- "Available", "for sale", "inventory", "options" on their own mean SUPPLY.
- If the message gives no clue between rent and sale, use the price: a monthly figure means rent, a crore or per-sqft or per-acre figure means sale.

# STEP 4: PROPERTY TYPE (last letter of the code)

| Letter | Type | Examples |
|---|---|---|
| A | Apartment / flat | "flat", "apartment", "3 BHK in <project>" |
| V | Villa / row house | "villa", "row house" |
| H | Independent house / builder floor / plot with a house | "independent house", "GF house", "duplex house", "plot with 5 BHK house", "bungalow" |
| L | Land / plot (no house worth counting) | "site", "plot", "land", "acres", "guntas", "40x60 plot" |
| O | Office space | "office space", "IT space" |
| C | Any other commercial space, or commercial where the kind is not clear | "commercial space", "bare shell", "shop", "showroom", "warehouse", a need that mixes office with kitchen or production use |
| B | Whole building | "entire building", "tenanted building", "PG building", "commercial building" |

Rules:
- \`code\` = intent + letter, for example "ARA", "WBL", "ASH".
- A residential unit with a BHK count and no type word: use A and set \`type_assumed: true\`.
- For land, the code stays L. Put the use in \`land_use\`.

# STEP 5: DEAL TYPE

- \`"standard"\`: normal rent or sale.
- \`"JD"\`: joint development. \`"JV"\`: joint venture. Use these when the landowner wants a developer partner and not a buyer (words: JD, JV, joint development, joint venture, ratio, goodwill, sharing). The code stays AS + type (usually ASL).

# STEP 6: NUMBERS

## Money

- K or k = 1,000. L, Lakh, Lakhs, Lac, Lacs = 1,00,000. Cr, Crore, Crores = 1,00,00,000.
- Write all money as plain rupees (integers). "60k" = 60000. "1.50 Lakhs" = 150000. "9.10cr" = 91000000.
- \`price_basis\`:
  - \`"per_month"\` for rent (AR / WR). \`price_min\` / \`price_max\` are monthly rent.
  - \`"total"\` for a total sale price or total budget.
  - \`"per_sqft"\` when quoted per sqft. Put the rate in \`price_rate\`. If the size is known, also put the computed total (rate x size) in \`price_min\` / \`price_max\`.
  - \`"per_acre"\` when quoted per acre. Put the rate in \`price_rate\`. If acreage is known, put the computed total in \`price_min\` / \`price_max\` (use both ends of an acreage range).
  - \`"none"\` when there is no price at all.
- Supply with one price: \`price_min\` = \`price_max\` = that price.
- Demand with one budget ("Budget 40K", "Max budget 2 lakhs"): \`price_min: null\`, \`price_max\` = budget. A budget range fills both.
- "As per market", "best price" with no number: prices null, \`price_basis: "none"\`, \`price_flag: "missing"\`, and write the phrase in \`price_note\`.

## Price sanity check (important)

Brokers often write lakhs when they mean crores, or copy the same price under different units. After converting, check the price against the property:

- Sale of any flat, villa, house or land below ₹10 lakh total: impossible.
- Monthly rent above ₹50 lakh for a single home or below ₹3,000: suspicious.
- Two different-size units in the same message with the exact same price: suspicious.

If the price is impossible or suspicious, set \`price_flag: "unclear"\`, set \`price_min\`, \`price_max\` and \`price_rate\` to null, and write the original text plus your best reading in \`price_note\` (for example "written as 1.15-lakhs, probably ₹1.15 Cr, verify"). Never put a guessed number into the numeric fields.

Otherwise \`price_flag\` is "ok" (price given) or "missing" (no price). \`price_note\` is null unless one of the cases above applies.

## Size

Use these conversions. Do not use any other values.

| Unit | sqft |
|---|---|
| 1 sq yd | 9 |
| 1 sq m | 10.764 |
| 1 cent | 435.6 |
| 1 gunta | 1,089 |
| 1 acre | 43,560 (= 40 guntas) |

- "sft", "sq.ft", "sqft", "Sft" all mean square feet.
- Dimensions like "40x60" or "30 x 40" are feet. Multiply: 40x60 = 2400 sqft, 50x80 = 4000 sqft. Use metres only if the message says metres.
- Two size fields, never mixed:
  - \`built_up_sqft_min\` / \`built_up_sqft_max\`: floor area of a flat, house, office, commercial space or building.
  - \`land_sqft_min\` / \`land_sqft_max\`: plot or land area. For H (plot with house) fill land, and built-up too if given.
- Supply with one size: min = max. Demand "2000+" or "at least 2000": min 2000, max null. "Approx 2000": min = max = 2000. "40x60 or 50x80": min 2400, max 4000.
- \`size_strict: true\` when demand says "only", "strictly", "exactly". Otherwise false.
- \`size_display\`: the size as a person would say it, in the message's own unit ("5 to 8 acres", "40x60 plot", "1700 sqft"). Null if no size.
- \`bhk_min\` / \`bhk_max\`: numbers. "3 BHK" = 3 and 3. "2 or 3 BHK" = 2 and 3. "3.5 BHK" = 3.5. "1 RK" = 0.5.

# STEP 7: LOCATION

- \`city\`: "Bangalore" unless another city or district is named (for example "Chitradurga", "Mysore", "Hosur"). Places in Bangalore Urban and Bangalore Rural (Devanahalli, Nelamangala, Hoskote, Anekal, Bagalur) count as "Bangalore".
- \`localities\`: every locality named, as a list, with standard spelling. "Anywhere in Bangalore" = ["Any"]. For a corridor ("Bagalur to Airport Road", "Kathirguppe to Domsandra Road") add both ends. Standard spellings include: Fraser Town (not Frazer), Cox Town, Cooke Town, Benson Town, Richmond Town, Shanthinagar, Indiranagar, Ulsoor, MG Road, Koramangala, HSR Layout, HBR Layout, Sadashivanagar, Jayamahal, Arekere, Whitefield, Varthur, Gunjur, Sarjapur Road, Bagalur, Budigere, Devanahalli, Hennur, Yelahanka, Nelamangala.
- \`streets\`: roads and layouts within a named locality ("Promenade Road", "Spencer Road", "D'Costa Layout", "Sai Baba Temple Road", "100 Ft Road"). When a road is the only place named, put it in \`localities\` instead. Never add a locality the message does not name.
- \`nearby\`: places mentioned as distance or proximity ("Varthur" from "2 km from Varthur", "Airport" from "Airport back side").
- \`locality_strict: true\` when demand says "only" for a place or street. Otherwise false.
- \`project_name\`: the building, project or layout brand, with correct spelling ("Raheja Vivarea", "Prestige Autumn Leaves", "MSR North City"). Never fill a locality from your own knowledge of where a project is. If only the project is given, \`localities\` stays empty.
- \`project_strict: true\` when demand names a project as the requirement ("Project: Raheja Vivarea").
- Road acronyms are locations: STRR (Satellite Town Ring Road), PRR (Peripheral Ring Road), ORR (Outer Ring Road), NICE Road, Old Madras Road, Airport Road. CBD = Central Business District.

# STEP 8: MATCHING DETAILS

- \`land_use\`: for L and H records: "residential", "commercial", "agricultural", "industrial", "mixed" or "unknown". For other types: "not_applicable". Yellow zone means residential, Green zone means agricultural, both together means mixed.
- \`road_width_ft\`: supply = width of the road it faces. Demand = minimum width required. Null if not stated.
- \`main_road\`: supply = true if on a main road. Demand = true if main road is required ("compulsory main road"), false if "off main road is fine". Otherwise null.
- \`purpose_or_use\`: demand = what the buyer will use it for ("farmhouse", "apartment development", "investment"). Supply = what it is offered for or suits ("apartment development", "warehouse", "commercial"). JD and JV land always includes "development". A list, empty if not stated.
- \`urgency\`: "high" for urgent, immediate finalization, immediate registration, inspection on a set date. Otherwise "normal".
- \`deadline\`: a real date YYYY-MM-DD for things like "inspection tomorrow". Work it out from \`sent_at\`. Null if none.

# STEP 9: CONTACT

- \`contact_name\`: the person's name written in the message ("Shamran", "Dr. Narayana Prasad", "Mr. Sudhir"). If the message names nobody, use \`sender_name\`. If that is empty, only a number, or only emojis, use null.
- \`contact_numbers\`: used to recognise the same broker across groups. Every phone number in the message, digits only, without +91, 91 or a leading 0 for mobiles ("98450 76840" becomes "9845076840", "#9986653451" becomes "9986653451"). Keep landlines with their STD code ("08041234567"). Keep a number even if it looks wrong (too short or too long). If the message has no number, use the sender number, cleaned the same way.

# STEP 10: QUALITY

- \`type_assumed\`: true when you picked the property type without a clear word for it.
- \`confidence\`: "high" when intent, type, location and either size or price are clear. "medium" when one of those is missing or inferred. "low" when two or more are missing, or the record is a vague multi-option line.

# READING THE MESSAGES

- Emojis are decoration, but use them to understand what follows (📍 = location, 💰 = price, 📞 = contact, 🟢 / 🟡 = zone colours). Never copy emojis into fields.
- Typos, all caps and shorthand are normal ("CL ME" = call me, "COMPULSARI" = compulsory, "nego" = negotiable, "sft" = sqft). Read them the way a broker would.
- Do not use em dashes in any text field.
`;

const CACHE_FILE = path.join(process.cwd(), "auth", "llm_property_cache.json");

function loadLLMCache(): Record<string, ExtractedMessageResponse> {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    }
  } catch {}
  return {};
}

function saveLLMCache(cache: Record<string, ExtractedMessageResponse>) {
  try {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), "utf8");
  } catch {}
}

/**
 * Fallback rule-based extractor that outputs the exact same ExtractedMessageResponse structure.
 */
export function ruleBasedPropertyExtract(
  msg: RawInputMessage,
): ExtractedMessageResponse {
  const text = msg.text.trim();
  if (!isPotentialPropertyMessage(text)) {
    return { message_type: "ignore", listings: [] };
  }

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const numbered = lines.filter((l) => /^\s*\d+[\.\)]\s+/i.test(l));

  const listings: ExtractedPropertyListing[] = [];

  // Extract any contact phone numbers from text (e.g. Call: 9591292090 / 9845007923 or Cell no: 9686115795)
  const allPhoneMatches = Array.from(
    text.matchAll(/(?:call|contact|ph|wa|mobile|cell|mr\.?\s*\w+)?\s*[:\-]?\s*(\+?91[\s\-]?)?([6-9]\d{4}[\s\-]?\d{5})\b/gi),
  );
  const extractedNumbers: string[] = [];
  for (const m of allPhoneMatches) {
    const digits = m[0].replace(/[^0-9]/g, "").slice(-10);
    if (digits.length === 10 && !extractedNumbers.includes(digits)) {
      extractedNumbers.push(digits);
    }
  }

  // Only use phone numbers explicitly extracted from the message text; never treat random WhatsApp LIDs as phone numbers
  const defaultNumbers = extractedNumbers;

  if (numbered.length > 1) {
    let currentIntent: BrokerDealIntent = "AS";

    // Chunk lines into numbered items (grouping any sub-lines under each number)
    const itemChunks: string[] = [];
    let currentChunk = "";

    for (const line of lines) {
      const lower = line.toLowerCase();
      if (/^\s*\d+[\.\)]\s+/i.test(line)) {
        if (currentChunk) itemChunks.push(currentChunk);
        currentChunk = line;
      } else if (currentChunk) {
        currentChunk += ` ${line}`;
      } else {
        // Section headers before any numbered item
        if (lower.includes("rental availability") || lower.includes("available for rent")) {
          currentIntent = "AR";
        } else if (lower.includes("rental requirement") || lower.includes("wanted rent")) {
          currentIntent = "WR";
        } else if (lower.includes("commercial rental") || lower.includes("commercial lease")) {
          currentIntent = "AR";
        } else if (lower.includes("for sale") || lower.includes("resale")) {
          currentIntent = "AS";
        } else if (lower.includes("purchase") || lower.includes("buyer")) {
          currentIntent = "WB";
        }
      }
    }
    if (currentChunk) itemChunks.push(currentChunk);

    for (const itemText of itemChunks) {
      const lower = itemText.toLowerCase();

      // Line-specific intent override
      let itemIntent = currentIntent;
      let dealType: "standard" | "JD" | "JV" = "standard";

      if (lower.includes("jd proposal") || lower.includes("jd ")) {
        itemIntent = "AS";
        dealType = "JD";
      } else if (lower.includes("jv proposal") || lower.includes("jv ")) {
        itemIntent = "AS";
        dealType = "JV";
      } else if (lower.includes("require") || lower.includes("purchase") || lower.includes("need")) {
        itemIntent = "WB";
      } else if (lower.includes("for sale") || lower.includes("available for sale")) {
        itemIntent = "AS";
      } else if (lower.includes("on rent") || lower.includes("available at") || lower.includes("available on rent")) {
        itemIntent = "AR";
      }

      const bhkMatch = itemText.match(/\b([1-6])\s*bhk\b/i);
      const bhk = bhkMatch ? parseInt(bhkMatch[1], 10) : null;
      const sizeMatch = itemText.match(/\b(\d+)\s*(?:sft|sqft)\b/i);
      const sizeSqft = sizeMatch ? parseInt(sizeMatch[1], 10) : null;
      const acreMatch = itemText.match(/\b(\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?)\s*acres?\b/i);

      let sizeDisplay: string | null = null;
      if (acreMatch) sizeDisplay = `${acreMatch[1]} acres`;
      else if (sizeSqft) sizeDisplay = `${sizeSqft} sqft`;

      // Property type resolution
      let propType: BrokerPropertyType = "A";
      if (/\b(?:house|bungalow|duplex)\b/i.test(itemText)) {
        propType = "H";
      } else if (/\bvilla\b/i.test(itemText)) {
        propType = "V";
      } else if (/(?:\b|\d)(?:plot|site|land|acres?|guntas?)\b/i.test(itemText) || lower.includes("jd proposal") || lower.includes("jv proposal")) {
        propType = "L";
      } else if (/\b(?:office|it space)\b/i.test(itemText)) {
        propType = "O";
      } else if (/\b(?:commercial|warehouse|showroom|bare shell)\b/i.test(itemText)) {
        propType = "C";
      }

      const loc = matchBangaloreLocality(itemText) || "Bangalore";

      let priceBasis: "per_month" | "total" | "per_sqft" | "per_acre" | "none" = "none";
      let priceMin: number | null = null;
      let priceMax: number | null = null;
      let priceRate: number | null = null;

      // Rate per acre
      const perAcreMatch = itemText.match(
        /\b(?:rs\.?|inr|₹)?\s*(\d+(?:\.\d+)?)\s*(?:cr|crore)?\s*(?:per\s*acre|\/\s*acre)\b/i,
      );
      if (perAcreMatch) {
        priceBasis = "per_acre";
        priceRate = parseFloat(perAcreMatch[1]) * 10000000;
      } else {
        // Rate per sqft
        const perSqftMatch = itemText.match(
          /\b(\d{1,3}(?:,\d{2,3})*)\s*(?:per\s*sft|per\s*sqft|\/\s*sft|\/\s*sqft)\b/i,
        );
        if (perSqftMatch) {
          priceBasis = "per_sqft";
          priceRate = parseInt(perSqftMatch[1].replace(/,/g, ""), 10);
        } else {
          const priceMatch = itemText.match(
            /\b((?:₹|rs\.?)?\s*(\d+(?:\.\d+)?)\s*(?:cr|crore|lakhs?|lac|k\b))\b/i,
          );
          if (priceMatch) {
            const num = parseFloat(priceMatch[2]);
            const unit = priceMatch[0].toLowerCase();
            let inr = num;
            if (unit.includes("k")) inr = num * 1000;
            else if (unit.includes("lac") || unit.includes("lakh")) inr = num * 100000;
            else if (unit.includes("cr")) inr = num * 10000000;

            priceBasis = itemIntent === "AR" || itemIntent === "WR" ? "per_month" : "total";
            priceMin = inr;
            priceMax = inr;
          }
        }
      }

      listings.push({
        code: `${itemIntent}${propType}`,
        intent: itemIntent,
        property_type: propType,
        deal_type: dealType,
        type_assumed: !bhkMatch && propType === "A",
        bhk_min: bhk,
        bhk_max: bhk,
        built_up_sqft_min: sizeSqft,
        built_up_sqft_max: sizeSqft,
        size_display: sizeDisplay,
        price_basis: priceBasis,
        price_min: priceMin,
        price_max: priceMax,
        price_rate: priceRate,
        price_flag: priceMin || priceRate ? "ok" : "missing",
        city: "Bangalore",
        localities: [loc],
        contact_name: msg.senderName || null,
        contact_numbers: defaultNumbers,
        confidence: "high",
        raw_text: itemText,
      });
    }
  }

  // Handle single listing or OR-alternative message
  if (listings.length === 0) {
    const lower = text.toLowerCase();
    let intent: BrokerDealIntent = "AS";
    if (lower.includes("purchase") || lower.includes("requirement") || lower.includes("buyer")) {
      intent = "WB";
    } else if (lower.includes("rent requirement") || lower.includes("wants on rent")) {
      intent = "WR";
    } else if (lower.includes("rent") || lower.includes("to let") || lower.includes("lease")) {
      intent = "AR";
    }

    // Check for "OR" alternatives (e.g. 4BHK Apartment OR Independent House)
    const orSplit = text.split(/\bOR\b/i);
    if (orSplit.length > 1 && (lower.includes("apartment") || lower.includes("bhk")) && lower.includes("house")) {
      orSplit.forEach((branch, branchIdx) => {
        const bLower = branch.toLowerCase();
        const bBhkMatch = branch.match(/\b([1-6])\s*bhk\b/i);
        const isHouse = /\b(?:house|bungalow|duplex)\b/i.test(branch);
        const bPropType: BrokerPropertyType = isHouse ? "H" : "A";

        let bSize: string | null = null;
        const bSqftMatch = branch.match(/\b(\d+[\+]?(?:\s*to\s*\d+)?)\s*(?:sft|sqft)\b/i);
        if (bSqftMatch) bSize = `${bSqftMatch[1]} sqft`;

        const bLoc = matchBangaloreLocality(branch) || matchBangaloreLocality(text) || "Bangalore";
        const projMatch = text.match(/(?:project|building)?\s*:\s*([A-Za-z0-9\s]+?)(?:\n|,|\.|$)/i);

        listings.push({
          code: `${intent}${bPropType}`,
          intent,
          property_type: bPropType,
          bhk_min: bBhkMatch ? parseInt(bBhkMatch[1], 10) : null,
          bhk_max: bBhkMatch ? parseInt(bBhkMatch[1], 10) : null,
          size_display: bSize,
          price_basis: "none",
          price_note: lower.includes("market") ? "Market Rate" : undefined,
          city: "Bangalore",
          localities: [bLoc],
          project_name: projMatch ? projMatch[1].trim() : undefined,
          contact_name: msg.senderName || null,
          contact_numbers: defaultNumbers,
          confidence: "high",
          option_group: `${msg.id || "msg"}-g1`,
          raw_text: branch.trim(),
        });
      });
      return { message_type: "listings", listings };
    }

    let propType: BrokerPropertyType = "A";
    if (/\b(?:plot|site|land|acres?|guntas?)\b/i.test(text)) {
      propType = "L";
    } else if (/\bvilla\b/i.test(text)) {
      propType = "V";
    } else if (/\b(?:independent house|duplex|house|bungalow)\b/i.test(text)) {
      propType = "H";
    } else if (/\b(?:office|it space)\b/i.test(text)) {
      propType = "O";
    } else if (/\b(?:commercial|showroom|shop|warehouse)\b/i.test(text)) {
      propType = "C";
    }

    const bhkRangeMatch = text.match(/\b([1-6])(?:\s*\/\s*|\s*-\s*)([1-6])\s*bhk\b/i);
    const bhkSingleMatch = text.match(/\b([1-6])\s*bhk\b/i);
    const bhkMin = bhkRangeMatch ? parseInt(bhkRangeMatch[1], 10) : bhkSingleMatch ? parseInt(bhkSingleMatch[1], 10) : null;
    const bhkMax = bhkRangeMatch ? parseInt(bhkRangeMatch[2], 10) : bhkSingleMatch ? parseInt(bhkSingleMatch[1], 10) : null;

    let sizeDisplay: string | null = null;
    const acreMatch = text.match(/\b(\d+(?:\.\d+)?(?:\s*to\s*\d+(?:\.\d+)?)?)\s*acres?\b/i);
    const sqftMatch = text.match(/\b(\d{1,3}(?:,\d{3})*|\d+)\s*(?:sft|sqft|sq\.?\s*ft)\b/i);
    const guntaMatch = text.match(/\b(\d+)\s*guntas?\b/i);
    if (acreMatch) sizeDisplay = `${acreMatch[1]} acres`;
    else if (sqftMatch) sizeDisplay = `${sqftMatch[1]} sqft${guntaMatch ? ` (${guntaMatch[1]} Guntas)` : ""}`;
    else if (guntaMatch) sizeDisplay = `${guntaMatch[1]} Guntas`;

    const loc = matchBangaloreLocality(text) || "Bangalore";

    let priceBasis: "per_month" | "total" | "per_sqft" | "per_acre" | "none" = "none";
    let priceMin: number | null = null;
    let priceMax: number | null = null;
    let priceRate: number | null = null;

    // Rate per acre (e.g. Budget Rs. 7.5 cr per acre)
    const perAcreMatch = text.match(
      /\b(?:rs\.?|inr|₹)?\s*(\d+(?:\.\d+)?)\s*(?:cr|crore)?\s*(?:per\s*acre|\/\s*acre)\b/i,
    );
    if (perAcreMatch) {
      priceBasis = "per_acre";
      priceRate = parseFloat(perAcreMatch[1]) * 10000000;
    } else {
      const perSqftMatch = text.match(
        /\b(\d{1,3}(?:,\d{2,3})*|\d+)\s*(?:per\s*sft|per\s*sqft|\/\s*sft|\/\s*sqft)\b/i,
      );
      if (perSqftMatch) {
        priceBasis = "per_sqft";
        priceRate = parseInt(perSqftMatch[1].replace(/,/g, ""), 10);
      } else {
        const priceMatch = text.match(
          /\b((?:₹|rs\.?)?\s*(\d+(?:\.\d+)?)\s*(?:cr|crore|lakhs?|lac|k\b))\b/i,
        );
        if (priceMatch) {
          const num = parseFloat(priceMatch[2]);
          const unit = priceMatch[0].toLowerCase();
          let inr = num;
          if (unit.includes("k")) inr = num * 1000;
          else if (unit.includes("lac") || unit.includes("lakh")) inr = num * 100000;
          else if (unit.includes("cr")) inr = num * 10000000;

          priceBasis = intent === "AR" || intent === "WR" ? "per_month" : "total";
          priceMin = inr;
          priceMax = inr;
        }
      }
    }

    const projMatch = text.match(/(?:project|building|flats)?\s*:\s*([A-Za-z0-9\s]+?)(?:\n|,|\.|$)/i);

    listings.push({
      code: `${intent}${propType}`,
      intent,
      property_type: propType,
      type_assumed: propType === "A" && !text.toLowerCase().includes("flat"),
      bhk_min: bhkMin,
      bhk_max: bhkMax,
      size_display: sizeDisplay,
      price_basis: priceBasis,
      price_min: priceMin,
      price_max: priceMax,
      price_rate: priceRate,
      price_flag: priceMin || priceRate ? "ok" : "missing",
      city: "Bangalore",
      localities: [loc],
      project_name: projMatch ? projMatch[1].trim() : undefined,
      contact_name: msg.senderName || null,
      contact_numbers: defaultNumbers,
      confidence: "high",
      raw_text: text,
    });
  }

  return {
    message_type: listings.length > 0 ? "listings" : "ignore",
    listings,
  };
}

/**
 * Extracts property listings from a WhatsApp message using OpenAI (OPENAI_KEY).
 * Caches responses to disk so each message is processed only once.
 */
export async function extractPropertyListingsWithLLM(
  msg: RawInputMessage,
): Promise<ExtractedPropertyListing[]> {
  const text = msg.text.trim();
  if (!text) return [];

  // Step 0: Pre-filter check: is this potentially related to properties?
  if (!isPotentialPropertyMessage(text)) {
    return [];
  }

  const cache = loadLLMCache();
  const cacheKey = `${msg.id || "msg"}-${text.slice(0, 100).replace(/\s+/g, "_")}`;

  if (cache[cacheKey]) {
    const cached = cache[cacheKey];
    if (cached.message_type === "ignore") return [];
    return cached.listings || [];
  }

  const apiKey = (process.env.OPENAI_KEY || process.env.OPENAI_API_KEY || "").trim();

  const userTurn = `message_id: ${msg.id}
sent_at: ${new Date(msg.timestamp || Date.now()).toISOString()}
group: ${msg.groupName || "Group for whatsapp testing"}
text:
"""
${text}
"""`;

  if (apiKey) {
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
            { role: "system", content: BROKER_EXTRACTOR_SYSTEM_PROMPT },
            { role: "user", content: userTurn },
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
          const parsed = JSON.parse(content) as ExtractedMessageResponse;
          cache[cacheKey] = parsed;
          saveLLMCache(cache);

          if (parsed.message_type === "ignore") {
            return [];
          }
          return parsed.listings || [];
        }
      } else {
        console.warn("[OpenAI Broker Extractor] API error:", res.status, await res.text());
      }
    } catch (err) {
      console.warn("[OpenAI Broker Extractor] Network or LLM error, using fallback:", err);
    }
  }

  // Fallback to rule-based extractor
  const fallback = ruleBasedPropertyExtract(msg);
  cache[cacheKey] = fallback;
  saveLLMCache(cache);

  if (fallback.message_type === "ignore") return [];
  return fallback.listings;
}

/**
 * Format a listing's price into a user-friendly string for the table
 */
export function formatListingPriceDisplay(listing: ExtractedPropertyListing): string {
  if (listing.price_flag === "unclear" && listing.price_note) {
    return listing.price_note;
  }
  if (listing.price_basis === "per_sqft" && listing.price_rate) {
    return `₹${listing.price_rate.toLocaleString("en-IN")}/sqft`;
  }
  if (listing.price_basis === "per_acre" && listing.price_rate) {
    return `₹${(listing.price_rate / 10000000).toFixed(2)} Cr/acre`;
  }
  if (listing.price_basis === "per_month") {
    const val = listing.price_max || listing.price_min;
    if (val) {
      if (val >= 100000) {
        const l = (val / 100000).toFixed(2).replace(/\.00$/, "");
        return `₹${l} Lakh/month`;
      }
      return `₹${val.toLocaleString("en-IN")}/month`;
    }
  }
  if (listing.price_basis === "total") {
    const val = listing.price_max || listing.price_min;
    if (val) {
      if (val >= 10000000) {
        const cr = (val / 10000000).toFixed(2).replace(/\.00$/, "");
        return `₹${cr} Cr`;
      }
      if (val >= 100000) {
        const l = (val / 100000).toFixed(2).replace(/\.00$/, "");
        return `₹${l} Lakhs`;
      }
      return `₹${val.toLocaleString("en-IN")}`;
    }
  }
  if (listing.price_note) return listing.price_note;
  return "—";
}

/**
 * Format a listing's configuration into a user-friendly string for the table
 */
export function formatListingConfigDisplay(listing: ExtractedPropertyListing): string {
  const parts: string[] = [];
  if (listing.bhk_min) {
    parts.push(
      listing.bhk_max && listing.bhk_max !== listing.bhk_min
        ? `${listing.bhk_min}-${listing.bhk_max} BHK`
        : `${listing.bhk_min} BHK`,
    );
  } else if (listing.property_type === "L") {
    parts.push("PLOT / LAND");
  } else if (listing.property_type === "V") {
    parts.push("VILLA");
  } else if (listing.property_type === "H") {
    parts.push("HOUSE");
  } else if (listing.property_type === "O") {
    parts.push("OFFICE");
  } else if (listing.property_type === "C") {
    parts.push("COMMERCIAL");
  } else if (listing.property_type === "B") {
    parts.push("BUILDING");
  }

  if (listing.size_display) {
    if (parts.length > 0) {
      parts[0] = `${parts[0]} (${listing.size_display})`;
    } else {
      parts.push(listing.size_display);
    }
  }

  if (listing.deal_type === "JD") {
    parts.push("[JD]");
  } else if (listing.deal_type === "JV") {
    parts.push("[JV]");
  }

  return parts.length > 0 ? parts.join(" ") : "—";
}
