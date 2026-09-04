import { HubGrid } from "@/components/layout/HubTile";

// Connect V3 — pilier "Médias" (mode démo). Pas de route /demo/photos (Pass Photo n'a jamais fait
// partie du parcours démo) — un seul pilier réel ici, gardé en page dédiée par cohérence avec les
// 5 onglets mobiles du vrai Espace joueur.
export default function MediasDemoHubPage() {
  return (
    <HubGrid
      title="Médias"
      tiles={[
        {
          href: "/demo/contenus",
          label: "Mes contenus",
          description: "Photos et vidéos livrées par SportVision",
          icon: "photo_library",
          color: "#C084FC",
        },
      ]}
    />
  );
}
