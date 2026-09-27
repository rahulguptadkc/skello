import { describe, expect, it } from "vitest";

import {
  callbackTime,
  decideOutcome,
  isTerminalCallStatus,
  type DecideOutcomeInput,
} from "@/lib/campaigns/outcome-decision";
import type { CallStatus } from "@/types/call";
import type { CampaignRetryTrigger } from "@/types/campaign";
import type { ResolvedOutcomePolicy } from "@/types/outcome-policy";
import type { OutcomeRule } from "@/types/workflow";

// Fixed clock so next_attempt_at is deterministic.
const NOW = 1_700_000_000_000;
const INTERVAL = 900; // seconds
const NOW_PLUS_INTERVAL = new Date(NOW + INTERVAL * 1000).toISOString();

// Mirrors the seeded default policy (the pre-config hardcoded behaviour).
const DEFAULT_POLICY: ResolvedOutcomePolicy = {
  actions: {
    interested: "succeed",
    meeting_booked: "succeed",
    callback_requested: "callback",
    not_interested: "fail",
    wrong_number: "fail",
    do_not_call: "fail",
    no_decision: "succeed",
  },
  fallbackAction: "succeed",
};

function make(overrides: Partial<DecideOutcomeInput> = {}): DecideOutcomeInput {
  return {
    callStatus: "completed",
    callOutcome: null,
    requestedCallbackAt: null,
    callId: "call-1",
    attempt: 1,
    callbackCount: 0,
    campaign: {
      max_attempts: 3,
      max_callbacks: 2,
      retry_interval_seconds: INTERVAL,
      retry_on: ["no_answer", "busy", "failed", "canceled"],
    },
    policy: DEFAULT_POLICY,
    now: NOW,
    ...overrides,
  };
}

describe("isTerminalCallStatus", () => {
  it("treats finished statuses as terminal", () => {
    for (const s of [
      "completed",
      "no_answer",
      "busy",
      "failed",
      "canceled",
    ] as CallStatus[]) {
      expect(isTerminalCallStatus(s)).toBe(true);
    }
  });

  it("treats in-progress statuses as non-terminal", () => {
    for (const s of ["initiated", "ringing", "in_progress"] as CallStatus[]) {
      expect(isTerminalCallStatus(s)).toBe(false);
    }
  });
});

describe("decideOutcome — non-terminal", () => {
  it.each(["initiated", "ringing", "in_progress"] as CallStatus[])(
    "%s → noop",
    (callStatus) => {
      expect(decideOutcome(make({ callStatus }))).toEqual({ kind: "noop" });
    },
  );
});

describe("decideOutcome — disposition tier (default policy)", () => {
  it.each(["interested", "meeting_booked", "no_decision"])(
    "%s → succeed",
    (callOutcome) => {
      const d = decideOutcome(make({ callOutcome }));
      expect(d).toEqual({
        kind: "succeed",
        patch: {
          last_status: "completed",
          last_call_id: "call-1",
          status: "succeeded",
          last_error: null,
          last_outcome: callOutcome,
        },
      });
    },
  );

  it("null outcome resolves to the reserved fallback key (no_decision) → succeed", () => {
    const d = decideOutcome(make({ callOutcome: null }));
    expect(d.kind).toBe("succeed");
    if (d.kind === "succeed") {
      expect(d.patch.last_outcome).toBe("no_decision");
    }
  });

  it.each(["not_interested", "do_not_call", "wrong_number"])(
    "%s → fail with reason (no retry)",
    (callOutcome) => {
      const d = decideOutcome(make({ callOutcome }));
      expect(d).toEqual({
        kind: "fail",
        patch: {
          last_status: "completed",
          last_call_id: "call-1",
          status: "failed",
          last_error: `Outcome: ${callOutcome}`,
          last_outcome: callOutcome,
        },
      });
    },
  );

  it("do_not_call carries no global/cross-campaign field — just fails this contact", () => {
    const d = decideOutcome(make({ callOutcome: "do_not_call" }));
    if (d.kind !== "fail") throw new Error("expected fail");
    expect(Object.keys(d.patch).sort()).toEqual([
      "last_call_id",
      "last_error",
      "last_outcome",
      "last_status",
      "status",
    ]);
  });
});

