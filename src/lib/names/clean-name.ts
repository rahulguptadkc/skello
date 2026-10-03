/**
 * Indian Customer Name Cleaner & Normalizer for Voice AI & Campaigns.
 *
 * Cleans up messy transcription artifacts, speech-to-text filler noise,
 * prefixes/titles, stray single-letter glitches (e.g. "t Raina" -> "Raina"),
 * trailing initials (e.g. "TEJESH C S" -> "Tejesh"), while preserving
 * legitimate dotted Indian initials (e.g. "K. Raina" or "k. rahul singh").
 *
 * Example:
 *  "t Raina Dwivedi"           -> "Raina Dwivedi"
 *  "uh Amit Sharma"            -> "Amit Sharma"
 *  "k. rahul singh"            -> "K. Rahul Singh"
 *  " name is Priya"            -> "Priya"
 *  "TEJESH C S"                -> "Tejesh"
 *  "mr. suresh kumar"          -> "Suresh Kumar"
 *  "DR. PRIYA SHARMA (Delhi)"  -> "Priya Sharma"
 */

import { transliterateToDevanagari } from "./transliterate";

// Dummy/placeholder names that should be treated as empty/null
const DUMMY_NAMES = new Set([
  "test",
  "testing",
  "test user",
  "demo",
  "demo user",
  "dummy",
  "dummy user",
  "null",
  "undefined",
  "na",
  "n/a",
  "none",
  "unknown",
  "no name",
  "noname",
  "customer",
  "cust",
  "lead",
  "client",
  "user",
  "admin",
  "guest",
  "caller",
  "caller id",
  "spam",
  "temp",
  "temporary",
  "asdf",
  "xxx",
  "anonymous",
  "self",
  "owner",
  "not available",
  "not applicable",
  "nil",
  "default",
  "sample",
  "phone",
  "mobile",
  "contact",
  "person",
  "someone",
]);

// Common Indian & English salutations, titles, and professional honorifics (Latin + Devanagari)
const SALUTATION_PATTERN =
  /^(?:(?:mr|mrs|ms|miss|mis|mz|mister|master|mast|madam|mdm|sir|mx|dr|doctor|doc|prof|professor|er|engr|engineer|ca|cma|arch|architect|adv|advocate|judge|justice|hon|honorable|shri|shree|sri|sree|smt|shrimati|srimati|kumari|km|pt|pandit|pundit|babu|swami|sant|sadhu|guru|guruji|acharya|maulana|mufti|qazi|syed|sayed|sheikh|shaikh|haji|alhaj|sardar|sardarji|giani|gyani|late|swargiya|swg|capt|captain|col|colonel|maj|major|gen|general|lt|lieutenant|brig|brigadier|subedar|havaldar|inspector|श्री|श्रीमान|श्रीमती|सुश्री|कुमारी|कु|डॉ|डॉक्टर|प्रो|प्रोफेसर|पं|पंडित|स्वामी|संत|आचार्य|स्वर्गीय|स्व|बाबू|मौलाना|मुफ्ती|हाजी|सरदार)[\.\-_/:\s]+)+/i;

