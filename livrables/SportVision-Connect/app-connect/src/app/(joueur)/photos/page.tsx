import { createClient } from "@/lib/supabase/server";
import { buildPlayerContext, requireJoueurAccount } from "@/lib/supabase/session";
import { fetchAvailableMediaProducts, fetchPhotoAlbums } from "@/lib/supabase/photoPass";
import { PhotosView } from "./PhotosView";

// Moteur média générique (Espace joueur) — 02/09/2026, voir migration-media-v1-moteur-generique.sql
// (remplace le Pass Photo figé équipe+saison du 28/08/2026, jamais activé commercialement). Liste
// les albums photo publiés de l'équipe réelle du joueur (team_memberships, RLS tm_player_select :
// is_own_player), verrouillés tant qu'aucun droit actif n'a été acheté (media_entitlements),
// résolu par can_access_media() selon la politique du club/de l'album.
//
// saisonId vient de team_memberships.saison_id (la saison RÉELLE de l'affiliation validée du
// joueur à cette équipe — pas clubs.saison_id, qui est une valeur d'affichage générale du club,
// potentiellement désynchronisée si le club a déjà basculé de saison sans que l'équipe du joueur
// n'ait été re-affiliée). buildPlayerContext() ne renvoie pas déjà la saison (elle ne lui est pas
// utile pour l'Accueil/le fil club) — requête dédiée ici, sur la même ligne team_memberships
// (statut='active') que celle déjà lue par buildPlayerContext.
export default async function PhotosPage({
  searchParams,
}: {
  searchParams: Promise<{ paiement?: string }>;
}) {
  const { paiement } = await searchParams;
  const supabase = await createClient();
  const { user } = await requireJoueurAccount(supabase);

  const player = await buildPlayerContext(supabase, user.id);

  let clubId: string | null = null;
  let teamId: string | null = null;
  let teamName: string | null = null;
  let saisonId: string | null = null;

  if (player?.club?.team && player.playerId) {
    clubId = player.club.id;
    teamId = player.club.team.id;
    teamName = player.club.team.name;
    const { data: membership } = await supabase
      .from("team_memberships")
      .select("saison_id")
      .eq("player_id", player.playerId)
      .eq("team_id", teamId)
      .eq("statut", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    saisonId = (membership?.saison_id as string | null) || null;
  }

  const [albums, products] = clubId && teamId && saisonId
    ? await Promise.all([fetchPhotoAlbums(supabase, clubId, teamId, saisonId), fetchAvailableMediaProducts(supabase, clubId, teamId)])
    : [[], []];

  return (
    <PhotosView
      clubId={clubId}
      teamId={teamId}
      teamName={teamName}
      saisonId={saisonId}
      albums={albums}
      products={products}
      returnStatus={paiement === "succes" ? "succes" : paiement === "annule" ? "annule" : null}
    />
  );
}
