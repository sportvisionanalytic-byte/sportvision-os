"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { formatPrice } from "@/lib/gallery/pricing";
import type { MyGallery, MyOrder } from "@/lib/gallery/data";

// Même univers que la galerie publique : mêmes typographies, même dégradé, mêmes arrondis. Le
// parent ne doit pas avoir l'impression de passer de « la galerie » à « une autre application ».

export function GaleriesView({ galeries, commandes }: { galeries: MyGallery[]; commandes: MyOrder[] }) {
  const date = (d: string | null) =>
    d ? new Date(`${d}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : null;

  return (
    <div className="min-h-screen bg-bg pb-16 text-text">
      <header className="mx-auto max-w-[900px] px-5 pt-7 sm:px-6">
        <div className="flex items-baseline gap-1.5">
          <span className="font-sora text-[13px] font-bold tracking-tight">SportVision</span>
          <span className="bg-sv-gradient bg-clip-text text-[9px] font-medium uppercase tracking-[.16em] text-transparent">
            Connect
          </span>
        </div>
        <h1 className="mt-5 font-sora text-[24px] font-extrabold leading-tight tracking-tight sm:text-[30px]">
          Mes galeries
        </h1>
        <p className="mt-1.5 text-[13px] text-text-tertiary">
          {galeries.length} galerie{galeries.length > 1 ? "s" : ""} · vos photos restent disponibles ici.
        </p>
      </header>

      <main className="mx-auto max-w-[900px] px-5 sm:px-6">
        <div className="mt-6 flex flex-col gap-3">
          {galeries.map((g) => (
            <Link
              key={g.albumId}
              href={`/galeries/${g.albumId}`}
              className="flex items-center gap-4 rounded-sv-card border border-border bg-surface p-3 transition hover:bg-surface-hover"
            >
              <div className="h-[74px] w-[74px] flex-none overflow-hidden rounded-sv bg-bg-elevated sm:h-[92px] sm:w-[92px]">
                {g.coverUrl && <img src={g.coverUrl} alt="" className="h-full w-full object-cover" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-sora text-[15px] font-bold tracking-tight">{g.titre}</div>
                <div className="mt-0.5 truncate text-[12px] text-text-tertiary">
                  {[g.clubNom, g.equipe, date(g.eventDate)].filter(Boolean).join(" · ")}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  {/* Ce qu'il possède VRAIMENT, jamais le quota vendu : un pack de 17 dont il n'a
                      retenu que 13 photos affiche 13. */}
                  <span className="text-[12.5px] font-semibold">
                    {g.accesComplet
                      ? `Galerie complète · ${g.photosAcquises} photos`
                      : `${g.photosAcquises} photo${g.photosAcquises > 1 ? "s" : ""}`}
                  </span>
                  <span
                    className={`rounded-sv-pill px-2 py-0.5 text-[10px] font-bold uppercase tracking-[.06em] ${
                      g.accesPermanent ? "bg-affiliations-bg text-affiliations" : "bg-attente-bg text-attente"
                    }`}
                  >
                    {g.accesPermanent ? "Accès permanent" : "Accès temporaire"}
                  </span>
                </div>
              </div>
              <span className="flex-none pr-1 text-text-faint" aria-hidden>
                →
              </span>
            </Link>
          ))}
        </div>

        {/* Les commandes restent distinctes des galeries : deux achats sur le même match, c'est
            une galerie mais deux commandes, et chacune a son montant et sa date. */}
        {commandes.length > 0 && (
          <section className="mt-10">
            <h2 className="font-sora text-[15px] font-extrabold tracking-tight">Mes commandes</h2>
            <div className="mt-3 flex flex-col gap-2">
              {commandes.map((c) => (
                <Link
                  key={c.orderId}
                  href={`/gallery/commande/${encodeURIComponent(c.token)}`}
                  className="flex items-center justify-between gap-3 rounded-sv border border-border bg-surface px-4 py-3 transition hover:bg-surface-hover"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] font-semibold">{c.albumTitre ?? "Galerie"}</span>
                    <span className="mt-0.5 block truncate text-[12px] text-text-tertiary">
                      {[c.offreNom, `${c.photosCount} photo${c.photosCount > 1 ? "s" : ""}`,
                        c.paidAt ? new Date(c.paidAt).toLocaleDateString("fr-FR") : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  {/* « Offert » plutôt que « 0,00 € » : c'est ce qu'on lui a annoncé à l'achat.
                      Le 0 reste en base pour la comptabilité. */}
                  <span className="flex-none text-[13.5px] font-bold tabular-nums">
                    {c.totalCents === 0 ? "Offert" : formatPrice(c.totalCents, c.currency)}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
