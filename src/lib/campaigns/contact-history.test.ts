import { describe, expect, it } from "vitest";

describe("contact-history campaign scoping (campaign-wise, not contact-number-wise)", () => {
  it("only includes calls matching the contact's campaign_contact_id, excluding other campaigns", () => {
    const contactId = "contact-curr-camp-1";
    const samePhoneNumber = "919719262537";

    const allCalls = [
      // Call from an earlier campaign to the same phone number:
      {
        id: "call-past-campaign",
        campaign_contact_id: "contact-old-camp-99",
        to_phone: samePhoneNumber,
        call_outcome: "interested",
        started_at: "2026-09-28T10:00:00.000Z",
        is_test: false,
      },
      // Call #1 in this campaign:
      {
        id: "call-curr-1",
        campaign_contact_id: contactId,
        to_phone: samePhoneNumber,
        call_outcome: "voicemail",
        started_at: "2026-09-29T03:30:00.000Z",
        is_test: false,
      },
      // Call #2 in this campaign:
      {
        id: "call-curr-2",
        campaign_contact_id: contactId,
        to_phone: samePhoneNumber,
        call_outcome: "no_conversation",
        started_at: "2026-09-29T03:45:00.000Z",
        is_test: false,
      },
      // Call to another contact in this campaign:
      {
        id: "call-other-contact",
        campaign_contact_id: "contact-curr-camp-2",
        to_phone: "919888888888",
        call_outcome: "completed",
        started_at: "2026-09-29T03:50:00.000Z",
        is_test: false,
      },
    ];

    // Filter strictly by campaign_contact_id
    const contactCalls = allCalls.filter(
      (call) => !call.is_test && call.campaign_contact_id === contactId,
    );

    expect(contactCalls).toHaveLength(2);
    expect(contactCalls.map((c) => c.id)).toEqual(["call-curr-1", "call-curr-2"]);
    // Does NOT include call-past-campaign even though phone number was identical!
    expect(contactCalls.some((c) => c.id === "call-past-campaign")).toBe(false);
  });
});

describe("contact call history chronology and test items", () => {
  it("orders call history attempts chronologically and assigns 1-based attempt numbers", () => {
    const rawCalls = [
      {
        id: "call-3",
        campaign_contact_id: "contact-1",
        started_at: "2026-09-29T03:40:00.000Z",
        created_at: "2026-09-29T03:40:00.000Z",
        status: "completed",
        call_outcome: "interested",
        duration_seconds: 66,
        is_test: false,
      },
      {
        id: "call-1",
        campaign_contact_id: "contact-1",
        started_at: "2026-09-29T03:30:00.000Z",
        created_at: "2026-09-29T03:30:00.000Z",
        status: "completed",
        call_outcome: "voicemail",
        duration_seconds: 0,
        is_test: false,
      },
      {
        id: "call-2",
        campaign_contact_id: "contact-1",
        started_at: "2026-09-29T03:35:00.000Z",
        created_at: "2026-09-29T03:35:00.000Z",
        status: "completed",
        call_outcome: "no_conversation",
        duration_seconds: 12,
        is_test: false,
      },
      {
        id: "call-test",
        campaign_contact_id: "contact-1",
        started_at: "2026-09-29T03:45:00.000Z",
        created_at: "2026-09-29T03:45:00.000Z",
        status: "completed",
        call_outcome: "test_history_verified",
        duration_seconds: 45,
        is_test: true,
      },
    ];

    const realCalls = rawCalls.filter(
      (c) => !c.is_test && c.call_outcome !== "test_history_verified",
    );

    const sorted = [...realCalls].sort(
      (a, b) =>
        new Date(a.started_at || a.created_at).getTime() -
        new Date(b.started_at || b.created_at).getTime(),
    );

    const history = sorted.map((call, idx) => ({
      id: call.id,
      attemptNumber: idx + 1,
      outcome: call.call_outcome,
      durationSeconds: call.duration_seconds,
    }));

    expect(history).toHaveLength(3);
    expect(history[0]).toEqual({
      id: "call-1",
      attemptNumber: 1,
      outcome: "voicemail",
      durationSeconds: 0,
    });
    expect(history[1]).toEqual({
      id: "call-2",
      attemptNumber: 2,
      outcome: "no_conversation",
      durationSeconds: 12,
    });
    expect(history[2]).toEqual({
      id: "call-3",
      attemptNumber: 3,
      outcome: "interested",
      durationSeconds: 66,
    });
  });
});
