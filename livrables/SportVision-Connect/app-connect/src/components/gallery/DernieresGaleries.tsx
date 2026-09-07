/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fetchMyGalleries } from "@/lib/gallery/data";

// « Mes dernières galeries » sur l'accueil Connect.
//
// Composant serveur, partagé par l'espace joueur et l'espace particulier : une seule lecture, un
// seul rendu, et donc une seule façon de compter les photos. Deux copies finiraient par afficher
// deux nombres différents pour la même galerie.
//
// PERFORMANCE : on ne charge AUCUNE photo ici. media_my_galleries() renvoie la couverture, le
// titre et un compte — les vignettes ne sont chargées que sur /galeries. Un accueil qui tirerait
// 200 miniatures serait lent pour tout le monde, y compris ceux qui n'ont acheté aucune photo.
//
// Trois galeries au plus : l'accueil est un aperçu, pas une liste.

const MAX = 3;

export async function DernieresGaleries() {
  const supabase = await createClient();
  const galeries = (await fetchMyGalleries(supabase)).slice(0, MAX);

  // Aucun achat : une ligne discrète plutôt qu'un grand bloc vide ou une réclame. La plupart des
  // comptes Connect n'ont jamais acheté de photos, et l'accueil ne leur doit rien de plus.
  if (galeries.length === 0) {
    return (
      <section>
        <h2 className="font-sora text-[17px] font-bold tracking-tight">Mes galeries</h2>
        <p className="mt-1.5 text-[13.5px] text-text-tertiary">
          Vos prochaines galeries SportVision apparaîtront ici.
        </p>
      </section>
    );
  }

  return (
    <section>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-sora text-[17px] font-bold tracking-tight">Mes dernières galeries</h2>
        <Link href="/galeries" className="text-[12.5px] text-text-tertiary underline underline-offset-2">
          Tout voir
        </Link>
      </div>

      <div className="mt-3 flex flex-col gap-2.5">
        {galeries.map((g) => (
          <Link
            key={g.albumId}
            href={`/galeries/${g.albumId}`}
            className="flex items-center gap-3.5 rounded-sv-card border border-border bg-surface p-2.5 transition hover:bg-surface-hover"
          >
            <div className="h-[58px] w-[58px] flex-none overflow-hidden rounded-sv bg-bg-elevated">
              {g.coverUrl && <img src={g.coverUrl} alt="" className="h-full w-full object-cover" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-semibold">{g.titre}</div>
              <div className="mt-0.5 truncate text-[12px] text-text-tertiary">
                {[
                  g.clubNom,
                  g.eventDate
                    ? new Date(`${g.eventDate}T12:00:00`).toLocaleDateString("fr-FR", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
              {/* Le nombre RÉELLEMENT acquis, jamais le quota vendu : un pack de 17 dont
                  l'acheteur n'a retenu que 13 photos affiche 13. */}
              <div className="mt-0.5 text-[12px] font-semibold text-affiliations">
                {g.photosAcquises} photo{g.photosAcquises > 1 ? "s" : ""} disponible
                {g.photosAcquises > 1 ? "s" : ""}
              </div>
            </div>
            <span className="flex-none pr-1 text-text-faint" aria-hidden>
              →
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
