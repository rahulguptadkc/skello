/**
 * Bangalore (Bengaluru) Real Estate Localities & Canonical Location Resolver.
 * Recognizes all major Bangalore zones, neighborhoods, roads, landmarks, and projects,
 * normalizing colloquial phrases like "near Whitefield", "off 100ft road",
 * "close to SBI Bank Cooke Town", "Sai Baba temple road Arekere", etc.
 */

export interface BangaloreLocality {
  name: string;
  zone: "East" | "South" | "Central" | "North" | "West";
  aliases: string[];
}

export const BANGALORE_LOCALITIES: BangaloreLocality[] = [
  // --- EAST BANGALORE ---
  {
    name: "Whitefield",
    zone: "East",
    aliases: [
      "whitefield",
      "white field",
      "itpl",
      "hope farm",
      "kadugodi",
      "channasandra",
      "seegehalli",
      "palm meadows",
      "prestige shantiniketan",
      "brigade metropolis",
      "nallurhalli",
      "inorbit",
    ],
  },
  {
    name: "Marathahalli",
    zone: "East",
    aliases: [
      "marathahalli",
      "marathalli",
      "marathhalli",
      "munnekolala",
      "spice garden",
      "kalamandir",
      "kundalahalli gate",
    ],
  },
  {
    name: "Bellandur",
    zone: "East",
    aliases: [
      "bellandur",
      "outer ring road",
      "orr",
      "ecospace",
      "green glen layout",
      "devarabeesanahalli",
      "kadubeesanahalli",
      "cessna",
    ],
  },
  {
    name: "Sarjapur Road",
    zone: "East",
    aliases: [
      "sarjapur",
      "sarjapur road",
      "sarjapura",
      "carmelaram",
      "doddakannelli",
      "kaikondrahalli",
      "kasavanahalli",
      "wipro corporate",
    ],
  },
  {
    name: "Varthur",
    zone: "East",
    aliases: ["varthur", "varthur road", "gunjur", "panathur", "balagere"],
  },
  {
    name: "Brookefield",
    zone: "East",
    aliases: ["brookefield", "brookfield", "aecs layout", "kundalahalli"],
  },
  {
    name: "Hoodi",
    zone: "East",
    aliases: ["hoodi", "hudi", "mahadevapura", "garudacharpalya", "rhb colony"],
  },
  {
    name: "KR Puram",
    zone: "East",
    aliases: [
      "kr puram",
      "k.r. puram",
      "krishnarajapuram",
      "battarahalli",
      "tin factory",
      "medahalli",
    ],
  },
  {
    name: "CV Raman Nagar",
    zone: "East",
    aliases: [
      "cv raman nagar",
      "c v raman nagar",
      "kaggadasapura",
      "malleshpalya",
      "bennigana halli",
    ],
  },

  // --- SOUTH BANGALORE ---
  {
    name: "Koramangala",
    zone: "South",
    aliases: [
      "koramangala",
      "raheja viverea",
      "sony world signal",
      "st johns",
      "forum mall",
      "koramangala 1st block",
      "koramangala 3rd block",
      "koramangala 4th block",
      "koramangala 5th block",
      "koramangala 6th block",
      "koramangala 7th block",
    ],
  },
  {
    name: "HSR Layout",
    zone: "South",
    aliases: [
      "hsr",
      "hsr layout",
      "sector 1 hsr",
      "sector 2 hsr",
      "sector 3 hsr",
      "sector 4 hsr",
      "sector 5 hsr",
      "sector 6 hsr",
      "sector 7 hsr",
      "agara",
      "27th main",
    ],
  },
  {
    name: "BTM Layout",
    zone: "South",
    aliases: [
      "btm",
      "btm layout",
      "madiwala",
      "tavarekere",
      "silk board",
      "btm 1st stage",
      "btm 2nd stage",
    ],
  },
  {
    name: "Jayanagar",
    zone: "South",
    aliases: [
      "jayanagar",
      "jayanagara",
      "south end circle",
      "ashoka pillar",
      "jayanagar 3rd block",
      "jayanagar 4th block",
      "jayanagar 9th block",
    ],
  },
  {
    name: "JP Nagar",
    zone: "South",
    aliases: [
      "jp nagar",
      "j p nagar",
      "jayaprakash nagar",
      "sarakki",
      "puttenahalli",
      "dollar layout",
      "jp nagar 1st phase",
      "jp nagar 2nd phase",
      "jp nagar 7th phase",
      "jp nagar 8th phase",
    ],
  },
  {
    name: "Bannerghatta Road",
    zone: "South",
    aliases: [
      "bannerghatta",
      "bannerghatta road",
      "bg road",
      "prestige autumn leaves",
      "meenakshi mall",
      "gottigere",
      "bilekahalli",
      "kalena agrahara",
    ],
  },
  {
    name: "Arekere",
    zone: "South",
    aliases: [
      "arekere",
      "sai baba temple road arekere",
      "arekere mico layout",
      "sai baba temple road",
    ],
  },
  {
    name: "Hulimavu",
    zone: "South",
    aliases: [
      "hulimavu",
      "begur",
      "begur road",
      "akshayanagar",
      "nobonagar",
      "dlf new town",
    ],
  },
  {
    name: "Electronic City",
    zone: "South",
    aliases: [
      "electronic city",
      "electronic city phase 1",
      "electronic city phase 2",
      "e-city",
      "ecity",
      "neotown",
      "velankani",
      "wipro gate",
    ],
  },
  {
    name: "Banashankari",
    zone: "South",
    aliases: [
      "banashankari",
      "bsk",
      "kathriguppe",
      "girinagar",
      "padmanabhanagar",
      "hosakerehalli",
    ],
  },
  {
    name: "Basavanagudi",
    zone: "South",
    aliases: ["basavanagudi", "gandhi bazaar", "bull temple", "duttatreya", "tagore circle"],
  },
  {
    name: "Kanakapura Road",
    zone: "South",
    aliases: [
      "kanakapura road",
      "konanakunte",
      "thalaghattapura",
      "vajarahalli",
      "kumaraswamy layout",
      "isckon kanakapura",
    ],
  },

  // --- CENTRAL BANGALORE ---
  {
    name: "Indiranagar",
    zone: "Central",
    aliases: [
      "indiranagar",
      "indira nagar",
      "100ft road",
      "100 ft road",
      "cmh road",
      "defence colony",
      "krishna temple road",
      "chinmaya mission",
      "hal 2nd stage",
    ],
  },
  {
    name: "MG Road",
    zone: "Central",
    aliases: [
      "mg road",
      "m.g. road",
      "mahatma gandhi road",
      "brigade road",
      "church street",
      "residency road",
      "richmond road",
      "commercial street",
    ],
  },
  {
    name: "Domlur",
    zone: "Central",
    aliases: ["domlur", "embassy golf links", "egl", "amarjyoti layout", "doopanahalli"],
  },
  {
    name: "Ulsoor",
    zone: "Central",
    aliases: ["ulsoor", "halasuru", "someshwarpura", "old madras road", "ulsoor lake"],
  },
  {
    name: "Richmond Town",
    zone: "Central",
    aliases: ["richmond town", "langford town", "victoria layout", "shanthi nagar", "shanthinagar"],
  },
  {
    name: "Fraser Town",
    zone: "Central",
    aliases: [
      "fraser town",
      "frazer town",
      "pulikeshi nagar",
      "promenade road",
      "coles park",
      "cleveland town",
    ],
  },
  {
    name: "Cooke Town",
    zone: "Central",
    aliases: [
      "cooke town",
      "cook town",
      "close to sbi bank",
      "sbi bank cooke town",
      "milton street",
      "thomas town",
    ],
  },
  {
    name: "Wheeler Road",
    zone: "Central",
    aliases: ["wheeler road", "wheeler road ext", "wheeler road extension", "cox town wheeler road"],
  },
  {
    name: "Cox Town",
    zone: "Central",
    aliases: ["cox town", "benson town", "richards town", "clarence school"],
  },
  {
    name: "Vasanth Nagar",
    zone: "Central",
    aliases: [
      "vasanth nagar",
      "cunningham road",
      "millers road",
      "cantonment",
      "sankey road",
      "golf club road",
    ],
  },

  // --- NORTH BANGALORE ---
  {
    name: "Hebbal",
    zone: "North",
    aliases: ["hebbal", "hebbala", "flyover", "lumbini gardens", "kempapura", "hebbal lake"],
  },
  {
    name: "Yelahanka",
    zone: "North",
    aliases: [
      "yelahanka",
      "yelahanka new town",
      "kogilu",
      "jakkur",
      "allalasandra",
      "attur layout",
    ],
  },
  {
    name: "Manyata Tech Park",
    zone: "North",
    aliases: ["manyata", "manyata tech park", "nagavara", "veersannandra"],
  },
  {
    name: "Thanisandra",
    zone: "North",
    aliases: ["thanisandra", "thanisandra main road", "bhartiya city", "rachenahalli"],
  },
  {
    name: "Hennur",
    zone: "North",
    aliases: ["hennur", "hennur road", "geddalahalli", "kothanur", "byrathi"],
  },
  {
    name: "HBR Layout",
    zone: "North",
    aliases: ["hbr", "hbr layout", "nagawara", "hennur cross", "hbr gf house"],
  },
  {
    name: "MSR North City",
    zone: "North",
    aliases: ["msr north city", "msr north city layout", "msr layout"],
  },
  {
    name: "Kalyan Nagar",
    zone: "North",
    aliases: ["kalyan nagar", "kammanahalli", "kammannahalli", "hrbr layout", "hrbr", "ramamurthy nagar"],
  },
  {
    name: "RT Nagar",
    zone: "North",
    aliases: ["rt nagar", "r t nagar", "ganganagar", "dinnur", "matadahalli"],
  },
  {
    name: "Devanahalli",
    zone: "North",
    aliases: ["devanahalli", "airport road", "kia", "aerotropolis", "shettigere"],
  },

  // --- WEST BANGALORE ---
  {
    name: "Rajajinagar",
    zone: "West",
    aliases: ["rajajinagar", "rajaji nagar", "orion mall", "brigade gateway", "mahalaxmi layout"],
  },
  {
    name: "Malleshwaram",
    zone: "West",
    aliases: [
      "malleshwaram",
      "malleswaram",
      "margosa road",
      "sampige road",
      "sadashivanagar",
      "sankey tank",
    ],
  },
  {
    name: "Yeshwanthpur",
    zone: "West",
    aliases: ["yeshwanthpur", "yeshwantpur", "peenya", "peenya industrial area"],
  },
  {
    name: "Vijayanagar",
    zone: "West",
    aliases: ["vijayanagar", "vijaya nagar", "chandra layout", "attiguppe"],
  },
  {
    name: "Nagarbhavi",
    zone: "West",
    aliases: ["nagarbhavi", "naagarabhaavi", "kengeri", "rr nagar", "rajarajeshwari nagar"],
  },
];

