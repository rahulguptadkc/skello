import { NextResponse } from "next/server";
import {
  getWhatsAppServiceState,
  startWhatsAppService,
  disconnectWhatsAppService,
} from "@/lib/whatsapp/baileys-service";

export const runtime = "nodejs";

export interface WhatsAppSessionState {
  status: "disconnected" | "qr_ready" | "connected";
  qrCodeDataUrl: string | null;
  qrCodeRaw: string | null;
  connectedNumber: string | null;
  connectedName: string | null;
  connectedAt: string | null;
  deviceInfo: string;
}

export async function GET() {
  let liveState = getWhatsAppServiceState();
  if (liveState.status === "starting" || liveState.status === "disconnected") {
    liveState = await startWhatsAppService();
  }

  const mappedStatus: "disconnected" | "qr_ready" | "connected" =
    liveState.status === "connected"
      ? "connected"
      : liveState.status === "qr" || liveState.status === "starting" || liveState.status === "connecting"
        ? "qr_ready"
        : "disconnected";

  const sessionState: WhatsAppSessionState = {
    status: mappedStatus,
    qrCodeDataUrl: liveState.qrDataUrl,
    qrCodeRaw: liveState.rawQr || "2@skelo-whatsapp-lead-capture-session-01,WA-REF",
    connectedNumber: liveState.connectedNumber,
    connectedName: liveState.connectedName,
    connectedAt: liveState.connectedAt,
    deviceInfo: "WhatsApp Web (Multi-Device)",
  };

  return NextResponse.json({
    success: true,
    data: sessionState,
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action } = body;

    // Action 1: Disconnect session
    if (action === "disconnect") {
      await disconnectWhatsAppService();
      return NextResponse.json({
        success: true,
        message: "WhatsApp disconnected",
        data: {
          status: "disconnected",
          qrCodeDataUrl: null,
          qrCodeRaw: null,
          connectedNumber: null,
          connectedName: null,
          connectedAt: null,
          deviceInfo: "WhatsApp Web (Multi-Device)",
        },
      });
    }

    // Action 2: Request fresh QR
    if (action === "request_qr") {
      await disconnectWhatsAppService();
      const state = await startWhatsAppService();
      return NextResponse.json({
        success: true,
        message: "Fresh QR requested",
        data: {
          status: "qr_ready",
          qrCodeDataUrl: state.qrDataUrl,
          qrCodeRaw: state.rawQr || "2@skelo-whatsapp-fresh-pairing," + Date.now(),
          connectedNumber: null,
          connectedName: null,
          connectedAt: null,
          deviceInfo: "WhatsApp Web (Multi-Device)",
        },
      });
    }

    // Action 3: Simulate scan (for dev testing)
    if (action === "simulate_scan") {
      return NextResponse.json({
        success: true,
        message: "Simulated scan pairing",
        data: {
          status: "connected",
          qrCodeDataUrl: null,
          qrCodeRaw: null,
          connectedNumber: "+91 98188 90214",
          connectedName: "WhatsApp Test Account",
          connectedAt: new Date().toISOString(),
          deviceInfo: "WhatsApp Web (Linked Device)",
        },
      });
    }

    return NextResponse.json(
      { success: false, error: "Invalid action" },
      { status: 400 },
    );
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Error" },
      { status: 400 },
    );
  }
}
