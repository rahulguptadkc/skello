import { zonedWallTimeToInstant } from "@/lib/time";
import type { AutomationFrequency } from "@/types/automation";

interface ScheduleInput {
  schedule_time: string; // "HH:mm"
  schedule_frequency: AutomationFrequency;
  schedule_interval_days?: number;
  schedule_days_of_week?: number[]; // 1=Mon .. 7=Sun
  schedule_timezone?: string;
  last_run_at?: string | null;
}

/**
 * Calculates the next UTC instant when an automation should trigger.
 */
export function calculateNextRunAt(
  input: ScheduleInput,
  fromInstant: Date = new Date(),
): string {
  const timeZone = input.schedule_timezone?.trim() || "Asia/Kolkata";
  const [hourStr, minuteStr] = (input.schedule_time || "11:00").split(":");
  const targetHour = Math.max(0, Math.min(23, Number(hourStr) || 11));
  const targetMinute = Math.max(0, Math.min(59, Number(minuteStr) || 0));

  // Determine current calendar date in the target timezone
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "narrow",
  });
  const parts = dtf.formatToParts(fromInstant);
  const m: Record<string, string> = {};
  for (const p of parts) m[p.type] = p.value;

  const currentYear = Number(m.year);
  const currentMonth = Number(m.month);
  const currentDay = Number(m.day);

  // Search up to 30 calendar days ahead
  for (let offset = 0; offset <= 30; offset++) {
    // Construct local wall date with offset
    const candidateDate = new Date(Date.UTC(currentYear, currentMonth - 1, currentDay + offset));
    const candYear = candidateDate.getUTCFullYear();
    const candMonth = candidateDate.getUTCMonth() + 1;
    const candDay = candidateDate.getUTCDate();

    // Convert candidate wall time to UTC instant
    const candInstant = zonedWallTimeToInstant(
      candYear,
      candMonth,
      candDay,
      targetHour,
      targetMinute,
      0,
      timeZone,
    );

    // If candidate instant is before or at fromInstant, skip
    if (candInstant.getTime() <= fromInstant.getTime()) {
      continue;
    }

    // Determine Day of Week (1=Monday ... 7=Sunday) in the target timezone
    // JS getUTCDay() has 0=Sunday, 1=Monday... 6=Saturday
    const jsDay = candidateDate.getUTCDay();
    const dayOfWeek = jsDay === 0 ? 7 : jsDay;

    // Check frequency conditions
    if (input.schedule_frequency === "daily") {
      return candInstant.toISOString();
    }

    if (input.schedule_frequency === "weekdays") {
      if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        return candInstant.toISOString();
      }
      continue;
    }

    if (input.schedule_frequency === "weekly") {
      const allowedDays = Array.isArray(input.schedule_days_of_week) && input.schedule_days_of_week.length > 0
        ? input.schedule_days_of_week
        : [1]; // default Monday
      if (allowedDays.includes(dayOfWeek)) {
        return candInstant.toISOString();
      }
      continue;
    }

    if (input.schedule_frequency === "fixed_interval") {
      const interval = Math.max(1, input.schedule_interval_days || 1);
      if (offset % interval === 0) {
        return candInstant.toISOString();
      }
      continue;
    }

    return candInstant.toISOString();
  }

  // Fallback: 24h from now
  return new Date(fromInstant.getTime() + 24 * 60 * 60 * 1000).toISOString();
}
