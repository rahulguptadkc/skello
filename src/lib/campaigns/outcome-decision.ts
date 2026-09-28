import type { CallOutcome, CallStatus } from "@/types/call";
import type { CampaignRetryTrigger } from "@/types/campaign";
import {
  FALLBACK_OUTCOME_KEY,
  type ResolvedOutcomePolicy,
} from "@/types/outcome-policy";
import type { OutcomeRule } from "@/types/workflow";

// Pure decision core for the campaign-contact state machine. No I/O — given a
// finished call + the contact's counters + the campaign's retry config + the
// org's outcome policy / workflow rules, it returns WHAT should happen and the exact column
// patch. The async applier (outcome.ts) does the DB reads/writes and the lead
// conversion. Keeping this pure makes the whole decision table unit-testable
// with zero mocks.

const RETRY_ELIGIBLE: ReadonlySet<CallStatus> = new Set<CallStatus>([
  "no_answer",
  "busy",
  "failed",
  "canceled",
]);

const TERMINAL_STATUSES: ReadonlySet<CallStatus> = new Set<CallStatus>([
  "completed",
  "no_answer",
  "busy",
  "failed",
  "canceled",
]);

export function isTerminalCallStatus(status: CallStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export interface DecideOutcomeInput {
  callStatus: CallStatus;
  callOutcome: CallOutcome | null;
  leadIntent?: string | null;
  interest?: string | null;
  customerStatus?: string | null;
  leadData?: Record<string, unknown> | null;
  customData?: Record<string, Record<string, unknown>> | null;
  requestedCallbackAt: string | null;
  callId: string;
  // Contact counters.
  attempt: number;
  connectedCount?: number;
  callbackCount: number;
  contactMetadata?: Record<string, unknown> | null;
  campaign: {
    max_attempts: number;
    max_connected_attempts?: number;
    max_callbacks: number;
    retry_interval_seconds: number;
    retry_on: CampaignRetryTrigger[];
  };
  workflowRules?: OutcomeRule[] | null;
  // The org's resolved outcome policy: per-key action + fallback action for any
  // label not in the org's configured set.
  policy: ResolvedOutcomePolicy;
  // Injected clock (ms). Pass Date.now() in production; a fixed value in tests.
  now: number;
}

const DISQUALIFYING_OUTCOMES = new Set([
  "not_interested",
  "uninterested",
  "wrong_number",
  "dnd",
  "do_not_call",
  "no",
  "nahi",
  "rejected",
  "language_barrier",
  "invalid",
  "disqualified",
  "blacklisted",
]);

// The applier injects `lead_id` on a `succeed` (it's an I/O lookup); every
// other field of every patch is decided here.
export type OutcomeDecision =
  | { kind: "noop" }
  | { kind: "succeed"; patch: Record<string, unknown> }
  | { kind: "fail"; patch: Record<string, unknown> }
  | { kind: "rearm"; patch: Record<string, unknown> };

export function decideOutcome(input: DecideOutcomeInput): OutcomeDecision {
  const {
    callStatus,
    callId,
    attempt,
    connectedCount = 0,
    callbackCount,
    campaign,
    workflowRules,
    policy,
    now,
  } = input;

  if (!TERMINAL_STATUSES.has(callStatus)) return { kind: "noop" };

  const isConnected = callStatus === "completed";
  const basePatch = {
    last_status: callStatus,
    last_call_id: callId,
  };

  const outcomeKey = input.callOutcome ?? (isConnected ? FALLBACK_OUTCOME_KEY : callStatus);

  // ---- Workflow rules engine (if a workflow is linked) --------------------
  if (workflowRules && workflowRules.length > 0) {
    const primaryCandidates: string[] = [];
    if (input.callOutcome) primaryCandidates.push(input.callOutcome);
    if (outcomeKey) primaryCandidates.push(outcomeKey);

    const secondaryCandidates: string[] = [];
    if (input.leadIntent) secondaryCandidates.push(input.leadIntent);
    if (input.interest) secondaryCandidates.push(input.interest);
    if (input.customerStatus) secondaryCandidates.push(input.customerStatus);
    if (input.callStatus) secondaryCandidates.push(input.callStatus);
    console.log("[outcome-decision] Input: ", input);
    console.log("outcome and primary candidate", input.callOutcome, primaryCandidates);
    if (input.leadData) {
      for (const [k, val] of Object.entries(input.leadData)) {
        if (typeof val === "string" && val.trim() !== "") {
          const kLower = k.toLowerCase();
          if (
            kLower.includes("outcome") ||
            kLower.includes("intent") ||
            kLower.includes("disposition") ||
            kLower.includes("reason")
          ) {
            primaryCandidates.push(val);
          } else {
            secondaryCandidates.push(val);
          }
        }
      }
    }
    if (input.customData) {
      for (const fields of Object.values(input.customData)) {
        if (fields && typeof fields === "object") {
          for (const [k, val] of Object.entries(fields)) {
            if (typeof val === "string" && val.trim() !== "") {
              const kLower = k.toLowerCase();
              if (
                kLower.includes("outcome") ||
                kLower.includes("intent") ||
                kLower.includes("disposition") ||
                kLower.includes("interest") ||
                kLower.includes("reason")
              ) {
                primaryCandidates.push(val);
              } else {
                secondaryCandidates.push(val);
              }
            }
          }
        }
      }
    }

    const clean = (s: string) => s.toLowerCase().trim();
    const normalize = (s: string) => clean(s).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

    const normPrimary = Array.from(new Set(primaryCandidates.map(normalize).filter(Boolean)));
    const normSecondary = Array.from(new Set(secondaryCandidates.map(normalize).filter(Boolean)));

    console.log("[outcome-decision] Reason / Outcome Matching:", {
      call_outcome: input.callOutcome ?? null,
      lead_intent: input.leadIntent ?? null,
      interest: input.interest ?? null,
      customer_status: input.customerStatus ?? null,
      call_status: input.callStatus,
      primaryCandidates: normPrimary,
      secondaryCandidates: normSecondary,
      workflowRulesCount: workflowRules.length,
    });

    function isMatch(varName: string, candidate: string): boolean {
      const v = normalize(varName);
      const c = normalize(candidate);
      if (!v || !c) return false;
      if (v === c) {
        console.log(`[outcome-decision] Exact match: rule variable "${varName}" === candidate "${candidate}"`);
        return true;
      }

      // Guard: "interested" must never match "not_interested", "uninterested", "no_...", or "non_..."
      if (v === "interested" && (c.includes("not") || c.includes("uninterested") || c.startsWith("no_") || c.startsWith("non_"))) {
        console.log(`[outcome-decision] Negation guard blocked: "${varName}" vs "${candidate}"`);
        return false;
      }
      if (c === "interested" && (v.includes("not") || v.includes("uninterested") || v.startsWith("no_") || v.startsWith("non_"))) {
        console.log(`[outcome-decision] Negation guard blocked: "${varName}" vs "${candidate}"`);
        return false;
      }

      // Common outcome aliases
      if (
        (v === "no_conversation" && (c === "no_contact" || c === "no_response" || c === "call_dropped")) ||
        (c === "no_conversation" && (v === "no_contact" || v === "no_response" || v === "call_dropped"))
      ) {
        return true;
      }

      if (
        (v === "not_interested" && (c === "no" || c === "nahi" || c === "na" || c === "uninterested")) ||
        (c === "not_interested" && (v === "no" || v === "nahi" || v === "na" || v === "uninterested"))
      ) {
        return true;
      }

      if (
        (v === "callback_requested" && (c === "callback" || c === "call_later" || c === "call_back" || c === "call_me_later")) ||
        (c === "callback_requested" && (v === "callback" || v === "call_later" || v === "call_back" || v === "call_me_later"))
      ) {
        return true;
      }

      // Word-boundary / exact segment matching (e.g. "voicemail" in "left_voicemail")
      const regex = new RegExp(`(^|_)${v}(_|$)`);
      const matched = regex.test(c);
      if (matched) {
        console.log(`[outcome-decision] Word-boundary segment match: rule variable "${varName}" in candidate "${candidate}"`);
      }
      return matched;
    }

    // 1. Prioritize explicit call outcome / disposition matches
    let matchedRule = workflowRules.find((r) =>
      r.variables.some((v) => normPrimary.some((c) => isMatch(v, c))),
    );

    // 2. If no direct outcome match, check secondary context fields
    if (!matchedRule) {
      matchedRule = workflowRules.find((r) =>
        r.variables.some((v) => normSecondary.some((c) => isMatch(v, c))),
      );
    }

    if (matchedRule) {
      console.log("[outcome-decision] Matched workflow rule:", {
        variables: matchedRule.variables,
        action: matchedRule.action,
        retries: matchedRule.retries,
        delay_minutes: matchedRule.delay_minutes,
      });
      if (matchedRule.action === "stop_calling") {
        const isDisqualified =
          DISQUALIFYING_OUTCOMES.has(normalize(outcomeKey)) ||
          policy.actions[outcomeKey] === "fail" ||
          matchedRule.variables.some((v) => DISQUALIFYING_OUTCOMES.has(normalize(v)));

        if (isDisqualified) {
          return {
            kind: "fail",
            patch: {
              ...basePatch,
              status: "failed",
              last_error: `Workflow action: Disqualified (${matchedRule.variables.join(", ")})`,
              last_outcome: outcomeKey,
            },
          };
        }

        if (isConnected) {
          return succeedDecision(basePatch, outcomeKey);
        }
        return {
          kind: "fail",
          patch: {
            ...basePatch,
            status: "failed",
            last_error: `Workflow action: Stop calling (${matchedRule.variables.join(", ")})`,
            last_outcome: outcomeKey,
          },
        };
      }

      if (matchedRule.action === "call_again") {
        // Max retries cap: allow up to matchedRule.retries (or campaign.max_attempts)
        const maxRetries = matchedRule.retries ?? campaign.max_attempts;
        const allowedAttempts = maxRetries + 1 + callbackCount;

        // Connected attempts cap: when workflow specifies call_again, allow up to maxRetries + 1 connected calls
        const maxConnectedAllowed = Math.max(
          campaign.max_connected_attempts ?? 1,
          maxRetries + 1,
        );

        const attemptsExhausted = attempt >= allowedAttempts;
        const connectedExhausted = isConnected && connectedCount >= maxConnectedAllowed;

        console.log("[outcome-decision] Checking retry eligibility for call_again:", {
          outcomeKey,
          currentAttempt: attempt,
          allowedAttempts,
          maxRetriesConfigured: maxRetries,
          connectedCount,
          maxConnectedAllowed,
          isConnected,
          attemptsExhausted,
          connectedExhausted,
          willRetry: !attemptsExhausted && !connectedExhausted,
        });

        if (attemptsExhausted || connectedExhausted) {
          if (
            isConnected &&
            (outcomeKey === "callback_requested" ||
              outcomeKey === "callback" ||
              policy.actions[outcomeKey] === "callback" ||
              policy.actions[outcomeKey] === "succeed")
          ) {
            console.log(
              `[outcome-decision] Retries exhausted but outcome "${outcomeKey}" maps to success policy.`,
            );
            return succeedDecision(basePatch, outcomeKey);
          }
          console.log(
            `[outcome-decision] Max retries exhausted (${maxRetries} retries limit). Marking contact failed.`,
          );
          return {
            kind: "fail",
            patch: {
              ...basePatch,
              status: "failed",
              last_error: `Max retries reached (${maxRetries} retries limit)`,
              last_outcome: outcomeKey,
            },
          };
        }

        const delaySec = matchedRule.delay_minutes
          ? matchedRule.delay_minutes * 60
          : campaign.retry_interval_seconds;

        const updatedMetadata = {
          ...(input.contactMetadata || {}),
          ...(matchedRule.agent_id ? { retry_agent_id: matchedRule.agent_id } : {}),
        };

        const nextAttemptTime = callbackTime(
          input.requestedCallbackAt,
          delaySec,
          now,
        );

        console.log(
          `[outcome-decision] RETRY SCHEDULED:\n` +
            `  Rule Variables: [${matchedRule.variables.join(", ")}]\n` +
            `  Attempt: ${attempt} of ${allowedAttempts} (max retries: ${maxRetries})\n` +
            `  Delay: ${delaySec}s (${Math.round(delaySec / 60)} mins)\n` +
            `  Next Attempt At: ${nextAttemptTime}\n` +
            `  Retry Agent: ${matchedRule.agent_name || matchedRule.agent_id || "campaign default"}`
        );

        return {
          kind: "rearm",
          patch: {
            ...basePatch,
            status: "pending",
            next_attempt_at: nextAttemptTime,
            last_error: null,
            last_outcome: outcomeKey,
            ...(Object.keys(updatedMetadata).length > 0 ? { metadata: updatedMetadata } : {}),
          },
        };
      }
    }
  }

  // ---- Disposition tier (completed calls only) ----------------------------
  if (callStatus === "completed") {
    // Record the actual key the agent emitted (or the reserved fallback when
    // none was extracted) so stats can map it back to the policy. Resolve the
    // ACTION via the policy, falling back for any unconfigured key.
    const action = policy.actions[outcomeKey] ?? policy.fallbackAction;

    if (action === "callback") {
      if (callbackCount < campaign.max_callbacks) {
        return {
          kind: "rearm",
          patch: {
            ...basePatch,
            status: "pending",
            callback_count: callbackCount + 1,
            next_attempt_at: callbackTime(
              input.requestedCallbackAt,
              campaign.retry_interval_seconds,
              now,
            ),
            last_error: null,
            last_outcome: outcomeKey,
          },
        };
      }
      // Engaged customer, but we've honored as many callbacks as allowed —
      // close as a success rather than re-dial indefinitely.
      return succeedDecision(basePatch, outcomeKey);
    }

    if (action === "retry") {
      // Disposition-driven retry: re-dial at the standard interval if we're
      // still under the dial allowance, otherwise it's terminal.
      const capHit = attempt >= campaign.max_attempts + callbackCount;
      if (!capHit) {
        return {
          kind: "rearm",
          patch: {
            ...basePatch,
            status: "pending",
            next_attempt_at: new Date(
              now + campaign.retry_interval_seconds * 1000,
            ).toISOString(),
            last_error: null,
            last_outcome: outcomeKey,
          },
        };
      }
      return {
        kind: "fail",
        patch: {
          ...basePatch,
          status: "failed",
          last_error: `Retries exhausted (${outcomeKey})`,
          last_outcome: outcomeKey,
        },
      };
    }

    if (action === "fail") {
      return {
        kind: "fail",
        patch: {
          ...basePatch,
          status: "failed",
          last_error: `Outcome: ${outcomeKey}`,
          last_outcome: outcomeKey,
        },
      };
    }

    // action === "succeed" (and, defensively, any unexpected value) so a
    // connected call never silently stalls in_flight.
    return succeedDecision(basePatch, outcomeKey);
  }

  // ---- Technical tier (no_answer / busy / failed / canceled) --------------
  const isRetryable =
    campaign.retry_on.includes(callStatus as CampaignRetryTrigger) &&
    RETRY_ELIGIBLE.has(callStatus);

  // Honored callbacks extend the dial allowance on top of the technical cap.
  const capHit = attempt >= campaign.max_attempts + callbackCount;

  if (isRetryable && !capHit) {
    return {
      kind: "rearm",
      patch: {
        ...basePatch,
        status: "pending",
        next_attempt_at: new Date(
          now + campaign.retry_interval_seconds * 1000,
        ).toISOString(),
      },
    };
  }

  return { kind: "fail", patch: { ...basePatch, status: "failed" } };
}

function succeedDecision(
  basePatch: { last_status: CallStatus; last_call_id: string },
  outcomeKey: string,
): OutcomeDecision {
  return {
    kind: "succeed",
    patch: {
      ...basePatch,
      status: "succeeded",
      last_error: null,
      last_outcome: outcomeKey,
    },
  };
}

// Resolve the next-attempt time for a requested callback: honour the customer's
// time when it's a valid future instant, otherwise fall back to the campaign's
// standard retry interval so a vague "later" still gets re-dialed.
export function callbackTime(
  requestedCallbackAt: string | null,
  retryIntervalSeconds: number,
  now: number,
): string {
  const fallback = new Date(now + retryIntervalSeconds * 1000).toISOString();
  if (!requestedCallbackAt) return fallback;
  const t = new Date(requestedCallbackAt);
  if (Number.isNaN(t.getTime())) return fallback;
  return t.getTime() > now ? t.toISOString() : fallback;
}
