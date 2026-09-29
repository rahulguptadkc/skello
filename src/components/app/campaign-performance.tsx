"use client";

import { Fragment, useState } from "react";
import {
  ActivityIcon,
  BotIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ClockIcon,
  HistoryIcon,
  PhoneCallIcon,
  PhoneIcon,
  PhoneOutgoingIcon,
  RefreshCwIcon,
  TargetIcon,
  TrendingUpIcon,
  TriangleAlertIcon,
  UsersIcon,
  Volume2Icon,
} from "lucide-react";

import { CallOutcomes } from "@/components/app/analytics/call-outcomes";
import { ChartFrame } from "@/components/app/analytics/chart-frame";
import { LineChart } from "@/components/app/analytics/line-chart";
import {
  DataTableCard,
  DataTableHead,
  DataTableToolbar,
} from "@/components/app/data-table";
import { SectionLabel } from "@/components/app/section-label";
import { StatCard } from "@/components/app/stat-card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  CONTACT_STATE_META,
  contactStateMeta,
} from "@/lib/campaigns/contact-state";
import { formatDurationClock } from "@/lib/format/duration";
import { formatDateTime, formatOutcomeKey } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CampaignStats } from "@/actions/campaigns";

/**
 * Performance dashboard for a single campaign. Client component for interactive
 * attempt history timeline inspection.
 */
