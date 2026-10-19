"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import {
  ConversationsFilterBar,
  type ConversationsFilters,
} from "@/components/app/conversations-filter-bar";
import { ConversationsTable } from "@/components/app/conversations-table";
import { listConversationAgents } from "@/actions/calls";
import type { CallDirection, CallStatus, CallWithLead } from "@/types/call";

const CallExportDialog = dynamic(
  () =>
    import("@/components/app/call-export-dialog").then(
      (mod) => mod.CallExportDialog,
    ),
  { ssr: false },
);

const INITIAL_PAGE_SIZE = 50;

const RANGES: readonly ConversationsFilters["range"][] = [
  "24h",
  "7d",
  "30d",
  "all",
];
const DIRECTIONS: readonly CallDirection[] = ["inbound", "outbound"];
const STATUSES: readonly CallStatus[] = [
  "initiated",
  "ringing",
  "in_progress",
  "completed",
  "failed",
  "no_answer",
  "busy",
  "canceled",
];

function readFilters(sp: URLSearchParams): ConversationsFilters {
  const range = sp.get("range")?.toLowerCase();
  const direction = sp.get("direction")?.toLowerCase();
  const status = sp.get("status")?.toLowerCase();
  return {
    range:
      range && (RANGES as readonly string[]).includes(range)
        ? (range as ConversationsFilters["range"])
        : "7d",
    direction:
      direction && (DIRECTIONS as readonly string[]).includes(direction)
        ? (direction as CallDirection)
        : undefined,
    status:
      status && (STATUSES as readonly string[]).includes(status)
        ? (status as CallStatus)
        : undefined,
    agent: sp.get("agent")?.trim() || undefined,
    q: sp.get("q")?.trim() || undefined,
  };
}

function rangeToFrom(range: ConversationsFilters["range"]): string | undefined {
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  switch (range) {
    case "24h":
      return new Date(now - day).toISOString();
    case "7d":
      return new Date(now - 7 * day).toISOString();
    case "30d":
      return new Date(now - 30 * day).toISOString();
    case "all":
    default:
      return undefined;
  }
}

interface ConversationsViewProps {
  organisationId: string;
  organisationName: string;
  initialCalls?: CallWithLead[];
  initialTotal?: number;
}

export function ConversationsView({
  organisationId,
  organisationName,
  initialCalls = [],
  initialTotal = 0,
}: ConversationsViewProps) {
  const searchParams = useSearchParams();
  const filters = React.useMemo(
    () => readFilters(searchParams),
    [searchParams],
  );
  const from = React.useMemo(
    () => rangeToFrom(filters.range),
    [filters.range],
  );

  // TanStack Query for voice agents dropdown (cached for 5 minutes)
  const { data: agents = [] } = useQuery({
    queryKey: ["conversation-agents", organisationId],
    queryFn: async () => {
      const res = await listConversationAgents(organisationId);
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  const tableKey = `${filters.range}|${filters.direction ?? ""}|${filters.status ?? ""}|${filters.agent ?? ""}|${filters.q ?? ""}`;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1.5">
          <h1 className="font-heading text-2xl font-semibold leading-tight tracking-tight md:text-3xl">
            Conversations
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Inbound and outbound calls · scoped to {organisationName}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CallExportDialog
            tableFilters={{
              range: filters.range,
              direction: filters.direction,
              status: filters.status,
              agent_id: filters.agent,
              q: filters.q,
            }}
          />
        </div>
      </header>

      <ConversationsFilterBar filters={filters} agents={agents} />

      <ConversationsTable
        key={tableKey}
        calls={initialCalls}
        total={initialTotal}
        pageSize={INITIAL_PAGE_SIZE}
        organisationId={organisationId}
        filters={{
          direction: filters.direction,
          status: filters.status,
          agent: filters.agent,
          from,
          q: filters.q,
        }}
      />
    </div>
  );
}
