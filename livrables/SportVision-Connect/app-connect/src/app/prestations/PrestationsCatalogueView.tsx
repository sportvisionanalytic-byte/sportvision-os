"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { type CatalogueOffer, baseTtc, categorieIcon, perPersonTtc } from "@/lib/prestations/catalogue";
import { formatEUR } from "@/lib/prestations/format";

// Filtres dynamiques : "Tous" + uniquement les familles réellement présentes dans le catalogue
// (voir lib/prestations/catalogue.ts — l'onglet "Montage" apparaîtra tout seul le jour où une
// offre de cette famille existera réellement, jamais construit en dur ici).
export function PrestationsCatalogueView({ offers }: { offers: CatalogueOffer[] }) {
  const families = useMemo(() => {
    const set = new Set(offers.map((o) => o.family).filter((f): f is NonNullable<typeof f> => !!f));
    return Array.from(set);
  }, [offers]);
  const [tab, setTab] = useState<string>("Tous");

  const visible = tab === "Tous" ? offers : offers.filter((o) => o.family === tab);

  return (
    <div className="flex flex-col gap-5 animate-sv-in">
      <div className="flex flex-wrap gap-2">
        {["Tous", ...families].map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setTab(f)}
            className={`h-10 rounded-sv-pill px-4 text-[13px] font-semibold transition-colors duration-150 ${
              tab === f ? "bg-sv-gradient text-white" : "border border-border-strong bg-surface text-text-secondary hover:bg-surface-hover"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-sv-card border border-dashed border-border-strong bg-surface p-8 text-center">
          <span className="material-symbols-rounded !text-[24px] text-text-tertiary">camera_alt</span>
          <span className="text-[14px] text-text-tertiary">Aucune prestation dans cette catégorie pour le moment.</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((offer) => (
            <OfferCard key={offer.id} offer={offer} />
          ))}
        </div>
      )}
    </div>
  );
}

function OfferCard({ offer }: { offer: CatalogueOffer }) {
  const ttc = baseTtc(offer);
  return (
    <Link
      href={`/prestations/${offer.id}`}
      className="flex flex-col gap-3.5 rounded-sv-card border border-border bg-surface p-5 transition-colors duration-150 hover:bg-surface-hover"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex h-12 w-12 flex-none items-center justify-center rounded-sv bg-prestations-bg">
          <span className="material-symbols-rounded !text-[24px] text-prestations">{categorieIcon(offer.categorie)}</span>
        </span>
        {offer.family && (
          <span className="rounded-sv-pill bg-white/5 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[.08em] text-text-tertiary">
            {offer.family}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="font-sora text-[17px] font-semibold tracking-tight">{offer.nom}</span>
        {offer.description && <p className="text-[13.5px] leading-relaxed text-text-tertiary line-clamp-2">{offer.description}</p>}
      </div>

      <div className="mt-auto flex flex-col gap-1 border-t border-border pt-3.5">
        <span className="font-sora text-[20px] font-bold tracking-tight">
          {ttc !== null ? `${formatEUR(ttc)} TTC` : "Sur devis"}
        </span>
        {ttc !== null && (
          <span className="text-[12px] text-text-tertiary">À 10 joueurs : {formatEUR(perPersonTtc(ttc))} / personne</span>
        )}
      </div>
    </Link>
  );
}
