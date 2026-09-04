"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { MediaCheckoutPreview } from "./page";

function euros(cents: number) {
  return (cents / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}
function validEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
}

export function GuestMediaCheckoutView({
  token,
  preview,
  paiementReturn,
}: {
  token: string;
  preview: MediaCheckoutPreview;
  paiementReturn: "succes" | "annule" | null;
}) {
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Fulfillment produit physique (04/09/2026) — voir migration-media-physical-fulfillment.sql.
  const [shippingName, setShippingName] = useState("");
  const [shippingAddressLine, setShippingAddressLine] = useState("");
  const [shippingPostalCode, setShippingPostalCode] = useState("");
  const [shippingCity, setShippingCity] = useState("");
  const isPhysical = preview.produit_physique === true;

  async function pay() {
    setTouched(true);
    if (!validEmail(email) || busy) return;
    if (isPhysical && (!shippingName.trim() || !shippingAddressLine.trim() || !shippingPostalCode.trim() || !shippingCity.trim())) return;
    setBusy(true);
    setError(null);
    // Page 100% publique, pas de session — createClient() envoie déjà l'apikey anon nécessaire,
    // même motif que PublicFundingView.tsx (/cotisation/[token]).
    const supabase = createClient();
    const { data, error: fnError } = await supabase.functions.invoke("create-guest-media-checkout", {
      body: {
        token,
        email: email.trim(),
        ...(isPhysical
          ? {
              shipping: {
                name: shippingName.trim(),
                addressLine: shippingAddressLine.trim(),
                postalCode: shippingPostalCode.trim(),
                city: shippingCity.trim(),
              },
            }
          : {}),
      },
    });
    if (fnError || data?.error || !data?.url) {
      setBusy(false);
      setError(data?.error || "Impossible de créer le paiement pour le moment. Réessayez dans un instant.");
      return;
    }
    window.location.href = data.url as string;
  }

  if (paiementReturn === "succes") {
    return (
      <div className="rounded-2xl border border-border bg-surface p-7 text-center">
        <h1 className="text-[20px] font-extrabold tracking-tight">Paiement en cours de confirmation</h1>
        <p className="mt-3 text-[13.5px] leading-relaxed text-text-soft">
          Merci ! Un e-mail vous permettra de créer votre mot de passe SportVision Connect pour retrouver l&apos;accès
          dès que le paiement sera confirmé.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-7">
      <p className="text-center text-[12.5px] font-bold uppercase tracking-[.1em] text-text-soft">Accès média</p>
      <h1 className="mt-2 text-center text-[22px] font-extrabold tracking-tight">{preview.produit_nom}</h1>
      <p className="mt-1 text-center text-[13.5px] text-text-soft">
        {preview.club_nom}
        {preview.beneficiaire_prenom ? ` · pour ${preview.beneficiaire_prenom}` : ""}
      </p>
      <p className="mt-4 text-center text-[26px] font-extrabold tracking-tight">
        {preview.prix_cents != null ? euros(preview.prix_cents) : "—"}
      </p>

      {paiementReturn === "annule" && (
        <p className="mt-4 rounded-lg bg-warning-bg px-3 py-2.5 text-[12.5px] font-semibold text-warning-fg">
          Paiement annulé, vous pouvez réessayer.
        </p>
      )}

      <div className="mt-6 flex flex-col gap-1.5">
        <label htmlFor="mc-email" className="text-[12.5px] font-bold text-text-soft">
          Votre adresse e-mail
        </label>
        <input
          id="mc-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="votre@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={`h-12 w-full rounded-lg border bg-input-bg px-3.5 text-[14px] outline-none focus-visible:border-brand-blue ${
            touched && !validEmail(email) ? "border-danger-fg" : "border-border-strong"
          }`}
        />
        <p className="mt-0.5 text-[11.5px] text-text-faint">
          Un compte SportVision Connect sera créé avec cette adresse pour que vous puissiez retrouver cet accès
          plus tard — aucun mot de passe n&apos;est requis maintenant.
        </p>
      </div>

      {isPhysical && (
        <div className="mt-4 flex flex-col gap-2.5 rounded-lg border border-border-strong bg-input-bg px-4 py-3.5">
          <span className="text-[12.5px] font-bold text-text-soft">Adresse de livraison</span>
          <input
            value={shippingName}
            onChange={(e) => setShippingName(e.target.value)}
            placeholder="Nom et prénom"
            className="h-11 w-full rounded-lg border border-border-strong bg-bg px-3 text-[14px] outline-none focus-visible:border-brand-blue"
          />
          <input
            value={shippingAddressLine}
            onChange={(e) => setShippingAddressLine(e.target.value)}
            placeholder="Adresse"
            className="h-11 w-full rounded-lg border border-border-strong bg-bg px-3 text-[14px] outline-none focus-visible:border-brand-blue"
          />
          <div className="grid grid-cols-2 gap-2.5">
            <input
              value={shippingPostalCode}
              onChange={(e) => setShippingPostalCode(e.target.value)}
              placeholder="Code postal"
              className="h-11 w-full rounded-lg border border-border-strong bg-bg px-3 text-[14px] outline-none focus-visible:border-brand-blue"
            />
            <input
              value={shippingCity}
              onChange={(e) => setShippingCity(e.target.value)}
              placeholder="Ville"
              className="h-11 w-full rounded-lg border border-border-strong bg-bg px-3 text-[14px] outline-none focus-visible:border-brand-blue"
            />
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-[12.5px] font-bold text-danger-fg">{error}</p>}

      <button
        type="button"
        onClick={pay}
        disabled={busy}
        className="mt-5 flex h-14 w-full items-center justify-center rounded-sv bg-gradient-to-br from-brand-blue to-brand-violet px-5 py-3.5 text-[14px] font-bold text-white shadow-sv-button hover:brightness-[1.06] disabled:cursor-wait disabled:opacity-75"
      >
        {busy ? "Redirection…" : `Payer ${preview.prix_cents != null ? euros(preview.prix_cents) : ""}`}
      </button>
      <p className="mt-3 text-center text-[11px] text-text-faint">Paiement sécurisé via Stripe.</p>
    </div>
  );
}
