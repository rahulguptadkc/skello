-- Workspace Lead Automations for Scheduled Workflow Execution (Hot Leads, etc.)
CREATE TABLE IF NOT EXISTS public.workspace_automations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  -- Cohort definition: lead intent (e.g. ["hot"]), outcomes, status, min_intent_score
  cohort_filters JSONB NOT NULL DEFAULT '{"intent": ["hot"]}'::jsonb,
  -- Schedule timing
  schedule_time TEXT NOT NULL DEFAULT '11:00', -- HH:mm (24-hour format)
  schedule_frequency TEXT NOT NULL DEFAULT 'daily' CHECK (schedule_frequency IN ('daily', 'weekdays', 'weekly', 'fixed_interval')),
  schedule_interval_days INTEGER NOT NULL DEFAULT 1,
  schedule_days_of_week JSONB NOT NULL DEFAULT '[]'::jsonb, -- e.g. [1, 2, 3, 4, 5] (1=Mon, 7=Sun)
  schedule_timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  -- Channel & Communications (Voice AI)
  channel TEXT NOT NULL DEFAULT 'voice_ai' CHECK (channel = 'voice_ai'),
  agent_id TEXT REFERENCES public.voice_agents(agent_id) ON DELETE SET NULL,
  whatsapp_template_id TEXT,
  -- Retry configuration
  retry_config JSONB NOT NULL DEFAULT '{"max_retries": 2, "retry_interval_minutes": 30, "max_connected_attempts": 1}'::jsonb,
  -- Workflow
  workflow_id TEXT REFERENCES public.workflows(id) ON DELETE SET NULL,
  -- Max global limit on each user/lead (cap total attempts across history)
  max_global_limit_per_user INTEGER NOT NULL DEFAULT 5,
  -- State & Execution
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  last_run_campaign_id UUID REFERENCES public.campaigns(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_workspace_automations_org_id ON public.workspace_automations(organisation_id);
CREATE INDEX IF NOT EXISTS idx_workspace_automations_due ON public.workspace_automations(is_active, next_run_at) WHERE is_active = true;

ALTER TABLE public.workspace_automations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view automations in their org"
  ON public.workspace_automations
  FOR SELECT
  USING (
    organisation_id IN (
      SELECT organisation_id FROM public.organisation_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can manage automations in their org"
  ON public.workspace_automations
  FOR ALL
  USING (
    organisation_id IN (
      SELECT organisation_id FROM public.organisation_members
      WHERE user_id = auth.uid()
    )
  );
