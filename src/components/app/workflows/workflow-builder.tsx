"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeftIcon,
  BotIcon,
  CheckIcon,
  ChevronDownIcon,
  Code2Icon,
  CopyIcon,
  GripVerticalIcon,
  Loader2Icon,
  MinusIcon,
  MoreHorizontalIcon,
  PhoneCallIcon,
  PhoneOffIcon,
  PlusIcon,
  SaveIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { deleteWorkflow, saveWorkflow } from "@/actions/workflows";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { VoiceAgent } from "@/types/voice-agent";
import type { OutcomeRule, Workflow, WorkflowActionType } from "@/types/workflow";

interface Props {
  workflow: Workflow;
  voiceAgents: VoiceAgent[];
  organisationId: string;
}

const COMMON_VARIABLES = [
  "interested",
  "not_interested",
  "callback_requested",
  "no_conversation",
  "no_answer",
  "busy",
  "voicemail",
  "wrong_number",
  "dnd",
  "call_dropped",
  "call_disconnected",
  "customer_hung_up",
  "language_barrier",
  "rescheduled",
];

const ACTION_DESCRIPTIONS: Record<
  "stop_calling" | "call_again",
  { label: string; description: string; icon: React.ReactNode }
> = {
  stop_calling: {
    label: "Stop calling",
    description: "Close the lead. No more calls.",
    icon: <PhoneOffIcon className="size-4 text-muted-foreground" />,
  },
  call_again: {
    label: "Call again",
    description: "Retry at a set frequency with the chosen agent.",
    icon: <PhoneCallIcon className="size-4 text-emerald-600 dark:text-emerald-400" />,
  },
};

const AGENT_COLORS = [
  "bg-teal-700 text-white",
  "bg-amber-600 text-white",
  "bg-indigo-600 text-white",
  "bg-rose-600 text-white",
  "bg-emerald-700 text-white",
  "bg-sky-600 text-white",
];

