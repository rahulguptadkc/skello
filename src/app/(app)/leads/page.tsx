import { Suspense } from "react";
import { requireSession } from "@/lib/auth/session";
import { QueryProvider } from "@/components/providers/query-provider";
import { LeadsView } from "@/components/app/leads-view";
import LeadsLoading from "./loading";

export const metadata = { title: "Leads · Skelo" };

export default async function LeadsPage() {
  const session = await requireSession();

  return (
    <QueryProvider>
      <Suspense fallback={<LeadsLoading />}>
        <LeadsView
          orgSlug={session.organisation.slug}
          organisationId={session.organisation.id}
          organisationName={session.organisation.name}
        />
      </Suspense>
    </QueryProvider>
  );
}
