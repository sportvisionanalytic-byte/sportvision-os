"use client";

/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { formatPrice } from "@/lib/gallery/pricing";
import type { OrderSummary } from "@/lib/gallery/data";

// Page de commande — c'est ici que l'achat se termine, et c'est ici que SportVision se présente.
//
// Le §22 demandait explicitement que ce ne soit pas une page « Merci pour votre commande » : les
// photos d'abord, la proposition de compte ensuite, et jamais l'inverse. L'ordre à l'écran est
// donc : télécharger, puis Connect. Un client qui vient de payer veut ses fichiers, pas un
// formulaire d'inscription.

export function OrderView({ token, order }: { token: string; order: OrderSummary }) {
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

        {/* Connect APRÈS les photos, jamais avant : le §21 est explicite, le CTA reste secondaire
            tant que le client n'a pas ce pour quoi il a payé. */}
        <section className="mt-10 rounded-sv-card border border-border bg-surface p-6">
          <h2 className="font-sora text-[17px] font-extrabold tracking-tight">
            Gardez vos photos sans limite de durée
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-text-tertiary">
            {order.dejaRattachee
              ? "Cette commande est rattachée à votre compte SportVision Connect : vos photos y restent disponibles en permanence."
              : `Ce lien reste actif jusqu'au ${expiration}. En créant votre compte SportVision Connect avec ${order.email}, vos photos y sont conservées définitivement, avec vos prochaines galeries et vos avantages.`}
          </p>
          {!order.dejaRattachee && (
            <Link
              href={`/signup?email=${encodeURIComponent(order.email)}&commande=${encodeURIComponent(token)}`}
              className="mt-4 inline-flex rounded-sv-pill bg-sv-gradient px-6 py-3 text-[14px] font-bold text-white"
            >
              Créer mon compte gratuitement
            </Link>
          )}
        </section>

        <p className="mt-8 text-center text-[11.5px] text-text-faint">
          Un souci avec votre commande ? Écrivez-nous à contact@sportvision-an.fr
        </p>
      </main>
    </div>
  );
}
