import { CallsCsvImporter } from "@/components/app/calls-csv-importer";
import { SettingsNavTabs } from "@/components/app/settings/settings-nav-tabs";
import { requireSession } from "@/lib/auth/session";

export const metadata = { title: "Import calls · Settings · Skelo" };

export default async function ImportCallsPage() {
  await requireSession();

  return (
    <div className="flex flex-col gap-6">
      <header className="space-y-1.5">
        <h1 className="font-heading text-2xl font-semibold leading-tight tracking-tight md:text-3xl">
          Settings
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Upload a call export CSV to backfill your call history.
        </p>
      </header>

      <SettingsNavTabs />

      <CallsCsvImporter />
    </div>
  );
}
