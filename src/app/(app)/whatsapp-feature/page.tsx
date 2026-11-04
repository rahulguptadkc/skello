import { requireSession } from "@/lib/auth/session";
import { WhatsAppFeatureView } from "@/components/app/whatsapp-feature/whatsapp-feature-view";

export const metadata = {
  title: "WhatsApp Feature · Skelo",
};

export default async function WhatsAppFeaturePage() {
  const session = await requireSession();

  return (
    <WhatsAppFeatureView
      organisationName={session.organisation.name}
    />
  );
}

