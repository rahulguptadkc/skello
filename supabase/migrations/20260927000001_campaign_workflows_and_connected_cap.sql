-- Add workflow_id, workflow_name and max_connected_attempts to campaigns
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS workflow_id TEXT REFERENCES public.workflows(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS workflow_name TEXT,
  ADD COLUMN IF NOT EXISTS max_connected_attempts SMALLINT DEFAULT 1;

ALTER TABLE public.campaign_contacts
  ADD COLUMN IF NOT EXISTS connected_count SMALLINT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_campaigns_workflow_id ON public.campaigns(workflow_id);

