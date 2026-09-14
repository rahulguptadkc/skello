import Link from "next/link";
import {
  ArrowLeftIcon,
  BadgeIndianRupeeIcon,
  ClockIcon,
  ReceiptIcon,
  SparklesIcon,
  UploadCloudIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/app/stat-card";
import { requireSession } from "@/lib/auth/session";

export const metadata = { title: "Tranche Recovery · Campaigns · Skelo" };

export default async function TrancheRecoveryTemplatePage() {
  const session = await requireSession();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2"
          render={<Link href="/campaigns" />}
        >
          <ArrowLeftIcon /> Back to outreach
        </Button>
      </div>

      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
              <SparklesIcon className="size-3" /> Real Estate Post-Sales
            </span>
          </div>
          <h1 className="font-heading text-2xl font-semibold leading-tight tracking-tight md:text-3xl">
            Tranche Recovery
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Construction milestone installment tracking & payment recovery for {session.organisation.name}. Dials buyers with upcoming or overdue demand milestones and delivers WhatsApp payment links.
          </p>
        </div>
      </header>

      {/* KPI Stats */}
      <section className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Pending Tranches"
          value="₹0"
          icon={<BadgeIndianRupeeIcon />}
          hint="Milestone installments"
        />
        <StatCard
          label="Overdue Calls"
          value="0"
          icon={<ClockIcon />}
          hint="Past grace period"
        />
        <StatCard
          label="Recovered Amount"
          value="₹0"
          icon={<ReceiptIcon />}
          hint="Collected via voice + WA"
        />
        <StatCard
          label="Recovery Rate"
          value="0%"
          icon={<SparklesIcon />}
          hint="Paid on milestone notice"
        />
      </section>

      {/* Placeholder Workspace Area */}
      <Card className="border-dashed">
        <CardHeader className="text-center">
          <div className="mx-auto grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
            <ReceiptIcon className="size-6" />
          </div>
          <CardTitle className="text-lg">Tranche Recovery Workspace</CardTitle>
          <CardDescription className="mx-auto max-w-md">
            Import buyer installment schedules or connect your ERP to automate payment milestone notices and WhatsApp payment reminders.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center pb-8">
          <Button variant="outline">
            <UploadCloudIcon /> Import Tranche Schedule CSV
          </Button>
          <p className="mt-3 text-xs text-muted-foreground">
            Awaiting custom layout mock from Rahul · Coming soon
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
