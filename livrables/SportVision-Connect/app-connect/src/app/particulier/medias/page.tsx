import { HubGrid } from "@/components/layout/HubTile";

// Connect V3 — pilier "Médias" (Espace particulier). Pas d'équivalent "Pass Photo" côté
// particulier (spécifique à l'Espace joueur, voir audit AppShell/ParticularShell) — un seul
// pilier réel ici, gardé en page dédiée par cohérence avec les 5 onglets mobiles des deux espaces.
export default function MediasParticulierHubPage() {
  return (
    <HubGrid
      title="Médias"
      tiles={[
        {
          href: "/particulier/contenus",
          label: "Mes contenus",
          description: "Photos et vidéos livrées par SportVision",
          icon: "photo_library",
          color: "#C084FC",
        },
      ]}
    />
  );
}