describe("decideOutcome — custom policy", () => {
  const CUSTOM: ResolvedOutcomePolicy = {
    actions: {
      demo_scheduled: "succeed",
      send_brochure: "retry",
      hard_no: "fail",
      no_decision: "fail", // org made the fallback terminal-fail
    },
    fallbackAction: "fail",
  };

  it("honours a custom succeed outcome", () => {
    const d = decideOutcome(
      make({ callOutcome: "demo_scheduled", policy: CUSTOM }),
    );
    expect(d.kind).toBe("succeed");
    if (d.kind === "succeed") expect(d.patch.last_outcome).toBe("demo_scheduled");
  });

  it("a 'retry' action re-arms at the interval when under cap", () => {
    const d = decideOutcome(
      make({ callOutcome: "send_brochure", policy: CUSTOM, attempt: 1 }),
    );
    expect(d).toEqual({
      kind: "rearm",
      patch: {
        last_status: "completed",
        last_call_id: "call-1",
        status: "pending",
        next_attempt_at: NOW_PLUS_INTERVAL,
        last_error: null,
        last_outcome: "send_brochure",
      },
    });
  });

  it("a 'retry' action becomes terminal fail once the dial cap is hit", () => {
    const d = decideOutcome(
      make({ callOutcome: "send_brochure", policy: CUSTOM, attempt: 3 }),
    );
    expect(d.kind).toBe("fail");
    if (d.kind === "fail") {
      expect(d.patch.last_error).toBe("Retries exhausted (send_brochure)");
    }
  });

  it("an unconfigured label falls back to the org's fallback action", () => {
    // CUSTOM fallbackAction is 'fail' — an unknown label should fail, not succeed.
    const d = decideOutcome(
      make({ callOutcome: "totally_unseen", policy: CUSTOM }),
    );
    expect(d.kind).toBe("fail");
    if (d.kind === "fail") expect(d.patch.last_outcome).toBe("totally_unseen");
  });

  it("null outcome under a fail-fallback policy fails (records no_decision)", () => {
    const d = decideOutcome(make({ callOutcome: null, policy: CUSTOM }));
    expect(d.kind).toBe("fail");
    if (d.kind === "fail") expect(d.patch.last_outcome).toBe("no_decision");
  });
});

describe("decideOutcome — callback budget", () => {
  it("callback_requested with budget left → rearm at requested time, callback_count++", () => {
    const requestedCallbackAt = new Date(
      NOW + 7 * 24 * 3600 * 1000,
    ).toISOString();
    const d = decideOutcome(
      make({
        callOutcome: "callback_requested",
        requestedCallbackAt,
        callbackCount: 0,
      }),
    );
    expect(d).toEqual({
      kind: "rearm",
      patch: {
        last_status: "completed",
        last_call_id: "call-1",
        status: "pending",
        callback_count: 1,
        next_attempt_at: requestedCallbackAt,
        last_error: null,
        last_outcome: "callback_requested",
      },
    });
  });

  it("callback with no time / past / garbage → falls back to retry interval", () => {
    for (const t of [null, new Date(NOW - 1000).toISOString(), "not-a-date"]) {
      const d = decideOutcome(
        make({ callOutcome: "callback_requested", requestedCallbackAt: t }),
      );
      if (d.kind !== "rearm") throw new Error("expected rearm");
      expect(d.patch.next_attempt_at).toBe(NOW_PLUS_INTERVAL);
    }
  });

  it("callback budget exhausted (count == max) → succeed, not rearm", () => {
    const d = decideOutcome(
      make({ callOutcome: "callback_requested", callbackCount: 2 }),
    );
    expect(d.kind).toBe("succeed");
  });

  it("max_callbacks=0 disables callbacks entirely → succeed", () => {
    const d = decideOutcome(
      make({
        callOutcome: "callback_requested",
        callbackCount: 0,
        campaign: {
          max_attempts: 3,
          max_callbacks: 0,
          retry_interval_seconds: INTERVAL,
          retry_on: [],
        },
      }),
    );
    expect(d.kind).toBe("succeed");
  });
});

describe("decideOutcome — technical tier", () => {
  it.each(["no_answer", "busy", "failed", "canceled"] as CallStatus[])(
    "%s in retry_on and under cap → rearm at retry interval",
    (callStatus) => {
      const d = decideOutcome(make({ callStatus, attempt: 1 }));
      expect(d).toEqual({
        kind: "rearm",
        patch: {
          last_status: callStatus,
          last_call_id: "call-1",
          status: "pending",
          next_attempt_at: NOW_PLUS_INTERVAL,
        },
      });
    },
  );

  it("technical rearm patch carries NO disposition fields", () => {
    const d = decideOutcome(make({ callStatus: "no_answer", attempt: 0 }));
    if (d.kind !== "rearm") throw new Error("expected rearm");
    expect(d.patch).not.toHaveProperty("last_outcome");
    expect(d.patch).not.toHaveProperty("last_error");
    expect(d.patch).not.toHaveProperty("callback_count");
  });

  it("status not in retry_on → fail (no retry)", () => {
    const d = decideOutcome(
      make({
        callStatus: "busy",
        attempt: 0,
        campaign: {
          max_attempts: 3,
          max_callbacks: 2,
          retry_interval_seconds: INTERVAL,
          retry_on: ["no_answer"], // busy excluded
        },
      }),
    );
    expect(d).toEqual({
      kind: "fail",
      patch: {
        last_status: "busy",
        last_call_id: "call-1",
        status: "failed",
      },
    });
  });

  it("retryable but cap hit (attempt >= max_attempts) → fail", () => {
    const d = decideOutcome(make({ callStatus: "no_answer", attempt: 3 }));
    expect(d.kind).toBe("fail");
  });

  it("honored callbacks extend the dial cap (attempt < max_attempts + callback_count)", () => {
    const d = decideOutcome(
      make({ callStatus: "no_answer", attempt: 3, callbackCount: 1 }),
    );
    expect(d.kind).toBe("rearm");
  });

  it("technical fail patch has only the base fields + status", () => {
    const d = decideOutcome(make({ callStatus: "failed", attempt: 99 }));
    if (d.kind !== "fail") throw new Error("expected fail");
    expect(Object.keys(d.patch).sort()).toEqual([
      "last_call_id",
      "last_status",
      "status",
    ]);
  });
});

