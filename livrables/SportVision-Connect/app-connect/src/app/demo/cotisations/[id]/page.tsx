import { FundingDetailView } from "@/app/(joueur)/cotisations/[id]/FundingDetailView";
import { DEMO_FUNDING_DETAIL } from "@/lib/demo/mock-data";

// Démo : un seul paiement collectif fictif ("demo-f1"), quel que soit l'id demandé — évite un
// 404 sur /demo/cotisations/demo-f1 (lien réel depuis la liste). "Participer" appellerait une
// RPC nécessitant auth.uid() — échoue proprement sans session, aucune écriture réelle possible.
export default function DemoCotisationDetailPage() {
  return <FundingDetailView funding={DEMO_FUNDING_DETAIL} listHref="/demo/cotisations" />;
}
