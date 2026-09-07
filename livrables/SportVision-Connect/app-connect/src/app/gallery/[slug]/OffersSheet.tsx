"use client";

import { formatPrice, offerSummary, type LinkOffer } from "@/lib/gallery/pricing";

// Le choix de la formule.
//
// RIEN n'est décidé ici. Le nombre d'offres, leur ordre, leur nom, leur prix, le nombre de photos
// et celle qui est mise en avant viennent tous de la configuration faite dans l'OS, lien par lien.
// Cet écran doit rester correct avec une offre comme avec sept, et ne suppose jamais qu'il y a
// « un petit pack, un grand pack et l'album » : il rend la liste qu'on lui donne.
//
// Volontairement une LISTE VERTICALE et non des colonnes : le parent est sur son téléphone, au
// bord d'un terrain. Trois colonnes sur 390 px de large rendent chaque offre illisible, et une
// grille qui change de forme selon le nombre d'offres finit toujours par mal tomber à cinq.

export function OffersSheet({
  offres,
  photoCount,
  selection,
  onChoisir,
  onClose,
}: {
  offres: LinkOffer[];
  photoCount: number;
  /** Nombre de photos déjà cochées : sert à dire ce qui sera conservé en changeant de formule. */
  selection: number;
  onChoisir: (offre: LinkOffer) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Choisissez votre formule"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[86vh] w-full max-w-[520px] overflow-y-auto rounded-t-sv-card border-t border-border-strong bg-bg-elevated px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5"
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="font-sora text-[17px] font-extrabold tracking-tight">Choisissez votre formule</h2>
          <button
            onClick={onClose}
            aria-label="Fermer"
            className="flex h-10 w-10 items-center justify-center rounded-full text-[18px] leading-none text-text-tertiary hover:bg-surface-hover"
          >
            ✕
          </button>
        </div>
        <p className="mb-4 text-[12.5px] leading-relaxed text-text-tertiary">
          Le prix est fixe : il ne change pas selon les photos que vous choisirez.
        </p>

        <div className="flex flex-col gap-2.5">
          {offres.map((o, i) => (
            <button
              key={o.offerId ?? `offre-${i}`}
              onClick={() => onChoisir(o)}
              className={`flex w-full items-center justify-between gap-3 rounded-sv border px-4 py-3.5 text-left transition ${
                o.featured
                  ? "border-transparent bg-sv-gradient text-white"
                  : "border-border-strong bg-surface hover:bg-surface-hover"
              }`}
            >
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <span className="truncate text-[14px] font-bold">{o.name}</span>
                  {/* La mise en avant vient de la configuration, elle n'est JAMAIS déduite du
                      prix le plus élevé : SportVision peut vouloir pousser une offre d'entrée. */}
                  {o.featured && (
                    <span className="flex-none rounded-sv-pill bg-white/25 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[.08em]">
                      Recommandé
                    </span>
                  )}
                </span>
                <span
                  className={`mt-0.5 block truncate text-[12px] ${o.featured ? "text-white/80" : "text-text-tertiary"}`}
                >
                  {offerSummary(o, photoCount)}
                </span>
                {/* Changer de formule ne fait pas perdre ce qu'on a déjà coché : le dire ici
                    évite qu'un parent hésite à monter d'un pack. */}
                {selection > 0 && o.photosAllowance !== null && selection > o.photosAllowance && (
                  <span className={`mt-0.5 block text-[11.5px] ${o.featured ? "text-white/70" : "text-text-faint"}`}>
                    Vous avez coché {selection} photos : {selection - o.photosAllowance} seraient à retirer.
                  </span>
                )}
              </span>
              <span className="flex-none font-sora text-[17px] font-extrabold tabular-nums">
                {o.priceCents === 0 ? "Offert" : formatPrice(o.priceCents, o.currency)}
              </span>
            </button>
          ))}
        </div>

        <p className="mt-3 text-center text-[11.5px] text-text-faint">
          Aucun compte n&apos;est nécessaire pour acheter vos photos.
        </p>
      </div>
    </div>
  );
}