describe("decideOutcome — workflow rules matrix", () => {
  const rules: OutcomeRule[] = [
    {
      id: "r1",
      variables: ["interested"],
      action: "stop_calling",
      retries: 0,
      agent_id: null,
    },
    {
      id: "r2",
      variables: ["not_interested", "dnd"],
      action: "stop_calling",
      retries: 0,
      agent_id: null,
    },
    {
      id: "r3",
      variables: ["callback_requested"],
      action: "call_again",
      retries: 2,
      delay_minutes: 60,
      agent_id: null,
    },
    {
      id: "r4",
      variables: ["no_answer", "busy"],
      action: "call_again",
      retries: 2,
      delay_minutes: 120,
      agent_id: null,
    },
  ];

  it("stops calling when workflow rule action is stop_calling on interested", () => {
    const d = decideOutcome(
      make({
        callStatus: "completed",
        callOutcome: "interested",
        workflowRules: rules,
      }),
    );
    expect(d.kind).toBe("succeed");
    if (d.kind === "succeed") {
      expect(d.patch.status).toBe("succeeded");
      expect(d.patch.last_outcome).toBe("interested");
    }
  });

  it("stops calling when workflow rule action is stop_calling on dnd", () => {
    const d = decideOutcome(
      make({
        callStatus: "completed",
        callOutcome: "dnd",
        workflowRules: rules,
      }),
    );
    expect(d.kind).toBe("succeed");
  });

  it("re-arms when workflow rule action is call_again on no_answer under max retries", () => {
    const d = decideOutcome(
      make({
        callStatus: "no_answer",
        attempt: 1,
        workflowRules: rules,
      }),
    );
    expect(d.kind).toBe("rearm");
    if (d.kind === "rearm") {
      expect(d.patch.status).toBe("pending");
      // Delay 120 minutes = 7200 seconds
      expect(d.patch.next_attempt_at).toBe(
        new Date(NOW + 120 * 60 * 1000).toISOString(),
      );
    }
  });

  it("stops calling when max retries limit is reached for call_again rule", () => {
    const d = decideOutcome(
      make({
        callStatus: "no_answer",
        attempt: 3,
        campaign: {
          max_attempts: 3,
          max_callbacks: 0,
          retry_interval_seconds: INTERVAL,
          retry_on: ["no_answer"],
        },
        workflowRules: rules,
      }),
    );
    expect(d.kind).toBe("fail");
    if (d.kind === "fail") {
      expect(d.patch.status).toBe("failed");
      expect(d.patch.last_error).toContain("Max retries reached");
    }
  });

  it("stops calling when max_connected_attempts cap is reached on completed call", () => {
    const d = decideOutcome(
      make({
        callStatus: "completed",
        callOutcome: "callback_requested",
        connectedCount: 1,
        campaign: {
          max_attempts: 5,
          max_connected_attempts: 1,
          max_callbacks: 2,
          retry_interval_seconds: INTERVAL,
          retry_on: [],
        },
        workflowRules: rules,
      }),
    );
    expect(d.kind).toBe("succeed");
    if (d.kind === "succeed") {
      expect(d.patch.status).toBe("succeeded");
    }
  });
});

describe("callbackTime", () => {
  it("returns the requested time when it is in the future", () => {
    const future = new Date(NOW + 5000).toISOString();
    expect(callbackTime(future, INTERVAL, NOW)).toBe(future);
  });

  it("falls back to now + interval when null/past/invalid", () => {
    expect(callbackTime(null, INTERVAL, NOW)).toBe(NOW_PLUS_INTERVAL);
    expect(callbackTime(new Date(NOW - 1).toISOString(), INTERVAL, NOW)).toBe(
      NOW_PLUS_INTERVAL,
    );
    expect(callbackTime("garbage", INTERVAL, NOW)).toBe(NOW_PLUS_INTERVAL);
  });
});

// Keep the retry-trigger union and the test list in sync.
const _allTriggers: CampaignRetryTrigger[] = [
  "no_answer",
  "busy",
  "failed",
  "canceled",
];
void _allTriggers;

