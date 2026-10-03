import Link from "next/link";
import {
  ArrowLeftIcon,
  Building2Icon,
  CalendarCheckIcon,
  PhoneCallIcon,
  SparklesIcon,
  UserCheckIcon,
  UsersIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/app/stat-card";
import { requireSession } from "@/lib/auth/session";

export const metadata = { title: "Pre-Sales · Campaigns · Skelo" };

export default async function PreSalesTemplatePage() {
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
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              <SparklesIcon className="size-3" /> Real Estate Pre-Sales
            </span>
          </div>
          <h1 className="font-heading text-2xl font-semibold leading-tight tracking-tight md:text-3xl">
            Pre-Sales & Site Visits
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Automated inbound qualification and site-visit scheduling engine for {session.organisation.name}. Captures buyer intent, unit preferences (2BHK / 3BHK / Villa), and books verified calendar visits.
          </p>
        </div>
      </header>

      {/* KPI Stats */}
      <section className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Inbound Inquiries"
          value="0"
          icon={<UsersIcon />}
          hint="From portals & ads"
        />
        <StatCard
          label="Qualified Buyers"
          value="0"
          icon={<UserCheckIcon />}
          hint="Budget & unit match"
        />
        <StatCard
          label="Site Visits Booked"
          value="0"
          icon={<CalendarCheckIcon />}
          hint="Confirmed on calendar"
        />
        <StatCard
          label="Connected Calls"
          value="0"
          icon={<PhoneCallIcon />}
          hint="Average 92% pickup"
        />
      </section>

      {/* Active Pre-Sales Configuration */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Building2Icon className="size-5 text-primary" />
              <CardTitle>Inbound Channel Sources</CardTitle>
            </div>
            <CardDescription>
              Connect your property portals (99acres, MagicBricks, Housing) and Google Ads webhooks to instantly trigger AI qualification.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg border border-border/80 bg-muted/40 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">99acres & Property Portals</p>
                  <p className="text-xs text-muted-foreground">Instant callback within 60 seconds of lead submission</p>
                </div>
                <Button variant="outline" size="sm" render={<Link href="/integrations?tab=portal-99acres" />}>
                  Configure
                </Button>
              </div>
            </div>

            <div className="rounded-lg border border-border/80 bg-muted/40 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Google Ads & Meta Forms</p>
                  <p className="text-xs text-muted-foreground">Sync leads directly into your voice agent queue</p>
                </div>
                <Button variant="outline" size="sm" render={<Link href="/integrations?tab=google-ads" />}>
                  Configure
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CalendarCheckIcon className="size-5 text-primary" />
              <CardTitle>Site Visit Booking Rules</CardTitle>
            </div>
            <CardDescription>
              AI voice agent qualifies buyer budget and sends WhatsApp confirmation with Google Maps location pin.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm leading-relaxed text-muted-foreground">
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-primary" />
              <p>Captures preferred project configuration: 2BHK, 3BHK, Penthouse, Plot size.</p>
            </div>
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-primary" />
              <p>Checks sales executive availability and registers prospective visitor details.</p>
            </div>
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-primary" />
              <p>Dispatches WhatsApp brocure & directions immediately upon call completion.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
