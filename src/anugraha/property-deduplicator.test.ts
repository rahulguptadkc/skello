import { describe, it, expect } from "vitest";
import {
  deduplicateCapturedMessages,
  getPropertyDedupSignature,
} from "./property-deduplicator";

describe("property-deduplicator", () => {
  it("keeps the latest row and removes the earlier duplicate when all 5 fields match", () => {
    const olderRow = {
      id: "msg-1",
      intent: "buy",
      configuration: "3 BHK",
      budget_or_price: "₹1.5 Cr",
      project_name: "Sobha Dream Acres",
      location: "Panathur",
      raw_timestamp: 1000,
      timestamp: "10:00 AM",
    };

    const latestRow = {
      id: "msg-2",
      intent: "buy",
      configuration: "3 BHK",
      budget_or_price: "₹1.5 Cr",
      project_name: "Sobha Dream Acres",
      location: "Panathur",
      raw_timestamp: 2000,
      timestamp: "11:30 AM",
    };

    const result = deduplicateCapturedMessages([olderRow, latestRow]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("msg-2");
    expect(result[0].timestamp).toBe("11:30 AM");
  });

  it("handles normalized variants (case, spacing, currency symbols)", () => {
    const olderRow = {
      id: "older",
      intent: "sell",
      configuration: "2bhk",
      budget_or_price: "₹85 Lakhs",
      project_name: "Prestige Shantiniketan",
      location: "Whitefield",
      raw_timestamp: 1000,
    };

    const latestRow = {
      id: "newer",
      intent: "SELL",
      configuration: "2 BHK",
      budget_or_price: "85 l",
      project_name: "prestige shantiniketan",
      location: "Whitefield",
      raw_timestamp: 3000,
    };

    const result = deduplicateCapturedMessages([olderRow, latestRow]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("newer");
  });

  it("does not remove rows if any of the 5 fields differ", () => {
    const base = {
      id: "base",
      intent: "buy",
      configuration: "3 BHK",
      budget_or_price: "₹1.5 Cr",
      project_name: "Sobha Dream Acres",
      location: "Panathur",
      raw_timestamp: 1000,
    };

    const diffIntent = { ...base, id: "diff-intent", intent: "rent", raw_timestamp: 2000 };
    const diffConfig = { ...base, id: "diff-config", configuration: "2 BHK", raw_timestamp: 2001 };
    const diffBudget = { ...base, id: "diff-budget", budget_or_price: "₹2 Cr", raw_timestamp: 2002 };
    const diffProject = { ...base, id: "diff-project", project_name: "Brigade Metropolis", raw_timestamp: 2003 };
    const diffLocation = { ...base, id: "diff-loc", location: "Koramangala", raw_timestamp: 2004 };

    const result = deduplicateCapturedMessages([
      base,
      diffIntent,
      diffConfig,
      diffBudget,
      diffProject,
      diffLocation,
    ]);

    expect(result).toHaveLength(6);
  });
});

