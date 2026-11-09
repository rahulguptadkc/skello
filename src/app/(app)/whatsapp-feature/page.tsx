import { requireSession } from "@/lib/auth/session";
import { WhatsAppFeatureView } from "@/anugraha/whatsapp-feature-view";

export const metadata = {
  title: "WhatsApp Feature · Skelo",
};

export default async function WhatsAppFeaturePage() {
  const session = await requireSession();

  return (
    <WhatsAppFeatureView
      organisationName={session.organisation.name}
      userEmail={session.email}
    />
  );
}

