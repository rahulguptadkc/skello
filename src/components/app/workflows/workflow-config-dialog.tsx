"use client";

import * as React from "react";
import {
  BotIcon,
  CheckCircle2Icon,
  CheckIcon,
  Code2Icon,
  CopyIcon,
  DownloadIcon,
  FileCodeIcon,
  LayersIcon,
  Maximize2Icon,
  Minimize2Icon,
  PhoneCallIcon,
  PhoneOffIcon,
  SearchIcon,
  SparklesIcon,
  TerminalIcon,
  WrapTextIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { OutcomeRule } from "@/types/workflow";

interface WorkflowConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  isActive: boolean;
  rules: OutcomeRule[];
  availableAgents: Array<{
    id: string;
    name: string;
    color?: string;
    enabled?: boolean;
  }>;
  workflowId?: string;
}

export function WorkflowConfigDialog({
  open,
  onOpenChange,
  name,
  isActive,
  rules,
  availableAgents,
  workflowId,
}: WorkflowConfigDialogProps) {
  const [activeTab, setActiveTab] = React.useState<"code" | "matrix" | "api">("code");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [isPretty, setIsPretty] = React.useState(true);
  const [wrapLines, setWrapLines] = React.useState(false);
  const [copiedCode, setCopiedCode] = React.useState(false);
  const [copiedCurl, setCopiedCurl] = React.useState(false);

  // Formatted JSON Object representation
  const formattedJsonObj = React.useMemo(() => {
    return {
      name: name || "Untitled Workflow",
      is_active: isActive,
      total_rules: rules.length,
      available_agents: availableAgents.map((a) => ({
        agent_id: a.id,
        agent_name: a.name,
      })),
      rules: rules.map((r, idx) => {
        const matchedAgent = r.agent_id
          ? availableAgents.find((a) => a.id === r.agent_id)
          : null;
        const agentId = r.action === "stop_calling" ? null : (r.agent_id || null);
        const agentName =
          r.action === "stop_calling"
            ? null
            : matchedAgent?.name || r.agent_name || null;

        return {
          id: r.id || `rule_${idx + 1}`,
          action: r.action,
          retries: r.action === "stop_calling" ? 0 : (r.retries ?? 0),
          delay_minutes: r.action === "stop_calling" ? undefined : (r.delay_minutes ?? 0),
          agent_id: agentId,
          agent_name: agentName,
          variables: r.variables,
        };
      }),
    };
  }, [name, isActive, rules, availableAgents]);

  const jsonText = React.useMemo(() => {
    return isPretty
      ? JSON.stringify(formattedJsonObj, null, 2)
      : JSON.stringify(formattedJsonObj);
  }, [formattedJsonObj, isPretty]);

  const lines = React.useMemo(() => jsonText.split("\n"), [jsonText]);
  const byteSize = React.useMemo(() => new Blob([jsonText]).size, [jsonText]);

  // Search match statistics
  const matchingLineIndices = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return new Set<number>();
    const matches = new Set<number>();
    lines.forEach((line, idx) => {
      if (line.toLowerCase().includes(q)) {
        matches.add(idx);
      }
    });
    return matches;
  }, [searchQuery, lines]);

  // Syntax highlighting parser
  function highlightSyntax(raw: string) {
    const regex =
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?|[{}[\],])/g;
    return raw
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(regex, (match) => {
        let cls = "text-amber-400"; // number
        if (/^"/.test(match)) {
          if (/:$/.test(match)) {
            cls = "text-sky-300 font-semibold"; // key
          } else {
            cls = "text-emerald-300"; // string value
          }
        } else if (/true|false/.test(match)) {
          cls = "text-purple-300 font-medium"; // boolean
        } else if (/null/.test(match)) {
          cls = "text-rose-400/90 italic"; // null
        } else if (/[{}[\],]/.test(match)) {
          cls = "text-slate-400 font-bold"; // brackets / punctuation
        }
        return `<span class="${cls}">${match}</span>`;
      });
  }

  const handleCopyCode = React.useCallback(() => {
    navigator.clipboard.writeText(jsonText);
    setCopiedCode(true);
    toast.success("Workflow configuration JSON copied to clipboard");
    setTimeout(() => setCopiedCode(false), 2000);
  }, [jsonText]);

  const handleDownload = React.useCallback(() => {
    const filename = `${name.toLowerCase().replace(/[^a-z0-9]/g, "_") || "workflow"}_config.json`;
    const blob = new Blob([jsonText], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${filename}`);
  }, [name, jsonText]);

  // Visual matrix calculations
  const stopCallingRulesCount = React.useMemo(
    () => rules.filter((r) => r.action === "stop_calling").length,
    [rules],
  );
  const callAgainRulesCount = React.useMemo(
    () => rules.filter((r) => r.action === "call_again").length,
    [rules],
  );
  const uniqueVariablesCount = React.useMemo(() => {
    const set = new Set<string>();
    rules.forEach((r) => r.variables?.forEach((v) => set.add(v.toLowerCase())));
    return set.size;
  }, [rules]);
  const maxRetriesConfigured = React.useMemo(() => {
    return Math.max(0, ...rules.map((r) => r.retries || 0));
  }, [rules]);

  // cURL integration snippet
  const curlSnippet = React.useMemo(() => {
    const id = workflowId || "wf_current";
    return `# Fetch live workflow configuration schema
curl -X GET "https://api.skello.io/v1/workflows/${id}/config" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json"`;
  }, [workflowId]);

  const handleCopyCurl = React.useCallback(() => {
    navigator.clipboard.writeText(curlSnippet);
    setCopiedCurl(true);
    toast.success("cURL command copied to clipboard");
    setTimeout(() => setCopiedCurl(false), 2000);
  }, [curlSnippet]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-4xl sm:max-w-4xl md:max-w-4xl lg:max-w-4xl p-0 gap-0 overflow-hidden bg-background border-border shadow-2xl rounded-2xl">
        {/* Header with Badges */}
        <div className="p-5 sm:p-6 border-b border-border/70 bg-gradient-to-b from-muted/40 to-muted/10">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <DialogTitle className="flex items-center gap-3 text-base font-semibold tracking-tight text-foreground">
                <div className="size-9 rounded-xl bg-gradient-to-br from-emerald-500/20 via-teal-500/10 to-transparent border border-emerald-500/25 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shadow-xs">
                  <Code2Icon className="size-5" />
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span>Workflow Configuration JSON</span>
                </div>
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground pl-12">
                Complete decision matrix, outcome variables, and multi-agent routing schema.
              </DialogDescription>
            </div>

            {/* Badges / Metrics */}
            <div className="flex items-center gap-2 pl-12 sm:pl-0 flex-wrap">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border shadow-2xs transition-colors",
                  isActive
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                    : "bg-muted text-muted-foreground border-border",
                )}
              >
                <span className="relative flex size-2">
                  {isActive && (
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  )}
                  <span
                    className={cn(
                      "relative inline-flex size-2 rounded-full",
                      isActive ? "bg-emerald-500" : "bg-muted-foreground/60",
                    )}
                  />
                </span>
                {isActive ? "Active" : "Inactive"}
              </span>

              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-mono font-medium bg-muted/80 text-foreground border border-border/80 shadow-2xs">
                {rules.length} {rules.length === 1 ? "rule" : "rules"}
              </span>

              {availableAgents.length > 0 && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-muted/80 text-foreground border border-border/80 shadow-2xs">
                  <BotIcon className="size-3 text-muted-foreground" />
                  {availableAgents.length} agent{availableAgents.length > 1 ? "s" : ""}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* View Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={(val) => setActiveTab(val as "code" | "matrix" | "api")}
          className="w-full flex flex-col"
        >
          <div className="px-6 border-b border-border/70 bg-muted/20">
            <TabsList variant="line" className="h-10 p-0 gap-6">
              <TabsTrigger
                value="code"
                className="gap-2 text-xs font-medium py-2.5 px-1 data-active:text-emerald-600 dark:data-active:text-emerald-400"
              >
                <Code2Icon className="size-3.5" />
                <span>JSON Editor</span>
                <span className="ml-1 px-1.5 py-0.2 rounded-md bg-muted text-[10px] font-mono text-muted-foreground">
                  {lines.length} lines
                </span>
              </TabsTrigger>

              <TabsTrigger
                value="matrix"
                className="gap-2 text-xs font-medium py-2.5 px-1 data-active:text-emerald-600 dark:data-active:text-emerald-400"
              >
                <LayersIcon className="size-3.5" />
                <span>Decision Matrix</span>
                <span className="ml-1 px-1.5 py-0.2 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-medium">
                  {rules.length} steps
                </span>
              </TabsTrigger>

              <TabsTrigger
                value="api"
                className="gap-2 text-xs font-medium py-2.5 px-1 data-active:text-emerald-600 dark:data-active:text-emerald-400"
              >
                <TerminalIcon className="size-3.5" />
                <span>cURL & API</span>
              </TabsTrigger>
            </TabsList>
          </div>

          {/* TAB 1: CODE (JSON) */}
          <TabsContent value="code" className="p-5 sm:p-6 space-y-4 focus-visible:outline-none">
            {/* macOS Styled Code Window */}
            <div className="rounded-xl border border-neutral-800 bg-[#0b0f19] text-neutral-100 shadow-2xl overflow-hidden ring-1 ring-white/5">
              {/* Window Chrome / Title Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 px-4 py-2.5 bg-[#121826] border-b border-neutral-800/90 text-xs">
                {/* Traffic Lights & File Info */}
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <span className="size-3 rounded-full bg-[#ff5f56] border border-[#e0443e]/50 shadow-inner" />
                    <span className="size-3 rounded-full bg-[#ffbd2e] border border-[#dea123]/50 shadow-inner" />
                    <span className="size-3 rounded-full bg-[#27c93f] border border-[#1aab29]/50 shadow-inner" />
                  </div>
                  <div className="h-3.5 w-px bg-neutral-800" />
                  <span className="text-neutral-300 font-mono text-[11px] flex items-center gap-1.5">
                    <FileCodeIcon className="size-3.5 text-emerald-400" />
                    <span>workflow_config.json</span>
                  </span>
                  <span className="text-neutral-500 font-mono text-[10px] hidden md:inline-block">
                    • {(byteSize / 1024).toFixed(1)} KB
                  </span>
                </div>

                {/* Quick In-Window Actions */}
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Search / Filter Input */}
                  <div className="relative flex items-center">
                    <SearchIcon className="absolute left-2 size-3 text-neutral-400 pointer-events-none" />
                    <input
                      type="text"
                      placeholder="Search JSON..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="h-6 w-32 sm:w-40 rounded-md bg-neutral-900 border border-neutral-700/80 pl-7 pr-6 text-[11px] text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:border-emerald-500/80 focus:ring-1 focus:ring-emerald-500/50"
                    />
                    {searchQuery ? (
                      <button
                        type="button"
                        onClick={() => setSearchQuery("")}
                        className="absolute right-1.5 text-neutral-400 hover:text-neutral-200"
                        title="Clear search"
                      >
                        <XIcon className="size-3" />
                      </button>
                    ) : null}
                  </div>

                  {searchQuery && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      {matchingLineIndices.size} match{matchingLineIndices.size !== 1 ? "es" : ""}
                    </span>
                  )}

                  {/* Format Toggle */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsPretty((p) => !p)}
                    className="h-6 px-2 text-[11px] font-mono text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/80 rounded"
                    title={isPretty ? "Switch to minified JSON" : "Switch to formatted JSON"}
                  >
                    {isPretty ? "Compact" : "Pretty"}
                  </Button>

                  {/* Wrap Toggle */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setWrapLines((w) => !w)}
                    className={cn(
                      "h-6 px-1.5 text-[11px] text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/80 rounded gap-1",
                      wrapLines && "text-emerald-400 bg-neutral-800/80",
                    )}
                    title={wrapLines ? "Disable line wrap" : "Enable line wrap"}
                  >
                    <WrapTextIcon className="size-3" />
                  </Button>

                  {/* Copy in Window Header */}
                  <button
                    type="button"
                    onClick={handleCopyCode}
                    className="flex items-center gap-1.5 h-6 px-2 text-[11px] font-medium rounded bg-neutral-800/90 text-neutral-300 hover:text-white hover:bg-neutral-700/90 border border-neutral-700/80 transition-all active:scale-95"
                    title="Copy JSON code"
                  >
                    {copiedCode ? (
                      <>
                        <CheckIcon className="size-3 text-emerald-400" />
                        <span className="text-emerald-400">Copied!</span>
                      </>
                    ) : (
                      <>
                        <CopyIcon className="size-3 text-neutral-400" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Code Editor Body */}
              <div
                className={cn(
                  "p-3.5 font-mono text-xs overflow-auto max-h-[440px] leading-relaxed select-text",
                  wrapLines ? "whitespace-pre-wrap break-all" : "whitespace-pre",
                )}
              >
                <table className="w-full border-collapse">
                  <tbody>
                    {lines.map((line, idx) => {
                      const isMatched = matchingLineIndices.has(idx);
                      return (
                        <tr
                          key={idx}
                          className={cn(
                            "group transition-colors",
                            isMatched
                              ? "bg-amber-500/15 border-l-2 border-amber-400"
                              : "hover:bg-white/[0.04]",
                          )}
                        >
                          <td className="w-10 pr-3 text-right select-none text-neutral-600 group-hover:text-neutral-400 font-mono text-[11px] align-top border-r border-neutral-800/60">
                            {idx + 1}
                          </td>
                          <td className="pl-4 text-neutral-100 font-mono text-xs align-top">
                            <span
                              dangerouslySetInnerHTML={{
                                __html: highlightSyntax(line),
                              }}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>

          {/* TAB 2: VISUAL MATRIX */}
          <TabsContent value="matrix" className="p-5 sm:p-6 space-y-5 focus-visible:outline-none">
            {/* KPI Summary Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3.5 rounded-xl border border-border/80 bg-card shadow-2xs space-y-1">
                <span className="text-[11px] font-medium text-muted-foreground">Total Rules</span>
                <div className="flex items-baseline gap-2">
                  <span className="text-xl font-bold text-foreground">{rules.length}</span>
                  <span className="text-[10px] text-muted-foreground">
                    ({callAgainRulesCount} retry, {stopCallingRulesCount} stop)
                  </span>
                </div>
              </div>

              <div className="p-3.5 rounded-xl border border-border/80 bg-card shadow-2xs space-y-1">
                <span className="text-[11px] font-medium text-muted-foreground">Outcome Variables</span>
                <div className="flex items-baseline gap-2">
                  <span className="text-xl font-bold text-foreground">{uniqueVariablesCount}</span>
                  <span className="text-[10px] text-muted-foreground">handled</span>
                </div>
              </div>

              <div className="p-3.5 rounded-xl border border-border/80 bg-card shadow-2xs space-y-1">
                <span className="text-[11px] font-medium text-muted-foreground">Max Retries Ceiling</span>
                <div className="flex items-baseline gap-2">
                  <span className="text-xl font-bold text-foreground">{maxRetriesConfigured}</span>
                  <span className="text-[10px] text-muted-foreground">attempts</span>
                </div>
              </div>

              <div className="p-3.5 rounded-xl border border-border/80 bg-card shadow-2xs space-y-1">
                <span className="text-[11px] font-medium text-muted-foreground">Assigned Agents</span>
                <div className="flex items-baseline gap-2">
                  <span className="text-xl font-bold text-foreground">{availableAgents.length}</span>
                  <span className="text-[10px] text-muted-foreground">in workspace</span>
                </div>
              </div>
            </div>

            {/* Decision Rule Cards */}
            <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
              {rules.map((rule, idx) => {
                const assignedAgent = rule.agent_id
                  ? availableAgents.find((a) => a.id === rule.agent_id)
                  : null;

                return (
                  <div
                    key={rule.id || idx}
                    className="p-4 rounded-xl border border-border/80 bg-card hover:border-emerald-500/30 transition-all shadow-2xs space-y-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center justify-center size-5 rounded-full bg-muted text-[11px] font-mono font-semibold text-muted-foreground">
                          {idx + 1}
                        </span>
                        <span className="text-xs font-semibold text-foreground">
                          Rule Priority #{idx + 1}
                        </span>
                      </div>

                      {rule.action === "call_again" ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                          <PhoneCallIcon className="size-3" />
                          Call again
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                          <PhoneOffIcon className="size-3" />
                          Stop calling
                        </span>
                      )}
                    </div>

                    {/* Trigger Variables */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] text-muted-foreground mr-1">Triggers when:</span>
                      {rule.variables.length > 0 ? (
                        rule.variables.map((variable) => (
                          <span
                            key={variable}
                            className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-mono font-medium bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20"
                          >
                            {variable}
                          </span>
                        ))
                      ) : (
                        <span className="text-[11px] italic text-muted-foreground">
                          No variables specified (catch-all)
                        </span>
                      )}
                    </div>

                    {/* Routing Details */}
                    {rule.action === "call_again" && (
                      <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-border/60 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-foreground">Retries:</span>
                          <span className="font-mono text-foreground font-semibold">
                            {rule.retries ?? 1}
                          </span>
                        </div>
                        <span>•</span>
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-foreground">Delay:</span>
                          <span className="font-mono text-foreground font-semibold">
                            {rule.delay_minutes ?? 0}m
                          </span>
                        </div>
                        <span>•</span>
                        <div className="flex items-center gap-1.5">
                          <BotIcon className="size-3.5 text-muted-foreground" />
                          <span className="font-medium text-foreground">
                            {assignedAgent?.name || rule.agent_name || "Campaign default agent"}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </TabsContent>

          {/* TAB 3: cURL & API */}
          <TabsContent value="api" className="p-5 sm:p-6 space-y-4 focus-visible:outline-none">
            <div className="space-y-1">
              <h4 className="text-xs font-semibold text-foreground">Workflow API Endpoint</h4>
              <p className="text-[11px] text-muted-foreground">
                Integrate this automated workflow with your CRM, backend services, or webhooks.
              </p>
            </div>

            <div className="rounded-xl border border-neutral-800 bg-[#0b0f19] p-4 text-xs font-mono text-neutral-200 relative group shadow-xl">
              <div className="flex items-center justify-between pb-3 border-b border-neutral-800 text-[11px] text-neutral-400">
                <span className="flex items-center gap-1.5">
                  <TerminalIcon className="size-3.5 text-emerald-400" />
                  cURL Request
                </span>
                <button
                  type="button"
                  onClick={handleCopyCurl}
                  className="flex items-center gap-1.5 text-neutral-300 hover:text-white transition-colors"
                >
                  {copiedCurl ? (
                    <>
                      <CheckIcon className="size-3 text-emerald-400" />
                      <span className="text-emerald-400 font-sans">Copied</span>
                    </>
                  ) : (
                    <>
                      <CopyIcon className="size-3" />
                      <span className="font-sans">Copy command</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="pt-3 text-[11px] leading-relaxed text-emerald-300 overflow-x-auto whitespace-pre">
                {curlSnippet}
              </pre>
            </div>

            <div className="p-4 rounded-xl border border-border/80 bg-muted/30 text-xs space-y-2">
              <div className="flex items-center gap-2 font-medium text-foreground">
                <SparklesIcon className="size-3.5 text-emerald-500" />
                <span>Dynamic Evaluation Engine</span>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                When a call finishes, the outcome decision engine prioritizes explicit call
                dispositions (e.g. voicemail, interested), validates retries against your safety
                ceiling, and re-routes eligible retries to designated voice agents automatically.
              </p>
            </div>
          </TabsContent>
        </Tabs>

        {/* Modal Footer Controls */}
        <div className="p-4 sm:p-5 border-t border-border/80 bg-muted/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
              <CheckCircle2Icon className="size-3.5" />
              Valid JSON Schema (v1.0)
            </span>
            <span className="text-border">•</span>
            <span className="font-mono text-[11px]">
              {lines.length} lines • {(byteSize / 1024).toFixed(1)} KB
            </span>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDownload}
              className="h-8.5 text-xs gap-1.5 shadow-2xs border-border/80 hover:bg-muted/80"
            >
              <DownloadIcon className="size-3.5 text-muted-foreground" />
              Download JSON
            </Button>

            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={handleCopyCode}
              className="h-8.5 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium shadow-2xs transition-all active:scale-95"
            >
              {copiedCode ? (
                <>
                  <CheckIcon className="size-3.5" />
                  <span>Copied!</span>
                </>
              ) : (
                <>
                  <CopyIcon className="size-3.5" />
                  <span>Copy JSON</span>
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