export function WorkflowBuilder({
  workflow,
  voiceAgents,
  organisationId,
}: Props) {
  const router = useRouter();

  // Workflow metadata
  const [name, setName] = React.useState(workflow.name);
  const [isActive, setIsActive] = React.useState(workflow.is_active);
  const [searchQuery, setSearchQuery] = React.useState("");

  // Modals
  const [saving, setSaving] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [isDeleting, startDeleting] = React.useTransition();
  const [jsonOpen, setJsonOpen] = React.useState(false);

  // Workspace agents
  const availableAgents = React.useMemo(() => {
    if (voiceAgents && voiceAgents.length > 0) {
      return voiceAgents.map((a, idx) => ({
        id: a.agent_id,
        name: a.label || `Agent (${a.agent_id.substring(0, 8)})`,
        color: AGENT_COLORS[idx % AGENT_COLORS.length],
        enabled: a.enabled,
      }));
    }
    return [];
  }, [voiceAgents]);

  // Outcome Rules Initialization
  const [rules, setRules] = React.useState<OutcomeRule[]>(() => {
    if (workflow.rules && workflow.rules.length > 0) {
      return workflow.rules;
    }
    return [
      {
        id: "rule_1",
        variables: ["interested"],
        action: "stop_calling",
        retries: 0,
        agent_id: null,
      },
      {
        id: "rule_2",
        variables: ["not_interested"],
        action: "stop_calling",
        retries: 0,
        agent_id: null,
      },
      {
        id: "rule_3",
        variables: ["callback_requested"],
        action: "call_again",
        retries: 2,
        agent_id: availableAgents[0]?.id || null,
        agent_name: availableAgents[0]?.name || "Default agent",
      },
      {
        id: "rule_4",
        variables: ["no_conversation"],
        action: "call_again",
        retries: 2,
        agent_id: availableAgents[0]?.id || null,
        agent_name: availableAgents[0]?.name || "Default agent",
      },
      {
        id: "rule_5",
        variables: ["no_answer", "busy"],
        action: "call_again",
        retries: 2,
        agent_id: availableAgents[0]?.id || null,
        agent_name: availableAgents[0]?.name || "Default agent",
      },
      {
        id: "rule_6",
        variables: ["wrong_number", "dnd"],
        action: "stop_calling",
        retries: 0,
        agent_id: null,
      },
    ];
  });

  // Filtered rules
  const filteredRules = React.useMemo(() => {
    if (!searchQuery.trim()) return rules;
    const q = searchQuery.toLowerCase();
    return rules.filter(
      (r) =>
        r.variables.some((v) => v.toLowerCase().includes(q)) ||
        r.action.toLowerCase().includes(q) ||
        (r.agent_name && r.agent_name.toLowerCase().includes(q)),
    );
  }, [rules, searchQuery]);

  // Summary counts
  const totalCalls = rules.filter((r) => r.action === "call_again").length;

  // Rule modification helpers
  function updateRule(ruleId: string, updates: Partial<OutcomeRule>) {
    setRules((prev) =>
      prev.map((r) => (r.id === ruleId ? { ...r, ...updates } : r)),
    );
  }

  function addVariable(ruleId: string, variable: string) {
    const clean = variable.trim().toLowerCase().replace(/\s+/g, "_");
    if (!clean) return;
    setRules((prev) =>
      prev.map((r) => {
        if (r.id !== ruleId) return r;
        if (r.variables.includes(clean)) return r;
        return { ...r, variables: [...r.variables, clean] };
      }),
    );
  }

  function removeVariable(ruleId: string, variable: string) {
    setRules((prev) =>
      prev.map((r) => {
        if (r.id !== ruleId) return r;
        return {
          ...r,
          variables: r.variables.filter((v) => v !== variable),
        };
      }),
    );
  }

  function deleteRule(ruleId: string) {
    if (rules.length <= 1) {
      toast.error("Workflow must have at least one outcome rule");
      return;
    }
    setRules((prev) => prev.filter((r) => r.id !== ruleId));
  }

  function duplicateRule(ruleId: string) {
    const existing = rules.find((r) => r.id === ruleId);
    if (!existing) return;
    const newRule: OutcomeRule = {
      ...existing,
      id: `rule_${Date.now()}`,
      variables: [...existing.variables],
    };
    setRules((prev) => [...prev, newRule]);
    toast.success("Outcome row duplicated");
  }

  function moveRule(index: number, direction: "up" | "down") {
    const targetIdx = direction === "up" ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= rules.length) return;
    setRules((prev) => {
      const next = [...prev];
      const temp = next[index];
      next[index] = next[targetIdx];
      next[targetIdx] = temp;
      return next;
    });
  }

  function addNewOutcomeRow(initialVariable?: string) {
    const newId = `rule_${Date.now()}`;
    const newRule: OutcomeRule = {
      id: newId,
      variables: initialVariable ? [initialVariable] : [],
      action: "call_again",
      retries: 2,
      agent_id: availableAgents[0]?.id || null,
      agent_name: availableAgents[0]?.name || "Arjun",
    };
    setRules((prev) => [...prev, newRule]);
    toast.success("New outcome row added");
  }

  async function handleSave() {
    if (!name.trim()) {
      toast.error("Workflow name cannot be empty");
      return;
    }

    setSaving(true);
    try {
      const res = await saveWorkflow({
        id: workflow.id,
        organisation_id: organisationId,
        name: name.trim(),
        description: workflow.description || null,
        is_active: isActive,
        rules,
        nodes: rules.map((r, i) => ({
          node_type: i === 0 ? "start" : "branch_retry",
          outcome_condition: r.variables[0] || "others",
          agent_id: r.agent_id,
          agent_label: r.agent_name,
          max_attempts: r.action.startsWith("call") ? r.retries : 1,
          delay_minutes: r.delay_minutes || 60,
          action_description: `Matches: ${r.variables.join(", ")}`,
        })),
      });

      if (!res.success) {
        toast.error("Failed to save workflow", { description: res.error });
        return;
      }

      toast.success("Workflow saved successfully");
      router.refresh();
    } catch {
      toast.error("An unexpected error occurred while saving");
    } finally {
      setSaving(false);
    }
  }

  function handleDelete() {
    startDeleting(async () => {
      const res = await deleteWorkflow(workflow.id);
      if (!res.success) {
        toast.error("Failed to delete workflow", { description: res.error });
        return;
      }

      toast.success("Workflow deleted");
      router.push("/workflows");
    });
  }

  return (
    <div className="space-y-6 pb-20">
      {/* Top action bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border/60 pb-5">
        <div className="flex items-center gap-3 min-w-0">
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-9 shrink-0 rounded-lg border border-border/60 hover:bg-muted/80 text-muted-foreground hover:text-foreground"
            render={<Link href="/workflows" />}
          >
            <ArrowLeftIcon className="size-4" />
          </Button>

          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="text-lg sm:text-xl font-heading font-semibold h-9 px-2.5 -ml-1 border-transparent hover:border-border/60 focus:border-border bg-transparent focus:bg-background transition-colors min-w-[200px] max-w-[420px]"
            placeholder="Workflow Name"
          />
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIsActive((prev) => !prev)}
            className={`text-xs gap-1.5 h-8 px-3 font-medium rounded-full transition-all shrink-0 ${
              isActive
                ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30 hover:bg-emerald-500/20"
                : "bg-amber-500/10 text-amber-700 border-amber-500/30 hover:bg-amber-500/20"
            }`}
          >
            <span
              className={`size-1.5 rounded-full ${
                isActive ? "bg-emerald-500 animate-pulse" : "bg-amber-500"
              }`}
            />
            {isActive ? "Active" : "Draft"}
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setJsonOpen(true)}
            className="h-8 text-xs font-medium gap-1.5 bg-background shadow-2xs border-border/80"
          >
            <Code2Icon className="size-3.5 text-muted-foreground" />
            View JSON
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setDeleteOpen(true)}
            className="h-8 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 gap-1.5"
          >
            <Trash2Icon className="size-3.5" />
            Delete
          </Button>

          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving}
            className="gap-1.5 h-8 px-3.5 bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-100 dark:hover:bg-zinc-200 dark:text-zinc-900 shadow-sm font-medium"
          >
            {saving ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <SaveIcon className="size-3.5" />
            )}
            Save
          </Button>
        </div>
      </div>

      {/* Search & Metrics Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 items-center gap-4 max-w-xl">
          <div className="relative w-full sm:w-72">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search outcome variables"
              className="h-9 pl-8 text-xs bg-background"
            />
          </div>
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {rules.length} outcome rows · {totalCalls} with calls
          </span>
        </div>
      </div>

      {/* Rules Matrix Table */}
      <div className="rounded-xl border border-border/80 bg-card overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border/60 bg-muted/25 text-[11px] font-semibold text-muted-foreground tracking-wider uppercase">
                <th className="w-10 px-3 py-3 text-center"></th>
                <th className="px-4 py-3 font-semibold min-w-[280px]">
                  Call Outcome (Variables)
                </th>
                <th className="px-4 py-3 font-semibold min-w-[170px]">Action</th>
                <th className="px-4 py-3 font-semibold min-w-[130px] text-center">
                  More Retries
                </th>
                <th className="px-4 py-3 font-semibold min-w-[170px]">Agent</th>
                <th className="w-12 px-3 py-3 text-right"></th>
              </tr>
            </thead>

            <tbody className="divide-y divide-border/60">
              {filteredRules.map((rule, index) => {
                const isStopAction = rule.action === "stop_calling";

                const selectedAgent =
                  (rule.agent_id ? availableAgents.find((a) => a.id === rule.agent_id) : null) ||
                  availableAgents[0] || {
                    id: "default",
                    name: rule.agent_name || "Default agent",
                    color: "bg-teal-700 text-white",
                    enabled: true,
                  };

                return (
                  <tr
                    key={rule.id}
                    className="group transition-colors hover:bg-muted/30"
                  >
                    {/* Drag Handle */}
                    <td className="px-3 py-4 text-center text-muted-foreground/50 group-hover:text-muted-foreground cursor-grab">
                      <GripVerticalIcon className="size-4 mx-auto" />
                    </td>

                    {/* Variable Tags */}
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {rule.variables.map((variable) => (
                          <span
                            key={variable}
                            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-mono font-medium bg-muted/80 text-foreground border border-border/70 group/tag"
                          >
                            <span>{variable}</span>
                            <button
                              type="button"
                              onClick={() => removeVariable(rule.id, variable)}
                              className="text-muted-foreground hover:text-destructive transition-colors ml-0.5"
                              title="Remove variable"
                            >
                              <XIcon className="size-3" />
                            </button>
                          </span>
                        ))}

                        {/* Add Variable Popover */}
                        <AddVariablePopover
                          onAdd={(v) => addVariable(rule.id, v)}
                          existing={rule.variables}
                        />
                      </div>
                    </td>

                    {/* Action Selector */}
                    <td className="px-4 py-4">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-9 px-3 gap-2 text-xs font-medium bg-background justify-between border-border/80 w-full max-w-[160px]"
                            />
                          }
                        >
                          <span className="truncate">
                            {ACTION_DESCRIPTIONS[rule.action]?.label ||
                              rule.action}
                          </span>
                          <ChevronDownIcon className="size-3.5 text-muted-foreground opacity-70 shrink-0" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="start"
                          className="w-[280px] p-1.5 space-y-1"
                        >
                          {(
                            Object.keys(
                              ACTION_DESCRIPTIONS,
                            ) as WorkflowActionType[]
                          ).map((actKey) => {
                            const act = ACTION_DESCRIPTIONS[actKey];
                            const isSelected = rule.action === actKey;
                            return (
                              <DropdownMenuItem
                                key={actKey}
                                onClick={() => {
                                  const updates: Partial<OutcomeRule> = {
                                    action: actKey,
                                  };
                                  if (actKey === "call_again") {
                                    if (!rule.retries) updates.retries = 2;
                                    if (!rule.agent_id)
                                      updates.agent_id = availableAgents[0]?.id;
                                  }
                                  updateRule(rule.id, updates);
                                }}
                                className={`flex items-start justify-between gap-2 p-2.5 rounded-lg cursor-pointer ${
                                  isSelected ? "bg-muted/70 font-medium" : ""
                                }`}
                              >
                                <div className="space-y-0.5">
                                  <div className="font-semibold text-xs text-foreground flex items-center gap-1.5">
                                    {act.label}
                                  </div>
                                  <p className="text-[11px] text-muted-foreground leading-snug">
                                    {act.description}
                                  </p>
                                </div>
                                {isSelected && (
                                  <CheckIcon className="size-4 text-foreground shrink-0 mt-0.5" />
                                )}
                              </DropdownMenuItem>
                            );
                          })}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>

                    {/* More Retries Stepper */}
                    <td className="px-4 py-4 text-center">
                      {isStopAction ? (
                        <span className="text-muted-foreground/60 text-sm font-medium">
                          —
                        </span>
                      ) : (
                        <div className="inline-flex items-center rounded-lg border border-border/80 bg-background overflow-hidden shadow-xs">
                          <button
                            type="button"
                            onClick={() =>
                              updateRule(rule.id, {
                                retries: Math.max(1, (rule.retries || 1) - 1),
                              })
                            }
                            disabled={rule.retries <= 1}
                            className="px-2 py-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-30 transition-colors"
                          >
                            <MinusIcon className="size-3.5" />
                          </button>
                          <input
                            type="number"
                            min={1}
                            max={100}
                            value={rule.retries || 1}
                            onChange={(e) =>
                              updateRule(rule.id, {
                                retries: Math.max(
                                  1,
                                  Math.min(100, parseInt(e.target.value, 10) || 1),
                                ),
                              })
                            }
                            className="w-10 text-center text-xs font-semibold bg-transparent focus:outline-hidden py-1 border-x border-border/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              updateRule(rule.id, {
                                retries: Math.min(100, (rule.retries || 1) + 1),
                              })
                            }
                            className="px-2 py-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                          >
                            <PlusIcon className="size-3.5" />
                          </button>
                        </div>
                      )}
                    </td>

                    {/* Agent Selector */}
                    <td className="px-4 py-4">
                      {isStopAction ? (
                        <span className="text-muted-foreground/60 text-sm font-medium">
                          —
                        </span>
                      ) : (
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-9 px-2.5 gap-2 text-xs font-medium bg-background border-border/80 w-full max-w-[170px] justify-between"
                              />
                            }
                          >
                            <div className="flex items-center gap-2 truncate">
                              {selectedAgent ? (
                                <>
                                  <span
                                    className={`size-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                                      selectedAgent.color || "bg-teal-700 text-white"
                                    }`}
                                  >
                                    {selectedAgent.name[0].toUpperCase()}
                                  </span>
                                  <span className="truncate">
                                    {selectedAgent.name}
                                  </span>
                                </>
                              ) : (
                                <span className="text-muted-foreground">
                                  Select Agent
                                </span>
                              )}
                            </div>
                            <ChevronDownIcon className="size-3.5 text-muted-foreground opacity-70 shrink-0" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" className="w-56 p-1">
                            <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase">
                              Workspace Agents ({availableAgents.length})
                            </div>
                            {availableAgents.length === 0 ? (
                              <div className="p-3 text-center space-y-1.5">
                                <p className="text-xs text-muted-foreground">
                                  No voice agents linked to this workspace.
                                </p>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs w-full"
                                  render={<Link href="/settings/voice-agent" />}
                                >
                                  <PlusIcon className="size-3 mr-1" /> Link Voice Agent
                                </Button>
                              </div>
                            ) : (
                              <>
                                {availableAgents.map((agent) => (
                                  <DropdownMenuItem
                                    key={agent.id}
                                    onClick={() =>
                                      updateRule(rule.id, {
                                        agent_id: agent.id,
                                        agent_name: agent.name,
                                      })
                                    }
                                    className="flex items-center gap-2 p-2 cursor-pointer"
                                  >
                                    <span
                                      className={`size-5 rounded-full flex items-center justify-center text-[10px] font-bold ${agent.color}`}
                                    >
                                      {agent.name[0].toUpperCase()}
                                    </span>
                                    <div className="flex flex-col truncate">
                                      <span className="text-xs font-medium truncate">
                                        {agent.name}
                                      </span>
                                      <span className="text-[10px] text-muted-foreground font-mono truncate">
                                        {agent.id.substring(0, 12)}...
                                      </span>
                                    </div>
                                    {rule.agent_id === agent.id && (
                                      <CheckIcon className="size-3.5 ml-auto text-foreground shrink-0" />
                                    )}
                                  </DropdownMenuItem>
                                ))}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  render={<Link href="/settings/voice-agent" />}
                                  className="text-[11px] text-muted-foreground flex items-center gap-1.5"
                                >
                                  <PlusIcon className="size-3" /> Link Another Agent
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </td>

                    {/* Row Options */}
                    <td className="px-3 py-4 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="size-7 p-0 text-muted-foreground hover:text-foreground"
                            />
                          }
                        >
                          <MoreHorizontalIcon className="size-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44 p-1">
                          <DropdownMenuItem
                            onClick={() => moveRule(index, "up")}
                            disabled={index === 0}
                            className="text-xs"
                          >
                            Move up
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => moveRule(index, "down")}
                            disabled={index === rules.length - 1}
                            className="text-xs"
                          >
                            Move down
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => duplicateRule(rule.id)}
                            className="text-xs"
                          >
                            Duplicate row
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => deleteRule(rule.id)}
                            className="text-xs text-destructive focus:text-destructive flex items-center gap-2"
                          >
                            <Trash2Icon className="size-3.5" /> Delete outcome
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Table Footer */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 border-t border-border/60 bg-muted/10">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => addNewOutcomeRow()}
            className="gap-1.5 text-xs font-medium border-dashed border-border/90 bg-background hover:bg-muted/60"
          >
            <PlusIcon className="size-3.5" />
            Add outcome row
          </Button>

          <p className="text-[11px] text-muted-foreground">
            Each row matches any of its variables. Drag rows to set priority.
          </p>
        </div>
      </div>

      {/* JSON Viewer Dialog */}
      <Dialog open={jsonOpen} onOpenChange={setJsonOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BotIcon className="size-4 text-emerald-500" />
              Workflow Configuration JSON
            </DialogTitle>
            <DialogDescription>
              Exportable multi-agent decision matrix and automated retry logic.
            </DialogDescription>
          </DialogHeader>

          <div className="relative mt-2">
            <pre className="p-4 rounded-xl bg-muted/60 border border-border/80 text-xs font-mono overflow-auto max-h-[360px] text-foreground">
              {JSON.stringify(
                {
                  workflow_id: workflow.id,
                  name,
                  is_active: isActive,
                  total_rules: rules.length,
                  rules: rules.map((r) => ({
                    variables: r.variables,
                    action: r.action,
                    retries: r.action.startsWith("call") ? r.retries : 0,
                    agent_id: r.agent_id,
                    agent_name: r.agent_name,
                  })),
                },
                null,
                2,
              )}
            </pre>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(
                  JSON.stringify({ name, is_active: isActive, rules }, null, 2),
                );
                toast.success("JSON copied to clipboard");
              }}
              className="absolute right-3 top-3 h-7 text-xs gap-1.5 bg-background shadow-xs"
            >
              <CopyIcon className="size-3" />
              Copy
            </Button>
          </div>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setJsonOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2Icon className="size-4" />
              Delete Workflow
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{" "}
              <strong className="text-foreground font-semibold">
                "{name}"
              </strong>
              ? This will remove all outcome rules and agent retry ladders.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDeleteOpen(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
              className="gap-1.5"
            >
              {isDeleting && <Loader2Icon className="size-4 animate-spin" />}
              Delete Workflow
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Inline Popover to Add Variable Tags to an Outcome Row
function AddVariablePopover({
  onAdd,
  existing,
}: {
  onAdd: (variable: string) => void;
  existing: string[];
}) {
  const [open, setOpen] = React.useState(false);
  const [customVar, setCustomVar] = React.useState("");

  const unusedSuggestions = COMMON_VARIABLES.filter((v) => !existing.includes(v));

  function handleSelect(v: string) {
    onAdd(v);
    setOpen(false);
    setCustomVar("");
  }

  function handleCustomSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!customVar.trim()) return;
    onAdd(customVar.trim());
    setCustomVar("");
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-mono font-medium border border-dashed border-border/90 text-muted-foreground hover:text-foreground hover:border-border transition-colors bg-background/50"
          />
        }
      >
        <PlusIcon className="size-3" />
        Variable
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3 space-y-3">
        <form onSubmit={handleCustomSubmit} className="space-y-1.5">
          <Label className="text-xs font-semibold">Custom Variable</Label>
          <div className="flex items-center gap-1.5">
            <Input
              value={customVar}
              onChange={(e) => setCustomVar(e.target.value)}
              placeholder="e.g. invalid_email"
              className="h-8 text-xs font-mono"
            />
            <Button type="submit" size="sm" className="h-8 px-2.5 text-xs">
              Add
            </Button>
          </div>
        </form>

        {unusedSuggestions.length > 0 && (
          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold text-muted-foreground uppercase">
              Quick Suggestions
            </Label>
            <div className="flex flex-wrap gap-1 max-h-36 overflow-y-auto pr-1">
              {unusedSuggestions.slice(0, 8).map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => handleSelect(suggestion)}
                  className="px-2 py-0.5 rounded text-[11px] font-mono bg-muted/60 hover:bg-muted text-foreground border border-border/60 transition-colors"
                >
                  +{suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
