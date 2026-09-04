import { HubGrid } from "@/components/layout/HubTile";

// Connect V3 — pilier "Médias" (Espace joueur). Regroupe Mes contenus et Pass Photo, jusqu'ici
// deux onglets séparés — voir HubTile.tsx pour le principe (aucune logique dupliquée).
export default function MediasHubPage() {
  return (
    <HubGrid
      title="Médias"
      tiles={[
        {
          href: "/contenus",
          label: "Mes contenus",
          description: "Photos et vidéos livrées par SportVision",
          icon: "photo_library",
          color: "#C084FC",
        },
        {
          href: "/photos",
          label: "Pass Photo",
          description: "Débloquer l'accès aux albums de votre équipe",
          icon: "photo_camera",
          color: "#34D399",
        },
      ]}
    />
  );
}
