"use client";

import * as React from "react";
import {
  PlayIcon,
  PencilIcon,
  Trash2Icon,
  ClockIcon,
  ShieldAlertIcon,
  SparklesIcon,
  BotIcon,
  PhoneCallIcon,
  GitBranchIcon,
  CalendarIcon,
  Loader2Icon,
  PlusIcon,
  CheckCircle2Icon,
} from "lucide-react";
import { toast } from "sonner";

import {
  deleteWorkspaceAutomation,
  toggleWorkspaceAutomation,
  triggerWorkspaceAutomationNow,
} from "@/actions/admin/automations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { AutomationDialog } from "./automation-dialog";
import type { WorkspaceAutomation } from "@/types/automation";

interface Props {
  organisationId: string;
  automations: WorkspaceAutomation[];
  voiceAgents: Array<{ id: string; label: string }>;
  workflows: Array<{ id: string; name: string }>;
  whatsappTemplates?: Array<{ id: string; name: string }>;
}

export function AutomationTable({
  organisationId,
  automations: initialAutomations,
  voiceAgents,
  workflows,
  whatsappTemplates = [],
}: Props) {
  const [automations, setAutomations] = React.useState(initialAutomations);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editingAutomation, setEditingAutomation] =
    React.useState<WorkspaceAutomation | null>(null);

  const [triggeringId, setTriggeringId] = React.useState<string | null>(null);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  // Sync state if initialAutomations changes
  React.useEffect(() => {
    setAutomations(initialAutomations);
  }, [initialAutomations]);

  async function handleToggle(auto: WorkspaceAutomation, nextActive: boolean) {
    const prev = automations;
    setAutomations((curr) =>
      curr.map((a) => (a.id === auto.id ? { ...a, is_active: nextActive } : a)),
    );

    const res = await toggleWorkspaceAutomation(
      auto.id,
      organisationId,
      nextActive,
    );
    if (!res.success) {
      toast.error(res.error);
      setAutomations(prev);
    } else {
      toast.success(
        nextActive
          ? `Automation "${auto.name}" activated`
          : `Automation "${auto.name}" paused`,
      );
    }
  }

  async function handleRunNow(auto: WorkspaceAutomation) {
    setTriggeringId(auto.id);
    try {
      const res = await triggerWorkspaceAutomationNow(auto.id, organisationId);
      if (res.success) {
        if (res.data.leadsFound > 0) {
          toast.success(
            `Fired automation! Targeted ${res.data.leadsFound} eligible leads in a new campaign.`,
          );
        } else {
          toast.info(
            "Automation ran successfully, but no eligible leads matched the cohort under the global cap.",
          );
        }
      } else {
        toast.error(res.error);
      }
    } finally {
      setTriggeringId(null);
    }
  }

  async function handleDelete(auto: WorkspaceAutomation) {
    if (!confirm(`Are you sure you want to delete automation "${auto.name}"?`)) {
      return;
    }

    setDeletingId(auto.id);
    try {
      const res = await deleteWorkspaceAutomation(auto.id, organisationId);
      if (res.success) {
        toast.success("Automation deleted");
        setAutomations((curr) => curr.filter((a) => a.id !== auto.id));
      } else {
        toast.error(res.error);
      }
    } finally {
      setDeletingId(null);
    }
  }

  const agentMap = new Map(voiceAgents.map((a) => [a.id, a.label]));
  const workflowMap = new Map(workflows.map((w) => [w.id, w.name]));

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground tracking-tight">
            Scheduled Automation Jobs ({automations.length})
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Automated cohort calling and outreach executed on schedule via cron.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditingAutomation(null);
            setDialogOpen(true);
          }}
          className="text-xs h-8 gap-1.5 self-start sm:self-auto"
        >
          <PlusIcon className="size-3.5" /> New Automation Job
        </Button>
      </div>

      {automations.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/80 bg-card p-10 text-center space-y-3">
          <div className="mx-auto grid size-12 place-items-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
            <SparklesIcon className="size-6" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-foreground">
              No automation jobs configured yet
            </h3>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              Set up scheduled cron jobs to automatically dial Hot leads with custom agent ladders and frequency caps.
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => {
              setEditingAutomation(null);
              setDialogOpen(true);
            }}
            className="text-xs h-8"
          >
            Create first automation
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border/70 bg-card shadow-xs">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-border/70 bg-muted/40 text-[11px] font-semibold text-muted-foreground">
                <th className="py-3 px-3.5 w-48">Name</th>
                <th className="py-3 px-3.5 w-44">Who (Cohort)</th>
                <th className="py-3 px-3.5 w-28">When</th>
                <th className="py-3 px-3.5 w-32">How Frequently</th>
                <th className="py-3 px-3.5 w-28">Channel</th>
                <th className="py-3 px-3.5 w-36">Comms (Agent ID)</th>
                <th className="py-3 px-3.5 w-36">Retry Config</th>
                <th className="py-3 px-3.5 w-40">Workflow</th>
                <th className="py-3 px-3.5 w-32 bg-highlight/40 text-highlight-foreground border-l border-r border-highlight-border/40 font-semibold">
                  Max Global Limit
                </th>
                <th className="py-3 px-3.5 text-right w-36">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {automations.map((auto) => {
                const retry = auto.retry_config || {
                  max_retries: 2,
                  retry_interval_minutes: 30,
                  max_connected_attempts: 1,
                };
                const agentLabel = auto.agent_id
                  ? agentMap.get(auto.agent_id) || auto.agent_id
                  : "Default Agent";
                const wfName = auto.workflow_id
                  ? workflowMap.get(auto.workflow_id) || auto.workflow_id
                  : "None";
                const isTriggering = triggeringId === auto.id;
                const isDeleting = deletingId === auto.id;

                const cohortIntents = auto.cohort_filters?.intent || ["hot"];

                return (
                  <tr
                    key={auto.id}
                    className={`hover:bg-muted/30 transition-colors ${
                      !auto.is_active ? "opacity-60 bg-muted/10" : ""
                    }`}
                  >
                    {/* Name */}
                    <td className="py-3 px-3.5 align-top">
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-foreground text-xs leading-snug">
                            {auto.name}
                          </span>
                        </div>
                        {auto.description && (
                          <p className="text-[10px] text-muted-foreground line-clamp-1">
                            {auto.description}
                          </p>
                        )}
                        <div className="flex items-center gap-1.5 pt-0.5">
                          <Switch
                            checked={auto.is_active}
                            onCheckedChange={(checked) =>
                              handleToggle(auto, checked)
                            }
                          />
                          <span className="text-[10px] font-medium text-muted-foreground">
                            {auto.is_active ? "Active" : "Paused"}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Who (Cohort) */}
                    <td className="py-3 px-3.5 align-top">
                      <div className="flex flex-wrap gap-1">
                        {cohortIntents.map((i) => (
                          <span
                            key={i}
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10px] font-semibold uppercase ${
                              i === "hot"
                                ? "bg-destructive-muted text-destructive border border-destructive/30"
                                : i === "warm"
                                  ? "bg-warning-muted text-warning border border-warning/30"
                                  : "bg-info-muted text-info border border-info/30"
                            }`}
                          >
                            <span
                              className={`size-1.5 rounded-full ${
                                i === "hot"
                                  ? "bg-destructive"
                                  : i === "warm"
                                    ? "bg-warning"
                                    : "bg-info"
                              }`}
                            />
                            {i}
                          </span>
                        ))}
                        {auto.cohort_filters?.min_intent_score ? (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm bg-muted text-[10px] font-mono text-muted-foreground border border-border/60">
                            Score ≥ {auto.cohort_filters.min_intent_score}
                          </span>
                        ) : null}
                      </div>
                    </td>

                    {/* When */}
                    <td className="py-3 px-3.5 align-top">
                      <div className="font-mono text-xs font-semibold text-foreground flex items-center gap-1">
                        <ClockIcon className="size-3 text-muted-foreground" />
                        {auto.schedule_time}
                      </div>
                      <div className="text-[10px] text-muted-foreground truncate">
                        {auto.schedule_timezone?.split("/")[1] || "IST"}
                      </div>
                    </td>

                    {/* How Frequently */}
                    <td className="py-3 px-3.5 align-top">
                      <Badge variant="outline" className="text-[10px] font-medium capitalize">
                        {auto.schedule_frequency === "fixed_interval"
                          ? `Every ${auto.schedule_interval_days}d`
                          : auto.schedule_frequency}
                      </Badge>
                      {auto.schedule_frequency === "weekly" &&
                      auto.schedule_days_of_week?.length > 0 ? (
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {auto.schedule_days_of_week
                            .map((d) => ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][d - 1])
                            .join(", ")}
                        </div>
                      ) : null}
                    </td>

                    {/* Channel */}
                    <td className="py-3 px-3.5 align-top">
                      <Badge variant="success" className="text-[10px] gap-1">
                        <PhoneCallIcon className="size-2.5" />
                        Voice AI
                      </Badge>
                    </td>

                    {/* Comms (Agent / WA) */}
                    <td className="py-3 px-3.5 align-top">
                      <div className="font-medium text-foreground text-[11px] truncate max-w-[140px]">
                        {agentLabel}
                      </div>
                      {auto.agent_id && (
                        <div className="font-mono text-[9px] text-muted-foreground truncate max-w-[140px]">
                          {auto.agent_id}
                        </div>
                      )}
                    </td>

                    {/* Retry Config */}
                    <td className="py-3 px-3.5 align-top">
                      <div className="text-[11px] font-medium text-foreground">
                        {retry.max_retries} Retries
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {retry.max_connected_attempts} max connected
                      </div>
                    </td>

                    {/* Workflow */}
                    <td className="py-3 px-3.5 align-top">
                      {auto.workflow_id ? (
                        <Badge variant="secondary" className="gap-1 text-[10px] font-medium">
                          <GitBranchIcon className="size-2.5 text-primary" />
                          <span className="truncate max-w-[120px]">{wfName}</span>
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-[10px]">—</span>
                      )}
                    </td>

                    {/* Max Global Limit */}
                    <td className="py-3 px-3.5 align-top bg-highlight/20 border-l border-r border-highlight-border/30">
                      <span className="inline-flex items-center gap-1 rounded-sm bg-highlight text-highlight-foreground border border-highlight-border px-2 py-0.5 font-semibold font-mono text-[11px] shadow-2xs">
                        <ShieldAlertIcon className="size-3 text-primary" />
                        {auto.max_global_limit_per_user} calls
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="py-3 px-3.5 align-top text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => handleRunNow(auto)}
                          disabled={isTriggering}
                          className="h-7 text-[10px] px-2 font-medium border-primary/30 text-primary hover:bg-primary/10"
                          title="Run automation job now"
                        >
                          {isTriggering ? (
                            <Loader2Icon className="size-3 animate-spin" />
                          ) : (
                            <>
                              <PlayIcon className="size-3 mr-0.5 fill-current" /> Run Now
                            </>
                          )}
                        </Button>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          onClick={() => {
                            setEditingAutomation(auto);
                            setDialogOpen(true);
                          }}
                          className="size-7 text-muted-foreground hover:text-foreground"
                          title="Edit automation"
                        >
                          <PencilIcon className="size-3.5" />
                        </Button>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          onClick={() => handleDelete(auto)}
                          disabled={isDeleting}
                          className="size-7 text-muted-foreground hover:text-destructive"
                          title="Delete automation"
                        >
                          {isDeleting ? (
                            <Loader2Icon className="size-3 animate-spin" />
                          ) : (
                            <Trash2Icon className="size-3.5" />
                          )}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / Edit Dialog */}
      <AutomationDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        organisationId={organisationId}
        automation={editingAutomation}
        voiceAgents={voiceAgents}
        workflows={workflows}
        whatsappTemplates={whatsappTemplates}
        onSuccess={() => {
          // Re-trigger server render
          window.location.reload();
        }}
      />
    </div>
  );
}
