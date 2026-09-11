import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireParticulierAccount } from "@/lib/supabase/session";
import { publicMediaUrl } from "@/lib/gallery/data";
import { fetchPhotosDuJoueur } from "@/lib/supabase/reconnaissance";
import { fetchPhotoAlbums } from "@/lib/supabase/photoPass";
import type { AthleteDetail } from "../../AthleteDetailView";

// « Les photos de mon enfant » dans une galerie (migrations v160 et v162).
// La base ne rend que les photos dont le rattachement a été validé par une personne, et seulement à
// la famille : cette page ne filtre rien elle-même, elle affiche ce que le serveur lui donne.
// Les aperçus sont ceux de la galerie (filigranés quand la galerie l'est). Tant que l'accès n'est
// pas acheté, seuls les six premiers sont montrés : un aperçu, pas la galerie entière.
const APERCU_MAX = 6;

export default async function PhotosDeMonEnfantPage({
  params,
}: {
  params: Promise<{ kind: string; id: string; albumId: string }>;
}) {
  const { kind, id, albumId } = await params;
  if (kind !== "club") notFound();

  const supabase = await createClient();
  await requireParticulierAccount(supabase);

  const { data } = await supabase.rpc("connect_get_athlete_detail", { p_kind: kind, p_ref_id: id });
  const detail = data as AthleteDetail | null;
  if (!detail || !detail.club_id || !detail.team_id || !detail.saison_id) notFound();

  const [photos, albums] = await Promise.all([
    fetchPhotosDuJoueur(supabase, albumId, id),
    fetchPhotoAlbums(supabase, detail.club_id, detail.team_id, detail.saison_id),
  ]);
  const album = albums.find((a) => a.id === albumId);
  if (!album) notFound();

  const visibles = album.unlocked ? photos : photos.slice(0, APERCU_MAX);
  const restantes = photos.length - visibles.length;

  return (
    <div className="flex flex-col gap-6 animate-sv-in">
      <Link
        href={`/particulier/sportifs/${kind}/${id}/photos`}
        className="flex min-h-11 w-fit items-center gap-2 text-[14px] font-medium text-text-tertiary hover:text-text"
      >
        <span className="material-symbols-rounded !text-[18px]" aria-hidden="true">arrow_back</span>
        Photos de {detail.first_name}
      </Link>

      <div className="flex flex-col gap-2">
        <h1 className="font-sora text-[27px] font-bold tracking-tight lg:text-[33px]">
          {detail.first_name} dans « {album.title} »
        </h1>
        <p className="max-w-[560px] text-[15px] text-text-tertiary">
          {photos.length === 0
            ? "Aucune photo de " + detail.first_name + " n'a encore été repérée dans cette galerie."
            : photos.length === 1
              ? "1 photo de " + detail.first_name + " a été repérée dans cette galerie."
              : photos.length + " photos de " + detail.first_name + " ont été repérées dans cette galerie."}
        </p>
      </div>

      {photos.length === 0 ? (
        <div className="flex max-w-[560px] flex-col gap-3.5 rounded-sv-card border border-dashed border-border-strong bg-surface p-6">
          <span className="flex h-12 w-12 items-center justify-center rounded-sv bg-contenus-bg">
            <span className="material-symbols-rounded !text-[24px] text-contenus" aria-hidden="true">search</span>
          </span>
          <span className="font-sora text-[18px] font-semibold">Rien pour le moment</span>
          <p className="text-[14px] leading-relaxed text-text-tertiary">
            SportVision n&apos;a pas encore rattaché de photo à {detail.first_name} dans cette galerie.
            La galerie complète de l&apos;équipe reste accessible depuis la page précédente.
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
                ? "1 autre photo de " + detail.first_name + " vous attend dans cette galerie."
                : restantes + " autres photos de " + detail.first_name + " vous attendent dans cette galerie."}{" "}
              <Link href={`/particulier/sportifs/${kind}/${id}/photos`} className="underline hover:text-text-secondary">
                Voir les formules
              </Link>
            </p>
          )}
        </>
      )}
    </div>
  );
}
