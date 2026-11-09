import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import {
  classifyPropertyMessage,
  type PropertyIntent,
} from "@/anugraha/intent-classifier";
import { fallbackDecomposeBangaloreMessage } from "@/anugraha/openai-lead-matcher";
import {
  fetchDiscoveredGroups,
  setPermittedGroupIds,
  getPermittedGroupIds,
  getLiveCapturedMessages,
  hasSavedCredentials,
  startWhatsAppService,
  getWhatsAppServiceState,
  extractContactFromMessage,
  resolvePhoneNumberFromParticipant,
  type DiscoveredWhatsAppGroup,
} from "@/anugraha/baileys-service";

import {
  isPotentialPropertyMessage,
  extractPropertyListingsWithLLM,
  formatListingConfigDisplay,
  formatListingPriceDisplay,
  extractProjectName,
  type ExtractedPropertyListing,
} from "@/anugraha/llm-property-extractor";

export interface CapturedMessageRecord {
  id: string;
  sender_name: string;
  sender_phone: string;
  group_id: string;
  group_name: string;
  message_text: string;
  intent: PropertyIntent;
  confidence: number;
  configuration?: string;
  budget_or_price?: string;
  location?: string;
  tags: string[];
  timestamp: string;
  raw_timestamp: number;
  is_today: boolean;
  code?: string;
  property_type?: string;
  deal_type?: string;
  size_display?: string;
  price_basis?: string;
  price_flag?: string;
  price_note?: string;
  localities?: string[];
  project_name?: string;
  contact_name?: string;
  contact_numbers?: string[];
}

export interface DiscoveredGroupRecord {
  id: string;
  name: string;
  participantCount: number;
  category: "broker_network" | "residential" | "commercial" | "direct_owners";
  lastActive: string;
  todayMessageCount: number;
}

const DEFAULT_GROUPS: DiscoveredGroupRecord[] = [
  {
    id: "120363024829102938@g.us",
    name: "Gurgaon Top Brokers Network",
    participantCount: 486,
    category: "broker_network",
    lastActive: "18m ago",
    todayMessageCount: 14,
  },
  {
    id: "120363098712345678@g.us",
    name: "DLF & Golf Course Road Resale",
    participantCount: 612,
    category: "residential",
    lastActive: "Just now",
    todayMessageCount: 22,
  },
  {
    id: "120363112233445566@g.us",
    name: "Cyber City & Sohna Commercial Lease",
    participantCount: 320,
    category: "commercial",
    lastActive: "45m ago",
    todayMessageCount: 8,
  },
  {
    id: "120363998877665544@g.us",
    name: "South Delhi Luxury Rentals & Flats",
    participantCount: 528,
    category: "residential",
    lastActive: "1h ago",
    todayMessageCount: 11,
  },
  {
    id: "120363445566778899@g.us",
    name: "Direct Owners & Investors Pool",
    participantCount: 195,
    category: "direct_owners",
    lastActive: "2h ago",
    todayMessageCount: 6,
  },
];

let discoveredGroups: DiscoveredGroupRecord[] = [...DEFAULT_GROUPS];
let allowedGroupIds: Set<string> = new Set([
  DEFAULT_GROUPS[0].id,
  DEFAULT_GROUPS[1].id,
]);

