-- Workflows and Workflow Nodes for Multi-Agent routing
CREATE TABLE IF NOT EXISTS public.workflows (
  id TEXT PRIMARY KEY,
  organisation_id UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  template_id TEXT,
  rules JSONB DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.workflow_nodes (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  node_type TEXT NOT NULL CHECK (node_type IN ('start', 'branch_retry')),
  outcome_condition TEXT,
  agent_id TEXT,
  agent_label TEXT,
  max_attempts INTEGER NOT NULL DEFAULT 1,
  max_connected_attempts INTEGER DEFAULT 1,
  delay_minutes INTEGER NOT NULL DEFAULT 0,
  action_description TEXT,
  is_terminal BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_workflows_org_id ON public.workflows(organisation_id);
CREATE INDEX IF NOT EXISTS idx_workflows_is_active ON public.workflows(organisation_id, is_active);
CREATE INDEX IF NOT EXISTS idx_workflow_nodes_wf_id ON public.workflow_nodes(workflow_id);

ALTER TABLE public.workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_nodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage workflows in their org"
  ON public.workflows
  FOR ALL
  USING (
    organisation_id IN (
      SELECT organisation_id FROM public.organisation_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can manage workflow_nodes in their org"
  ON public.workflow_nodes
  FOR ALL
  USING (
    workflow_id IN (
      SELECT id FROM public.workflows
      WHERE organisation_id IN (
        SELECT organisation_id FROM public.organisation_members
        WHERE user_id = auth.uid()
      )
    )
  );
