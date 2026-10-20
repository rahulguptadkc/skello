import { describe, expect, it } from "vitest";
import { calculateNextRunAt } from "./schedule";

describe("calculateNextRunAt", () => {
  it("computes next run time today if scheduled time is in the future", () => {
    // 09:00 UTC (which is 14:30 IST)
    const from = new Date("2026-10-20T05:00:00.000Z"); // 10:30 AM IST
    const next = calculateNextRunAt(
      {
        schedule_time: "11:00",
        schedule_frequency: "daily",
        schedule_timezone: "Asia/Kolkata",
      },
      from,
    );
    // 11:00 AM IST is 05:30 UTC
    expect(next).toBe("2026-10-20T05:30:00.000Z");
  });

  it("computes next run time tomorrow if scheduled time has already passed today", () => {
    // 12:00 PM IST is 06:30 UTC, which is after 11:00 AM IST
    const from = new Date("2026-10-20T06:30:00.000Z");
    const next = calculateNextRunAt(
      {
        schedule_time: "11:00",
        schedule_frequency: "daily",
        schedule_timezone: "Asia/Kolkata",
      },
      from,
    );
    // Tomorrow 11:00 AM IST is 2026-10-21 05:30 UTC
    expect(next).toBe("2026-10-21T05:30:00.000Z");
  });

  it("skips weekend days when frequency is weekdays", () => {
    // 2026-10-23 is Friday. 12:00 PM IST is after 11:00 AM
    const fromFridayAfternoon = new Date("2026-10-23T07:00:00.000Z");
    const next = calculateNextRunAt(
      {
        schedule_time: "11:00",
        schedule_frequency: "weekdays",
        schedule_timezone: "Asia/Kolkata",
      },
      fromFridayAfternoon,
    );
    // Next weekday is Monday, 2026-10-26 05:30 UTC
    expect(next).toBe("2026-10-26T05:30:00.000Z");
  });
});
