import { HubGrid } from "@/components/layout/HubTile";

// Connect V3 — pilier "Services" (Espace joueur). Regroupe Prestations, Paiement collectif, Mes
// commandes et Factures & paiements, jusqu'ici 2 onglets séparés + 2 entrées dans "Plus" — voir
// HubTile.tsx pour le principe (aucune logique dupliquée).
export default function ServicesHubPage() {
  return (
    <HubGrid
      title="Services"
      tiles={[
        {
          href: "/prestations",
          label: "Prestations",
          description: "Réserver une prestation SportVision",
          icon: "camera_alt",
          color: "#8CA9FF",
        },
        {
          href: "/cotisations",
          label: "Paiement collectif",
          description: "Participer à un paiement groupé",
          icon: "savings",
          color: "#F472B6",
        },
        {
          href: "/commandes",
          label: "Mes commandes",
          description: "L'historique de vos commandes",
          icon: "receipt_long",
          color: "#8CA9FF",
        },
        {
          href: "/factures",
          label: "Factures & paiements",
          description: "Vos factures et le suivi de vos paiements",
          icon: "payments",
          color: "#FBBF24",
        },
      ]}
    />
  );
}
