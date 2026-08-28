import { createClient } from "@/lib/supabase/server";
import { buildPlayerContext, requireJoueurAccount } from "@/lib/supabase/session";
import { fetchPhotoAlbums } from "@/lib/supabase/photoPass";
import { PhotosView } from "./PhotosView";

// Pass Photo (Espace joueur) — voir migration-connect-pass-photo-v1.sql. Liste les albums photo
// publiés de l'équipe réelle du joueur (team_memberships, RLS tm_player_select : is_own_player),
// verrouillés tant qu'aucun Pass Photo actif n'a été acheté pour cette équipe + cette saison
// précise (photo_pass_entitlements, clé club_id+team_id+season_id).
//
// season_id vient de team_memberships.saison (la saison RÉELLE de l'affiliation validée du joueur
// à cette équipe — pas clubs.saison, qui est une valeur d'affichage générale du club, potentiellement
// désynchronisée si le club a déjà basculé de saison sans que l'équipe du joueur n'ait été
// re-affiliée). buildPlayerContext() ne renvoie pas déjà la saison (elle ne lui est pas utile pour
// l'Accueil/le fil club) — requête dédiée ici, sur la même ligne team_memberships (statut='active')
// que celle déjà lue par buildPlayerContext.
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
  let seasonId: string | null = null;

  if (player?.club?.team && player.playerId) {
    clubId = player.club.id;
    teamId = player.club.team.id;
    teamName = player.club.team.name;
    const { data: membership } = await supabase
      .from("team_memberships")
      .select("saison")
      .eq("player_id", player.playerId)
      .eq("team_id", teamId)
      .eq("statut", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    seasonId = (membership?.saison as string | null) || null;
  }

  const albums = clubId && teamId && seasonId ? await fetchPhotoAlbums(supabase, clubId, teamId, seasonId) : [];

  return (
    <PhotosView
      clubId={clubId}
      teamId={teamId}
      teamName={teamName}
      seasonId={seasonId}
      albums={albums}
      returnStatus={paiement === "succes" ? "succes" : paiement === "annule" ? "annule" : null}
    />
  );
}
