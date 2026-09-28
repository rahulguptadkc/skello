"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Papa from "papaparse";
import {
  ArrowUpRightIcon,
  BotIcon,
  CheckCircle2Icon,
  CheckIcon,
  DownloadIcon,
  EyeIcon,
  FileCheckIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  GitBranchIcon,
  Loader2Icon,
  MinusIcon,
  PhoneCallIcon,
  PhoneOffIcon,
  PlusIcon,
  RotateCcwIcon,
  SearchIcon,
  SparklesIcon,
  UploadCloudIcon,
  UploadIcon,
  XCircleIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { VoiceConfigDialog } from "@/components/app/voice-config-dialog";
import { createCampaign } from "@/actions/campaigns";
import { getVoiceConfig } from "@/actions/voice-config";
import { listWorkflows } from "@/actions/workflows";
import { parseCampaignCsv, type ParsedCsv } from "@/lib/campaigns/csv-parse";
import { cn } from "@/lib/utils";
import type { CampaignRetryTrigger } from "@/types/campaign";
import type { VoiceConfig } from "@/types/voice-config";
import type { OutcomeRule, Workflow } from "@/types/workflow";

type ScheduleMode = "now" | "later";

// Weekday toggles for the calling window. value matches the 0=Sun..6=Sat
// indexing used by lib/campaigns/calling-window and the DB column.
const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

// "HH:MM" (from a <input type="time">) → minutes since midnight.
function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

const DEFAULT_RETRY_TRIGGERS: CampaignRetryTrigger[] = [
  "no_answer",
  "busy",
  "failed",
];

// Lightweight, self-contained sample so users can see exactly what we accept.
// `phone` and `name` are the recognized columns; the extra columns demonstrate
// how arbitrary fields flow through to the voice agent as call metadata.
const SAMPLE_CSV =
  "phone,name,vehicle,city,last_visit\r\n" +
  "+91 99999 00000,Neem Kumar,Honda Dio,Bengaluru,2026-04-22\r\n" +
  "9810000111,Priya Sharma,Royal Enfield Classic 350,Pune,\r\n" +
  "+1 (415) 555-0199,Alex Patel,Tesla Model 3,San Francisco,2026-04-30\r\n";

function downloadSampleCsv() {
  const blob = new Blob([`\ufeff${SAMPLE_CSV}`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "skelo-campaign-sample.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function defaultScheduleAt(): string {
  const d = new Date(Date.now() + 30 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultAgentPlaceholder(c: VoiceConfig | null): string {
  if (!c) return "Loading…";
  if (c.agents.length === 0) return "No agents — open Manage to add one";
  return "Workspace default";
}

interface CampaignUploadDialogProps {
  organisationId: string;
}

export function CampaignUploadDialog({
  organisationId,
}: CampaignUploadDialogProps) {
  const router = useRouter();
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [parsed, setParsed] = React.useState<ParsedCsv | null>(null);
  const [parsing, setParsing] = React.useState(false);
  const [viewerOpen, setViewerOpen] = React.useState(false);
  const [viewerSearch, setViewerSearch] = React.useState("");
  const [viewerFilter, setViewerFilter] = React.useState<
    "all" | "cleaned" | "unchanged"
  >("all");
  const [dragOver, setDragOver] = React.useState(false);
  const [scheduleMode, setScheduleMode] = React.useState<ScheduleMode>("now");
  const [scheduledAt, setScheduledAt] =
    React.useState<string>(defaultScheduleAt());
  const [maxRetries, setMaxRetries] = React.useState<number>(1);
  const [retryIntervalMinutes, setRetryIntervalMinutes] = React.useState<number>(30);
  const [maxConnectedAttempts, setMaxConnectedAttempts] = React.useState<number>(1);
  const [retryOn, setRetryOn] = React.useState<CampaignRetryTrigger[]>(
    DEFAULT_RETRY_TRIGGERS,
  );
  // Caller-ID switching (connect-rate based). Defaults match the DB defaults.
  const [switchFloor, setSwitchFloor] = React.useState<string>("30");
  const [switchWindow, setSwitchWindow] = React.useState<string>("60");
  // Calling window — restrict dialing to set hours/days. Off by default (dial
  // any time). Times are interpreted in the operator's detected timezone.
  const [windowEnabled, setWindowEnabled] = React.useState(false);
  const [windowStart, setWindowStart] = React.useState("09:00");
  const [windowEnd, setWindowEnd] = React.useState("18:00");
  const [windowDays, setWindowDays] = React.useState<number[]>([
    1, 2, 3, 4, 5,
  ]);
  const timeZone = React.useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    [],
  );
  const [submitting, setSubmitting] = React.useState(false);

  // Workflows state
  const [workflows, setWorkflows] = React.useState<Workflow[]>([]);
  const [workflowChoice, setWorkflowChoice] = React.useState<string>("");
  const [workflowsLoading, setWorkflowsLoading] = React.useState(false);
  const chosenWf = React.useMemo(
    () => workflows.find((w) => w.id === workflowChoice),
    [workflows, workflowChoice],
  );

  // Voice config (agents + dialling numbers). Fetched lazily once the dialog
  // opens; the empty-string select value means "use the workspace default".
  const [voiceConfig, setVoiceConfig] = React.useState<VoiceConfig | null>(
    null,
  );
  const [voiceLoading, setVoiceLoading] = React.useState(false);
  const [agentChoice, setAgentChoice] = React.useState<string>("");
  // Caller-ID rotation pool: the set of numbers this campaign may dial from.
  // Empty = use the workspace default. 2+ enables rotation under the daily cap.
  const [fromPhoneChoices, setFromPhoneChoices] = React.useState<string[]>([]);

  const loadVoiceConfig = React.useCallback(async () => {
    setVoiceLoading(true);
    setWorkflowsLoading(true);
    const [res, wfRes] = await Promise.all([
      getVoiceConfig({ organisation_id: organisationId }),
      listWorkflows(organisationId),
    ]);
    setVoiceLoading(false);
    setWorkflowsLoading(false);

    if (wfRes.success && wfRes.data) {
      setWorkflows(wfRes.data);
      setWorkflowChoice((prev) => {
        const chosenId = prev || (wfRes.data.find((w) => w.is_active) || wfRes.data[0])?.id || "";
        if (chosenId) {
          const chosen = wfRes.data.find((w) => w.id === chosenId);
          if (chosen?.rules && chosen.rules.length > 0) {
            const maxWfRetries = Math.max(
              0,
              ...chosen.rules
                .filter((r) => r.action === "call_again")
                .map((r) => Number(r.retries) || 0),
            );
            if (maxWfRetries > 0) {
              setMaxRetries(maxWfRetries);
              setMaxConnectedAttempts(maxWfRetries + 1);
            }
          }
        }
        return chosenId;
      });
    }

    if (!res.success) {
      toast.error(res.error);
      return;
    }
    setVoiceConfig(res.data);
    // Auto-select the workspace default so the user doesn't have to think
    // about it for the common case. Only sets if the user hasn't picked yet.
    setAgentChoice((prev) => {
      if (prev) return prev;
      const def = res.data.agents.find((a) => a.is_default);
      return def ? def.id : "";
    });
    // Default the pool to ALL available numbers — the safe default is to
    // spread volume across every caller-ID, so a user only narrows to one
    // deliberately. Only seeds if the user hasn't already chosen.
    setFromPhoneChoices((prev) => {
      if (prev.length > 0) return prev;
      return res.data.dial_numbers.map((n) => n.phone);
    });
  }, [organisationId]);

  function reset() {
    setName("");
    setFile(null);
    setParsed(null);
    setParsing(false);
    setViewerOpen(false);
    setViewerSearch("");
    setViewerFilter("all");
    setDragOver(false);
    setScheduleMode("now");
    setScheduledAt(defaultScheduleAt());
    setMaxRetries(1);
    setRetryIntervalMinutes(30);
    setMaxConnectedAttempts(1);
    setRetryOn(DEFAULT_RETRY_TRIGGERS);
    setSwitchFloor("30");
    setSwitchWindow("60");
    setWindowEnabled(false);
    setWindowStart("09:00");
    setWindowEnd("18:00");
    setWindowDays([1, 2, 3, 4, 5]);
    setSubmitting(false);
    setAgentChoice("");
    setWorkflowChoice("");
    setFromPhoneChoices([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
    if (next) void loadVoiceConfig();
  }

  async function ingestFile(f: File | null) {
    setFile(f);
    setParsed(null);
    if (!f) return;
    if (!/\.csv$/i.test(f.name) && f.type !== "text/csv") {
      toast.error("Please drop a .csv file");
      setFile(null);
      return;
    }
    if (!name) {
      const base = f.name.replace(/\.[^.]+$/, "");
      setName(base.slice(0, 200));
    }
    setParsing(true);
    try {
      const result = await parseCampaignCsv(f);
      setParsed(result);
      if (result.error && result.valid_rows === 0) {
        toast.error(result.error);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not parse CSV");
    } finally {
      setParsing(false);
    }
  }



  function handleRetryClean(e?: React.MouseEvent) {
    e?.stopPropagation();
    if (file) {
      void ingestFile(file);
      toast.info("Re-cleaned customer names from CSV");
    }
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    void ingestFile(e.target.files?.[0] ?? null);
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (submitting || parsing) return;
    const f = e.dataTransfer.files?.[0] ?? null;
    void ingestFile(f);
  }

  function onDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (submitting || parsing) return;
    if (!dragOver) setDragOver(true);
  }

  function onDragLeave(e: React.DragEvent<HTMLDivElement>) {
    // Only reset when leaving the dropzone container, not its children.
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDragOver(false);
  }

  function clearFile(e: React.MouseEvent) {
    e.stopPropagation();
    setFile(null);
    setParsed(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function toggleRetryTrigger(t: CampaignRetryTrigger) {
    setRetryOn((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );
  }

  function toggleWindowDay(day: number) {
    setWindowDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    );
  }

  function toggleFromPhone(phone: string) {
    setFromPhoneChoices((prev) =>
      prev.includes(phone) ? prev.filter((p) => p !== phone) : [...prev, phone],
    );
  }

  // Effective pool = explicit choices, or (if none chosen) the workspace
  // default = all available numbers. Drives the rotation note below.
  const numbersAvailable = voiceConfig?.dial_numbers.length ?? 0;
  const effectiveNumberCount =
    fromPhoneChoices.length > 0 ? fromPhoneChoices.length : numbersAvailable;

  const filteredContacts = React.useMemo(() => {
    if (!parsed) return [];
    let list = parsed.contacts;
    if (viewerFilter === "cleaned") {
      list = list.filter((c) => c.raw_name && c.name && c.raw_name !== c.name);
    } else if (viewerFilter === "unchanged") {
      list = list.filter(
        (c) => !c.raw_name || (c.name && c.raw_name === c.name),
      );
    }
    if (!viewerSearch.trim()) return list;
    const q = viewerSearch.toLowerCase().trim();
    return list.filter(
      (c) =>
        c.phone.includes(q) ||
        (c.name && c.name.toLowerCase().includes(q)) ||
        (c.raw_name && c.raw_name.toLowerCase().includes(q)),
    );
  }, [parsed, viewerSearch, viewerFilter]);

  const modifiedCount = React.useMemo(() => {
    if (!parsed) return 0;
    return parsed.contacts.filter(
      (c) => c.raw_name && c.name && c.raw_name !== c.name,
    ).length;
  }, [parsed]);

  const unchangedCount = React.useMemo(() => {
    if (!parsed) return 0;
    return parsed.contacts.length - modifiedCount;
  }, [parsed, modifiedCount]);

  function handleDownloadCleanedCsv() {
    if (!parsed || parsed.contacts.length === 0) return;
    const exportData = parsed.contacts.map((c) => ({
      phone: c.phone,
      name: c.name,
      ...c.metadata,
    }));
    const csvString = Papa.unparse(exportData);
    const blob = new Blob([`\ufeff${csvString}`], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file
      ? `cleaned-${file.name}`
      : "cleaned-campaign-contacts.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success("Downloaded cleaned CSV file");
  }

  async function onConfirm() {
    if (!name.trim()) {
      toast.error("Give the campaign a name");
      return;
    }
    if (!parsed || parsed.valid_rows === 0) {
      toast.error("Upload a CSV with at least one valid phone number");
      return;
    }
    if (scheduleMode === "later") {
      const ts = new Date(scheduledAt);
      if (Number.isNaN(ts.getTime()) || ts.getTime() < Date.now() - 60_000) {
        toast.error("Pick a future date and time to schedule");
        return;
      }
    }

    const floor = Number(switchFloor);
    if (!Number.isInteger(floor) || floor < 0 || floor > 100) {
      toast.error(
        "Connect-rate floor must be a whole number between 0 and 100",
      );
      return;
    }
    const windowMin = Number(switchWindow);
    if (!Number.isInteger(windowMin) || windowMin < 5 || windowMin > 1440) {
      toast.error("Switching window must be between 5 and 1440 minutes");
      return;
    }

    let callingWindow: {
      start_minute: number;
      end_minute: number;
      days: number[];
      timezone: string;
    } | null = null;
    if (windowEnabled) {
      const startMin = timeToMinutes(windowStart);
      const endMin = timeToMinutes(windowEnd);
      if (endMin <= startMin) {
        toast.error("Calling window end time must be after the start time");
        return;
      }
      if (windowDays.length === 0) {
        toast.error("Pick at least one day for the calling window");
        return;
      }
      callingWindow = {
        start_minute: startMin,
        end_minute: endMin,
        // All seven selected = every day; send empty so the dispatcher treats it
        // as unrestricted by weekday.
        days: windowDays.length === 7 ? [] : windowDays,
        timezone: timeZone,
      };
    }

    const chosenWf = workflows.find((w) => w.id === workflowChoice);

    setSubmitting(true);
    try {
      const result = await createCampaign({
        organisation_id: organisationId,
        name: name.trim(),
        file_name: file?.name ?? null,
        schedule_mode: scheduleMode,
        scheduled_at:
          scheduleMode === "later" ? new Date(scheduledAt).toISOString() : null,
        // Empty string = "use workspace default"; the action treats null/empty
        // identically and falls back at dispatch time.
        agent_id: agentChoice || null,
        // Single override only when exactly one number is chosen (a consistent
        // caller ID for the whole run); otherwise the rotation pool drives it.
        from_phone_number:
          fromPhoneChoices.length === 1 ? fromPhoneChoices[0] : null,
        from_phone_numbers: fromPhoneChoices,
        workflow_id: workflowChoice || null,
        workflow_name: chosenWf?.name || null,
        max_attempts: maxRetries + 1,
        max_connected_attempts: maxConnectedAttempts,
        retry_interval_seconds: retryIntervalMinutes * 60,
        retry_on: retryOn,
        switch_connect_rate_floor: floor,
        switch_window_minutes: windowMin,
        calling_window: callingWindow,
        contacts: parsed.contacts,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(
        scheduleMode === "now"
          ? `Campaign started — dialing ${parsed.valid_rows} contacts`
          : `Campaign scheduled for ${new Date(scheduledAt).toLocaleString()}`,
      );
      setOpen(false);
      reset();
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  const confirmLabel =
    scheduleMode === "now" ? "Start campaign" : "Schedule campaign";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button>
            <UploadIcon /> Create a Campaign
          </Button>
        }
      />
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>New campaign</DialogTitle>
          <DialogDescription>
            Upload a CSV of phone numbers. We&apos;ll dial each one through your
            voice agent and retry failures based on your settings.
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[65vh] gap-5 overflow-y-auto pr-1">
          <div className="grid gap-1.5">
            <Label htmlFor="campaign-name">Name</Label>
            <Input
              id="campaign-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. April homebuyer follow-ups"
              maxLength={200}
              disabled={submitting}
            />
          </div>

          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="campaign-file">CSV file</Label>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={downloadSampleCsv}
                disabled={submitting}
                className="-mr-2 text-muted-foreground hover:text-foreground"
                title="Download a sample CSV template"
              >
                <DownloadIcon /> Sample CSV
              </Button>
            </div>
            <input
              ref={fileInputRef}
              id="campaign-file"
              type="file"
              accept=".csv,text/csv"
              onChange={onFileChange}
              disabled={submitting || parsing}
              className="sr-only"
            />
            <div
              role="button"
              tabIndex={0}
              aria-label="Drop a CSV file or click to browse"
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              onDrop={onDrop}
              onDragOver={onDragOver}
              onDragEnter={onDragOver}
              onDragLeave={onDragLeave}
              className={cn(
                "group relative grid cursor-pointer place-items-center gap-2 rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors outline-none",
                "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
                dragOver
                  ? "border-foreground/50 bg-muted/40"
                  : file
                    ? "border-success/30 bg-success-muted"
                    : "border-border/70 bg-muted/20 hover:border-foreground/30 hover:bg-muted/30",
                (submitting || parsing) && "cursor-not-allowed opacity-70",
              )}
            >
              {parsing ? (
                <>
                  <Loader2Icon className="size-7 animate-spin text-muted-foreground" />
                  <p className="text-sm font-medium">Parsing CSV…</p>
                  <p className="text-xs text-muted-foreground">
                    Hang tight, this takes a moment for big files.
                  </p>
                </>
              ) : file && parsed ? (
                <>
                  <span className="grid size-10 place-items-center rounded-full bg-success/15 text-success">
                    {parsed.valid_rows > 0 ? (
                      <CheckCircle2Icon className="size-5" />
                    ) : (
                      <XCircleIcon className="size-5 text-destructive" />
                    )}
                  </span>
                  <p className="inline-flex items-center gap-1.5 text-sm font-medium">
                    <FileTextIcon className="size-3.5" /> {file.name}
                  </p>
                  {parsed.valid_rows > 0 ? (
                    <>
                      <p className="text-xs text-muted-foreground">
                        Phone column:{" "}
                        <span className="font-mono text-foreground">
                          {parsed.phone_column}
                        </span>{" "}
                        ·{" "}
                        <span className="font-medium tabular-nums text-foreground">
                          {parsed.valid_rows} valid
                        </span>{" "}
                        / {parsed.total_rows} rows
                        {parsed.duplicate_rows > 0
                          ? ` · ${parsed.duplicate_rows} duplicates skipped`
                          : ""}
                      </p>
                      {((parsed.cleaned_name_previews?.length ?? 0) > 0 ||
                        (parsed.converted_name_previews?.length ?? 0) > 0) && (
                        <div className="mt-2 w-full max-w-md rounded-md border border-border/60 bg-background/90 p-3 text-left text-xs shadow-xs">
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <p className="font-semibold text-foreground text-[11px] flex items-center gap-1.5">
                              <SparklesIcon className="size-3.5 text-emerald-500" />
                              Voice AI Cleaned Names Preview (
                              {parsed.cleaned_name_previews?.length ??
                                parsed.converted_name_previews?.length}{" "}
                              shown):
                            </p>
                            <Button
                              type="button"
                              size="xs"
                              variant="ghost"
                              onClick={handleRetryClean}
                              disabled={parsing || submitting}
                              className="h-6 text-[11px] px-2 text-muted-foreground hover:text-foreground"
                              title="Re-run clean process on the uploaded CSV"
                            >
                              <RotateCcwIcon
                                className={cn(
                                   "size-3 mr-1",
                                   parsing && "animate-spin",
                                )}
                              />
                              Retry clean
                            </Button>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {(
                              parsed.cleaned_name_previews ??
                              parsed.converted_name_previews.map((p) => ({
                                original: p.original,
                                cleaned: p.devanagari,
                              }))
                            ).map((item, idx) => (
                              <span
                                key={idx}
                                className="inline-flex items-center gap-1 rounded bg-muted/70 px-2 py-0.5 font-mono text-[11px] border border-border/60 text-foreground"
                              >
                                <span className="text-muted-foreground line-through opacity-75">
                                  {item.original}
                                </span>
                                <span className="text-muted-foreground/70">→</span>
                                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                                  {item.cleaned}
                                </span>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-destructive">
                      {parsed.error ?? "No valid phone numbers found"}
                    </p>
                  )}
                  <div className="mt-2 flex items-center gap-2">
                    {parsed.valid_rows > 0 && (
                      <Button
                        type="button"
                        size="xs"
                        variant="secondary"
                        onClick={(e) => {
                          e.stopPropagation();
                          setViewerOpen(true);
                        }}
                        disabled={submitting}
                      >
                        <EyeIcon className="size-3 mr-1" /> Open Cleaned File ({parsed.valid_rows})
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      onClick={clearFile}
                      disabled={submitting}
                    >
                      Choose a different file
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <span className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground transition-colors group-hover:bg-foreground/10 group-hover:text-foreground">
                    <UploadCloudIcon className="size-5" />
                  </span>
                  <p className="text-sm font-medium">
                    {dragOver ? "Drop to upload" : "Drag & drop a CSV here"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    or{" "}
                    <span className="font-medium text-foreground underline-offset-2 group-hover:underline">
                      click to browse
                    </span>{" "}
                    · .csv only
                  </p>
                </>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                Required column:
              </span>{" "}
              <code className="font-mono">phone</code> (also accepts{" "}
              <code className="font-mono">mobile</code> /{" "}
              <code className="font-mono">number</code>).{" "}
              <span className="font-medium text-foreground">Optional:</span>{" "}
              <code className="font-mono">name</code>. Any other columns are
              passed to the voice agent as call context.
            </p>
          </div>

          <div className="grid gap-3 rounded-lg border border-border/60 bg-muted/30 p-3.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Voice setup
              </Label>
              <VoiceConfigDialog
                organisationId={organisationId}
                onConfigChange={(c) => {
                  setVoiceConfig(c);
                  // Drop choices that no longer exist after a removal so the
                  // select doesn't show a stale value.
                  const agentSet = new Set(c.agents.map((a) => a.id));
                  if (agentChoice && !agentSet.has(agentChoice)) {
                    setAgentChoice("");
                  }
                  const phoneSet = new Set(c.dial_numbers.map((n) => n.phone));
                  setFromPhoneChoices((prev) =>
                    prev.filter((p) => phoneSet.has(p)),
                  );
                }}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="campaign-agent" className="text-xs">
                Voice agent
              </Label>
              <Select
                value={agentChoice}
                onValueChange={(v) => setAgentChoice(v ?? "")}
                disabled={submitting || voiceLoading}
              >
                <SelectTrigger id="campaign-agent" className="w-full">
                  {/* Render the label, not the underlying agent_id, so the
                      trigger reads as a friendly name rather than the
                      cryptic Bolna id. */}
                  <SelectValue
                    placeholder={defaultAgentPlaceholder(voiceConfig)}
                  >
                    {(value: unknown) => {
                      if (typeof value !== "string" || !value) {
                        return defaultAgentPlaceholder(voiceConfig);
                      }
                      const found = voiceConfig?.agents.find(
                        (a) => a.id === value,
                      );
                      return found ? found.label : value;
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(voiceConfig?.agents ?? []).map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      <span className="font-medium">{a.label}</span>
                      {a.is_default ? (
                        <span className="ml-1 text-[10px] text-muted-foreground">
                          (default)
                        </span>
                      ) : null}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Caller-ID pool — multi-select. The campaign rotates across the
                checked numbers under a per-number daily cap to avoid carrier
                spam-flagging. */}
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Dialling numbers (caller ID)</Label>
                {numbersAvailable > 0 ? (
                  <button
                    type="button"
                    disabled={submitting || voiceLoading}
                    onClick={() =>
                      setFromPhoneChoices(
                        fromPhoneChoices.length === numbersAvailable
                          ? []
                          : (voiceConfig?.dial_numbers ?? []).map(
                              (n) => n.phone,
                            ),
                      )
                    }
                    className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
                  >
                    {fromPhoneChoices.length === numbersAvailable
                      ? "Clear all"
                      : "Select all"}
                  </button>
                ) : null}
              </div>

              {numbersAvailable === 0 ? (
                <p className="rounded-md border border-dashed border-border/60 p-3 text-[11px] text-muted-foreground">
                  No numbers saved — we&apos;ll use the default caller ID on the
                  voice agent. Add numbers via{" "}
                  <span className="font-medium text-foreground">
                    Manage agents &amp; numbers
                  </span>{" "}
                  to enable rotation.
                </p>
              ) : (
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {(voiceConfig?.dial_numbers ?? []).map((n) => {
                    const checked = fromPhoneChoices.includes(n.phone);
                    return (
                      <button
                        key={n.phone}
                        type="button"
                        onClick={() => toggleFromPhone(n.phone)}
                        disabled={submitting || voiceLoading}
                        className={cn(
                          "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors",
                          checked
                            ? "border-foreground/30 bg-background"
                            : "border-border/60 bg-transparent text-muted-foreground hover:bg-background",
                          (submitting || voiceLoading) &&
                            "cursor-not-allowed opacity-60",
                        )}
                      >
                        <span
                          className={cn(
                            "grid size-3.5 shrink-0 place-items-center rounded border",
                            checked
                              ? "border-foreground bg-foreground text-background"
                              : "border-border",
                          )}
                          aria-hidden
                        >
                          {checked ? <CheckMark /> : null}
                        </span>
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate font-medium text-foreground">
                            {n.label}
                          </span>
                          <span className="truncate font-mono text-[10px] text-muted-foreground">
                            {n.phone}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Switching note — numbers are rested by connect-rate health, not
                a fixed daily count (configured below). */}
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {effectiveNumberCount > 1
                ? `Rotating across ${effectiveNumberCount} numbers. A number is rested when its connect rate drops below the floor set below.`
                : "Using one caller ID. Add more numbers so the dialer can switch away from one that starts getting flagged."}
            </p>
          </div>

          <div className="grid gap-3 rounded-lg border border-border/60 bg-muted/30 p-3.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Caller-ID switching
            </Label>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              The dialer rests a number when its connect rate drops below the
              floor over the window — the sign it&apos;s being spam-flagged. Set
              the floor a little below your numbers&apos; normal connect rate.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="switch-floor" className="text-xs">
                  Min connect rate (%)
                </Label>
                <Input
                  id="switch-floor"
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={switchFloor}
                  onChange={(e) => setSwitchFloor(e.target.value)}
                  disabled={submitting}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="switch-window" className="text-xs">
                  Window (minutes)
                </Label>
                <Input
                  id="switch-window"
                  type="number"
                  min={5}
                  max={1440}
                  step={5}
                  value={switchWindow}
                  onChange={(e) => setSwitchWindow(e.target.value)}
                  disabled={submitting}
                />
              </div>
            </div>
          </div>

          <div className="grid gap-2">
            <Label>When to run</Label>
            <div className="grid grid-cols-2 gap-2">
              <ScheduleRadio
                checked={scheduleMode === "now"}
                onCheck={() => setScheduleMode("now")}
                title="Run now"
                hint="Start dialing immediately"
                disabled={submitting}
              />
              <ScheduleRadio
                checked={scheduleMode === "later"}
                onCheck={() => setScheduleMode("later")}
                title="Schedule for later"
                hint="Pick a date and time"
                disabled={submitting}
              />
            </div>
            {scheduleMode === "later" ? (
              <Input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                disabled={submitting}
                min={defaultScheduleAt()}
              />
            ) : null}
          </div>

          <div className="grid gap-3 rounded-lg border border-border/60 bg-muted/30 p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="grid gap-0.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Calling window
                </Label>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Only dial during set hours and days. Outside the window a
                  contact waits for the next opening — no attempt is used.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setWindowEnabled((v) => !v)}
                disabled={submitting}
                aria-pressed={windowEnabled}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                  windowEnabled
                    ? "border-foreground/30 bg-background text-foreground"
                    : "border-border/60 bg-transparent text-muted-foreground hover:bg-background",
                  submitting && "cursor-not-allowed opacity-60",
                )}
              >
                <span
                  className={cn(
                    "grid size-3.5 shrink-0 place-items-center rounded border",
                    windowEnabled
                      ? "border-foreground bg-foreground text-background"
                      : "border-border",
                  )}
                  aria-hidden
                >
                  {windowEnabled ? <CheckMark /> : null}
                </span>
                {windowEnabled ? "Enabled" : "Enable"}
              </button>
            </div>

            {windowEnabled ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="window-start" className="text-xs">
                      From
                    </Label>
                    <Input
                      id="window-start"
                      type="time"
                      value={windowStart}
                      onChange={(e) => setWindowStart(e.target.value)}
                      disabled={submitting}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="window-end" className="text-xs">
                      To
                    </Label>
                    <Input
                      id="window-end"
                      type="time"
                      value={windowEnd}
                      onChange={(e) => setWindowEnd(e.target.value)}
                      disabled={submitting}
                    />
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Days</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {WEEKDAYS.map((d) => {
                      const checked = windowDays.includes(d.value);
                      return (
                        <button
                          key={d.value}
                          type="button"
                          onClick={() => toggleWindowDay(d.value)}
                          disabled={submitting}
                          aria-pressed={checked}
                          className={cn(
                            "rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                            checked
                              ? "border-foreground/30 bg-background text-foreground"
                              : "border-border/60 bg-transparent text-muted-foreground hover:bg-background",
                            submitting && "cursor-not-allowed opacity-60",
                          )}
                        >
                          {d.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Times are in{" "}
                  <span className="font-medium text-foreground">{timeZone}</span>{" "}
                  (your timezone).
                </p>
              </>
            ) : null}
          </div>

          {/* Workflow Selector */}
          <div className="grid gap-3 rounded-lg border border-border/60 bg-muted/30 p-3.5">
            <div>
              <Label htmlFor="campaign-workflow" className="text-sm font-semibold tracking-tight text-foreground">
                Workflow
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Select which call outcome &amp; retry workflow to execute for this campaign.
              </p>
            </div>

            {workflows.length > 0 ? (
              <Select
                value={workflowChoice}
                onValueChange={(v) => {
                  const id = v ?? "";
                  setWorkflowChoice(id);
                  const chosen = workflows.find((w) => w.id === id);
                  if (chosen?.rules && chosen.rules.length > 0) {
                    const maxWfRetries = Math.max(
                      0,
                      ...chosen.rules
                        .filter((r) => r.action === "call_again")
                        .map((r) => Number(r.retries) || 0),
                    );
                    if (maxWfRetries > 0) {
                      setMaxRetries(maxWfRetries);
                      setMaxConnectedAttempts(maxWfRetries + 1);
                    }
                  }
                }}
                disabled={submitting || workflowsLoading}
              >
                <SelectTrigger id="campaign-workflow" className="w-full bg-background">
                  <SelectValue placeholder="Select workflow...">
                    {(value: unknown) => {
                      if (typeof value !== "string" || !value) {
                        return "Select a workflow";
                      }
                      const found = workflows.find((w) => w.id === value);
                      return found ? found.name : "Select a workflow";
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {workflows.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      <span className="font-medium">{w.name}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-md border border-dashed border-border/70 p-2.5 text-xs text-muted-foreground bg-background">
                <span>No custom workflows created yet. Default outcome rules will apply.</span>
                <Link
                  href="/workflows"
                  target="_blank"
                  className="font-medium text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1 shrink-0"
                >
                  Create workflow <ArrowUpRightIcon className="size-3" />
                </Link>
              </div>
            )}
          </div>

          {/* Retry Configuration - Connected to Workflow */}
          <div className="grid gap-3.5 rounded-lg border border-border/60 bg-muted/30 p-3.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
              <div>
                <div className="flex items-center gap-2">
                  <Label className="text-sm font-semibold tracking-tight text-foreground">
                    Retry Configuration
                  </Label>
                  {chosenWf ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 px-2 py-0.5 text-[11px] font-medium">
                      <GitBranchIcon className="size-3" /> Connected to {chosenWf.name}
                    </span>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Configure retry attempts, backoff window, and maximum connected attempt boundaries.
                </p>
              </div>
            </div>

            {/* Workflow Rules Preview */}
            {chosenWf?.rules && chosenWf.rules.length > 0 ? (
              <div className="rounded-md border border-border/60 bg-background/80 p-3 space-y-2">
                <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                  <span className="flex items-center gap-1.5 text-foreground font-semibold">
                    <GitBranchIcon className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                    Workflow Outcome Rules ({chosenWf.rules.length})
                  </span>
                  <Link
                    href={`/workflows/${chosenWf.id}`}
                    target="_blank"
                    className="text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1"
                  >
                    Edit workflow <ArrowUpRightIcon className="size-3" />
                  </Link>
                </div>
                <div className="grid grid-cols-1 gap-1.5 max-h-36 overflow-y-auto pr-1">
                  {chosenWf.rules.map((rule: OutcomeRule) => {
                    const isCallAgain = rule.action === "call_again";
                    const assignedAgent = voiceConfig?.agents.find((a) => a.id === rule.agent_id);
                    const agentDisplay = rule.agent_name || assignedAgent?.label;
                    return (
                      <div
                        key={rule.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded border border-border/40 bg-muted/40 px-2.5 py-1.5 text-xs"
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-mono text-[11px] text-foreground font-medium truncate max-w-[200px]">
                            {rule.variables.slice(0, 3).join(", ")}
                            {rule.variables.length > 3 ? ` +${rule.variables.length - 3}` : ""}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {isCallAgain ? (
                            <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 text-[10px] font-medium border border-emerald-500/20">
                              <PhoneCallIcon className="size-2.5" /> Call again ({rule.retries}x)
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded bg-zinc-500/10 text-muted-foreground px-1.5 py-0.5 text-[10px] font-medium border border-zinc-500/20">
                              <PhoneOffIcon className="size-2.5" /> Stop calling
                            </span>
                          )}
                          {isCallAgain && agentDisplay ? (
                            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground font-medium">
                              <BotIcon className="size-2.5" /> {agentDisplay}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <StepperInput
                label="Max Retries"
                value={maxRetries}
                onChange={setMaxRetries}
                min={0}
                max={10}
                step={1}
                disabled={submitting}
              />
              <StepperInput
                label="Retry Interval (mins)"
                value={retryIntervalMinutes}
                onChange={setRetryIntervalMinutes}
                min={1}
                max={1440}
                step={5}
                disabled={submitting || maxRetries === 0}
              />
              <StepperInput
                label="Max connected attempts"
                value={maxConnectedAttempts}
                onChange={setMaxConnectedAttempts}
                min={1}
                max={20}
                step={1}
                disabled={submitting}
              />
            </div>

            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {chosenWf ? (
                <>
                  Dynamic retry routing and agent assignments are actively driven by{" "}
                  <span className="font-medium text-foreground">{chosenWf.name}</span>. The{" "}
                  <span className="font-medium text-foreground">Max Retries</span> ({maxRetries}) and{" "}
                  <span className="font-medium text-foreground">{maxConnectedAttempts} max connected call{maxConnectedAttempts > 1 ? "s" : ""}</span>{" "}
                  serve as the campaign-wide safety ceiling with a{" "}
                  <span className="font-medium text-foreground">{retryIntervalMinutes}m</span> delay between dials.
                </>
              ) : (
                <>
                  Calls will only be placed within the <span className="font-medium text-foreground">Max Retries</span> limit and up to{" "}
                  <span className="font-medium text-foreground">{maxConnectedAttempts} connected call{maxConnectedAttempts > 1 ? "s" : ""}</span>.
                </>
              )}
            </p>
          </div>
        </div>

        <DialogFooter>
          <DialogClose
            render={
              <Button variant="outline" type="button" disabled={submitting} />
            }
          >
            Cancel
          </DialogClose>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={
              submitting || parsing || !parsed || parsed.valid_rows === 0
            }
          >
            {submitting ? <Loader2Icon className="animate-spin" /> : null}
            {submitting ? "Saving…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Cleaned File Full Screen Viewer Modal */}
      <Dialog open={viewerOpen} onOpenChange={setViewerOpen}>
        <DialogContent className="w-[96vw] max-w-[96vw] sm:max-w-[96vw] h-[92vh] max-h-[92vh] flex flex-col p-6 gap-4 bg-background shadow-2xl rounded-2xl">
          <DialogHeader className="pb-3 border-b border-border/50">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pr-8">
              <div>
                <DialogTitle className="flex items-center gap-2 text-lg font-semibold tracking-tight">
                  <div className="grid size-7 place-items-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                    <FileSpreadsheetIcon className="size-4" />
                  </div>
                  Cleaned Campaign Contacts
                  <span className="ml-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 px-2.5 py-0.5 text-xs font-medium">
                    {parsed?.valid_rows ?? 0} valid contacts
                  </span>
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-1">
                  <span className="font-medium text-foreground">{file?.name}</span> · All customer names standardized to Title Case, speech recognition filler words & stray letters stripped.
                </DialogDescription>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadCleanedCsv}
                  className="h-8 text-xs gap-1.5"
                  title="Download the cleaned CSV to your computer"
                >
                  <DownloadIcon className="size-3.5" />
                  Export Cleaned CSV
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setViewerOpen(false)}
                  className="h-8 text-xs"
                >
                  Done
                </Button>
              </div>
            </div>
          </DialogHeader>

          {/* Search & Filter Toolbar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 p-0.5 bg-muted/60 rounded-lg border border-border/50">
              <button
                type="button"
                onClick={() => setViewerFilter("all")}
                className={cn(
                  "px-3 py-1 text-xs font-medium rounded-md transition-colors",
                  viewerFilter === "all"
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                All ({parsed?.valid_rows ?? 0})
              </button>
              <button
                type="button"
                onClick={() => setViewerFilter("cleaned")}
                className={cn(
                  "px-3 py-1 text-xs font-medium rounded-md transition-colors flex items-center gap-1",
                  viewerFilter === "cleaned"
                    ? "bg-background text-emerald-600 dark:text-emerald-400 shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <SparklesIcon className="size-3 text-emerald-500" />
                Cleaned ({modifiedCount})
              </button>
              <button
                type="button"
                onClick={() => setViewerFilter("unchanged")}
                className={cn(
                  "px-3 py-1 text-xs font-medium rounded-md transition-colors",
                  viewerFilter === "unchanged"
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Unchanged ({unchangedCount})
              </button>
            </div>

            <div className="relative flex-1 max-w-sm">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <Input
                placeholder="Search phone or name..."
                value={viewerSearch}
                onChange={(e) => setViewerSearch(e.target.value)}
                className="pl-8.5 pr-8 h-8 text-xs"
              />
              {viewerSearch && (
                <button
                  type="button"
                  onClick={() => setViewerSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
                >
                  <XIcon className="size-3" />
                </button>
              )}
            </div>
          </div>

          {/* Full Height Responsive Table */}
          <div className="flex-1 overflow-auto rounded-lg border border-border/70 bg-card shadow-xs">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-muted/80 backdrop-blur-sm sticky top-0 z-10 border-b border-border/70 text-muted-foreground">
                <tr>
                  <th className="py-2.5 px-4 font-semibold w-14">#</th>
                  <th className="py-2.5 px-4 font-semibold w-44">Phone Number</th>
                  <th className="py-2.5 px-4 font-semibold w-64">Cleaned Name for AI</th>
                  <th className="py-2.5 px-4 font-semibold w-64">Original in CSV</th>
                  <th className="py-2.5 px-4 font-semibold w-32">Status</th>
                  <th className="py-2.5 px-4 font-semibold">Additional Fields</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40 font-normal">
                {filteredContacts.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="py-16 text-center text-muted-foreground"
                    >
                      <p className="text-sm font-medium">No matching contacts found</p>
                      <p className="text-xs text-muted-foreground/70 mt-1">
                        Try adjusting your search query or active filter.
                      </p>
                    </td>
                  </tr>
                ) : (
                  filteredContacts.map((contact, idx) => {
                    const isModified =
                      contact.raw_name &&
                      contact.name &&
                      contact.raw_name !== contact.name;
                    return (
                      <tr
                        key={idx}
                        className="hover:bg-muted/30 transition-colors group"
                      >
                        <td className="py-2.5 px-4 text-muted-foreground font-mono text-[11px]">
                          {idx + 1}
                        </td>
                        <td className="py-2.5 px-4 font-mono font-medium text-foreground">
                          {contact.phone}
                        </td>
                        <td className="py-2.5 px-4">
                          {contact.name ? (
                            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                              {contact.name}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/50 italic">
                              —
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-muted-foreground">
                          {contact.raw_name ? (
                            <span
                              className={cn(
                                isModified && "line-through opacity-70",
                              )}
                            >
                              {contact.raw_name}
                            </span>
                          ) : (
                            <span className="italic text-muted-foreground/40">
                              —
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-4">
                          {isModified ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                              <SparklesIcon className="size-2.5" /> Cleaned
                            </span>
                          ) : contact.name ? (
                            <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                              Original
                            </span>
                          ) : (
                            <span className="text-muted-foreground/40 text-[10px]">
                              —
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-muted-foreground text-[11px] font-mono">
                          {Object.entries(contact.metadata).length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {Object.entries(contact.metadata).map(
                                ([k, v]) => (
                                  <span
                                    key={k}
                                    className="rounded bg-muted/60 px-1.5 py-0.5 border border-border/40 text-[10px]"
                                  >
                                    <span className="text-foreground font-medium">
                                      {k}:
                                    </span>{" "}
                                    {typeof v === "object" && v !== null
                                      ? JSON.stringify(v)
                                      : String(v ?? "")}
                                  </span>
                                ),
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <DialogFooter className="flex items-center justify-between sm:justify-between pt-2 border-t border-border/40">
            <p className="text-xs text-muted-foreground">
              Showing{" "}
              <strong className="text-foreground">
                {filteredContacts.length}
              </strong>{" "}
              of {parsed?.valid_rows ?? 0} contacts ({modifiedCount} cleaned)
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => setViewerOpen(false)}
              >
                Done
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}

function CheckMark() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-2.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 8.5 6.5 12 13 4.5" />
    </svg>
  );
}

function ScheduleRadio({
  checked,
  onCheck,
  title,
  hint,
  disabled,
}: {
  checked: boolean;
  onCheck: () => void;
  title: string;
  hint: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onCheck}
      disabled={disabled}
      className={cn(
        "flex flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left text-xs transition-colors",
        checked
          ? "border-foreground/30 bg-background"
          : "border-border/60 bg-transparent text-muted-foreground hover:bg-background",
        disabled && "cursor-not-allowed opacity-60",
      )}
      aria-pressed={checked}
    >
      <span className="text-sm font-medium text-foreground">{title}</span>
      <span className="text-[11px] leading-tight">{hint}</span>
    </button>
  );
}

function StepperInput({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  disabled = false,
}: {
  label: string;
  value: number;
  onChange: (val: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
        {label}
      </Label>
      <div className="flex h-10 items-center justify-between rounded-xl border border-border/80 bg-slate-100/80 dark:bg-slate-800/80 px-1.5 shadow-xs transition-colors hover:border-foreground/30 focus-within:border-ring">
        <button
          type="button"
          disabled={disabled || value <= min}
          onClick={() => onChange(Math.max(min, value - step))}
          className="grid size-7 place-items-center rounded-lg text-muted-foreground transition-all hover:bg-background hover:text-foreground active:scale-95 disabled:pointer-events-none disabled:opacity-30"
          aria-label={`Decrease ${label}`}
        >
          <MinusIcon className="size-3.5 stroke-[2.5]" />
        </button>
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => {
            const parsed = parseInt(e.target.value, 10);
            if (!isNaN(parsed)) {
              onChange(Math.max(min, Math.min(max, parsed)));
            } else if (e.target.value === "") {
              onChange(min);
            }
          }}
          className="w-14 bg-transparent text-center font-bold text-sm tabular-nums text-foreground outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <button
          type="button"
          disabled={disabled || value >= max}
          onClick={() => onChange(Math.min(max, value + step))}
          className="grid size-7 place-items-center rounded-lg text-muted-foreground transition-all hover:bg-background hover:text-foreground active:scale-95 disabled:pointer-events-none disabled:opacity-30"
          aria-label={`Increase ${label}`}
        >
          <PlusIcon className="size-3.5 stroke-[2.5]" />
        </button>
      </div>
    </div>
  );
}