/**
 * Normalizes colloquial or landmark-based Bangalore text into a canonical Bangalore locality.
 * Handles phrases like:
 * - "near Whitefield", "close to ITPL" -> "Whitefield"
 * - "Cooke Town close to SBI Bank" -> "Cooke Town"
 * - "off 100 ft road Indira Nagar" -> "Indiranagar"
 * - "Sai Baba temple road Arekere" -> "Arekere"
 * - "Raheja Viverea, Koramangala" -> "Koramangala"
 */
export function matchBangaloreLocality(text: string): string | null {
  if (!text || !text.trim()) return null;
  const lower = text.toLowerCase();

  // Strip common noisy prefixes like "near", "opposite", "close to", "off", "behind"
  const cleaned = lower
    .replace(/\b(near|close\s+to|opp|opposite|off|behind|adjacent\s+to|around|towards)\s+/g, "")
    .trim();

  // 1. Direct locality name match
  for (const loc of BANGALORE_LOCALITIES) {
    for (const alias of loc.aliases) {
      // Regex word boundary match
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i");
      if (regex.test(cleaned) || regex.test(lower)) {
        return loc.name;
      }
    }
  }

  return null;
}

/**
 * Returns a formatted prompt string listing all major Bangalore localities and canonical resolution rules.
 */
