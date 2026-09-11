import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { buildPlayerContext, requireJoueurAccount } from "@/lib/supabase/session";
import { publicMediaUrl } from "@/lib/gallery/data";
import { fetchPhotosDuJoueur } from "@/lib/supabase/reconnaissance";
import { fetchPhotoAlbums } from "@/lib/supabase/photoPass";

// « Mes photos » dans une galerie (migrations v160 et v162), côté joueur.
// Même règle que côté parent : la base ne rend que les rattachements validés par une personne, et
// seulement au joueur lui-même. Tant que l'accès n'est pas acheté, on n'en montre que six.
const APERCU_MAX = 6;

export default async function MesPhotosDansUnAlbumPage({
  params,
}: {
  params: Promise<{ albumId: string }>;
}) {
  const { albumId } = await params;
  const supabase = await createClient();
  const { user } = await requireJoueurAccount(supabase);
  const player = await buildPlayerContext(supabase, user.id);
  if (!player?.playerId || !player.club?.team) notFound();

  const { data: membership } = await supabase
    .from("team_memberships")
    .select("saison_id")
    .eq("player_id", player.playerId)
    .eq("team_id", player.club.team.id)
    .eq("statut", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const saisonId = (membership?.saison_id as string | null) || null;
  if (!saisonId) notFound();

  const [photos, albums] = await Promise.all([
    fetchPhotosDuJoueur(supabase, albumId, player.playerId),
    fetchPhotoAlbums(supabase, player.club.id, player.club.team.id, saisonId),
  ]);
  const album = albums.find((a) => a.id === albumId);
  if (!album) notFound();

  const visibles = album.unlocked ? photos : photos.slice(0, APERCU_MAX);
  const restantes = photos.length - visibles.length;

  return (
    <div className="flex flex-col gap-6 animate-sv-in">
      <Link href="/photos" className="flex min-h-11 w-fit items-center gap-2 text-[14px] font-medium text-text-tertiary hover:text-text">
        <span className="material-symbols-rounded !text-[18px]" aria-hidden="true">arrow_back</span>
        Photos
      </Link>

      <div className="flex flex-col gap-2">
        <h1 className="font-sora text-[27px] font-bold tracking-tight lg:text-[33px]">Vous dans « {album.title} »</h1>
        <p className="max-w-[560px] text-[15px] text-text-tertiary">
          {photos.length === 0
            ? "Aucune photo de vous n'a encore été repérée dans cette galerie."
            : photos.length === 1
              ? "1 photo de vous a été repérée dans cette galerie."
              : photos.length + " photos de vous ont été repérées dans cette galerie."}
        </p>
      </div>

      {photos.length === 0 ? (
        <div className="flex max-w-[560px] flex-col gap-3.5 rounded-sv-card border border-dashed border-border-strong bg-surface p-6">
          <span className="flex h-12 w-12 items-center justify-center rounded-sv bg-contenus-bg">
            <span className="material-symbols-rounded !text-[24px] text-contenus" aria-hidden="true">search</span>
          </span>
          <span className="font-sora text-[18px] font-semibold">Rien pour le moment</span>
          <p className="text-[14px] leading-relaxed text-text-tertiary">
            SportVision n&apos;a pas encore rattaché de photo à votre nom dans cette galerie. La galerie
            complète de l&apos;équipe reste accessible depuis la page précédente.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {visibles.map((p) => (
              <div key={p.assetId} className="overflow-hidden rounded-sv border border-border bg-surface">
                {p.thumbPath || p.previewPath ? (
                  // eslint-disable-next-line @next/next/no-img-element -- aperçu distant, pas un domaine autorisé pour next/image
                  <img
                    src={publicMediaUrl((p.previewPath ?? p.thumbPath)!)}
                    alt=""
                    loading="lazy"
                    className="aspect-[4/3] w-full object-cover"
                  />
                ) : (
                  <div className="aspect-[4/3] w-full bg-surface-hover" />
                )}
              </div>
            ))}
          </div>
          {restantes > 0 && (
            <p className="text-[14px] leading-relaxed text-text-tertiary">
              {restantes === 1
                ? "1 autre photo de vous vous attend dans cette galerie."
                : restantes + " autres photos de vous vous attendent dans cette galerie."}{" "}
              <Link href="/photos" className="underline hover:text-text-secondary">
                Voir les formules
              </Link>
            </p>
          )}
        </>
      )}
    </div>
  );
}
