export type OutcomeCondition =
  | "interested"
  | "not_interested"
  | "callback"
  | "callback_requested"
  | "voicemail"
  | "no_conversation"
  | "no_answer"
  | "busy"
  | "wrong_number"
  | "dnd"
  | "others"
  | (string & {});

export type WorkflowActionType =
  | "stop_calling"
  | "call_again";

export interface OutcomeRule {
  id: string;
  variables: string[];
  action: WorkflowActionType;
  retries: number;
  delay_minutes?: number;
  agent_id: string | null;
  agent_name?: string | null;
  whatsapp_template?: string | null;
}

export interface WorkflowNode {
  id: string;
  workflow_id: string;
  node_type: "start" | "branch_retry";
  outcome_condition: OutcomeCondition | null;
  agent_id: string | null;
  agent_label?: string | null;
  max_attempts: number;
  max_connected_attempts?: number | null;
  delay_minutes: number;
  action_description?: string | null;
  is_terminal?: boolean;
}

export interface Workflow {
  id: string;
  organisation_id: string;
  name: string;
  description: string | null;
  template_id?: string | null;
  is_active: boolean;
  is_default: boolean;
  rules?: OutcomeRule[];
  nodes: WorkflowNode[];
  created_at: string;
  updated_at: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  tag: string;
  defaultNodes: Omit<WorkflowNode, "id" | "workflow_id">[];
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: "call_outcome_ladder",
    name: "Call Outcome Multi-Agent Ladder",
    description: "Standard qualification flow that routes Interested leads to CRM, stops on Not Interested, and triggers specific agent retry cadences for Callback, Voicemail, and Unanswered.",
    tag: "Recommended",
    defaultNodes: [
      {
        node_type: "start",
        outcome_condition: null,
        agent_id: null,
        max_attempts: 1,
        max_connected_attempts: 1,
        delay_minutes: 0,
        action_description: "Initial outreach call to qualify lead intent",
      },
      {
        node_type: "branch_retry",
        outcome_condition: "callback",
        agent_id: null,
        max_attempts: 3,
        delay_minutes: 60,
        action_description: "Re-dial lead at scheduled callback window or after 1 hour",
      },
      {
        node_type: "branch_retry",
        outcome_condition: "voicemail",
        agent_id: null,
        max_attempts: 2,
        delay_minutes: 240,
        action_description: "Retry calling 4 hours after voicemail was detected",
      },
      {
        node_type: "branch_retry",
        outcome_condition: "others",
        agent_id: null,
        max_attempts: 3,
        delay_minutes: 1440,
        action_description: "Retry daily (24h) for unanswered/busy lines, up to 3 times",
      },
    ],
  },
  {
    id: "presales_visit_ladder",
    name: "Pre-Sales & Site Visit Qualification",
    description: "Designed for real estate inbound/outbound leads to confirm budget, timeline, and schedule on-site tours.",
    tag: "Real Estate",
    defaultNodes: [
      {
        node_type: "start",
        outcome_condition: null,
        agent_id: null,
        max_attempts: 1,
        delay_minutes: 0,
        action_description: "Primary site visit & budget qualification",
      },
      {
        node_type: "branch_retry",
        outcome_condition: "callback",
        agent_id: null,
        max_attempts: 3,
        delay_minutes: 30,
        action_description: "Dedicated callback agent for high-intent queries",
      },
      {
        node_type: "branch_retry",
        outcome_condition: "others",
        agent_id: null,
        max_attempts: 4,
        delay_minutes: 720,
        action_description: "Rotate caller ID and retry twice daily",
      },
    ],
  },
  {
    id: "blank",
    name: "Custom Blank Workflow",
    description: "Build an outcome routing ladder from scratch with custom agent nodes and rules.",
    tag: "Custom",
    defaultNodes: [
      {
        node_type: "start",
        outcome_condition: null,
        agent_id: null,
        max_attempts: 1,
        delay_minutes: 0,
        action_description: "Start node",
      },
    ],
  },
];
