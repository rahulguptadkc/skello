import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, SparklesIcon } from "lucide-react";

import { getOrganisationAdmin } from "@/actions/admin/organisations";
import { listWorkspaceAutomations } from "@/actions/admin/automations";
import { AutomationTable } from "@/components/admin/automations/automation-table";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Automations · Organisation · Admin · Skelo" };

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminOrganisationAutomationsPage({
  params,
}: PageProps) {
  const { id } = await params;
  const admin = createAdminClient();

  const [orgResult, automationsResult, voiceAgentsRes, workflowsRes, integrationRes] =
    await Promise.all([
      getOrganisationAdmin(id),
      listWorkspaceAutomations(id),
      admin
        .from("voice_agents")
        .select("agent_id, label")
        .eq("organisation_id", id)
        .eq("enabled", true),
      admin
        .from("workflows")
        .select("id, name")
        .eq("organisation_id", id)
        .eq("is_active", true),
      admin
        .from("bolna_integrations")
        .select("agent_id")
        .eq("organisation_id", id)
        .maybeSingle<{ agent_id: string }>(),
    ]);

  if (!orgResult.success) {
    if (orgResult.error === "Organisation not found") notFound();
    return (
      <div className="p-6 text-destructive">
        {orgResult.error}
      </div>
    );
  }

  const org = orgResult.data;
  const automations = automationsResult.success ? automationsResult.data : [];

  // Combine voice agents
  const voiceAgentOptions: Array<{ id: string; label: string }> = [];
  if (integrationRes.data?.agent_id) {
    voiceAgentOptions.push({
      id: integrationRes.data.agent_id,
      label: `Default Agent (${integrationRes.data.agent_id})`,
    });
  }
  for (const va of voiceAgentsRes.data ?? []) {
    if (!voiceAgentOptions.some((o) => o.id === va.agent_id)) {
      voiceAgentOptions.push({
        id: va.agent_id,
        label: va.label || va.agent_id,
      });
    }
  }

  const workflowOptions = (workflowsRes.data ?? []).map((w) => ({
    id: w.id,
    name: w.name,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2"
          render={<Link href={`/admin/organisations/${org.id}`} />}
        >
          <ArrowLeftIcon /> Back to {org.name}
        </Button>
      </div>

      <header className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-lg border border-primary/25 bg-primary/10 text-primary shadow-xs">
            <SparklesIcon className="size-4.5" />
          </span>
          <h1 className="font-heading text-2xl font-semibold leading-tight tracking-tight md:text-3xl">
            Lead Workflow Automations
          </h1>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Workspace: <span className="font-medium text-foreground">{org.name}</span> ({org.slug}) · Define scheduled cron triggers to automatically call Hot leads with dedicated workflows, retries, and global fatigue ceilings.
        </p>
      </header>

      <Separator />

      <AutomationTable
        organisationId={org.id}
        automations={automations}
        voiceAgents={voiceAgentOptions}
        workflows={workflowOptions}
      />
    </div>
  );
}