// Speech-to-text conversational introductions & filler prefixes (English + Hindi)
const STT_INTRO_PATTERN =
  /\b(?:called|my name is|this is|i am|i'm|im|speaking with|name is|call from|calling|here is)\b|(?:नाम है|मेरा नाम|बोल रहा हूँ|बोल रही हूँ)/gi;

// Speech-to-text filler sounds
const STT_FILLER_PATTERN =
  /\b(?:uh|um|ah|er|the|its|it's)\b/gi;

/**
 * Checks if a word is a trailing initial (e.g. "C", "S", "CS", "C.S.", "K.")
 */
function isTrailingInitial(word: string): boolean {
  const clean = word.replace(/[\.\-_]/g, "");
  if (clean.length === 1 && /^[a-zA-Z]$/.test(clean)) return true;
  if (clean.length === 2 && (/^[A-Z]{2}$/.test(word) || /^[a-zA-Z]\.[a-zA-Z]\.?$/i.test(word))) return true;
  return false;
}

/**
 * Checks if a word is an undotted leading floating single letter (e.g. "t", "d")
 */
function isLeadingFloatingGlitch(word: string): boolean {
  return word.length === 1 && /^[a-zA-Z]$/.test(word);
}

/**
 * Capitalizes a single word properly (Title Case), handling dotted initials
 * (e.g. K.L., M.S., k.), hyphenated names, apostrophes (e.g., D'Souza), and Mc/Mac.
 */
function titleCaseWord(word: string): string {
  if (!word) return "";

  // Dotted initials (e.g. "K.L.", "k.l.", "m.", "A.", "k.")
  if (/^[a-zA-Z](\.[a-zA-Z])*\.?$/.test(word)) {
    return word.toUpperCase();
  }

  // Hyphenated words (e.g., "Al-Hassan", "Mary-Jane")
  if (word.includes("-")) {
    return word
      .split("-")
      .map((part) => titleCaseWord(part))
      .join("-");
  }

  // Apostrophes (e.g., "D'Souza", "O'Connor")
  if (word.includes("'")) {
    return word
      .split("'")
      .map((part, idx) => (idx === 0 && part.length === 1 ? part.toUpperCase() : titleCaseWord(part)))
      .join("'");
  }

  // Mc/Mac prefixes (e.g. McDonald)
  if (/^mc[a-z]+/i.test(word) && word.length > 2) {
    return "Mc" + word.charAt(2).toUpperCase() + word.slice(3).toLowerCase();
  }

  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * Normalizes casing of a full name to Title Case.
 */
export function toTitleCase(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map(titleCaseWord)
    .join(" ");
}

export interface CleanCustomerNameOptions {
  /**
   * If true (default), extracts only the first name (e.g., "Raina Dwivedi" -> "Raina" / "रैना").
   * If false, returns the cleaned full name.
   */
  firstNameOnly?: boolean;

  /**
   * If true (default), transliterates the cleaned first name into Hindi (Devanagari) script
   * (e.g. "Karthik" -> "कार्तिक", "Deena" -> "दीना", "Tejesh" -> "तेजेश").
   * If false, returns the cleaned name in Latin Title Case.
   */
  toDevanagari?: boolean;
}

/**
 * Cleans, sanitizes, and standardizes an Indian customer name for Voice AI,
 * extracting the first name and converting it to Hindi (Devanagari) by default
 * (e.g. "karthik" -> "कार्तिक", "t Raina Dwivedi" -> "रैना").
 */
export function cleanCustomerName(
  rawName: string | null | undefined,
  options: CleanCustomerNameOptions = { firstNameOnly: true, toDevanagari: true },
): string | null {
  if (!rawName || typeof rawName !== "string") {
    return null;
  }

  let name = rawName.trim();
  if (!name) return null;

  // 1. Remove emojis and control characters
  name = name.replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\u200d\ufe0f]/gu, " ");

  // 2. Strip speech-to-text conversational intros & filler words (e.g. "name is", "uh", "um", "called")
  name = name.replace(STT_INTRO_PATTERN, " ");
  name = name.replace(STT_FILLER_PATTERN, " ");

  // 3. Iteratively strip salutations and honorifics ("Mr.", "Dr.", "Shri", "Smt", "Miss", "Late Shri Dr.", etc.)
  while (SALUTATION_PATTERN.test(name)) {
    name = name.replace(SALUTATION_PATTERN, " ").trim();
  }

  // 4. Remove leading numbering / list markers like "1.", "1 -", "#1"
  name = name.replace(/^#?\d+[\.\-\)\s:]+\s*/, " ");

  // 5. Strip trailing annotations / metadata in brackets/parentheses, e.g. "Raina Dwivedi (Shop)"
  name = name.replace(/\s*[\(\[\{][^\)\]\}]*[\)\]\}]\s*$/, " ").trim();

  // 6. Strip trailing phone numbers or digits, e.g. "Raina Dwivedi 9876543210" or "Raina 123"
  name = name.replace(/\s+(?:\+?\d[\d\s\-]{6,}\d|\d{1,5})$/, " ").trim();

  // 7. Strip trailing separators & notes, e.g. "Raina Dwivedi - Customer" or "Raina Dwivedi | Delhi"
  name = name.replace(/\s*[\-\|\/\\]\s*(?:customer|lead|client|buyer|delhi|mumbai|pune|shop|user|vip|order.*|call.*)$/i, "").trim();

  // 8. Strip outer quotes and brackets
  name = name.replace(/^["'`“”‘’\[\{\(<]+/, "").replace(/["'`“”’\]\}\)>]+$/, "").trim();

  // 9. Normalize whitespace
  name = name.replace(/[\s\u00A0\u2000-\u200B]+/g, " ").trim();

  // 10. Handle stray floating single letters & trailing initials
  // (e.g. "t Raina Dwivedi" -> "Raina Dwivedi", "TEJESH C S" -> "Tejesh", while preserving "k. rahul singh")
  let words = name.split(/\s+/).filter(Boolean);

  // If there are no words with at least 2 letters (e.g. "R T", "R", "T", "A B C", "K."),
  // it is merely isolated initials/single letters and not a real name — discard immediately.
  const hasRealWord = words.some(
    (w) => w.replace(/[^a-zA-Z\u0900-\u097F]/g, "").length >= 2,
  );
  if (!hasRealWord) {
    return null;
  }

  const hasMainName = words.some((w) => w.replace(/[^a-zA-Z\u0900-\u097F]/g, "").length >= 3);

  if (hasMainName && words.length > 1) {
    // Strip trailing initials like "C S", "CS", "C.S."
    while (words.length > 1 && isTrailingInitial(words[words.length - 1])) {
      words.pop();
    }
    // Strip leading floating single letters without a dot like "t", "d" (preserves "k.", "m.")
    while (words.length > 1 && isLeadingFloatingGlitch(words[0])) {
      words.shift();
    }
    name = words.join(" ");
  }

  // 11. Strip lingering punctuation from ends
  name = name.replace(/^[\s,.\-_:;!@#$%^&*+=~`|/?\\<>[\]{}]+/, "");
  // If the last word is full word, strip trailing period as well
  const lastWord = words[words.length - 1] ?? "";
  if (lastWord.replace(/[^a-zA-Z]/g, "").length >= 2) {
    name = name.replace(/[\s,.\-_:;!@#$%^&*+=~`|/?\\<>[\]{}]+$/, "");
  } else {
    name = name.replace(/[\s,\-_:;!@#$%^&*+=~`|/?\\<>[\]{}]+$/, "");
  }
  name = name.trim();

  if (!name) return null;

  // 12. Check against dummy / placeholder names
  const lowerClean = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (DUMMY_NAMES.has(name.toLowerCase()) || DUMMY_NAMES.has(lowerClean)) {
    return null;
  }

  // If the string contains no letters at all, discard
  if (!/[a-zA-Z\u0900-\u097F]/.test(name)) {
    return null;
  }

  if (name.length < 2 && !/[\u0900-\u097F]/.test(name)) {
    return null;
  }

  // 13. Normalize to Title Case (unless already in Devanagari)
  const isDevanagari = /[\u0900-\u097F]/.test(name);
  if (!isDevanagari) {
    name = toTitleCase(name);
  }

  // 14. First name extraction
  let finalName = name;
  if (options.firstNameOnly !== false) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length > 0) {
      // Pick the first word that is a legitimate name (length >= 2)
      let chosen: string | null = null;
      for (const p of parts) {
        const cleanP = p.replace(/[^a-zA-Z\u0900-\u097F]/g, "");
        if (cleanP.length >= 2) {
          chosen = p;
          break;
        }
      }
      if (!chosen) {
        return null;
      }
      finalName = chosen;
    }
  }

  // Ensure extracted name is not a single letter
  const cleanFinalBeforeTranslit = finalName.replace(/[^a-zA-Z\u0900-\u097F]/g, "");
  if (cleanFinalBeforeTranslit.length < 2) {
    return null;
  }

  // 15. Transliterate to Hindi (Devanagari) if requested (default: true)
  if (options.toDevanagari !== false) {
    finalName = transliterateToDevanagari(finalName);
  }

  // Final check: a single character (Latin or Devanagari e.g. "र", "R") is never a valid Voice AI name
  const finalCleanChars = finalName.replace(/[^a-zA-Z\u0900-\u097F]/g, "");
  if (finalCleanChars.length < 2) {
    return null;
  }

  return finalName;
}

/**
 * Batch cleans a list of names.
 */
export function cleanNamesBatch(
  names: (string | null | undefined)[],
  options: CleanCustomerNameOptions = { firstNameOnly: true },
): (string | null)[] {
  return names.map((n) => cleanCustomerName(n, options));
}
