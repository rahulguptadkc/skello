import { redirect } from "next/navigation";

import { Logo } from "@/components/brand/logo";
import { Card } from "@/components/ui/card";
import { OnboardingForm } from "@/components/forms/onboarding-form";
import { listOrganisations } from "@/actions/organisations";
import { getCurrentUser } from "@/actions/auth";
import { getIsAdmin } from "@/lib/auth/admin";

export const metadata = { title: "Set up workspace · Skelo" };

export default async function OnboardingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Platform admins don't need their own workspace — send them home.
  if (await getIsAdmin()) redirect("/admin");

  const orgsResult = await listOrganisations();
  if (orgsResult.success && orgsResult.data.length > 0) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <header className="border-b border-border/60 bg-background px-6 py-4">
        <Logo />
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-12">
        <Card className="p-8">
          <div className="mb-6 space-y-1.5">
            <h1 className="font-heading text-xl font-semibold leading-tight tracking-tight">
              Create your workspace
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              You don&apos;t have an organisation yet. Choose your business type
              and name it to spin one up.
            </p>
          </div>
          <OnboardingForm />
        </Card>
      </main>
    </div>
  );
}
