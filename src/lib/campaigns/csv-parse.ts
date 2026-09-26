"use client";

import Papa from "papaparse";

import { normalisePhoneForWa } from "@/lib/format";
import { cleanCustomerName, cleanNamesBatch } from "@/lib/names/clean-name";

export interface ParsedContact {
  raw_phone: string;
  phone: string;
  name: string | null;
  raw_name?: string | null;
  metadata: Record<string, unknown>;
}

export interface ParsedCsv {
  contacts: ParsedContact[];
  /** Header in the source file used as the phone column. */
  phone_column: string;
  /** Header in the source file used as the name column. */
  name_column: string | null;
  total_rows: number;
  valid_rows: number;
  duplicate_rows: number;
  /** Examples of cleaned names (e.g. "t Raina Dwivedi -> Raina Dwivedi") for UI preview. */
  cleaned_name_previews: Array<{ original: string; cleaned: string }>;
  /** Legacy alias for backwards compatibility */
  converted_name_previews: Array<{ original: string; devanagari: string }>;
  /** First parser-level error message, if any. */
  error: string | null;
}

const PHONE_HEADER_HINTS = ["phone", "mobile", "number", "msisdn", "contact"];
const NAME_HEADER_HINTS = [
  "customer_name",
  "customer name",
  "name",
  "full_name",
  "fullname",
  "contact_name",
  "cust_name",
  "client_name",
  "client name",
  "lead_name",
  "lead name",
];

function pickColumn(headers: string[], hints: string[]): string | null {
  const lower = headers.map((h) => h.toLowerCase().trim());
  // Exact-ish match wins.
  for (const h of hints) {
    const i = lower.indexOf(h);
    if (i !== -1) return headers[i];
  }
  // Fall back to "contains".
  for (let i = 0; i < lower.length; i++) {
    if (hints.some((h) => lower[i].includes(h))) return headers[i];
  }
  return null;
}

export interface ParseCampaignCsvOptions {
  cleanNames?: boolean;
}

export function parseCampaignCsv(
  file: File,
  options: ParseCampaignCsvOptions = { cleanNames: true },
): Promise<ParsedCsv> {
  return new Promise((resolve) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      complete: async (result) => {
        const headers = (result.meta.fields ?? []).filter(Boolean);
        const phoneCol = pickColumn(headers, PHONE_HEADER_HINTS);
        const nameCol = pickColumn(headers, NAME_HEADER_HINTS);

        if (!phoneCol) {
          resolve({
            contacts: [],
            phone_column: "",
            name_column: nameCol,
            total_rows: result.data.length,
            valid_rows: 0,
            duplicate_rows: 0,
            cleaned_name_previews: [],
            converted_name_previews: [],
            error:
              "No phone column detected. Add a column named phone, mobile, or number.",
          });
          return;
        }

        const seen = new Set<string>();
        const rawContacts: Array<{
          raw_phone: string;
          phone: string;
          raw_name: string | null;
          metadata: Record<string, unknown>;
        }> = [];
        let duplicates = 0;

        for (const row of result.data) {
          const raw = String(row[phoneCol] ?? "").trim();
          if (!raw) continue;
          const normalized = normalisePhoneForWa(raw);
          if (normalized.length < 7 || normalized.length > 15) continue;
          if (seen.has(normalized)) {
            duplicates++;
            continue;
          }
          seen.add(normalized);

          const metadata: Record<string, unknown> = {};
          for (const h of headers) {
            if (h === phoneCol || h === nameCol) continue;
            const v = row[h];
            if (v !== undefined && v !== null && String(v).trim() !== "") {
              metadata[h] = v;
            }
          }

          rawContacts.push({
            raw_phone: raw,
            phone: normalized,
            raw_name: nameCol ? String(row[nameCol] ?? "").trim() || null : null,
            metadata,
          });
        }

        // Clean customer names (remove AI noise, casing, prefixes, filler)
        const rawNames = rawContacts.map((c) => c.raw_name);
        const cleanedNames =
          options.cleanNames !== false
            ? cleanNamesBatch(rawNames)
            : rawNames;

        const cleanedPreviews: Array<{ original: string; cleaned: string }> = [];
        const contacts: ParsedContact[] = rawContacts.map((c, i) => {
          const finalName = cleanedNames[i] ?? c.raw_name;
          if (
            c.raw_name &&
            finalName &&
            c.raw_name !== finalName &&
            cleanedPreviews.length < 5
          ) {
            cleanedPreviews.push({
              original: c.raw_name,
              cleaned: finalName,
            });
          }
          return {
            raw_phone: c.raw_phone,
            phone: c.phone,
            name: finalName,
            raw_name: c.raw_name,
            metadata: c.metadata,
          };
        });

        // Map to legacy preview format as well
        const convertedPreviews = cleanedPreviews.map((p) => ({
          original: p.original,
          devanagari: p.cleaned,
        }));

        resolve({
          contacts,
          phone_column: phoneCol,
          name_column: nameCol,
          total_rows: result.data.length,
          valid_rows: contacts.length,
          duplicate_rows: duplicates,
          cleaned_name_previews: cleanedPreviews,
          converted_name_previews: convertedPreviews,
          error: result.errors[0]?.message ?? null,
        });
      },
      error: (err) => {
        resolve({
          contacts: [],
          phone_column: "",
          name_column: null,
          total_rows: 0,
          valid_rows: 0,
          duplicate_rows: 0,
          cleaned_name_previews: [],
          converted_name_previews: [],
          error: err.message,
        });
      },
    });
  });
}
