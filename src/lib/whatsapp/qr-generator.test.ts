import { describe, it, expect } from "vitest";
import { generateQRMatrix, generateQRSvg } from "./qr-generator";

describe("generateQRMatrix", () => {
  it("generates a square boolean matrix with valid dimensions", () => {
    const matrix = generateQRMatrix("skelo-whatsapp-lead-capture-pairing");
    expect(Array.isArray(matrix)).toBe(true);
    expect(matrix.length).toBeGreaterThan(20);
    expect(matrix[0].length).toBe(matrix.length);
  });

  it("places finder patterns in the 3 corners", () => {
    const matrix = generateQRMatrix("test-pairing");
    const n = matrix.length;

    // Top-left finder center (3,3) must be dark
    expect(matrix[3][3]).toBe(true);
    // Top-right finder center (3, n-4) must be dark
    expect(matrix[3][n - 4]).toBe(true);
    // Bottom-left finder center (n-4, 3) must be dark
    expect(matrix[n - 4][3]).toBe(true);

    // Inner white ring module at (1,1) must be light
    expect(matrix[1][1]).toBe(false);
  });

  it("generates SVG string containing valid XML and rect elements", () => {
    const svg = generateQRSvg("2@test-whatsapp-ref,public-identity-key", 280);
    expect(svg).toContain("<svg");
    expect(svg).toContain("xmlns=\"http://www.w3.org/2000/svg\"");
    expect(svg).toContain("<rect");
    expect(svg).toContain("viewBox=");
  });
});

