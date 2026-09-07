"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { startGalleryCheckout } from "@/lib/gallery/data";
import { formatPrice } from "@/lib/gallery/pricing";

// Checkout invité — le §14 du prompt : « demander uniquement les informations nécessaires ».
// Prénom/nom et e-mail, rien d'autre. Pas de mot de passe, pas de compte, pas d'adresse : une
// photo se télécharge, elle ne se livre pas.
//
// L'e-mail sert à trois choses, et l'écran le dit plutôt que de le faire deviner : recevoir le
// lien de téléchargement, retrouver la commande plus tard, et la rattacher à un compte Connect si
// le client en crée un. C'est aussi pour ça qu'on ne le rend pas facultatif.

export function GalleryCheckout({
  slug,
  token,
  password,
  offerId,
  assetIds,
  libelle,
  totalCents,
  currency,
  onClose,
}: {
  slug: string;
  token: string;
  password?: string;
  /** L'offre choisie. Le serveur revérifie qu'elle appartient bien à ce lien. */
  offerId?: string | null;
  /** Vide quand le lien vend une formule : le prix ne dépend alors pas de la sélection, et pour un
   * pack l'acheteur n'a encore rien choisi. C'est le serveur qui retrouve ce qui est vendu. */
  assetIds: string[];
  /** Ce que l'acheteur voit résumé au-dessus du bouton : « Galerie complète », « 5 photos au
   * choix », « 3 photos »… Calculé par l'appelant, qui sait dans quel parcours on est. */
  libelle: string;
  totalCents: number;
  currency: string;
  onClose: () => void;
}) {
  const [nom, setNom] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailValide = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
  const pret = nom.trim().length >= 2 && emailValide;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!pret || busy) return;
    setBusy(true);
    setError(null);
    const result = await startGalleryCheckout(createClient(), {
      slug,
      token,
      password: password ?? null,
      offerId: offerId ?? null,
      assetIds,
      email: email.trim(),
      nom: nom.trim(),
    });
    if ("error" in result) {
      setError(result.error);
      setBusy(false);
      return;
    }
    // Redirection pleine page vers Stripe : jamais un iframe, comme partout ailleurs dans le
    // projet (la CSP n'autorise aucun domaine Stripe en frame-src, et c'est voulu).
    window.location.href = result.url;
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[520px] rounded-t-sv-card border-t border-border-strong bg-bg-elevated px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-sora text-[17px] font-extrabold tracking-tight">Vos coordonnées</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="rounded-full px-2 py-1 text-[18px] leading-none text-text-tertiary hover:bg-surface-hover"
          >
            ✕
          </button>
        </div>

        <p className="mb-4 text-[12.5px] leading-relaxed text-text-tertiary">
          Vos photos vous seront envoyées à cette adresse. Aucun compte n&apos;est nécessaire.
        </p>

        <label htmlFor="co-nom" className="mb-1 block text-[11px] font-bold uppercase tracking-[.04em] text-text-label">
          Prénom et nom
        </label>
        <input
          id="co-nom"
          value={nom}
          onChange={(e) => setNom(e.target.value)}
          autoComplete="name"
          className="mb-3 w-full rounded-sv border border-border-strong bg-surface px-4 py-3 text-[14px] outline-none focus:border-white/35"
          placeholder="Camille Martin"
        />

        <label htmlFor="co-email" className="mb-1 block text-[11px] font-bold uppercase tracking-[.04em] text-text-label">
          Adresse e-mail
        </label>
        <input
          id="co-email"
          type="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          className="w-full rounded-sv border border-border-strong bg-surface px-4 py-3 text-[14px] outline-none focus:border-white/35"
          placeholder="camille@exemple.fr"
        />

        {error && <p className="mt-3 text-[12.5px] font-semibold text-danger">{error}</p>}

        <div className="mt-4 flex items-center justify-between border-t border-border pt-3.5">
          <span className="text-[13px] text-text-secondary">{libelle}</span>
          <span className="font-sora text-[20px] font-extrabold tabular-nums">
            {formatPrice(totalCents, currency)}
          </span>
        </div>

        <button
          type="submit"
          disabled={!pret || busy}
          className="mt-4 w-full rounded-sv-pill bg-sv-gradient py-3.5 text-[14.5px] font-bold text-white disabled:opacity-50"
        >
          {busy ? "Redirection vers le paiement…" : "Payer"}
        </button>
        <p className="mt-2 text-center text-[11px] leading-relaxed text-text-faint">
          Paiement sécurisé par Stripe. Téléchargement immédiat après paiement, disponible 30 jours.
        </p>
      </form>
    </div>
  );
}
