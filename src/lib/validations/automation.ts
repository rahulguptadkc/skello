import { z } from "zod";

export const cohortFiltersSchema = z.object({
  intent: z.array(z.enum(["hot", "warm", "cold"])).optional().default(["hot"]),
  outcomes: z.array(z.string()).optional(),
  statuses: z.array(z.string()).optional(),
  min_intent_score: z.number().min(0).max(100).optional(),
});

export const retryConfigSchema = z.object({
  max_retries: z.number().int().min(0).max(10).default(2),
  retry_interval_minutes: z.number().int().min(1).max(1440).default(30),
  max_connected_attempts: z.number().int().min(1).max(10).default(1),
});

export const createAutomationSchema = z.object({
  organisation_id: z.string().uuid(),
  name: z.string().trim().min(1, "Name is required").max(100),
  description: z.string().trim().max(500).optional().nullable(),
  cohort_filters: cohortFiltersSchema.default({ intent: ["hot"] }),
  schedule_time: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Time must be in HH:mm (24h) format")
    .default("11:00"),
  schedule_frequency: z
    .enum(["daily", "weekdays", "weekly", "fixed_interval"])
    .default("daily"),
  schedule_interval_days: z.number().int().min(1).max(365).default(1),
  schedule_days_of_week: z.array(z.number().int().min(1).max(7)).default([]),
  schedule_timezone: z.string().trim().min(1).default("Asia/Kolkata"),
  channel: z.enum(["voice_ai"]).default("voice_ai"),
  agent_id: z.string().trim().optional().nullable(),
  whatsapp_template_id: z.string().trim().optional().nullable(),
  retry_config: retryConfigSchema.default({
    max_retries: 2,
    retry_interval_minutes: 30,
    max_connected_attempts: 1,
  }),
  workflow_id: z.string().trim().optional().nullable(),
  max_global_limit_per_user: z.number().int().min(1).max(100).default(5),
  is_active: z.boolean().default(true),
});

export const updateAutomationSchema = createAutomationSchema.partial().extend({
  id: z.string().uuid(),
  organisation_id: z.string().uuid(),
});

export type CreateAutomationInput = z.infer<typeof createAutomationSchema>;
export type UpdateAutomationInput = z.infer<typeof updateAutomationSchema>;
