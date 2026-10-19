import { Suspense } from "react";
import { requireSession } from "@/lib/auth/session";
import { ConversationsView } from "@/components/app/conversations-view";
import ConversationsLoading from "./loading";

export const metadata = { title: "Conversations · Skelo" };

export default async function ConversationsPage() {
  const session = await requireSession();

  return (
    <Suspense fallback={<ConversationsLoading />}>
      <ConversationsView
        organisationId={session.organisation.id}
        organisationName={session.organisation.name}
      />
    </Suspense>
  );
}
