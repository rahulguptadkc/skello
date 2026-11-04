import { NextResponse } from "next/server";
import {
  analyzeWhatsAppMessagesWithLLM,
  decomposeAndCategorizeMessageWithLLM,
  SAMPLE_REAL_ESTATE_WHATSAPP_MESSAGES,
  type RawInputMessage,
  type AILeadAnalysisResult,
} from "@/lib/whatsapp/openai-lead-matcher";
import { getCapturedBuffer } from "@/app/api/whatsapp-capture/route";

export async function GET() {
  const apiKey = (process.env.OPENAI_KEY || process.env.OPENAI_API_KEY || "").trim();
  const hasOpenAiKey = Boolean(apiKey);

  return NextResponse.json({
    success: true,
    hasOpenAiKey,
    model: "gpt-4o-mini",
    sampleMessagesCount: SAMPLE_REAL_ESTATE_WHATSAPP_MESSAGES.length,
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { rawMessages, messageIds, messageText, action, metadata } = body as {
      rawMessages?: RawInputMessage[];
      messageIds?: string[];
      messageText?: string;
      action?: string;
      metadata?: { senderName?: string; senderPhone?: string; groupName?: string };
    };

    // Action: Decompose a specific WhatsApp message into multiple categorized Bangalore inquiries
    if (action === "decompose" || (typeof messageText === "string" && messageText.trim())) {
      const items = await decomposeAndCategorizeMessageWithLLM(messageText || "", metadata);
      return NextResponse.json({
        success: true,
        action: "decompose",
        count: items.length,
        items,
        hasOpenAiKey: Boolean(process.env.OPENAI_KEY || process.env.OPENAI_API_KEY),
      });
    }

    let targetMessages: RawInputMessage[] = [];

    // 1. If rawMessages are explicitly provided in request body
    if (Array.isArray(rawMessages) && rawMessages.length > 0) {
      targetMessages = rawMessages;
    } else {
      // 2. Fetch from captured buffer in whatsapp-capture
      const buffer = getCapturedBuffer();
      if (Array.isArray(messageIds) && messageIds.length > 0) {
        const idSet = new Set(messageIds);
        targetMessages = buffer
          .filter((m) => idSet.has(m.id))
          .map((m) => ({
            id: m.id,
            senderName: m.sender_name,
            senderPhone: m.sender_phone,
            groupName: m.group_name,
            groupId: m.group_id,
            text: m.message_text,
            timestamp: m.raw_timestamp,
          }));
      } else if (buffer.length > 0) {
        targetMessages = buffer.map((m) => ({
          id: m.id,
          senderName: m.sender_name,
          senderPhone: m.sender_phone,
          groupName: m.group_name,
          groupId: m.group_id,
          text: m.message_text,
          timestamp: m.raw_timestamp,
        }));
      }

      // If still empty, fall back to sample messages
      if (targetMessages.length === 0) {
        targetMessages = SAMPLE_REAL_ESTATE_WHATSAPP_MESSAGES;
      }
    }

    const result: AILeadAnalysisResult =
      await analyzeWhatsAppMessagesWithLLM(targetMessages);

    return NextResponse.json({
      success: true,
      data: result,
      hasOpenAiKey: Boolean(process.env.OPENAI_KEY || process.env.OPENAI_API_KEY),
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Failed to analyze messages",
      },
      { status: 500 },
    );
  }
}

