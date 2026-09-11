import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireParticulierAccount } from "@/lib/supabase/session";
import { fetchAlbumsVideos, fetchAvailableMediaProducts, fetchPhotoAlbums } from "@/lib/supabase/photoPass";
import { fetchComptesPhotosDuJoueur } from "@/lib/supabase/reconnaissance";
import { PhotosViewClub } from "./PhotosViewClub";
import type { AthleteDetail } from "../AthleteDetailView";

// Photos d'un enfant affilié à un club (kind='club' uniquement, migration-connect-v79) — achat par
// le parent pour son enfant, master prompt §20. Réutilise le moteur média générique tel quel
// (mêmes fonctions que l'Espace joueur, src/lib/supabase/photoPass.ts) : can_access_media() gère
// déjà nativement le cas parent côté RLS (is_confirmed_parent_of), aucun changement backend
// nécessaire au-delà de connect_get_athlete_detail (déjà étendu pour exposer team_id/saison_id).
export default async function AthletePhotosPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if (kind !== "club") notFound();

  const supabase = await createClient();
  await requireParticulierAccount(supabase);

  const { data } = await supabase.rpc("connect_get_athlete_detail", { p_kind: kind, p_ref_id: id });
  const detail = data as AthleteDetail | null;
  if (!detail || !detail.club_id || !detail.team_id || !detail.saison_id) notFound();

  const [albumsBruts, products] = await Promise.all([
    fetchPhotoAlbums(supabase, detail.club_id, detail.team_id, detail.saison_id),
    fetchAvailableMediaProducts(supabase, detail.club_id, detail.team_id),
  ]);

  // La vidéo du match s'ouvre par le lien du montage déposé sur la mission (v157).
  const albums = await fetchAlbumsVideos(supabase, albumsBruts);
  // Combien de photos de CET enfant dans chaque galerie (v160/v162) : le compteur n'apparaît que
  // là où la Production a rattaché au moins une photo, jamais sous la forme d'un « 0 photo ».
  const comptes = await fetchComptesPhotosDuJoueur(supabase, albums.map((a) => a.id), id);

  return (
    <PhotosViewClub
      detail={detail}
      albums={albums}
      products={products}
      comptesParAlbum={Object.fromEntries(comptes)}
    />
  );
}
