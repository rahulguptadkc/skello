import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { WHATSAPP_SCANNER_ONLY_ORGANISATION_ID } from "@/lib/auth/organisation-features";
import { readWhatsAppCaptures } from "@/lib/whatsapp/captured-message-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_CODE_PREFIXES = new Set(["AR", "AS", "WR", "WB"]);

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (session.organisation.id !== WHATSAPP_SCANNER_ONLY_ORGANISATION_ID) {
    return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search")?.trim() ?? "";
  const requestedCodePrefix = searchParams.get("codePrefix")?.toUpperCase() ?? "";
  const codePrefix = VALID_CODE_PREFIXES.has(requestedCodePrefix) ? requestedCodePrefix : null;

  if (!search) {
    return NextResponse.json({ success: false, error: "search is required" }, { status: 400 });
  }
  if (search.length > 120) {
    return NextResponse.json({ success: false, error: "search must be 120 characters or fewer" }, { status: 400 });
  }

  try {
    const items = await readWhatsAppCaptures({
      organisationId: session.organisation.id,
      search,
      codePrefix,
    });

    return NextResponse.json(
      { success: true, data: { search, count: items.length, items } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("WhatsApp database search failed:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Database search failed",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
