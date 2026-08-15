import { createClient } from "@/lib/supabase/server";
import { buildPlayerContext, requireJoueurAccount } from "@/lib/supabase/session";
import { AppShell } from "@/components/layout/AppShell";
import { ContentGallery, type ContentItem } from "./ContentGallery";

// Mes contenus — voir design-connect-personnel-12-08/README.md § Espace joueur → Mes contenus.
//
// SOURCE DE DONNÉES — écart volontaire par rapport à la liste initiale (`contenus`,
// `contenu_stats`) : `contenus` (migration-contenus.sql) est le planning éditorial CM
// (posts/publications Instagram — hook/légende/cta/hashtags/sponsor), réservé à la communication
// club (MASTER-CONNECT-V1 §19, "pas affiché au joueur"), pas les photos/vidéos qu'un joueur
// consulte. C'est explicitement confirmé par le commentaire de tête de
// migration-connect-v43-espace-joueur.sql (§1) : les contenus réels d'un espace Joueur viennent de
// `club_media` (migration-clubplus-v7.sql), déjà utilisées en production par l'ancien app-next
// (lib/data/player/media.ts → fetchClubMediaAssets). RLS fail-closed déjà en place et déjà
// exécutée : `cmd_family_select` sur club_media exige une ligne `media_access_rules` publiée par
// le club ET que le joueur ait un `team_memberships` actif dans l'équipe visée
// (migration-clubplus-v18.sql, v30 pour le droit à l'image) — donc "aucun contenu" est un état
// légitime tant que le club n'a rien publié vers l'Espace Joueur, pas une erreur.
//
// `club_creations` (créations graphiques/visuels) n'est PAS repris ici : ces lignes n'ont aucun
// fichier réel associé (`link`/fileUrl toujours vide côté app-next, voir lib/data/club/content.ts)
// — les afficher dans une galerie avec bouton "Télécharger" serait un bouton décoratif, interdit
// par MASTER-CONNECT-V1 §0/§59.
//
// Favoris : `contenu_favoris` (créée par migration-connect-v43-espace-joueur.sql, déjà exécutée —
// la table répond en direct). `media_asset_id` est un texte libre au format `media-<uuid>` (même
// convention que MediaAsset.id côté app-next), RLS strictement own-row (user_id = auth.uid()).
export default async function ContenusPage() {
  const supabase = await createClient();
  const { user } = await requireJoueurAccount(supabase);

  // player et favRows sont indépendants (contenu_favoris ne dépend que de user.id, pas du
  // profil joueur) — voir rapport fluidité perçue 15/08. club_media, en revanche, a besoin de
  // player.club.id une fois résolu : dépendance réelle, reste séquentiel après le Promise.all.
  const [player, favRows] = await Promise.all([
    buildPlayerContext(supabase, user.id),
    supabase
      .from("contenu_favoris")
      .select("media_asset_id")
      .eq("user_id", user.id)
      .then((res) => res.data),
  ]);
  const firstName = player?.firstName || user.email?.split("@")[0] || "";

  let items: ContentItem[] = [];
  if (player?.club) {
    const { data } = await supabase
      .from("club_media")
      .select("id, title, type, team, link, tags, created_at")
      .eq("club_id", player.club.id)
      .eq("expired", false)
      .order("created_at", { ascending: false });

    items = (data ?? []).map((row) => ({
      id: row.id as string,
      title: row.title as string,
      type: row.type as string,
      team: (row.team as string | null) ?? null,
      link: (row.link as string | null) ?? null,
      tags: (row.tags as string | null) ?? null,
      createdAt: row.created_at as string,
    }));
  }

  const favoriteIds = (favRows ?? []).map((r) => r.media_asset_id as string);

  return (
    <AppShell firstName={firstName}>
      <ContentGallery items={items} favoriteIds={favoriteIds} hasClub={!!player?.club} />
    </AppShell>
  );
}
