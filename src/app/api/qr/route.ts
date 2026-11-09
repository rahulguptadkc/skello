import { NextResponse } from "next/server";
import {
  getWhatsAppServiceState,
  startWhatsAppService,
} from "@/anugraha/baileys-service";

export const runtime = "nodejs";

/**
 * GET /api/qr
 * Exposes the live WhatsApp QR code Data URL and status from Baileys.
 */
export async function GET() {
  let state = getWhatsAppServiceState();

  // If service has not started, socket is not running, or was disconnected, launch it
  if (!globalThis.__skeloWhatsAppSock || state.status === "starting" || state.status === "disconnected") {
    state = await startWhatsAppService();
  }

  return NextResponse.json({
    status: state.status,
    qr: state.qrDataUrl,
    rawQr: state.rawQr,
    connectedNumber: state.connectedNumber,
    connectedName: state.connectedName,
  });
}

