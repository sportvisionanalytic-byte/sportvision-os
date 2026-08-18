"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { PublicFunding } from "./page";

function euros(n: number) {
  return `${n.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`;
}
function formatDeadline(iso: string | null) {
  if (!iso) return null;
  return `Paiement collectif ouvert jusqu'au ${new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}`;
}
function validEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
}

type Step = "view" | "form";

export function PublicFundingView({
  token,
  initial,
  paiementReturn,
}: {
  token: string;
  initial: PublicFunding;
  paiementReturn: "succes" | "annule" | null;
}) {
  const [funding, setFunding] = useState(initial);
  const [step, setStep] = useState<Step>("view");
  const [amount, setAmount] = useState("");
  const [amountTouched, setAmountTouched] = useState(false);
  const [prenom, setPrenom] = useState("");
  const [email, setEmail] = useState("");
  const [formTouched, setFormTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollCount = useRef(0);

  const reached = funding.statut === "objectif_atteint";
  const isTerminal = funding.statut === "expiree" || funding.statut === "annulee";
  const pct = Math.min(100, Math.round((funding.montant_collecte / funding.montant_cible) * 100));
  const remaining = Math.max(0, Math.round((funding.montant_cible - funding.montant_collecte) * 100) / 100);
  const suggested = funding.repartition_mode === "egale" && funding.nb_participants_prevu
    ? Math.min(remaining, Math.ceil((funding.montant_cible / funding.nb_participants_prevu) * 100) / 100)
    : null;

  const amountNum = Number(amount) || 0;
  const amountBad = amountTouched && (amountNum < 1 || amountNum > remaining);

  // Retour Stripe "succès" : le webhook confirme de façon asynchrone, donc on relit
  // get_public_funding() quelques fois plutôt que d'affirmer "c'est payé" sur le seul retour
  // navigateur (règle explicite du master doc §25).
  useEffect(() => {
    if (paiementReturn !== "succes") return;
    const supabase = createClient();
    const interval = setInterval(async () => {
      pollCount.current += 1;
      const { data } = await supabase.rpc("get_public_funding", { p_token: token });
      if (data) setFunding(data as PublicFunding);
      if (pollCount.current >= 8) clearInterval(interval);
    }, 2500);
    return () => clearInterval(interval);
  }, [paiementReturn, token]);

  async function submitAmount() {
    setAmountTouched(true);
    if (amountNum < 1 || amountNum > remaining) return;
    setStep("form");
  }

  async function pay() {
    setFormTouched(true);
    if (!prenom.trim() || !validEmail(email) || busy) return;
    setBusy(true);
    setError(null);
    // Pas de session (page 100% publique) : createClient() envoie déjà l'apikey anon
    // nécessaire, exactement comme les autres appels supabase.functions.invoke de ce
    // projet — pas besoin d'un fetch() manuel ni d'un header Authorization.
    const supabase = createClient();
    const { data, error: fnError } = await supabase.functions.invoke("create-guest-funding-contribution-checkout", {
      body: { token, prenom: prenom.trim(), email: email.trim(), montant: amountNum },
    });
    if (fnError || data?.error || !data?.url) {
      setBusy(false);
      setError(data?.error || "Impossible de créer le paiement pour le moment. Réessayez dans un instant.");
      return;
    }
    window.location.href = data.url as string;
  }

  return (
    <div className="flex flex-col gap-5 animate-sv-in">
      {paiementReturn === "succes" && (
        <div className="flex items-start gap-2.5 rounded-sv border border-affiliations/40 bg-affiliations-bg px-4 py-3.5">
          <span className="material-symbols-rounded !text-[19px] text-affiliations" aria-hidden="true">hourglass_top</span>
          <span className="text-[13px] leading-relaxed text-text-secondary">
            Merci ! Votre paiement est en cours de confirmation. Le montant collecté ci-dessous se mettra à jour dès
            que Stripe l&apos;aura confirmé.
          </span>
        </div>
      )}
      {paiementReturn === "annule" && (
        <div className="flex items-start gap-2.5 rounded-sv border border-attente/40 bg-attente-bg px-4 py-3.5">
          <span className="material-symbols-rounded !text-[19px] text-attente" aria-hidden="true">info</span>
          <span className="text-[13px] leading-relaxed text-text-secondary">Paiement annulé, vous pouvez réessayer.</span>
        </div>
      )}

      {step === "view" && (
        <>
          <div className="flex flex-col items-center gap-2.5 text-center">
            <span className="bg-sv-gradient bg-clip-text text-[11px] font-medium uppercase tracking-[.12em] text-transparent">
              Paiement collectif
            </span>
            <h1 className="font-sora text-[28px] font-bold tracking-tight leading-[1.12]">{funding.titre}</h1>
            {funding.contexte && <span className="text-[14px] text-text-tertiary">{funding.contexte}</span>}
          </div>

          <div
            className="h-[150px] rounded-sv-card"
            style={{ background: "linear-gradient(135deg,#4C1D95 0%,#3A2A86 50%,#155E75 100%)" }}
          />

          <div
            className="rounded-sv-card p-px"
            style={{ background: "linear-gradient(140deg,rgba(168,85,247,.6),rgba(244,114,182,.35) 55%,transparent)" }}
          >
            <div className="flex flex-col gap-3.5 rounded-[calc(theme(borderRadius.sv-modal)-1px)] bg-bg-elevated-accent p-[22px]">
              <div className="flex items-baseline justify-between gap-2.5">
                <div className="flex items-baseline gap-1.5">
                  <span className="font-sora text-[32px] font-bold tracking-tight">{euros(funding.montant_collecte)}</span>
                  <span className="text-[14px] text-text-tertiary">/ {euros(funding.montant_cible)}</span>
                </div>
                <span className="text-[13px] font-semibold" style={{ color: reached ? "#22D3EE" : "#F472B6" }}>
                  {pct}% financé
                </span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-sv-pill bg-white/[.08]">
                <div className={`h-full rounded-sv-pill transition-[width] duration-300 motion-reduce:transition-none ${reached ? "bg-sv-gradient-financee" : "bg-sv-gradient-cotisation"}`} style={{ width: `${pct}%` }} />
              </div>
              <span className="text-[13px] text-text-tertiary">
                {funding.participants_count} participant{funding.participants_count > 1 ? "s" : ""}
              </span>
              {funding.date_limite && <span className="text-[13px] text-text-secondary">{formatDeadline(funding.date_limite)}</span>}
            </div>
          </div>

          {!reached && !isTerminal && (
            <div className="flex flex-col gap-2">
              <label htmlFor="pc-amount" className="text-[13px] font-medium text-text-secondary">
                Votre participation
              </label>
              <div className={`flex h-14 items-center gap-1.5 rounded-sv border bg-surface px-[18px] ${amountBad ? "border-danger" : "border-border-strong"}`}>
                <input
                  id="pc-amount"
                  type="number"
                  inputMode="numeric"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="h-full min-w-0 flex-1 border-0 bg-transparent font-sora text-[21px] font-semibold text-text outline-none"
                />
                <span className="text-[16px] text-text-tertiary">€</span>
              </div>
              {amountBad && (
                <span className="text-[12px] text-danger">
                  {amountNum > remaining ? `Il ne reste que ${remaining.toLocaleString("fr-FR")} € à financer.` : "Indiquez un montant d'au moins 1 €."}
                </span>
              )}
              <div className="mt-0.5 flex flex-wrap gap-2">
                {[suggested, remaining].filter((v): v is number => v != null && v > 0 && v <= remaining).filter((v, i, arr) => arr.indexOf(v) === i).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setAmount(String(v))}
                    className={`rounded-sv-pill border px-3.5 py-2 text-[13px] font-medium ${
                      amountNum === v ? "border-cotisations/60 bg-cotisations-bg text-text" : "border-border text-text-secondary"
                    }`}
                  >
                    {v === remaining ? `Solde ${v.toLocaleString("fr-FR")} €` : `${v.toLocaleString("fr-FR")} €`}
                  </button>
                ))}
              </div>
            </div>
          )}

          {reached && (
            <div className="flex items-center gap-3 rounded-sv border border-affiliations/30 bg-affiliations-bg px-[17px] py-4">
              <span className="material-symbols-rounded !text-[22px] text-affiliations" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">
                check_circle
              </span>
              <span className="text-[14px] leading-relaxed text-text-secondary">
                Objectif atteint 🎉 Cette prestation est entièrement financée.
              </span>
            </div>
          )}

          {isTerminal && !reached && (
            <div className="flex items-center gap-3 rounded-sv border border-dashed border-border-strong bg-white/[.04] px-[17px] py-4">
              <span className="material-symbols-rounded !text-[22px] text-text-tertiary" aria-hidden="true">event_busy</span>
              <span className="text-[14px] leading-relaxed text-text-tertiary">
                Ce paiement collectif n&apos;accepte plus de nouvelles participations.
              </span>
            </div>
          )}

          <div className="flex flex-col gap-2 rounded-sv border border-border bg-white/[.04] px-[18px] py-4">
            <span className="font-sora text-[14px] font-semibold">Ce que finance ce paiement collectif</span>
            <span className="text-[13px] leading-relaxed text-text-tertiary">
              {funding.catalogue_offre_nom
                ? `${funding.catalogue_offre_nom}, livré aux joueurs via SportVision Connect.`
                : "Une prestation SportVision, livrée aux joueurs via SportVision Connect."}
            </span>
          </div>

          {!reached && !isTerminal && (
            <button
              type="button"
              onClick={submitAmount}
              className="flex h-14 items-center justify-center rounded-sv bg-sv-gradient font-sora text-[16px] font-semibold text-white hover:brightness-[1.12]"
            >
              Participer — {amountNum || 0} €
            </button>
          )}
        </>
      )}

      {step === "form" && (
        <>
          <button
            type="button"
            onClick={() => setStep("view")}
            className="flex items-center gap-2 self-start text-[13px] font-medium text-text-tertiary hover:text-text"
          >
            <span className="material-symbols-rounded !text-[18px]" aria-hidden="true">arrow_back</span>
            Retour
          </button>
          <div className="flex flex-col gap-2">
            <h1 className="font-sora text-[26px] font-bold tracking-tight leading-[1.14]">Votre participation</h1>
            <p className="text-[15px] text-text-tertiary">{funding.titre} · {amountNum} €</p>
          </div>
          <div className="flex flex-col gap-[14px]">
            <div className="flex flex-col gap-2">
              <label htmlFor="pc-first" className="text-[13px] font-medium text-text-secondary">
                Prénom
              </label>
              <input
                id="pc-first"
                autoComplete="given-name"
                placeholder="Noah"
                value={prenom}
                onChange={(e) => setPrenom(e.target.value)}
                className={`h-[54px] w-full rounded-sv border bg-surface px-4 text-[16px] text-text outline-none focus:border-[#8CA9FF] focus:shadow-[0_0_0_3px_rgba(79,125,255,.22)] ${
                  formTouched && !prenom.trim() ? "border-danger" : "border-border-strong"
                }`}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="pc-email" className="text-[13px] font-medium text-text-secondary">
                Adresse e-mail
              </label>
              <input
                id="pc-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="votre@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={`h-[54px] w-full rounded-sv border bg-surface px-4 text-[16px] text-text outline-none focus:border-[#8CA9FF] focus:shadow-[0_0_0_3px_rgba(79,125,255,.22)] ${
                  formTouched && !validEmail(email) ? "border-danger" : "border-border-strong"
                }`}
              />
              <span className="text-[12px] text-text-faint">Utilisée uniquement pour le suivi de votre paiement Stripe.</span>
            </div>
          </div>
          <div className="flex items-center gap-3.5 rounded-sv border border-dashed border-border-strong bg-white/[.04] p-[18px]">
            <span className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-sv bg-white/[.06]">
              <span className="material-symbols-rounded !text-[21px] text-text-secondary" aria-hidden="true">lock</span>
            </span>
            <span className="text-[13px] leading-relaxed text-text-tertiary">
              Vous serez redirigé vers Stripe pour un paiement sécurisé. Aucun compte n&apos;est nécessaire pour participer.
            </span>
          </div>
          {error && <span className="text-[13px] text-danger">{error}</span>}
          <button
            type="button"
            onClick={pay}
            disabled={busy}
            className="flex h-14 items-center justify-center gap-2 rounded-sv bg-sv-gradient font-sora text-[16px] font-semibold text-white hover:brightness-[1.12] disabled:cursor-wait disabled:opacity-75"
          >
            {busy && <span className="h-[18px] w-[18px] animate-sv-spin rounded-full border-2 border-white/35 border-t-white" />}
            {busy ? "Redirection…" : `Payer ${amountNum} €`}
          </button>
        </>
      )}

      <span className="pb-6 text-center text-[11px] text-text-faint">Paiement sécurisé · aucun compte requis</span>
    </div>
  );
}
