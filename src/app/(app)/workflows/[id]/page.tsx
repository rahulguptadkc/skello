import { notFound } from "next/navigation";

import { listVoiceAgents } from "@/actions/voice-agents";
import { getWorkflow } from "@/actions/workflows";
import { WorkflowBuilder } from "@/components/app/workflows/workflow-builder";
import { requireSession } from "@/lib/auth/session";

export const metadata = { title: "Edit Workflow · Skelo" };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function WorkflowDetailPage({ params }: Props) {
  const { id } = await params;
  const session = await requireSession();

  const [workflowRes, agentsRes] = await Promise.all([
    getWorkflow(id),
    listVoiceAgents(session.organisation.id),
  ]);

  if (!workflowRes.success) {
    notFound();
  }

  const voiceAgents = agentsRes.success ? agentsRes.data : [];

  return (
    <WorkflowBuilder
      workflow={workflowRes.data}
      voiceAgents={voiceAgents}
      organisationId={session.organisation.id}
    />
  );
}
