import { HubGrid } from "@/components/layout/HubTile";

// Connect V3 — pilier "Mon univers" (Espace joueur). Regroupe Mon affiliation, Mes équipes,
// Calendrier et Messages, jusqu'ici accessibles uniquement via la feuille "Plus" — voir
// HubTile.tsx pour le principe (aucune logique dupliquée).
export default function MonUniversHubPage() {
  return (
    <HubGrid
      title="Mon univers"
      tiles={[
        {
          href: "/affiliations",
          label: "Mon affiliation",
          description: "Le ou les clubs auxquels vous êtes rattaché",
          icon: "shield",
          color: "#22D3EE",
        },
        {
          href: "/equipes",
          label: "Mes équipes",
          description: "Vos équipes et leurs membres",
          icon: "groups",
          color: "#22D3EE",
        },
        {
          href: "/calendrier",
          label: "Calendrier",
          description: "Matchs, entraînements et événements à venir",
          icon: "calendar_month",
          color: "#8CA9FF",
        },
        {
          href: "/messages",
          label: "Messages",
          description: "Vos échanges avec le club et SportVision",
          icon: "forum",
          color: "#22D3EE",
        },
      ]}
    />
  );
}
