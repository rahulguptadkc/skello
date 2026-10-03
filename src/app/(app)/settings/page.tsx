import Link from "next/link";
import { PlugZapIcon, UploadCloudIcon, UsersIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { SettingsNavTabs } from "@/components/app/settings/settings-nav-tabs";
import { requireSession } from "@/lib/auth/session";

export const metadata = { title: "Settings · Skelo" };

export default async function SettingsPage() {
  const session = await requireSession();

  return (
    <div className="flex flex-col gap-6">
      <header className="space-y-1.5">
        <h1 className="font-heading text-2xl font-semibold leading-tight tracking-tight md:text-3xl">
          Settings
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Manage your workspace, team members, and account.
        </p>
      </header>

      <SettingsNavTabs />

      <Card>
        <CardHeader>
          <CardTitle>Workspace</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="org-name">Name</Label>
            <Input id="org-name" defaultValue={session.organisation.name} disabled />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="org-slug">Slug</Label>
            <Input id="org-slug" defaultValue={session.organisation.slug} disabled />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="org-industry">Business Type</Label>
            <Input
              id="org-industry"
              defaultValue={
                session.organisation.industry === "ecommerce"
                  ? "E-Commerce (Cart Recovery, COD & Shopify)"
                  : "Real Estate (Pre-Sales, Reactivate & Tranche Recovery)"
              }
              disabled
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Workspace edits are locked in this preview build.
          </p>
        </CardContent>
      </Card>

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle>Team & Roles</CardTitle>
          <CardDescription>
            Onboard team members, assign admin or member roles, and manage access to this workspace.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" render={<Link href="/settings/team" />}>
            <UsersIcon /> Manage Team
          </Button>
        </CardContent>
      </Card>

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle>Connections</CardTitle>
          <CardDescription>
            Your voice agent, lead sources and connected stores live on their
            own page, with setup steps and a delivery log for each.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" render={<Link href="/integrations" />}>
            <PlugZapIcon /> Open Integrations
          </Button>
        </CardContent>
      </Card>

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle>Data</CardTitle>
          <CardDescription>
            Backfill historical calls from a voice-agent CSV export.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" render={<Link href="/settings/import-calls" />}>
            <UploadCloudIcon /> Import calls from CSV
          </Button>
        </CardContent>
      </Card>

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="acct-email">Email</Label>
            <Input id="acct-email" defaultValue={session.email} disabled />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="acct-role">Workspace Role</Label>
            <Input
              id="acct-role"
              defaultValue={session.role === "admin" ? "Admin (Workspace Manager)" : "Team Member"}
              disabled
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

