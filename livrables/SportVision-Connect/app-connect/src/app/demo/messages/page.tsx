import { MessagesThread } from "@/app/(joueur)/messages/MessagesThread";
import { DEMO_MESSAGES } from "@/lib/demo/mock-data";

// clientId factice : un envoi de message tenterait un insert Supabase non authentifié, bloqué
// par RLS (aucune écriture réelle possible) — la démo reste donc en lecture seule dans les faits.
export default function DemoMessagesPage() {
  return <MessagesThread clientId="demo-client" initialMessages={DEMO_MESSAGES} unavailable={false} />;
}