export function getHourlyCycleInfo(referenceDate: Date = new Date()) {
  const now = referenceDate;
  const currentHour = now.getHours();

  let nextSlotDate: Date;
  if (currentHour < 9) {
    nextSlotDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0, 0);
  } else if (currentHour < 20) {
    nextSlotDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), currentHour + 1, 0, 0, 0);
  } else {
    nextSlotDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0, 0);
  }

  const isToday = nextSlotDate.getDate() === now.getDate();
  const nextSlotFormatted = isToday
    ? nextSlotDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : `Tomorrow, ${nextSlotDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;

  const windowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0, 0);
  const windowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 20, 0, 0, 0);

  const formatShort = (d: Date) =>
    d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });

  return {
    windowStartTs: windowStart.getTime(),
    windowEndTs: windowEnd.getTime(),
    windowLabel: `${formatShort(windowStart)} 9:00 AM – ${formatShort(windowEnd)} 8:00 PM`,
    cadence: "Hourly 9 AM–8 PM (Automated Batch)",
    nextSlotFormatted,
    nextSlotIso: nextSlotDate.toISOString(),
  };
}

export const get9amCycleInfo = getHourlyCycleInfo;
export const get12pmCycleInfo = getHourlyCycleInfo;

export function isTimestampToday(ts: number, referenceDate: Date = new Date()): boolean {
  if (typeof ts !== "number" || isNaN(ts)) return true;
  const now = referenceDate.getTime();

  // 1. Calendar today (from midnight 00:00:00 of reference date)
  const midnightToday = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
    0,
    0,
    0,
    0,
  ).getTime();
  if (ts >= midnightToday) return true;

  // 2. Rolling 24-hour window (captures messages from within the last 24h)
  const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;
  if (ts >= twentyFourHoursAgo) return true;

  // 3. 9 AM business cycle window
  const cycle = get9amCycleInfo(referenceDate);
  if (ts >= cycle.windowStartTs) return true;

  return false;
}

export function isTimestampIn9amWindow(ts: number, referenceDate: Date = new Date()): boolean {
  return isTimestampToday(ts, referenceDate);
}

// Seed pool of today's messages across realistic real estate groups
function generateTodaysMockMessages(): CapturedMessageRecord[] {
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    9,
    0,
    0,
  ).getTime();

  const presets = [
    {
      group_id: "120363024829102938@g.us",
      group_name: "Gurgaon Top Brokers Network",
      sender_name: "Amit Singhal",
      sender_phone: "+91 98102 34567",
      message_text:
        "Urgent requirement: Need 3BHK on rent in Sector 54 or Golf Course Road, fully furnished for an MNC executive family. Budget 75k - 85k/month. Move in by 15th Nov.",
      minutesAgo: 18,
    },
    {
      group_id: "120363098712345678@g.us",
      group_name: "DLF & Golf Course Road Resale",
      sender_name: "Rohit Bansal",
      sender_phone: "+91 98991 22334",
      message_text:
        "Available for sale: 4BHK Luxury Apartment in DLF Phase 2, 3400 sq ft, park facing, middle floor with 3 car parkings. Demand: ₹4.85 Cr slightly negotiable.",
      minutesAgo: 42,
    },
    {
      group_id: "120363024829102938@g.us",
      group_name: "Gurgaon Top Brokers Network",
      sender_name: "Kavita Rao",
      sender_phone: "+91 99882 11009",
      message_text:
        "Direct Buyer: Looking to buy a 3BHK ready to move flat in DLF Phase 5 or Golf Course Road. Budget ₹3 Cr to ₹3.5 Cr. Clear title only, direct options preferred.",
      minutesAgo: 75,
    },
    {
      group_id: "120363112233445566@g.us",
      group_name: "Cyber City & Sohna Commercial Lease",
      sender_name: "Vikram Chauhan",
      sender_phone: "+91 97110 55443",
      message_text:
        "Commercial office space available on long term lease in Cyber City building 9. Total area 6,200 sq ft warm shell, 60 workstations + 3 cabins. Lock-in 3 years.",
      minutesAgo: 110,
    },
    {
      group_id: "120363098712345678@g.us",
      group_name: "DLF & Golf Course Road Resale",
      sender_name: "Pooja Malhotra",
      sender_phone: "+91 98119 77881",
      message_text:
        "Serious buyer ready: Need 2BHK or 3BHK builder floor in DLF Phase 1 or Phase 2. Ready to close this week, payment ready. Budget ₹2.4 Cr.",
      minutesAgo: 145,
    },
    {
      group_id: "120363024829102938@g.us",
      group_name: "Gurgaon Top Brokers Network",
      sender_name: "Deepak Verma",
      sender_phone: "+91 98711 44322",
      message_text:
        "Urgent rental: 2BHK fully furnished flat in Sector 48 Sohna Road available immediately. Rent 42k/month including maintenance. Families or corporate bachelor.",
      minutesAgo: 190,
    },
    {
      group_id: "120363998877665544@g.us",
      group_name: "South Delhi Luxury Rentals & Flats",
      sender_name: "Rajesh Khanna",
      sender_phone: "+91 98101 99882",
      message_text:
        "Available on rent: 3BHK builder floor in Greater Kailash 1, 250 sq yards, modular kitchen, lift, 1 car parking. Rent ₹1.25 Lakhs/month.",
      minutesAgo: 220,
    },
    {
      group_id: "120363445566778899@g.us",
      group_name: "Direct Owners & Investors Pool",
      sender_name: "Sunil Grover",
      sender_phone: "+91 98105 11223",
      message_text:
        "Direct Owner: 3BHK in Godrej Meridien, Sector 106 Dwarka Expressway, 1850 sq ft, 14th floor, park view. Asking ₹2.10 Cr non-negotiable.",
      minutesAgo: 260,
    },
    {
      group_id: "120363112233445566@g.us",
      group_name: "Cyber City & Sohna Commercial Lease",
      sender_name: "Manish Agarwal",
      sender_phone: "+91 99100 88776",
      message_text:
        "Retail shop 1,100 sq ft available on lease on Golf Course Extension Road. Ground floor, high visibility, suitable for boutique, clinic or cafe.",
      minutesAgo: 310,
    },
  ];

  return presets.map((p, idx) => {
    const rawTs = Math.max(startOfToday, Date.now() - p.minutesAgo * 60 * 1000);
    const classified = classifyPropertyMessage(p.message_text);
    return {
      id: `today-msg-${idx + 1}`,
      sender_name: p.sender_name,
      sender_phone: p.sender_phone,
      group_id: p.group_id,
      group_name: p.group_name,
      message_text: p.message_text,
      intent: classified.intent,
      confidence: classified.confidence,
      configuration: classified.configuration,
      budget_or_price: classified.budgetOrPrice,
      location: classified.location,
      project_name: extractProjectName(p.message_text) || undefined,
      tags: classified.tags,
      timestamp: new Date(rawTs).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      }),
      raw_timestamp: rawTs,
      is_today: true,
    };
  });
}

function ensureMessagesForPermittedGroups(
  permittedGroupIds: string[],
  availableGroups: DiscoveredGroupRecord[],
) {
  const now = Date.now();
  const groupMap = new Map(availableGroups.map((g) => [g.id, g.name]));

  for (const gid of permittedGroupIds) {
    const gname = groupMap.get(gid) || "Group for whatsapp testing";
    const samplePresets = [
      {
        id: `seed-${gid}-1`,
        sender_name: "Kartik Skelo",
        sender_phone: "+91 98450 11990",
        minutesAgo: 10,
        text: `Prestige Autumn Leaves \n\nFabulous plotted development by prestige group !! \n\nAvailable Premium Plot for Sale !! \n\n2400 Sqft.\n\nPremium Plot - East Facing\nAnd\nOpposite the Garden & Club house. \n\nPrice : 11,500  per Sft  + deposits \n\nTrend shelters \nShamran \nCell no : 9686115795`,
      },
      {
        id: `seed-${gid}-2`,
        sender_name: "Kartik Skelo",
        sender_phone: "+91 98450 11990",
        minutesAgo: 18,
        text: `Residential rental availability\n1. Wheeler Road  - 3 Bhk, 1700 sft, West Facing at 60k (nego).\n2. HBR GF house 3 Bhk duplex Negotiable rent 50K*\n3. MSR North City Layout - 3 bhk Villa from August 15th at 75K\n4. Fraser Town 3 bhk with servant's room, swimming pool etc at 1.50 Lakhs\n\nResidential Rental Requirement\n1. Location : Cooke Town close to SBI Bank, 2 BHK, Semi Furnished. Budget 40K\n\nCommercial Rental Availability\n1. Location : Fraser Town, off Promenade Road, Ground floor, bare shell, 1500 sft at 1 Lakh + GST\n2. Indira Nagar - 3 options - A. Off 100 ft road, B. Off CMH Road & C. On Krishna Temple road\n3. HSR 3500 sft fully furnished office space at 4 Lakhs\n4. Cooke Town off Wheeler Road ext 1300 sft furnished at 1 Lakh`,
      },
      {
        id: `seed-${gid}-3`,
        sender_name: "Kartik Skelo",
        sender_phone: "+91 98450 11990",
        minutesAgo: 25,
        text: `New Flats \nFor sale \n3-bhk  \n1375 sft \nNorth facing\nStand alone building \nG+4\n1.15-lakhs\nA&E khata with o.c& c.c.\nSai Baba temple road Arekere\nCar parking \nSecurity \nLift \nCctv cameras`,
      },
      {
        id: `seed-${gid}-4`,
        sender_name: "Kartik Skelo",
        sender_phone: "+91 98450 11990",
        minutesAgo: 32,
        text: `New Flats \nFor sale \n2-bhk  \n970 sft \nNorth facing\nStand alone building \nG+4\n1.15-lakhs\nA&E khata with o.c& c.c.\nSai Baba temple road Arekere\nCar parking \nSecurity \nLift \nCctv cameras`,
      },
      {
        id: `seed-${gid}-5`,
        sender_name: "Kartik Skelo",
        sender_phone: "+91 98450 11990",
        minutesAgo: 40,
        text: `URGENT REQUIREMENT - PURCHASE\n\n4BHK Spacious Apartment 5000+Sqft.\nProject : Raheja Viverea, Koramangala\n\nOR\n\nINDEPENDENT HOUSE with Land Area 6000 to 10000Sqft.\nPrime property`,
      },
      {
        id: `seed-${gid}-6`,
        sender_name: "Kartik Skelo",
        sender_phone: "+91 98450 11990",
        minutesAgo: 50,
        text: `URGENT BUYER REQUIREMENT - PURCHASE:\n\nLooking for 3BHK high-rise apartment in Whitefield or Outer Ring Road (Prestige Shantiniketan, Brigade Metropolis, or Godrej).\nBudget up to ₹2.25 Cr. Immediate registration, payment ready.\nDirect buyer ready to close.`,
      },
      {
        id: `seed-${gid}-7`,
        sender_name: "Kartik Skelo",
        sender_phone: "+91 98450 11990",
        minutesAgo: 60,
        text: `Residential Rental Availability:\n\nFurnished 2BHK flat available for rent in HSR Layout Sector 2.\n1200 sqft, 2nd floor, modular kitchen, power backup, covered car parking.\nRent ₹45,000/month, deposit 5 months.\nImmediate possession available.`,
      },
      {
        id: `seed-${gid}-8`,
        sender_name: "Kartik Skelo",
        sender_phone: "+91 98450 11990",
        minutesAgo: 72,
        text: `Commercial Office Space available for rent/lease on Indiranagar 100ft Road.\n2,400 sqft warm shell, 25 workstations capacity, 2 cabins, conference room, pantry, 100% DG backup.\nSuitable for tech startup, consultancy or corporate office.\nRent ₹1.80 Lakhs/month + GST.`,
      },
      {
        id: `seed-${gid}-9`,
        sender_name: "Kartik Skelo",
        sender_phone: "+91 98450 11990",
        minutesAgo: 85,
        text: `Luxury 4BHK Villa For Sale in Palm Meadows, Whitefield.\nBuilt-up area 4,200 sqft on 6,000 sqft land plot.\nPrivate landscaped garden, 2 car garage, clubhouse access.\nAsking price ₹6.5 Cr negotiable.\nClear title, ready to move.`,
      },
      {
        id: `seed-${gid}-10`,
        sender_name: "Kartik Skelo",
        sender_phone: "+91 98450 11990",
        minutesAgo: 100,
        text: `Commercial Showroom For Sale:\n1,800 sqft ground floor on MG Road / Brigade Road junction.\nHigh footfall commercial zone, pre-leased to reputed apparel brand with 7.5% rental yield.\nAsking ₹4.8 Cr. Clear title documents.`,
      },
    ];

    for (let i = 0; i < samplePresets.length; i++) {
      const p = samplePresets[i];
      const rawTs = now - p.minutesAgo * 60 * 1000;
      const decomposed = fallbackDecomposeBangaloreMessage(p.text);

      if (decomposed.length > 1) {
        // Multi-listing message (e.g. seed 2 with 9 listings)
        // Remove old single bundled entry if present
        const oldIdx = capturedBuffer.findIndex(
          (m) =>
            m.id === p.id ||
            m.message_text.trim() === p.text.trim() ||
            (m.group_id === gid && m.id === `seed-${gid}-${i + 1}`),
        );
        if (oldIdx >= 0) {
          capturedBuffer.splice(oldIdx, 1);
        }

        // Add each decomposed item using the actual sender who sent the message in the group
        decomposed.forEach((item, subIdx) => {
          const subId = `seed-${gid}-${i + 1}-item-${subIdx + 1}`;
          const existingSub = capturedBuffer.find((m) => m.id === subId);
          const subTs = rawTs + subIdx * 1000;
          const subRecord: CapturedMessageRecord = {
            id: subId,
            sender_name: p.sender_name,
            sender_phone: p.sender_phone,
            group_id: gid,
            group_name: gname,
            message_text: item.text,
            intent: item.intent.toLowerCase() as PropertyIntent,
            confidence: 0.95,
            configuration: item.config !== "—" ? item.config : undefined,
            budget_or_price: item.price !== "—" ? item.price : undefined,
            project_name: extractProjectName(item.text) || extractProjectName(p.text) || undefined,
            location: item.location !== "Bangalore" ? item.location : undefined,
            tags: [item.intent, item.config, item.location].filter(Boolean),
            timestamp: new Date(subTs).toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            }),
            raw_timestamp: subTs,
            is_today: true,
          };
          if (!existingSub) {
            capturedBuffer.push(subRecord);
          } else {
            existingSub.sender_name = p.sender_name;
            existingSub.sender_phone = p.sender_phone;
            existingSub.intent = subRecord.intent;
            existingSub.configuration = subRecord.configuration;
            existingSub.budget_or_price = subRecord.budget_or_price;
            existingSub.project_name = subRecord.project_name;
            existingSub.location = subRecord.location;
          }
        });
      } else {
        const classified = classifyPropertyMessage(p.text);
        const existing = capturedBuffer.find(
          (m) =>
            m.id === p.id ||
            m.message_text.trim() === p.text.trim() ||
            (m.group_id === gid && m.id === `seed-${gid}-${i + 1}`),
        );

        if (!existing) {
          capturedBuffer.push({
            id: p.id,
            sender_name: p.sender_name,
            sender_phone: p.sender_phone,
            group_id: gid,
            group_name: gname,
            message_text: p.text,
            intent: classified.intent,
            confidence: classified.confidence,
            configuration: classified.configuration,
            budget_or_price: classified.budgetOrPrice,
            project_name: extractProjectName(p.text) || undefined,
            location: classified.location,
            tags: classified.tags,
            timestamp: new Date(rawTs).toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            }),
            raw_timestamp: rawTs,
            is_today: true,
          });
        } else {
          existing.sender_name = p.sender_name;
          existing.sender_phone = p.sender_phone;
          existing.intent = classified.intent;
          existing.configuration = classified.configuration;
          existing.budget_or_price = classified.budgetOrPrice;
          existing.project_name = extractProjectName(p.text) || undefined;
          existing.location = classified.location;
        }
      }
    }
  }
}

