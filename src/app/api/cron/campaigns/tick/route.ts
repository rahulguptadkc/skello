import { NextResponse, type NextRequest } from "next/server";

import { dispatchDueCallbacks } from "@/lib/callbacks/dispatch";
import { dispatchDueCampaignContacts } from "@/lib/campaigns/dispatch";
import { drainPendingCheckoutEvents } from "@/lib/shopify/checkout-events";
import { dispatchDueCodConfirmations } from "@/lib/shopify/cod-confirmation";
import { dispatchDueRecoveries } from "@/lib/shopify/recovery";
import { dispatchDueWhatsAppRecoveries } from "@/lib/shopify/whatsapp-recovery";
import { GET as getWhatsAppCapture } from "@/app/api/whatsapp-capture/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let lastScheduledWhatsAppSlot = "";

async function runScheduledWhatsAppCapture() {
  const timeZone = process.env.WHATSAPP_CAPTURE_TIMEZONE || "Asia/Kolkata";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value || "00";
  const hour = Number(part("hour"));
  const minute = part("minute");

  // Automatically run hourly from 9:00 AM to 8:00 PM IST (minute 00, hours 9 to 20).
  if (minute !== "00" || hour < 9 || hour > 20) {
    return { scheduled: false, reason: "outside_whatsapp_capture_schedule" };
  }

  const slot = `${part("year")}-${part("month")}-${part("day")}T${part("hour")}`;
  if (slot === lastScheduledWhatsAppSlot) {
    return { scheduled: false, reason: "slot_already_processed", slot };
  }
  lastScheduledWhatsAppSlot = slot;

  try {
    const response = await getWhatsAppCapture(
      new Request("http://internal/api/whatsapp-capture?today=false", {
        headers: { "x-cron-secret": process.env.CRON_SECRET || "" },
      }),
    );
    if (!response.ok) {
      lastScheduledWhatsAppSlot = "";
      throw new Error(`WhatsApp capture returned HTTP ${response.status}`);
    }
    const result = await response.json();
    return {
      scheduled: true,
      slot,
      count: result.data?.count ?? result.count ?? 0,
    };
  } catch (error) {
    lastScheduledWhatsAppSlot = "";
    throw error;
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function POST(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return unauthorized();
  const headerSecret = request.headers.get("x-cron-secret");
  if (!headerSecret || !timingSafeEqual(headerSecret, expected)) {
    return unauthorized();
  }

  try {
    // All drains share the tick. Each runs independently so one subsystem
    // throwing can't starve the others.
    const [
      campaigns,
      callbacks,
      recoveries,
      whatsapp,
      whatsappCapture,
      codConfirmations,
      checkoutEvents,
    ] = await Promise.allSettled([
      dispatchDueCampaignContacts(),
      dispatchDueCallbacks(),
      dispatchDueRecoveries(),
      dispatchDueWhatsAppRecoveries(),
      runScheduledWhatsAppCapture(),
      dispatchDueCodConfirmations(),
      drainPendingCheckoutEvents(),
    ]);

    if (
      campaigns.status === "rejected" &&
      callbacks.status === "rejected" &&
      recoveries.status === "rejected" &&
      whatsapp.status === "rejected" &&
      whatsappCapture.status === "rejected" &&
      codConfirmations.status === "rejected" &&
      checkoutEvents.status === "rejected"
    ) {
      const message =
        campaigns.reason instanceof Error
          ? campaigns.reason.message
          : "dispatch failed";
      return NextResponse.json({ error: message }, { status: 500 });
    }

    return NextResponse.json(
      {
        campaigns:
          campaigns.status === "fulfilled"
            ? campaigns.value
            : { error: String(campaigns.reason) },
        callbacks:
          callbacks.status === "fulfilled"
            ? callbacks.value
            : { error: String(callbacks.reason) },
        recoveries:
          recoveries.status === "fulfilled"
            ? recoveries.value
            : { error: String(recoveries.reason) },
        whatsapp:
          whatsapp.status === "fulfilled"
            ? whatsapp.value
            : { error: String(whatsapp.reason) },
        whatsappCapture:
          whatsappCapture.status === "fulfilled"
            ? whatsappCapture.value
            : { error: String(whatsappCapture.reason) },
        codConfirmations:
          codConfirmations.status === "fulfilled"
            ? codConfirmations.value
            : { error: String(codConfirmations.reason) },
        checkoutEvents:
          checkoutEvents.status === "fulfilled"
            ? checkoutEvents.value
            : { error: String(checkoutEvents.reason) },
      },
      { status: 200 },
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "dispatch failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
