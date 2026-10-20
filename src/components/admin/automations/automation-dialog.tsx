"use client";

import * as React from "react";
import {
  Loader2Icon,
  SparklesIcon,
  BotIcon,
  PhoneCallIcon,
  GitBranchIcon,
  ShieldAlertIcon,
  ClockIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  createWorkspaceAutomation,
  updateWorkspaceAutomation,
} from "@/actions/admin/automations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type {
  AutomationChannel,
  AutomationFrequency,
  WorkspaceAutomation,
} from "@/types/automation";
import type { LeadIntent } from "@/types/lead";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organisationId: string;
  automation: WorkspaceAutomation | null;
  voiceAgents: Array<{ id: string; label: string }>;
  workflows: Array<{ id: string; name: string }>;
  whatsappTemplates?: Array<{ id: string; name: string }>;
  onSuccess?: () => void;
}

const DAYS_OF_WEEK = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
];

export function AutomationDialog({
  open,
  onOpenChange,
  organisationId,
  automation,
  voiceAgents,
  workflows,
  whatsappTemplates = [],
  onSuccess,
}: Props) {
  const [submitting, startSubmitting] = React.useTransition();

  const isEditing = Boolean(automation);

  // Form State
  const [name, setName] = React.useState(automation?.name || "");
  const [description, setDescription] = React.useState(automation?.description || "");
  const [intents, setIntents] = React.useState<LeadIntent[]>(
    automation?.cohort_filters?.intent || ["hot"],
  );
  const [minScore, setMinScore] = React.useState<number>(
    automation?.cohort_filters?.min_intent_score ?? 0,
  );
  const [time, setTime] = React.useState(automation?.schedule_time || "11:00");
  const [frequency, setFrequency] = React.useState<AutomationFrequency>(
    automation?.schedule_frequency || "daily",
  );
  const [intervalDays, setIntervalDays] = React.useState<number>(
    automation?.schedule_interval_days || 1,
  );
  const [selectedDays, setSelectedDays] = React.useState<number[]>(
    automation?.schedule_days_of_week || [1, 2, 3, 4, 5],
  );
  const [timezone, setTimezone] = React.useState(
    automation?.schedule_timezone || "Asia/Kolkata",
  );
  const [channel, setChannel] = React.useState<AutomationChannel>(
    automation?.channel || "voice_ai",
  );
  const [agentId, setAgentId] = React.useState(automation?.agent_id || "none");
  const [templateId, setTemplateId] = React.useState(
    automation?.whatsapp_template_id || "none",
  );
  const [workflowId, setWorkflowId] = React.useState(
    automation?.workflow_id || "none",
  );
  const [maxRetries, setMaxRetries] = React.useState<number>(
    automation?.retry_config?.max_retries ?? 2,
  );
  const [retryInterval, setRetryInterval] = React.useState<number>(
    automation?.retry_config?.retry_interval_minutes ?? 30,
  );
  const [maxConnected, setMaxConnected] = React.useState<number>(
    automation?.retry_config?.max_connected_attempts ?? 1,
  );
  const [maxGlobalLimit, setMaxGlobalLimit] = React.useState<number>(
    automation?.max_global_limit_per_user ?? 5,
  );
  const [isActive, setIsActive] = React.useState<boolean>(
    automation?.is_active ?? true,
  );

  // Reset form when dialog opens or changes
  React.useEffect(() => {
    if (automation) {
      setName(automation.name);
      setDescription(automation.description || "");
      setIntents(automation.cohort_filters?.intent || ["hot"]);
      setMinScore(automation.cohort_filters?.min_intent_score ?? 0);
      setTime(automation.schedule_time || "11:00");
      setFrequency(automation.schedule_frequency || "daily");
      setIntervalDays(automation.schedule_interval_days || 1);
      setSelectedDays(automation.schedule_days_of_week || [1, 2, 3, 4, 5]);
      setTimezone(automation.schedule_timezone || "Asia/Kolkata");
      setChannel(automation.channel || "voice_ai");
      setAgentId(automation.agent_id || "none");
      setTemplateId(automation.whatsapp_template_id || "none");
      setWorkflowId(automation.workflow_id || "none");
      setMaxRetries(automation.retry_config?.max_retries ?? 2);
      setRetryInterval(automation.retry_config?.retry_interval_minutes ?? 30);
      setMaxConnected(automation.retry_config?.max_connected_attempts ?? 1);
      setMaxGlobalLimit(automation.max_global_limit_per_user ?? 5);
      setIsActive(automation.is_active ?? true);
    } else {
      setName("");
      setDescription("");
      setIntents(["hot"]);
      setMinScore(0);
      setTime("11:00");
      setFrequency("daily");
      setIntervalDays(1);
      setSelectedDays([1, 2, 3, 4, 5]);
      setTimezone("Asia/Kolkata");
      setChannel("voice_ai");
      setAgentId(voiceAgents[0]?.id || "none");
      setTemplateId("none");
      setWorkflowId(workflows[0]?.id || "none");
      setMaxRetries(2);
      setRetryInterval(30);
      setMaxConnected(1);
      setMaxGlobalLimit(5);
      setIsActive(true);
    }
  }, [automation, voiceAgents, workflows]);

  function toggleIntent(intent: LeadIntent) {
    setIntents((prev) =>
      prev.includes(intent)
        ? prev.filter((i) => i !== intent)
        : [...prev, intent],
    );
  }

  function toggleDay(day: number) {
    setSelectedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Please enter a name for the automation job");
      return;
    }
    if (intents.length === 0) {
      toast.error("Please select at least one cohort intent (e.g. Hot)");
      return;
    }

    startSubmitting(async () => {
      const payload = {
        organisation_id: organisationId,
        name: name.trim(),
        description: description.trim() || null,
        cohort_filters: {
          intent: intents,
          min_intent_score: minScore > 0 ? minScore : undefined,
        },
        schedule_time: time,
        schedule_frequency: frequency,
        schedule_interval_days: intervalDays,
        schedule_days_of_week: selectedDays,
        schedule_timezone: timezone,
        channel,
        agent_id: agentId === "none" ? null : agentId,
        whatsapp_template_id: templateId === "none" ? null : templateId,
        workflow_id: workflowId === "none" ? null : workflowId,
        retry_config: {
          max_retries: maxRetries,
          retry_interval_minutes: retryInterval,
          max_connected_attempts: maxConnected,
        },
        max_global_limit_per_user: maxGlobalLimit,
        is_active: isActive,
      };

      if (isEditing && automation) {
        const res = await updateWorkspaceAutomation({
          ...payload,
          id: automation.id,
        });
        if (res.success) {
          toast.success("Automation job updated");
          onOpenChange(false);
          onSuccess?.();
        } else {
          toast.error(res.error);
        }
      } else {
        const res = await createWorkspaceAutomation(payload);
        if (res.success) {
          toast.success("Automation job created");
          onOpenChange(false);
          onSuccess?.();
        } else {
          toast.error(res.error);
        }
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] sm:max-w-2xl md:max-w-3xl max-h-[90vh] overflow-y-auto p-6 sm:p-7 md:p-8">
        <DialogHeader className="pb-4 border-b border-border/60">
          <div className="flex items-start gap-3.5">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-primary/25 bg-primary/10 text-primary shadow-xs">
              <SparklesIcon className="size-5" />
            </span>
            <div className="space-y-1">
              <DialogTitle className="text-lg font-semibold tracking-tight text-foreground">
                {isEditing ? "Edit Workflow Automation" : "Create Workflow Automation Job"}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground leading-relaxed">
                Schedule recurring outreach on qualified lead cohorts with custom multi-agent workflow & retry ladders.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6 pt-4">
          {/* Job Name */}
          <div className="space-y-2">
            <Label htmlFor="auto-name" className="text-xs font-semibold text-foreground">
              Job Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="auto-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Daily 11:00 AM Hot Leads Dialler"
              className="h-10 text-sm bg-background border-border shadow-2xs focus-visible:border-primary focus-visible:ring-primary/20"
              required
            />
          </div>

          {/* Who: Cohort Definition */}
          <div className="rounded-xl border border-border/80 bg-card p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold text-foreground flex items-center gap-2">
                <SparklesIcon className="size-3.5 text-primary" />
                Target Cohort (Who to Call)
              </Label>
              <span className="text-[11px] text-muted-foreground">
                Target leads matching selected intent
              </span>
            </div>

            <div className="space-y-2">
              <span className="text-[11px] font-medium text-muted-foreground block">
                Lead Intent:
              </span>
              <div className="flex flex-wrap items-center gap-2.5">
                {(["hot", "warm", "cold"] as LeadIntent[]).map((i) => {
                  const selected = intents.includes(i);
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => toggleIntent(i)}
                      className={cn(
                        "inline-flex items-center gap-2 px-3.5 py-2 rounded-sm border text-xs font-medium transition-all cursor-pointer shadow-2xs select-none",
                        selected
                          ? i === "hot"
                            ? "bg-destructive-muted border-destructive/40 text-destructive font-semibold shadow-xs"
                            : i === "warm"
                              ? "bg-warning-muted border-warning/40 text-warning font-semibold shadow-xs"
                              : "bg-info-muted border-info/40 text-info font-semibold shadow-xs"
                          : "bg-background border-border/80 text-muted-foreground hover:bg-muted/60 hover:text-foreground opacity-60",
                      )}
                    >
                      <span
                        className={cn(
                          "size-2 rounded-full",
                          i === "hot"
                            ? "bg-destructive"
                            : i === "warm"
                              ? "bg-warning"
                              : "bg-info",
                        )}
                      />
                      <span className="tracking-wide uppercase text-[11px]">
                        {i} Leads
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* When & Frequency */}
          <div className="rounded-xl border border-border/80 bg-card p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold text-foreground flex items-center gap-2">
                <ClockIcon className="size-3.5 text-primary" />
                Schedule & Frequency
              </Label>
              <span className="text-[11px] text-muted-foreground">
                Automated recurring trigger
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="auto-time" className="text-xs text-muted-foreground">
                  Execution Time (HH:mm, 24h)
                </Label>
                <Input
                  id="auto-time"
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="h-10 text-sm font-mono bg-background border-border"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  How Frequently
                </Label>
                <Select
                  value={frequency}
                  onValueChange={(val) => setFrequency(val as AutomationFrequency)}
                >
                  <SelectTrigger className="w-full h-10 text-sm bg-background border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="start">
                    <SelectItem value="daily">Daily (Every Day)</SelectItem>
                    <SelectItem value="weekdays">Weekdays (Mon - Fri)</SelectItem>
                    <SelectItem value="weekly">Weekly on Specific Days</SelectItem>
                    <SelectItem value="fixed_interval">Fixed Interval (Every X Days)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {frequency === "weekly" && (
              <div className="space-y-2 pt-1 border-t border-border/50">
                <span className="text-xs text-muted-foreground block font-medium">
                  Select Days of Week:
                </span>
                <div className="flex flex-wrap gap-2">
                  {DAYS_OF_WEEK.map((d) => {
                    const isSel = selectedDays.includes(d.value);
                    return (
                      <button
                        key={d.value}
                        type="button"
                        onClick={() => toggleDay(d.value)}
                        className={cn(
                          "px-3 py-1.5 text-xs font-medium rounded-sm border transition-all cursor-pointer shadow-2xs",
                          isSel
                            ? "bg-primary text-primary-foreground border-primary shadow-xs font-semibold"
                            : "bg-background border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                      >
                        {d.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {frequency === "fixed_interval" && (
              <div className="space-y-1.5 pt-1 max-w-xs border-t border-border/50">
                <Label className="text-xs text-muted-foreground">
                  Interval (Every N Days)
                </Label>
                <Input
                  type="number"
                  min={1}
                  max={30}
                  value={intervalDays}
                  onChange={(e) => setIntervalDays(Math.max(1, Number(e.target.value) || 1))}
                  className="h-9 text-xs font-mono bg-background border-border"
                />
              </div>
            )}
          </div>

          {/* Channel & Voice Agent Card */}
          <div className="rounded-xl border border-border/80 bg-card p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold text-foreground flex items-center gap-2">
                <PhoneCallIcon className="size-3.5 text-primary" />
                Channel & Voice Agent
              </Label>
              <span className="text-[11px] text-muted-foreground">
                Outbound voice dialling configuration
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Channel
                </Label>
                <div className="h-10 px-3.5 rounded-lg border border-border/80 bg-muted/30 flex items-center justify-between text-xs font-medium text-foreground">
                  <span className="flex items-center gap-2">
                    <span className="size-2 rounded-full bg-success" />
                    Voice AI (Outbound Dialling)
                  </span>
                  <Badge variant="success" className="text-[10px] font-semibold tracking-wider">
                    ACTIVE
                  </Badge>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Voice Agent
                </Label>
                <Select value={agentId} onValueChange={(val) => setAgentId(val ?? "none")}>
                  <SelectTrigger className="w-full h-10 text-sm bg-background border-border">
                    <SelectValue placeholder="Default Workspace Agent" />
                  </SelectTrigger>
                  <SelectContent align="start">
                    <SelectItem value="none">Default Workspace Agent</SelectItem>
                    {voiceAgents.map((a) => (
                      <SelectItem key={a.id} value={a.id} className="text-xs">
                        {a.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Workflow & Retry Config */}
          <div className="rounded-xl border border-border/80 bg-card p-5 shadow-xs space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold flex items-center gap-1.5 text-foreground">
                <GitBranchIcon className="size-3.5 text-primary" />
                Workflow (Multi-Agent Routing Ladder)
              </Label>
              <Select value={workflowId} onValueChange={(val) => setWorkflowId(val ?? "none")}>
                <SelectTrigger className="w-full h-10 text-sm bg-background border-border">
                  <SelectValue placeholder="No workflow (Standard outcome policy)" />
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectItem value="none">None (Standard outcome policy)</SelectItem>
                  {workflows.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Max Retries</Label>
                <Input
                  type="number"
                  min={0}
                  max={10}
                  value={maxRetries}
                  onChange={(e) => setMaxRetries(Number(e.target.value) || 0)}
                  className="h-9.5 text-xs font-mono bg-background border-border"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Max Connected</Label>
                <Input
                  type="number"
                  min={1}
                  max={10}
                  value={maxConnected}
                  onChange={(e) => setMaxConnected(Number(e.target.value) || 1)}
                  className="h-9.5 text-xs font-mono bg-background border-border"
                />
              </div>
            </div>
          </div>

          {/* Max Global Limit on Each User (Skelo highlight surface) */}
          <div className="rounded-xl border border-highlight-border bg-highlight/60 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-2xs">
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-highlight-foreground flex items-center gap-1.5">
                <ShieldAlertIcon className="size-4 text-primary" />
                Max Global Limit per Contact
              </Label>
              <p className="text-[11px] text-muted-foreground leading-relaxed max-w-md">
                Ceiling on total calls across history to protect leads from fatigue and spam.
              </p>
            </div>
            <div className="w-24 sm:w-28 shrink-0">
              <Input
                type="number"
                min={1}
                max={50}
                value={maxGlobalLimit}
                onChange={(e) => setMaxGlobalLimit(Math.max(1, Number(e.target.value) || 5))}
                className="h-10 text-sm font-semibold font-mono text-center bg-background border-border shadow-2xs"
              />
            </div>
          </div>

          {/* Active Status */}
          <div className="flex items-center justify-between p-4.5 rounded-xl border border-border/80 bg-muted/20">
            <div className="space-y-0.5">
              <Label htmlFor="auto-active" className="text-xs font-semibold text-foreground">
                Automation Enabled
              </Label>
              <p className="text-[11px] text-muted-foreground">
                When enabled, cron automatically executes this job at the scheduled time.
              </p>
            </div>
            <Switch
              id="auto-active"
              checked={isActive}
              onCheckedChange={setIsActive}
            />
          </div>

          <DialogFooter className="pt-4 border-t border-border/60 gap-2.5 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
              className="h-10 px-5 text-sm"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={submitting}
              className="h-10 px-5 text-sm font-medium"
            >
              {submitting ? (
                <>
                  <Loader2Icon className="size-3.5 animate-spin mr-1.5" />
                  Saving…
                </>
              ) : isEditing ? (
                "Save Changes"
              ) : (
                "Create Automation Job"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

