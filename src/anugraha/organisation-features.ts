export const ANUGRAHA_ORGANISATION_ID = "87a2c68a-037d-4652-8406-bea4cf672c21";
export const WHATSAPP_SCANNER_ONLY_ORGANISATION_ID = ANUGRAHA_ORGANISATION_ID;

export function isWhatsAppScannerOnlyOrganisation(organisationId: string): boolean {
  return organisationId === WHATSAPP_SCANNER_ONLY_ORGANISATION_ID;
}

export const isAnugrahaOrganisation = isWhatsAppScannerOnlyOrganisation;
