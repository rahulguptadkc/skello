import type { LeadIntent } from "@/types/lead";

export type AutomationFrequency =
  | "daily"
  | "weekdays"
  | "weekly"
  | "fixed_interval";

export type AutomationChannel = "voice_ai";

export interface AutomationCohortFilters {
  intent?: LeadIntent[];
  outcomes?: string[];
  statuses?: string[];
  min_intent_score?: number;
}

export interface AutomationRetryConfig {
  max_retries: number;
  retry_interval_minutes: number;
  max_connected_attempts: number;
}

export interface WorkspaceAutomation {
  id: string;
  organisation_id: string;
  name: string;
  description: string | null;
  cohort_filters: AutomationCohortFilters;
  schedule_time: string; // e.g. "11:00"
  schedule_frequency: AutomationFrequency;
  schedule_interval_days: number;
  schedule_days_of_week: number[]; // 1=Mon, 7=Sun
  schedule_timezone: string;
  channel: AutomationChannel;
  agent_id: string | null;
  whatsapp_template_id: string | null;
  retry_config: AutomationRetryConfig;
  workflow_id: string | null;
  max_global_limit_per_user: number;
  is_active: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  last_run_campaign_id: string | null;
  created_at: string;
  updated_at: string;
}