const CAPTURED_BUFFER_FILE = path.join(process.cwd(), "auth", "captured_buffer.json");

function backfillProjectNames(items: CapturedMessageRecord[]): boolean {
  let changed = false;
  for (const item of items) {
    if (!item.project_name && item.message_text) {
      const proj = extractProjectName(item.message_text);
      if (proj) {
        item.project_name = proj;
        changed = true;
      }
    }
  }
  return changed;
}

function loadCapturedBuffer(): {
  items: CapturedMessageRecord[];
  updatedAt: string | null;
} | null {
  try {
    if (!fs.existsSync(CAPTURED_BUFFER_FILE)) return null;
    const parsed: unknown = JSON.parse(fs.readFileSync(CAPTURED_BUFFER_FILE, "utf8"));
    if (Array.isArray(parsed)) {
      const items = parsed as CapturedMessageRecord[];
      backfillProjectNames(items);
      return { items, updatedAt: null };
    }
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as { items?: unknown }).items)
    ) {
      const snapshot = parsed as { items: CapturedMessageRecord[]; updatedAt?: string };
      backfillProjectNames(snapshot.items);
      return { items: snapshot.items, updatedAt: snapshot.updatedAt || null };
    }
    return null;
  } catch (err) {
    console.error("[WhatsApp Capture] Failed to load captured feed cache:", err);
    return null;
  }
}