export function CampaignPerformance({ stats }: { stats: CampaignStats }) {
  const [expandedContactIds, setExpandedContactIds] = useState<Set<string>>(
    () => new Set(),
  );

  function toggleExpanded(id: string) {
    setExpandedContactIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  const presentStates = CONTACT_STATE_META.filter(
    (m) => stats.contactStateCounts[m.key] > 0,
  );

  /**
   * The funnel, with **two** percentages per step and that being the point.
   *
   * The bar's width is share of total, so the steps are visually comparable.
   * The conversion under it is share of the *previous* step, which is what a
   * funnel actually measures — and it makes "Connected" agree with the Connect
   * rate card above, which is connected ÷ attempted. Before, every step was a
   * share of total while the card used a different denominator, so the same
   * word carried two numbers on one screen.
   */
  const funnel = [
    {
      label: "Contacts",
      value: stats.totalContacts,
      hint: "In the uploaded list",
      from: null as string | null,
      fromValue: 0,
    },
    {
      label: "Attempted",
      value: stats.attemptedContacts,
      hint: "Dialed at least once",
      from: "contacts",
      fromValue: stats.totalContacts,
    },
    {
      label: "Connected",
      value: stats.connectedContacts,
      hint: "Conversation happened",
      from: "attempted",
      fromValue: stats.attemptedContacts,
    },
    {
      label: "Succeeded",
      value: stats.succeededContacts,
      hint: "Marked successful",
      from: "connected",
      fromValue: stats.connectedContacts,
    },
  ];
  const funnelMax = Math.max(stats.totalContacts, 1);

  return (
    <div className="flex flex-col gap-5">
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Connect rate"
          value={`${stats.connectRatePct}%`}
          icon={<TargetIcon />}
          hint="Connected ÷ attempted"
        />
        <StatCard
          label="Success rate"
          value={`${stats.successRatePct}%`}
          icon={<TrendingUpIcon />}
          hint="Succeeded ÷ total contacts"
        />
        <StatCard
          label="Total dials"
          value={stats.totalCalls.toLocaleString()}
          icon={<PhoneOutgoingIcon />}
          hint="Across all attempts"
        />
        <StatCard
          label="Avg attempts"
          value={stats.avgAttemptsPerContact.toString()}
          icon={<ActivityIcon />}
          hint="Per contact"
        />
      </section>

      {/* Degraded warning first when it fires: every judged number is resting,
          so the dispatcher is dialing from the least-bad one. It explains a bad
          connect rate, so it belongs above the charts, not under them. */}
      {stats.degraded ? (
        <Alert variant="warning">
          <TriangleAlertIcon />
          <AlertDescription className="leading-relaxed">
            <span className="font-medium">Running on degraded numbers.</span>{" "}
            Every caller ID is below the {stats.switchFloorPct}% connect-rate
            floor over the last {stats.switchWindowMinutes} min, so calls are
            going out on the least-bad number. Add fresh numbers to recover
            answer rates.
          </AlertDescription>
        </Alert>
      ) : null}

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartFrame
          icon={UsersIcon}
          title="Funnel"
          subtitle="Contacts down the pipeline"
        >
          <ol className="flex flex-col gap-3">
            {funnel.map((step) => {
              const widthPct = Math.round((step.value / funnelMax) * 100);
              const conversionPct =
                step.from && step.fromValue > 0
                  ? Math.round((step.value / step.fromValue) * 100)
                  : null;
              return (
                <li key={step.label} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="font-medium">{step.label}</span>
                    <span className="tabular-nums">
                      {step.value.toLocaleString()}
                    </span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-linear-to-r from-chart-1/70 to-chart-1"
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                  <div className="flex items-baseline justify-between gap-2 text-[11px] text-muted-foreground">
                    <span>{step.hint}</span>
                    {conversionPct !== null ? (
                      <span className="tabular-nums">
                        {conversionPct}% of {step.from}
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </ChartFrame>

        <ChartFrame
          icon={PhoneCallIcon}
          title="Call outcomes"
          subtitle="Every dial, all attempts"
        >
          <CallOutcomes outcomes={stats.outcomes} total={stats.totalCalls} />
        </ChartFrame>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard
          label="Total talk time"
          value={formatDurationClock(stats.totalTalkSeconds, { empty: "0:00" })}
          icon={<ClockIcon />}
          hint="Connected calls only"
        />
        <StatCard
          label="Avg call length"
          value={formatDurationClock(stats.avgTalkSeconds, { empty: "0:00" })}
          icon={<ClockIcon />}
          hint="Per connected call"
        />
        <StatCard
          label="Longest call"
          value={formatDurationClock(stats.longestTalkSeconds, {
            empty: "0:00",
          })}
          icon={<ClockIcon />}
          hint="Single connected call"
        />
      </section>

      {/* Per-contact state — answers "why hasn't this contact been called?".
          A DataTableCard, not a ChartFrame: it's a table, and hosting it in a
          chart shell gave it a chart's padding and no table chrome. */}
      {stats.contacts.length > 0 ? (
        <DataTableCard>
          <DataTableToolbar className="flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-0.5">
              <SectionLabel as="span">Contacts</SectionLabel>
              <span className="text-xs text-muted-foreground">
                Where each contact sits — and why it&apos;s waiting
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {presentStates.map((m) => (
                <Tooltip key={m.key}>
                  <TooltipTrigger
                    delay={150}
                    render={<Badge variant={m.variant} className="gap-1.5" />}
                  >
                    {m.label}
                    <span className="tabular-nums">
                      {stats.contactStateCounts[m.key].toLocaleString()}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{m.hint}</TooltipContent>
                </Tooltip>
              ))}
            </div>
          </DataTableToolbar>

          <div className="no-scrollbar overflow-x-auto">
            <table className="w-full text-left text-sm">
              <DataTableHead>
                <th className="px-5 py-3 font-medium">Contact</th>
                <th className="px-3 py-3 font-medium">State</th>
                <th className="px-3 py-3 font-medium">Will Retry?</th>
                <th className="px-3 py-3 font-medium">Retry Time</th>
                <th className="px-3 py-3 font-medium">Retry Agent</th>
                <th className="px-3 py-3 font-medium">Reason / Disposition</th>
                <th className="px-4 py-3 text-right font-medium">Attempts</th>
                <th className="px-4 py-3 text-center font-medium">History</th>
              </DataTableHead>
              <tbody className="divide-y divide-border/60">
                {stats.contacts.map((c) => {
                  const meta = contactStateMeta(c.state);
                  const isExpanded = expandedContactIds.has(c.id);
                  const historyCount = c.history?.length ?? 0;
                  return (
                    <Fragment key={c.id}>
                      <tr
                        className={cn(
                          "hover:bg-muted/30 transition-colors",
                          isExpanded && "bg-muted/15",
                        )}
                      >
                        <td className="px-5 py-2.5">
                          <button
                            type="button"
                            onClick={() => toggleExpanded(c.id)}
                            className="flex items-center gap-2 text-left group cursor-pointer"
                          >
                            <div className="flex flex-col">
                              <span className="font-medium group-hover:text-primary transition-colors flex items-center gap-1.5">
                                {c.name?.trim() || "—"}
                              </span>
                              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                                {c.phone}
                              </span>
                            </div>
                          </button>
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge variant={meta.variant}>{meta.label}</Badge>
                        </td>
                        <td className="px-3 py-2.5">
                          {c.willRetry ? (
                            <Badge variant="warning" className="gap-1 font-medium">
                              <RefreshCwIcon className="size-3" />
                              Yes
                            </Badge>
                          ) : (
                            <Badge variant="neutral" className="text-muted-foreground font-normal">
                              No
                            </Badge>
                          )}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums">
                          {c.willRetry && c.nextAttemptLabel ? (
                            <div className="flex flex-col gap-0.5">
                              <span className="flex items-center gap-1 font-medium text-foreground">
                                <ClockIcon className="size-3 shrink-0 text-primary" />
                                {c.nextAttemptLabel}
                              </span>
                              {c.nextAttemptFormatted ? (
                                <span className="text-[11px] text-muted-foreground">
                                  {c.nextAttemptFormatted}
                                </span>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          {c.willRetry && c.retryAgentName ? (
                            <div className="flex items-center gap-1.5">
                              <BotIcon className="size-3.5 shrink-0 text-muted-foreground" />
                              <span className="max-w-[150px] truncate font-medium text-foreground">
                                {c.retryAgentName}
                              </span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground">
                          {c.willRetry && c.detail.startsWith("Workflow retry") ? (
                            <span className="inline-flex items-center gap-1 font-medium text-foreground">
                              <RefreshCwIcon className="size-3 shrink-0 text-warning" />
                              {c.detail}
                            </span>
                          ) : (
                            <span>{c.detail}</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          <div className="flex flex-col items-end">
                            <span className="font-medium text-foreground">
                              {c.attempt}/{c.maxAttempts}
                            </span>
                            {c.maxConnectedAttempts !== undefined && (
                              <span className="text-[11px] text-muted-foreground font-normal">
                                {c.connectedCount ?? 0}/{c.maxConnectedAttempts} connected
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <Button
                            variant={isExpanded ? "secondary" : "outline"}
                            size="xs"
                            onClick={() => toggleExpanded(c.id)}
                            className="gap-1.5 text-xs font-normal cursor-pointer"
                          >
                            <HistoryIcon className="size-3.5 text-primary" />
                            <span>
                              {historyCount > 0
                                ? `${historyCount} dial${historyCount > 1 ? "s" : ""}`
                                : "History"}
                            </span>
                            {isExpanded ? (
                              <ChevronUpIcon className="size-3 text-muted-foreground" />
                            ) : (
                              <ChevronDownIcon className="size-3 text-muted-foreground" />
                            )}
                          </Button>
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr key={`${c.id}-history`} className="bg-muted/10 border-b border-border/70 animate-in fade-in-50 duration-200">
                          <td colSpan={8} className="p-3 sm:px-6 sm:py-4">
                            <div className="flex flex-col gap-4 rounded-xl border border-border/70 bg-card/75 p-4 sm:p-5 shadow-xs">
                              {/* Header bar */}
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-border/60 pb-3">
                                <div className="flex items-center gap-2.5">
                                  <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                    <HistoryIcon className="size-4" />
                                  </div>
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <span className="font-semibold text-foreground text-sm">
                                        Call Attempt History: {c.name || "Contact"}
                                      </span>
                                      <span className="font-mono text-xs text-muted-foreground tabular-nums">
                                        ({c.phone})
                                      </span>
                                      <Badge variant="outline" className="text-[11px] font-normal py-0">
                                        {c.history?.length ?? 0} {(c.history?.length ?? 0) === 1 ? "attempt" : "attempts"}
                                      </Badge>
                                    </div>
                                    <span className="text-[11px] text-muted-foreground">
                                      Detailed log of each call dial, outcome, duration, and agent recording
                                    </span>
                                  </div>
                                </div>
                              </div>

                              {/* Timeline list */}
                              {(!c.history || c.history.length === 0) ? (
                                <div className="flex flex-col items-center justify-center py-6 text-center text-muted-foreground">
                                  <PhoneCallIcon className="size-8 text-muted-foreground/40 mb-1.5" />
                                  <p className="text-xs font-medium text-foreground">No call history recorded yet</p>
                                  <p className="text-[11px] text-muted-foreground max-w-sm mt-0.5">
                                    Attempts will appear automatically as calls are dialed to this phone number.
                                  </p>
                                </div>
                              ) : (
                                <div className="relative pl-6 space-y-3 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-border/60">
                                  {c.history.map((item) => {
                                    const statusBadgeVariant =
                                      item.status === "completed"
                                        ? "success"
                                        : item.status === "failed"
                                          ? "destructive"
                                          : item.status === "busy" || item.status === "no_answer"
                                            ? "warning"
                                            : "neutral";

                                    return (
                                      <div
                                        key={item.id}
                                        className="relative flex flex-col gap-2 p-3.5 rounded-lg border border-border/70 bg-card/90 hover:bg-card shadow-xs transition-all text-xs"
                                      >
                                        {/* Timeline dot */}
                                        <div
                                          className={cn(
                                            "absolute -left-[21px] top-4 size-3 rounded-full border-2 border-background",
                                            item.status === "completed"
                                              ? "bg-emerald-500 ring-2 ring-emerald-500/30"
                                              : item.status === "failed"
                                                ? "bg-rose-500 ring-2 ring-rose-500/30"
                                                : "bg-amber-500 ring-2 ring-amber-500/30",
                                          )}
                                        />

                                        {/* Header line */}
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                          <div className="flex flex-wrap items-center gap-1.5">
                                            <span className="font-semibold text-foreground text-xs">
                                              Attempt #{item.attemptNumber}
                                            </span>

                                            <Badge variant={statusBadgeVariant} className="text-[10px] py-0 px-1.5">
                                              {item.status}
                                            </Badge>

                                            {item.outcome ? (
                                              <Badge
                                                variant="neutral"
                                                className="text-[11px] font-medium text-foreground bg-muted/70 border border-border/80 py-0"
                                              >
                                                Outcome: {formatOutcomeKey(item.outcome)}
                                              </Badge>
                                            ) : null}
                                          </div>

                                          <span className="text-[11px] text-muted-foreground tabular-nums">
                                            {formatDateTime(item.startedAt)}
                                          </span>
                                        </div>

                                        {/* Metadata line */}
                                        <div className="flex flex-wrap items-center gap-3 text-muted-foreground text-[11px]">
                                          <span className="flex items-center gap-1 tabular-nums">
                                            <ClockIcon className="size-3 text-muted-foreground/70" />
                                            {formatDurationClock(item.durationSeconds ?? 0)}
                                          </span>

                                          {item.agentName ? (
                                            <span className="flex items-center gap-1">
                                              <BotIcon className="size-3 text-muted-foreground/70" />
                                              {item.agentName}
                                            </span>
                                          ) : null}

                                          {item.fromPhone ? (
                                            <span className="font-mono text-[10px] text-muted-foreground/80">
                                              Caller ID: {item.fromPhone}
                                            </span>
                                          ) : null}

                                          {item.recordingUrl ? (
                                            <a
                                              href={item.recordingUrl}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="inline-flex items-center gap-1 text-primary hover:underline font-medium ml-auto"
                                            >
                                              <Volume2Icon className="size-3.5" />
                                              Listen Recording
                                            </a>
                                          ) : null}
                                        </div>

                                        {/* Summary / notes */}
                                        {item.summary ? (
                                          <p className="text-[11px] text-muted-foreground italic border-t border-border/40 pt-1.5 mt-0.5">
                                            &ldquo;{item.summary}&rdquo;
                                          </p>
                                        ) : null}

                                        {item.errorMessage ? (
                                          <p className="text-[11px] text-destructive border-t border-border/40 pt-1.5 mt-0.5">
                                            Error: {item.errorMessage}
                                          </p>
                                        ) : null}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {stats.contactsOverflow > 0 ? (
            <p className="border-t border-border/60 px-5 py-3 text-[11px] text-muted-foreground">
              Showing the {stats.contacts.length} most actionable contacts.{" "}
              {stats.contactsOverflow.toLocaleString()} more not shown — the
              counts above cover all contacts.
            </p>
          ) : null}
        </DataTableCard>
      ) : null}

      {/* Per caller-ID breakdown — how switching spread the load, plus each
          number's recent health. Only shown once dials exist. */}
      {stats.byNumber.length > 0 ? (
        <DataTableCard>
          <DataTableToolbar>
            <div className="flex flex-col gap-0.5">
              <SectionLabel as="span">
                <PhoneIcon className="mr-1 inline size-3" />
                Caller IDs
              </SectionLabel>
              <span className="text-xs text-muted-foreground">
                Connect-rate switching · floor {stats.switchFloorPct}% over{" "}
                {stats.switchWindowMinutes}m
              </span>
            </div>
          </DataTableToolbar>

          <div className="no-scrollbar overflow-x-auto">
            <table className="w-full text-left text-sm">
              <DataTableHead>
                <th className="px-5 py-3 font-medium">Number</th>
                <th className="px-3 py-3 text-right font-medium">Dials</th>
                <th className="px-3 py-3 text-right font-medium">Connected</th>
                <th className="px-3 py-3 text-right font-medium">
                  Connect rate
                </th>
                <th className="px-5 py-3 text-right font-medium">
                  Recent ({stats.switchWindowMinutes}m)
                </th>
              </DataTableHead>
              <tbody className="divide-y divide-border/60">
                {stats.byNumber.map((n) => (
                  <tr key={n.phone} className="hover:bg-muted/30">
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="flex flex-col">
                          <span className="font-medium">{n.label}</span>
                          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                            {n.phone}
                          </span>
                        </div>
                        {n.isResting ? (
                          <Tooltip>
                            <TooltipTrigger
                              delay={150}
                              render={<Badge variant="warning" />}
                            >
                              resting
                            </TooltipTrigger>
                            <TooltipContent>
                              Below the connect-rate floor — the dispatcher is
                              steering new dials away from this number.
                            </TooltipContent>
                          </Tooltip>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {n.totalCalls.toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {n.connected.toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {n.connectRatePct}%
                    </td>
                    <td
                      className={cn(
                        "px-5 py-2.5 text-right tabular-nums",
                        n.isResting
                          ? "font-medium text-warning"
                          : "text-muted-foreground",
                      )}
                    >
                      {n.recentConnectRatePct === null
                        ? "—"
                        : `${n.recentConnectRatePct}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DataTableCard>
      ) : null}

      {/* Pacing — a line reads better than bars for a continuous run. */}
      <ChartFrame
        icon={TrendingUpIcon}
        title="Dials over time"
        subtitle="Calls placed per day"
      >
        <LineChart
          data={stats.callsPerDay.map((d) => ({
            period: d.date,
            value: d.count,
          }))}
          seriesLabel="Dials"
          emptyLabel="No dials placed yet."
        />
      </ChartFrame>
    </div>
  );
}
