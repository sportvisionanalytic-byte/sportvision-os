import { HubGrid } from "@/components/layout/HubTile";

// Connect V3 — pilier "Services" (mode démo), même contenu que le vrai Espace joueur.
export default function ServicesDemoHubPage() {
  return (
    <HubGrid
      title="Services"
      tiles={[
        {
          href: "/demo/prestations",
          label: "Prestations",
          description: "Réserver une prestation SportVision",
          icon: "camera_alt",
          color: "#8CA9FF",
        },
        {
          href: "/demo/cotisations",
          label: "Paiement collectif",
          description: "Participer à un paiement groupé",
          icon: "savings",
          color: "#F472B6",
        },
        {
          href: "/demo/commandes",
          label: "Mes commandes",
          description: "L'historique de vos commandes",
          icon: "receipt_long",
          color: "#8CA9FF",
        },
        {
          href: "/demo/factures",
          label: "Factures & paiements",
          description: "Vos factures et le suivi de vos paiements",
          icon: "payments",
          color: "#FBBF24",
        },
      ]}
    />
  );
}
