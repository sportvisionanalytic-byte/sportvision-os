"use client";

/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatPrice } from "@/lib/gallery/pricing";
import type { OrderSummary } from "@/lib/gallery/data";
import { ConnectBlock } from "./ConnectBlock";
import { ServicesBlock } from "./ServicesBlock";

// Page de commande — c'est ici que l'achat se termine, et c'est ici que SportVision se présente.
//
// Le §22 demandait explicitement que ce ne soit pas une page « Merci pour votre commande » : les
// photos d'abord, la proposition de compte ensuite, et jamais l'inverse. L'ordre à l'écran est
// donc : télécharger, puis Connect. Un client qui vient de payer veut ses fichiers, pas un
// formulaire d'inscription.

/** Découpage annoncé par la fonction qui fabrique les archives, jamais recalculé ici. */
export interface ArchiveInfo {
  photos: number;
  octets: number;
  parties: { index: number; photos: number; octets: number }[];
}

export function OrderView({
  token,
  order,
  archive,
}: {
  token: string;
  order: OrderSummary;
  archive: ArchiveInfo | null;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** L'URL n'est jamais pré-calculée dans la page : elle est signée au clic, pour 5 minutes, par
   * une fonction serveur qui revérifie le droit à cet instant précis. */
  async function download(assetId: string, filename: string) {
    setBusy(assetId);
    setError(null);
    const { data, error: fnError } = await createClient().functions.invoke("gallery-download", {
      body: { token, assetId },
    });
    const payload = data as { url?: string; error?: string } | null;
    if (fnError || !payload?.url) {
      setError(payload?.error ?? "Téléchargement momentanément indisponible. Réessayez.");
      setBusy(null);
      return;
    }
    // Ancre plutôt que window.location : sur iOS, remplacer l'URL de la page par un fichier
    // quitte la page et l'acheteur perd sa liste de photos.
    const a = document.createElement("a");
    a.href = payload.url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setBusy(null);
  }

  const expiration = new Date(order.expiresAt).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  // « Tout télécharger » : une navigation directe, pas un appel JavaScript. C'est le navigateur qui
  // reçoit l'archive et l'écrit sur le disque au fur et à mesure ; la passer par du JavaScript
  // obligerait à la tenir entièrement en mémoire, ce qui fait tomber l'onglet d'un téléphone sur
  // une grosse commande. Même raison pour ne pas enchaîner N téléchargements : Chrome demande une
  // autorisation dès le deuxième, et Safari sur iPhone les refuse.
  const urlArchive = (partie: number) =>
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/gallery-download-zip?token=${encodeURIComponent(token)}${partie > 0 ? `&partie=${partie}` : ""}`;

  const poids = (o: number) =>
    o >= 1024 * 1024 * 1024
      ? `${(o / 1024 / 1024 / 1024).toFixed(1)} Go`
      : `${Math.max(1, Math.round(o / 1024 / 1024))} Mo`;

  return (
    <div className="min-h-screen bg-bg pb-16 text-text">
      <header className="mx-auto max-w-[720px] px-5 pt-7 sm:px-6">
        <div className="flex items-baseline gap-1.5">
          <span className="font-sora text-[13px] font-bold tracking-tight">SportVision</span>
          <span className="bg-sv-gradient bg-clip-text text-[9px] font-medium uppercase tracking-[.16em] text-transparent">
            Galerie
          </span>
        </div>

        <h1 className="mt-5 font-sora text-[24px] font-extrabold leading-tight tracking-tight sm:text-[30px]">
          Vos photos sont prêtes
        </h1>
        <p className="mt-1.5 text-[13px] text-text-tertiary">
          {[order.albumTitre, order.clubNom].filter(Boolean).join(" · ")}
          {order.photos.length > 0 && ` · ${order.photos.length} photo${order.photos.length > 1 ? "s" : ""}`}
        </p>
        <p className="mt-0.5 text-[12px] text-text-faint">
          Commande {order.orderId.slice(0, 8).toUpperCase()} · {formatPrice(order.totalCents, order.currency)}
          {!order.dejaRattachee && ` · disponible jusqu'au ${expiration}`}
        </p>
      </header>

      <main className="mx-auto max-w-[720px] px-5 sm:px-6">
        {error && (
          <p className="mt-5 rounded-sv border border-danger-border bg-danger-bg px-3.5 py-3 text-[12.5px] font-semibold text-danger">
            {error}
          </p>
        )}

        {/* Tout télécharger, AVANT la grille : c'est ce que veut faire la quasi-totalité des
            acheteurs. Les boutons photo par photo restent en dessous pour qui n'en veut qu'une. */}
        {archive && archive.parties.length > 0 && (
          <section className="mt-6">
            {archive.parties.length === 1 ? (
              <a
                href={urlArchive(0)}
                className="flex w-full items-center justify-center gap-2 rounded-sv-pill bg-sv-gradient py-3.5 text-[14.5px] font-bold text-white"
              >
                Tout télécharger ({archive.photos} photo{archive.photos > 1 ? "s" : ""} · {poids(archive.octets)})
              </a>
            ) : (
              <>
                {/* Au-delà d'une certaine taille, une seule archive a toutes les chances de se
                    couper en route sur une connexion mobile. Mieux vaut plusieurs archives qui
                    aboutissent, et le dire franchement plutôt que de laisser un échec arriver. */}
                <p className="mb-2.5 text-[12.5px] leading-relaxed text-text-tertiary">
                  Vos {archive.photos} photos ({poids(archive.octets)}) sont réparties en{" "}
                  {archive.parties.length} archives, pour que le téléchargement aboutisse même en
                  connexion mobile.
                </p>
                <div className="flex flex-col gap-2">
                  {archive.parties.map((p) => (
                    <a
                      key={p.index}
                      href={urlArchive(p.index)}
                      className="flex w-full items-center justify-between gap-3 rounded-sv border border-border-strong bg-surface px-4 py-3 text-[13.5px] font-semibold"
                    >
                      <span>
                        Partie {p.index + 1} sur {archive.parties.length}
                      </span>
                      <span className="text-[12px] font-normal text-text-tertiary">
                        {p.photos} photos · {poids(p.octets)}
                      </span>
                    </a>
                  ))}
                </div>
              </>
            )}
          </section>
        )}

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {order.photos.map((photo) => (
            <div key={photo.id} className="overflow-hidden rounded-sv border border-border bg-surface">
              <img src={photo.thumbUrl} alt="" loading="lazy" className="aspect-[4/3] w-full object-cover" />
              <button
                onClick={() => download(photo.id, photo.filename)}
                disabled={busy === photo.id}
                className="w-full px-3 py-2.5 text-[12.5px] font-bold text-brand disabled:opacity-50"
                style={{ color: "#8CA9FF" }}
              >
                {busy === photo.id ? "Préparation…" : "Télécharger"}
              </button>
            </div>
          ))}
        </div>

        {/* Connect APRÈS les photos, jamais avant : le client doit d'abord obtenir ce pour
            quoi il a payé. Le CTA reste une proposition, pas un péage. */}
        <ConnectBlock
          token={token}
          email={order.email}
          dejaRattachee={order.dejaRattachee}
          albumId={order.albumId}
          expiration={expiration}
        />

        {/* Et les autres services encore après : c'est le dernier bloc de la page. */}
        <ServicesBlock />

        <p className="mt-8 text-center text-[11.5px] text-text-faint">
          Un souci avec votre commande ? Écrivez-nous à contact@sportvision-an.fr
        </p>
      </main>
    </div>
  );
}