export function getBangalorePromptGuidelines(): string {
  return `=== BANGALORE LOCALITY DIRECTORY & RESOLUTION RULES ===
All input messages are strictly located in Bangalore (Bengaluru), Karnataka, India.
Always normalize mentioned areas, roads, landmarks, and projects into their canonical Bangalore locality:

1. East Bangalore:
   - Whitefield (aliases: near Whitefield, ITPL, Hope Farm, Kadugodi, Palm Meadows, Prestige Shantiniketan, Brigade Metropolis)
   - Marathahalli (aliases: Munnekolala, Spice Garden, Kalamandir)
   - Bellandur (aliases: Outer Ring Road, ORR, Ecospace, Green Glen Layout)
   - Sarjapur Road (aliases: Sarjapur, Carmelaram, Kaikondrahalli, Kasavanahalli)
   - Varthur (aliases: Gunjur, Panathur, Balagere)
   - Brookefield (aliases: AECS Layout, Kundalahalli)
   - Hoodi / Mahadevapura
   - KR Puram (aliases: K.R. Puram, Tin Factory, Battarahalli)
   - CV Raman Nagar (aliases: Kaggadasapura, Malleshpalya)

2. South Bangalore:
   - Koramangala (aliases: Raheja Viverea, Sony World, Forum)
   - HSR Layout (aliases: HSR, Sector 1 to 7, 27th Main)
   - BTM Layout (aliases: BTM, Madiwala, Tavarekere, Silk Board)
   - Jayanagar (aliases: South End Circle, Ashoka Pillar, 4th Block Jayanagar)
   - JP Nagar (aliases: J.P. Nagar, Sarakki, Puttenahalli, Dollar Layout)
   - Bannerghatta Road (aliases: BG Road, Prestige Autumn Leaves, Meenakshi Mall, Gottigere)
   - Arekere (aliases: Sai Baba temple road Arekere, Arekere Mico Layout)
   - Hulimavu / Begur (aliases: Begur Road, Akshayanagar, DLF New Town)
   - Electronic City (aliases: E-City, Phase 1 & 2, NeoTown)
   - Banashankari (aliases: BSK, Kathriguppe, Padmanabhanagar)
   - Basavanagudi (aliases: Gandhi Bazaar, Bull Temple)
   - Kanakapura Road (aliases: Konanakunte, Thalaghattapura)

3. Central Bangalore:
   - Indiranagar (aliases: Indira Nagar, 100ft Road, 100 ft road, CMH Road, Defence Colony, Krishna Temple Road)
   - MG Road (aliases: M.G. Road, Brigade Road, Church Street, Residency Road, Richmond Road)
   - Domlur (aliases: Embassy Golf Links, EGL)
   - Ulsoor / Halasuru
   - Richmond Town / Shanthi Nagar
   - Fraser Town (aliases: Frazer Town, Pulikeshi Nagar, Promenade Road, Coles Park)
   - Cooke Town (aliases: Cook Town, close to SBI Bank, Milton Street)
   - Wheeler Road (aliases: Wheeler Road Ext, Wheeler Road Extension)
   - Cox Town / Benson Town / Richards Town
   - Vasanth Nagar / Cunningham Road

4. North Bangalore:
   - Hebbal (aliases: Hebbala, Lumbini Gardens, Kempapura)
   - Yelahanka (aliases: Kogilu, Jakkur, Allalasandra)
   - Manyata Tech Park / Nagavara
   - Thanisandra (aliases: Thanisandra Main Road, Bhartiya City)
   - Hennur / Hennur Road
   - HBR Layout (aliases: HBR, HBR GF house)
   - MSR North City (aliases: MSR North City Layout, MSR Layout)
   - Kalyan Nagar / Kammanahalli (aliases: HRBR Layout)
   - RT Nagar / Devanahalli

5. West Bangalore:
   - Rajajinagar (aliases: Orion Mall, Brigade Gateway)
   - Malleshwaram (aliases: Margosa Road, Sampige Road, Sadashivanagar)
   - Yeshwanthpur / Peenya
   - Vijayanagar / Nagarbhavi / Kengeri`;
}

