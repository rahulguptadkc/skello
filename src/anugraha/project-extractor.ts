/**
 * Extracts apartment, society, layout, commercial building or project name from property text.
 * Pure string regex utility - 100% browser and server safe (zero Node.js dependencies).
 */
export function extractProjectName(text: string): string | undefined {
  if (!text || !text.trim()) return undefined;

  // 1. Explicit labels: "Project: XYZ", "Society: XYZ", "Building: XYZ", etc.
  const explicitMatch = text.match(
    /\b(?:project|society|complex|tower|building)\s*[:\-]\s*([A-Za-z0-9\s&'\.-]+?)(?=\n|,|\.|$)/i,
  );
  if (explicitMatch && explicitMatch[1]?.trim()) {
    const cleaned = explicitMatch[1].trim().replace(/\s+/g, " ");
    if (
      cleaned.length > 2 &&
      !/^(?:purchase|rent|sale|commercial|residential|\d+\s*bhk|available|urgent)$/i.test(cleaned)
    ) {
      return cleaned;
    }
  }

  // 2. Standalone known layouts / gated communities
  const layoutMatch = text.match(
    /\b(Palm\s+Meadows|MSR\s+North\s+City(?:\s+Layout)?|Cyber\s+City(?:\s+Building\s+\d+)?|DLF\s+Phase\s*[1-5]|Prestige\s+Shantiniketan|Brigade\s+Metropolis|Sobha\s+Dream\s+Acres)\b/i,
  );
  if (layoutMatch && layoutMatch[1]?.trim()) {
    return layoutMatch[1].trim().replace(/\s+/g, " ");
  }

  // 3. Renowned builder brands & iconic developments (e.g. Prestige, Sobha, Brigade, Godrej, Raheja, DLF, etc.)
  const knownBrandMatch = text.match(
    /\b((?:Prestige|Sobha|Brigade|Godrej|Raheja|DLF|Puravankara|Salarpuria|Sattva|Hiranandani|Shriram|Bhartiya\s+City|Tata\s+Promont)[^\S\r\n]+[A-Za-z0-9&'\.-]+(?:[^\S\r\n]+[A-Za-z0-9&'\.-]+){0,3})(?=[^\S\r\n]*(?:\r?\n|,|\.|\band\b|\bor\b|at\b|for\b|from\b|in\b|with\b|near\b|available\b|opposite\b|$))/i,
  );
  if (knownBrandMatch && knownBrandMatch[1]?.trim()) {
    const cleaned = knownBrandMatch[1].trim().replace(/\s+/g, " ");
    if (
      cleaned.length > 3 &&
      !/^(?:for\s+sale|for\s+rent|available|residential|commercial)$/i.test(cleaned)
    ) {
      return cleaned;
    }
  }

  // 4. "in <Named Project/Society>"
  const inProjectMatch = text.match(
    /\bin\s+([A-Z][A-Za-z0-9\s&'\.-]+?(?:Apartments?|Heights?|Enclave|Residency|Greens?|Meadows?|Villas?|Township|Park|Phase\s*[1-5]|Metropolis|Leaves|Vivarea|Viverea))\b/,
  );
  if (inProjectMatch && inProjectMatch[1]?.trim()) {
    const cleaned = inProjectMatch[1].trim().replace(/\s+/g, " ");
    if (cleaned.length > 3) {
      return cleaned;
    }
  }

  return undefined;
}

