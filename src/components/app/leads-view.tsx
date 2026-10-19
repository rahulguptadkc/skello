"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  PhoneIncomingIcon,
  PhoneOutgoingIcon,
  UsersIcon,
} from "lucide-react";

import { NavTabs } from "@/components/app/nav-tabs";
import { LeadsActivityTable } from "@/components/app/leads-activity-table";
import { StatCard } from "@/components/app/stat-card";
import {
  getLeadCallLifetimeStats,
  getLeadStatusCounts,
} from "@/actions/lead-activity";
import { listLeadFieldDefinitions } from "@/actions/lead-field-definitions";
import { LEAD_STATUS_LABEL, LEAD_STATUS_ORDER } from "@/lib/leads/status";
import type { LeadStatus } from "@/types/lead";

const LeadCreateDialog = dynamic(
  () =>
    import("@/components/app/lead-create-dialog").then(
      (mod) => mod.LeadCreateDialog,
    ),
  {
    loading: () => (
      <div className="h-9 w-28 rounded-md bg-muted/60 animate-pulse" />
    ),
  },
);

const PAGE_SIZE = 20;

function StatCardsSkeleton() {
  return (
    <section className="grid grid-cols-1 gap-5 md:grid-cols-3">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-28 rounded-xl border border-border/60 bg-card/60 p-5 shadow-xs animate-pulse flex flex-col justify-between"
        >
          <div className="flex items-center justify-between">
            <div className="h-4 w-28 rounded bg-muted" />
            <div className="size-8 rounded-lg bg-muted" />
          </div>
          <div className="h-7 w-20 rounded bg-muted" />
          <div className="h-3 w-36 rounded bg-muted" />
        </div>
      ))}
    </section>
  );
}

function LifetimeStatCards({ orgSlug }: { orgSlug: string }) {
  const { data: stats, isLoading } = useQuery({
    queryKey: ["leads-lifetime-stats", orgSlug],
    queryFn: async () => {
      const res = await getLeadCallLifetimeStats({ org_slug: orgSlug });
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
    staleTime: 60 * 1000,
  });

  if (isLoading || !stats) {
    return <StatCardsSkeleton />;
  }

  return (
    <section className="grid grid-cols-1 gap-5 md:grid-cols-3">
      <StatCard
        label="Leads contacted"
        value={stats.contacted_leads.toLocaleString()}
        icon={<UsersIcon />}
        hint="Lifetime · with at least one call"
      />
      <StatCard
        label="Inbound calls"
        value={stats.inbound_calls.toLocaleString()}
        icon={<PhoneIncomingIcon />}
        hint="Lifetime · from the voice agent"
      />
      <StatCard
        label="Outbound calls"
        value={stats.outbound_calls.toLocaleString()}
        icon={<PhoneOutgoingIcon />}
        hint="Lifetime · placed from Skelo"
      />
    </section>
  );
}

const STATUS_DOT: Record<LeadStatus, string> = {
  new: "bg-info",
  contacted: "bg-muted-foreground",
  qualified: "bg-success",
  negotiating: "bg-warning",
  won: "bg-success",
  lost: "bg-destructive",
};

function leadsHref(opts: {
  include: boolean;
  q?: string;
  status?: LeadStatus | null;
  page?: number;
}): string {
  const params = new URLSearchParams();
  if (opts.include) params.set("include", "all");
  if (opts.q) params.set("q", opts.q);
  if (opts.status) params.set("status", opts.status);
  if (opts.page && opts.page > 1) params.set("page", String(opts.page));
  const qs = params.toString();
  return qs ? `/leads?${qs}` : "/leads";
}

function ViewToggle({
  includeZero,
  q,
  status,
}: {
  includeZero: boolean;
  q: string;
  status: LeadStatus | null;
}) {
  const base =
    "rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap";
  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-border/70 bg-muted/40 p-0.5">
      <Link
        href={leadsHref({ include: false, q, status })}
        className={`${base} ${
          includeZero
            ? "text-muted-foreground hover:text-foreground"
            : "bg-card text-foreground shadow-xs"
        }`}
      >
        With calls
      </Link>
      <Link
        href={leadsHref({ include: true, q, status })}
        className={`${base} ${
          includeZero
            ? "bg-card text-foreground shadow-xs"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        All leads
      </Link>
    </div>
  );
}

interface LeadsViewProps {
  orgSlug: string;
  organisationId: string;
  organisationName: string;
}

export function LeadsView({
  orgSlug,
  organisationId,
  organisationName,
}: LeadsViewProps) {
  const searchParams = useSearchParams();

  const includeZero = searchParams.get("include") === "all";
  const search = typeof searchParams.get("q") === "string" ? (searchParams.get("q") ?? "").trim() : "";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const statusParam = searchParams.get("status");
  const status = LEAD_STATUS_ORDER.find((s) => s === statusParam) ?? null;

  // TanStack Query for catalog definitions (5m cache)
  const { data: catalog = [] } = useQuery({
    queryKey: ["lead-field-defs", organisationId],
    queryFn: async () => {
      const res = await listLeadFieldDefinitions({
        organisation_id: organisationId,
        visible_only: false,
      });
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  // TanStack Query for status counts funnel
  const { data: perStatus } = useQuery({
    queryKey: ["leads-status-counts", orgSlug, includeZero],
    queryFn: async () => {
      const res = await getLeadStatusCounts({
        org_slug: orgSlug,
        include_zero_calls: includeZero,
      });
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
    staleTime: 60 * 1000,
  });

  const statusCounts = perStatus
    ? {
        ...perStatus,
        all: Object.values(perStatus).reduce<number>(
          (acc, val) => acc + (val ?? 0),
          0,
        ),
      }
    : null;
  const showCounts = statusCounts !== null && !search;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <h1 className="font-heading text-2xl font-semibold leading-tight tracking-tight md:text-3xl">
            Leads
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            One row per unique phone, scoped to {organisationName}.
            Counts pull from every call across the org — inbound and outbound.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <LeadCreateDialog orgSlug={orgSlug} />
        </div>
      </header>

      {/* Lifetime Stat Cards: loaded asynchronously with TanStack Query */}
      <LifetimeStatCards orgSlug={orgSlug} />

      {/* Pipeline status tabs */}
      <NavTabs
        aria-label="Pipeline status"
        items={[
          {
            href: leadsHref({ include: includeZero, q: search }),
            label: "All",
            active: !status,
            count: showCounts ? statusCounts?.all : undefined,
          },
          ...LEAD_STATUS_ORDER.map((s) => ({
            href: leadsHref({ include: includeZero, q: search, status: s }),
            label: LEAD_STATUS_LABEL[s],
            active: status === s,
            icon: (
              <span
                aria-hidden
                className={`size-1.5 shrink-0 rounded-full ${STATUS_DOT[s]}`}
              />
            ),
            count: showCounts ? (statusCounts?.[s] ?? 0) : undefined,
          })),
        ]}
      />

      {/* Interactive Leads Table */}
      <LeadsActivityTable
        key={`${includeZero ? "all" : "with-calls"}-${status ?? "any"}-${page}`}
        pageSize={PAGE_SIZE}
        initialPage={page}
        organisationId={organisationId}
        orgSlug={orgSlug}
        includeZeroCalls={includeZero}
        statusFilter={status}
        catalog={catalog}
        initialSearch={search}
        viewToggle={
          <ViewToggle
            includeZero={includeZero}
            q={search}
            status={status}
          />
        }
      />
    </div>
  );
}