function saveCapturedBuffer() {
  try {
    fs.mkdirSync(path.dirname(CAPTURED_BUFFER_FILE), { recursive: true });
    capturedBufferUpdatedAt = new Date().toISOString();
    fs.writeFileSync(
      CAPTURED_BUFFER_FILE,
      JSON.stringify({ updatedAt: capturedBufferUpdatedAt, items: capturedBuffer }),
      "utf8",
    );
  } catch (err) {
    console.error("[WhatsApp Capture] Failed to persist captured feed cache:", err);
  }
}

const loadedCapturedBuffer = loadCapturedBuffer();
let capturedBufferUpdatedAt = loadedCapturedBuffer?.updatedAt || null;
let capturedBuffer: CapturedMessageRecord[] =
  loadedCapturedBuffer?.items || generateTodaysMockMessages();
if (backfillProjectNames(capturedBuffer)) {
  saveCapturedBuffer();
}

function refreshCapturedBufferFromDisk() {
  const latest = loadCapturedBuffer();
  if (latest) {
    const updated = backfillProjectNames(latest.items);
    capturedBuffer = latest.items;
    capturedBufferUpdatedAt = latest.updatedAt;
    if (updated) {
      saveCapturedBuffer();
    }
  }
}

export function getCapturedBuffer(): CapturedMessageRecord[] {
  return capturedBuffer;
}

