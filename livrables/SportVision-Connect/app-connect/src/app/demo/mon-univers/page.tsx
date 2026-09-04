import { HubGrid } from "@/components/layout/HubTile";

// Connect V3 — pilier "Mon univers" (mode démo), même contenu que le vrai Espace joueur.
export default function MonUniversDemoHubPage() {
  return (
    <HubGrid
      title="Mon univers"
      tiles={[
        {
          href: "/demo/affiliations",
          label: "Mon affiliation",
          description: "Le ou les clubs auxquels vous êtes rattaché",
          icon: "shield",
          color: "#22D3EE",
        },
        {
          href: "/demo/equipes",
          label: "Mes équipes",
          description: "Vos équipes et leurs membres",
          icon: "groups",
          color: "#22D3EE",
        },
        {
          href: "/demo/calendrier",
          label: "Calendrier",
          description: "Matchs, entraînements et événements à venir",
          icon: "calendar_month",
          color: "#8CA9FF",
        },
        {
          href: "/demo/messages",
          label: "Messages",
          description: "Vos échanges avec le club et SportVision",
          icon: "forum",
          color: "#22D3EE",
        },
      ]}
    />
  );
}