async function processLiveMessagesIntoBuffer(
  liveMsgs: ReturnType<typeof getLiveCapturedMessages>,
) {
  for (const lm of liveMsgs) {
    // 1. Property relevance check (bhk, available, rupee symbol, sell, rent, etc.)
    if (!isPotentialPropertyMessage(lm.text)) {
      continue;
    }

    const normalizedGid = lm.groupId.replace(/:.*@/, "@");
    const listings = await extractPropertyListingsWithLLM({
      id: lm.id,
      senderName: lm.senderName,
      senderPhone: lm.senderPhone,
      groupName: lm.groupName,
      groupId: normalizedGid,
      text: lm.text,
      timestamp: lm.timestamp,
    });

    if (listings.length === 0) continue;

    listings.forEach((listing, subIdx) => {
      const subId = listings.length > 1 ? `${lm.id}-list-${subIdx + 1}` : lm.id;
      const subTs = lm.timestamp + subIdx * 1000;
      const existingIdx = capturedBuffer.findIndex((b) => b.id === subId);

      let intent: PropertyIntent = "general";
      if (listing.intent === "WB") intent = "buy";
      else if (listing.intent === "AS") intent = "sell";
      else if (listing.intent === "AR") intent = "rent";
      else if (listing.intent === "WR") intent = "rent";

      const configStr = formatListingConfigDisplay(listing);
      const priceStr = formatListingPriceDisplay(listing);
      const locStr =
        listing.localities && listing.localities.length > 0
          ? listing.localities.join(", ")
          : "Bangalore";

      // Listing contact numbers can belong to someone other than the person
      // who posted the message. Sender identity comes only from Baileys.
      const displayPhone = resolvePhoneNumberFromParticipant(lm.senderPhone);

      const record: CapturedMessageRecord = {
        id: subId,
        sender_name: lm.senderName || listing.contact_name || "WhatsApp Member",
        sender_phone: displayPhone,
        group_id: normalizedGid,
        group_name: lm.groupName,
        message_text: listing.raw_text || lm.text,
        intent,
        confidence: listing.confidence === "high" ? 0.95 : 0.85,
        configuration: configStr !== "—" ? configStr : undefined,
        budget_or_price: priceStr !== "—" ? priceStr : undefined,
        location: locStr,
        tags: [
          listing.code,
          listing.intent,
          listing.property_type,
          ...(listing.localities || []),
        ].filter(Boolean),
        timestamp: new Date(subTs).toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        }),
        raw_timestamp: subTs,
        is_today: isTimestampToday(subTs),
        code: listing.code,
        property_type: listing.property_type,
        deal_type: listing.deal_type,
        size_display: listing.size_display || undefined,
        price_basis: listing.price_basis,
        price_flag: listing.price_flag,
        price_note: listing.price_note || undefined,
        localities: listing.localities,
        project_name: listing.project_name || undefined,
        contact_name: listing.contact_name || undefined,
        contact_numbers: listing.contact_numbers,
      };

      if (existingIdx >= 0) {
        capturedBuffer[existingIdx] = record;
      } else {
        capturedBuffer.unshift(record);
      }
    });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    refreshCapturedBufferFromDisk();

    // Saving group permissions does not fetch messages; ingestion is owned by
    // the scheduled backend job or the explicit Fetch button.
    if (
      body.action === "set_permissions" ||
      body.action === "set_permissions_and_scrape"
    ) {
      const { selectedGroupIds } = body as { selectedGroupIds: string[] };
      if (!Array.isArray(selectedGroupIds)) {
        return NextResponse.json(
          { success: false, error: "selectedGroupIds must be an array" },
          { status: 400 },
        );
      }
      allowedGroupIds = new Set(selectedGroupIds);
      setPermittedGroupIds(selectedGroupIds);
      return NextResponse.json({ success: true, permittedGroupIds: selectedGroupIds });
    }

    // Action 2: Real Baileys Discovered Groups Sync / Refresh
    if (
      body.action === "sync_discovered_groups" ||
      body.action === "refresh_groups"
    ) {
      const { groups } = body as { groups?: DiscoveredGroupRecord[] };
      if (Array.isArray(groups) && groups.length > 0) {
        discoveredGroups = groups;
      }
      const freshGroups = await fetchDiscoveredGroups();
      return NextResponse.json({
        success: true,
        count: freshGroups.length,
        groups: freshGroups,
      });
    }

    // Action 3: Live Ingestion from Baileys Listener (skelo-wa-poc)
    const {
      sender_name,
      sender_phone,
      group_id,
      group_name,
      message_text,
      timestamp,
    } = body;

    if (!message_text) {
      return NextResponse.json(
        { success: false, error: "message_text is required" },
        { status: 400 },
      );
    }

    const rawTs = timestamp ? Number(timestamp) : Date.now();
    const isToday = isTimestampToday(rawTs);

    // If allowedGroupIds is set, only accept messages from allowed groups
    if (allowedGroupIds.size > 0 && group_id && !allowedGroupIds.has(group_id)) {
      return NextResponse.json({
        success: false,
        skipped: true,
        reason: "group_not_permitted",
      });
    }

    // Update group name in discovered list if group is new
    if (group_id && !discoveredGroups.some((g) => g.id === group_id)) {
      discoveredGroups.push({
        id: group_id,
        name: group_name || "WhatsApp Real Estate Group",
        participantCount: 50,
        category: "broker_network",
        lastActive: "Just now",
        todayMessageCount: 1,
      });
    }

    const finalSenderName = sender_name || "WhatsApp User";
    const finalSenderPhone = sender_phone || "Unknown Phone";

    // If message contains multiple numbered/bulleted listings, decompose into distinct items
    const decomposed = fallbackDecomposeBangaloreMessage(message_text);
    if (decomposed.length > 1) {
      const addedRecords: CapturedMessageRecord[] = [];
      decomposed.forEach((item, subIdx) => {
        const subId = `msg-${Date.now()}-${subIdx}-${Math.random().toString(36).slice(2, 6)}`;
        const subRecord: CapturedMessageRecord = {
          id: subId,
          sender_name: finalSenderName,
          sender_phone: finalSenderPhone,
          group_id: group_id || "direct",
          group_name: group_name || "WhatsApp Group",
          message_text: item.text,
          intent: item.intent.toLowerCase() as PropertyIntent,
          confidence: 0.95,
          configuration: item.config !== "—" ? item.config : undefined,
          budget_or_price: item.price !== "—" ? item.price : undefined,
          project_name: extractProjectName(item.text) || extractProjectName(message_text) || undefined,
          location: item.location !== "Bangalore" ? item.location : undefined,
          tags: [item.intent, item.config, item.location].filter(Boolean),
          timestamp: new Date(rawTs + subIdx * 1000).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          }),
          raw_timestamp: rawTs + subIdx * 1000,
          is_today: isToday,
        };
        capturedBuffer.unshift(subRecord);
        addedRecords.push(subRecord);
      });
      saveCapturedBuffer();
      return NextResponse.json({
        success: true,
        count: addedRecords.length,
        data: addedRecords[0],
      });
    }

    const classified = classifyPropertyMessage(message_text);

    const record: CapturedMessageRecord = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      sender_name: finalSenderName,
      sender_phone: finalSenderPhone,
      group_id: group_id || "direct",
      group_name: group_name || "WhatsApp Group",
      message_text: message_text.trim(),
      intent: classified.intent,
      confidence: classified.confidence,
      configuration: classified.configuration,
      budget_or_price: classified.budgetOrPrice,
      location: classified.location,
      project_name: body.project_name || extractProjectName(message_text) || undefined,
      tags: classified.tags,
      timestamp: new Date(rawTs).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      }),
      raw_timestamp: rawTs,
      is_today: isToday,
    };

    capturedBuffer.unshift(record);
    if (capturedBuffer.length > 500) {
      capturedBuffer.pop();
    }
    saveCapturedBuffer();

    return NextResponse.json({
      success: true,
      data: record,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Invalid payload",
      },
      { status: 400 },
    );
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  refreshCapturedBufferFromDisk();
  const todayOnly = searchParams.get("today") !== "false"; // default true
  const groupIdsParam = searchParams.get("groups");
  const targetGroupIds = groupIdsParam ? groupIdsParam.split(",") : null;

  // Read the latest backend snapshot without triggering message processing.
  if (searchParams.get("cached") === "true") {
    let cachedItems = capturedBuffer.filter(
      (m) =>
        (Boolean(m.code) || isPotentialPropertyMessage(m.message_text)) &&
        (m.intent !== "general" || Boolean(m.code)) &&
        (!todayOnly || isTimestampToday(m.raw_timestamp)),
    );
    const permittedIds = getPermittedGroupIds();
    const effectiveAllowed = permittedIds.length > 0
      ? permittedIds
      : Array.from(allowedGroupIds);
    const groupFilter = targetGroupIds?.length ? targetGroupIds : effectiveAllowed;
    if (groupFilter.length > 0) {
      const groupSet = new Set(groupFilter.map((id) => id.replace(/:.*@/, "@").toLowerCase()));
      const groupDigits = new Set(groupFilter.map((id) => id.split("@")[0].replace(/[^0-9]/g, "")));
      cachedItems = cachedItems.filter((m) => {
        const groupId = m.group_id.replace(/:.*@/, "@").toLowerCase();
        return groupSet.has(groupId) || groupDigits.has(groupId.split("@")[0].replace(/[^0-9]/g, ""));
      });
    }
    cachedItems.sort((a, b) => (b.raw_timestamp || 0) - (a.raw_timestamp || 0));
    return NextResponse.json({
      success: true,
      data: {
        count: cachedItems.length,
        allowedGroupCount: effectiveAllowed.length,
        permittedGroupIds: effectiveAllowed,
        isConnected: hasSavedCredentials(),
        fetchedAt: capturedBufferUpdatedAt,
        ...(globalThis.__skeloDiscoveredGroups?.length
          ? { discoveredGroups: globalThis.__skeloDiscoveredGroups }
          : {}),
        items: cachedItems,
      },
    });
  }

  // Auto-connect Baileys in background if credentials exist and socket is not active
  if (hasSavedCredentials()) {
    const currentState = getWhatsAppServiceState();
    if (!globalThis.__skeloWhatsAppSock || currentState.status !== "connected") {
      startWhatsAppService().catch(console.error);
    }
  }

  // Retrieve actual participating groups from connected WhatsApp (cache/disk first, non-blocking)
  const liveGroups = await fetchDiscoveredGroups(false);
  const isConnected = hasSavedCredentials();
  const permittedIds = getPermittedGroupIds();

  // If WhatsApp is connected, strictly use discovered real groups (or empty while syncing)
  // Only fall back to DEFAULT_GROUPS if no account is connected (offline demo mode)
  const activeGroups = isConnected
    ? liveGroups
    : liveGroups.length > 0
      ? liveGroups
      : DEFAULT_GROUPS;

  const effectiveAllowed =
    permittedIds.length > 0 ? new Set(permittedIds) : allowedGroupIds;

  // Retrieve actual live captured messages from disk/memory
  const liveMsgs = getLiveCapturedMessages();
  const groupsWithRealMsgs = new Set(
    liveMsgs.map((m) => m.groupId.split("@")[0].replace(/[^0-9]/g, "")).filter(Boolean),
  );

  // If a permitted group has real captured messages, purge old mock seeds and non-property chatter
  capturedBuffer = capturedBuffer.filter((m) => {
    if (m.id.startsWith("seed-")) {
      const mDigits = m.group_id.split("@")[0].replace(/[^0-9]/g, "");
      return !groupsWithRealMsgs.has(mDigits);
    }
    return (
      (Boolean(m.code) || isPotentialPropertyMessage(m.message_text)) &&
      (m.intent !== "general" || Boolean(m.code))
    );
  });

  // Only generate mock presets for permitted groups that do NOT have any real live messages captured!
  const permittedWithoutLive = Array.from(effectiveAllowed).filter((gid) => {
    const digits = gid.split("@")[0].replace(/[^0-9]/g, "");
    return !groupsWithRealMsgs.has(digits);
  });
  if (permittedWithoutLive.length > 0) {
    ensureMessagesForPermittedGroups(permittedWithoutLive, activeGroups);
  }

  // Process live messages with property keyword filter and OpenAI broker extractor
  await processLiveMessagesIntoBuffer(liveMsgs);
  saveCapturedBuffer();

  // Filter buffer to only selected groups, today's messages, and valid property records
  let filtered = capturedBuffer.filter(
    (m) =>
      (Boolean(m.code) || isPotentialPropertyMessage(m.message_text)) &&
      (m.intent !== "general" || m.code),
  );

  if (todayOnly) {
    filtered = filtered.filter((m) => isTimestampToday(m.raw_timestamp));
  }

  if (targetGroupIds && targetGroupIds.length > 0) {
    const targetDigits = new Set(
      targetGroupIds.map((id) => id.split("@")[0].replace(/[^0-9]/g, "")).filter(Boolean),
    );
    const set = new Set(targetGroupIds.map((id) => id.replace(/:.*@/, "@").toLowerCase()));
    filtered = filtered.filter((m) => {
      const gid = m.group_id.replace(/:.*@/, "@").toLowerCase();
      const gidDigits = gid.split("@")[0].replace(/[^0-9]/g, "");
      return set.has(gid) || (gidDigits && targetDigits.has(gidDigits));
    });
  } else if (effectiveAllowed.size > 0) {
    const allowedDigits = new Set(
      Array.from(effectiveAllowed).map((id) => id.split("@")[0].replace(/[^0-9]/g, "")).filter(Boolean),
    );
    const allowedSet = new Set(
      Array.from(effectiveAllowed).map((id) => id.replace(/:.*@/, "@").toLowerCase()),
    );
    filtered = filtered.filter((m) => {
      const gid = m.group_id.replace(/:.*@/, "@").toLowerCase();
      const gidDigits = gid.split("@")[0].replace(/[^0-9]/g, "");
      return allowedSet.has(gid) || (gidDigits && allowedDigits.has(gidDigits));
    });
  }

  filtered.sort((a, b) => (b.raw_timestamp || 0) - (a.raw_timestamp || 0));

  return NextResponse.json({
    success: true,
    data: {
      count: filtered.length,
      allowedGroupCount:
        permittedIds.length > 0 ? permittedIds.length : allowedGroupIds.size,
      permittedGroupIds:
        permittedIds.length > 0 ? permittedIds : Array.from(allowedGroupIds),
      discoveredGroups: activeGroups,
      isConnected,
      cycleInfo: get9amCycleInfo(),
      fetchedAt: capturedBufferUpdatedAt,
      items: filtered,
    },
  });
}
