"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type ModePaiement = "carte" | "especes";

// Modale "Participer" / "Payer le reste" — voir design-connect-personnel-12-08/README.md
// § Cotisations. Carte (défaut, inchangé) : appelle l'Edge Function
// create-funding-contribution-checkout (jamais un update direct de group_fundings.
// montant_collecte) et redirige vers Stripe Checkout — le montant collecté ne bouge qu'après
// confirmation par le webhook (master doc §25). Espèces (migration-connect-v73-cotisation-
// paiement-especes.sql) : appelle la RPC contribute_funding_especes — même philosophie de
// confiance que le choix carte/espèces déjà en place sur une réservation solo, confirmée
// immédiatement (statut='paye'), sans redirection ni vérification bloquante.
export function ParticipateButton({
  fundingId,
  remaining,
  suggested,
  payRestLabel,
}: {
  fundingId: string;
  remaining: number;
  suggested: number | null;
  payRestLabel?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(suggested ? String(suggested) : "");
  const [mode, setMode] = useState<ModePaiement>("carte");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [especesDone, setEspecesDone] = useState(false);

  const amountNum = Number(amount) || 0;
  const invalid = amountNum < 1 || amountNum > remaining;

  const quickAmounts = [suggested, Math.round(remaining * 100) / 100]
    .filter((v): v is number => v != null && v > 0 && v <= remaining)
    .filter((v, i, arr) => arr.indexOf(v) === i);

  async function confirm() {
    setTouched(true);
    if (invalid || busy) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();

    if (mode === "especes") {
      const { data, error: rpcError } = await supabase.rpc("contribute_funding_especes", {
        p_funding_id: fundingId,
        p_montant: amountNum,
      });
      if (rpcError || !data?.ok) {
        setBusy(false);
        setError("Impossible d'enregistrer cette participation pour le moment. Réessayez dans un instant.");
        return;
      }
      setBusy(false);
      setEspecesDone(true);
      // Le montant collecté vient d'être incrémenté côté serveur (trigger trg_fc_recompute,
      // migration-connect-v50) — router.refresh() relit get_funding_detail() côté serveur pour
      // que la barre de progression et la liste des participants reflètent tout de suite cette
      // contribution, exactement comme pour toute autre mutation de ce type dans l'app (voir
      // GrantCard.tsx, AddClubForm.tsx...).
      router.refresh();
      return;
    }

    const { data, error: fnError } = await supabase.functions.invoke("create-funding-contribution-checkout", {
      body: { funding_id: fundingId, montant: amountNum },
    });
    if (fnError || data?.error || !data?.url) {
      setBusy(false);
      setError(data?.error || "Impossible de créer le paiement pour le moment. Réessayez dans un instant.");
      return;
    }
    window.location.href = data.url as string;
  }

  function closeModal() {
    if (busy) return;
    setOpen(false);
    // Réinitialise pour la prochaine ouverture (une participation espèces réussie ferme sur un
    // écran de confirmation — repartir de "carte" par défaut si l'utilisateur rouvre la modale).
    if (especesDone) {
      setEspecesDone(false);
      setMode("carte");
      setTouched(false);
      setError(null);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          payRestLabel
            ? "flex h-[50px] items-center rounded-sv border border-danger-border bg-danger-bg px-5 font-sora text-[15px] font-semibold text-danger hover:bg-[rgba(244,114,182,.22)]"
            : "flex h-[50px] items-center gap-2 rounded-sv border border-affiliations/40 bg-affiliations-bg px-5 font-sora text-[15px] font-semibold text-affiliations hover:bg-[rgba(34,211,238,.22)]"
        }
      >
        {!payRestLabel && <span className="material-symbols-rounded !text-[19px]" aria-hidden="true">volunteer_activism</span>}
        {payRestLabel || "Participer"}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/66 p-6 backdrop-blur-sm"
          onClick={() => !busy && closeModal()}
        >
          <div
            className="flex w-full max-w-[440px] flex-col gap-[18px] rounded-sv-modal border border-border bg-bg-elevated-accent p-[22px] shadow-[0_30px_70px_-20px_rgba(0,0,0,.75)]"
            onClick={(e) => e.stopPropagation()}
          >
            {especesDone ? (
              <>
                <div className="flex items-start gap-3">
                  <span className="font-sora text-[19px] font-semibold tracking-tight">Participation enregistrée</span>
                  <button
                    type="button"
                    onClick={closeModal}
                    className="ml-auto flex h-10 w-10 flex-none items-center justify-center rounded-sv bg-white/[.06] text-text-secondary hover:bg-white/[.12]"
                  >
                    <span className="material-symbols-rounded !text-[20px]" aria-hidden="true">close</span>
                  </button>
                </div>
                <div className="flex items-center gap-3 rounded-sv border border-affiliations/30 bg-affiliations-bg px-[17px] py-[15px]">
                  <span className="material-symbols-rounded !text-[22px] text-affiliations" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">
                    check_circle
                  </span>
                  <span className="text-[14px] leading-relaxed text-text-secondary">
                    Votre participation de {amountNum.toLocaleString("fr-FR")} € en espèces a été enregistrée. Remettez ce montant à
                    l&apos;organisateur du paiement collectif.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex h-[54px] items-center justify-center rounded-sv bg-sv-gradient font-sora text-[16px] font-semibold text-white hover:brightness-[1.12]"
                >
                  Fermer
                </button>
              </>
            ) : (
              <>
                <div className="flex items-start gap-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="font-sora text-[19px] font-semibold tracking-tight">Votre participation</span>
                    <span className="text-[14px] text-text-tertiary lg:text-[13px]">reste {remaining.toLocaleString("fr-FR")} €</span>
                  </div>
                  <button
                    type="button"
                    onClick={closeModal}
                    disabled={busy}
                    className="ml-auto flex h-10 w-10 flex-none items-center justify-center rounded-sv bg-white/[.06] text-text-secondary hover:bg-white/[.12]"
                  >
                    <span className="material-symbols-rounded !text-[20px]" aria-hidden="true">close</span>
                  </button>
                </div>

                <div className="flex flex-col gap-2">
                  <label htmlFor="part-amount" className="text-[14px] font-medium text-text-secondary lg:text-[13px]">
                    Montant
                  </label>
                  <div
                    className={`flex h-14 items-center gap-1.5 rounded-sv border bg-surface px-[18px] ${
                      touched && invalid ? "border-danger" : "border-border-strong"
                    }`}
                  >
                    <input
                      id="part-amount"
                      type="number"
                      inputMode="numeric"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="h-full min-w-0 flex-1 border-0 bg-transparent font-sora text-[21px] font-semibold text-text outline-none"
                    />
                    <span className="text-[16px] text-text-tertiary">€</span>
                  </div>
                  {touched && invalid && (
                    <span className="text-[13px] text-danger lg:text-[12px]">
                      {amountNum > remaining ? `Il ne reste que ${remaining.toLocaleString("fr-FR")} € à financer.` : "Indiquez un montant d'au moins 1 €."}
                    </span>
                  )}
                  {quickAmounts.length > 0 && (
                    <div className="mt-0.5 flex flex-wrap gap-2">
                      {quickAmounts.map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setAmount(String(v))}
                          className={`rounded-sv-pill border px-3.5 py-2 text-[14px] font-medium lg:text-[13px] ${
                            amountNum === v ? "border-cotisations/60 bg-cotisations-bg text-text" : "border-border text-text-secondary"
                          }`}
                        >
                          {v === remaining ? `Solde ${v.toLocaleString("fr-FR")} €` : `${v.toLocaleString("fr-FR")} €`}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  <span className="text-[14px] font-medium text-text-secondary lg:text-[13px]">Mode de paiement</span>
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() => setMode("carte")}
                      className={`flex h-12 items-center justify-center gap-2 rounded-sv border font-sora text-[14px] font-semibold lg:text-[13.5px] ${
                        mode === "carte" ? "border-cotisations/60 bg-cotisations-bg text-text" : "border-border-strong bg-surface text-text-secondary"
                      }`}
                    >
                      <span className="material-symbols-rounded !text-[18px]" aria-hidden="true">credit_card</span>
                      Carte
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode("especes")}
                      className={`flex h-12 items-center justify-center gap-2 rounded-sv border font-sora text-[14px] font-semibold lg:text-[13.5px] ${
                        mode === "especes" ? "border-cotisations/60 bg-cotisations-bg text-text" : "border-border-strong bg-surface text-text-secondary"
                      }`}
                    >
                      <span className="material-symbols-rounded !text-[18px]" aria-hidden="true">payments</span>
                      Espèces
                    </button>
                  </div>
                  {mode === "especes" && (
                    <span className="text-[13px] leading-relaxed text-text-faint lg:text-[12px]">
                      Votre participation sera comptée immédiatement. Remettez ce montant en espèces à l&apos;organisateur de la
                      paiement collectif.
                    </span>
                  )}
                </div>

                {error && <span className="text-[14px] text-danger lg:text-[13px]">{error}</span>}

                <button
                  type="button"
                  onClick={confirm}
                  disabled={busy}
                  className="flex h-[54px] items-center justify-center gap-2 rounded-sv bg-sv-gradient font-sora text-[16px] font-semibold text-white hover:brightness-[1.12] disabled:cursor-wait disabled:opacity-75"
                >
                  {busy && <span className="h-[18px] w-[18px] animate-sv-spin rounded-full border-2 border-white/35 border-t-white" />}
                  {busy
                    ? mode === "especes"
                      ? "Enregistrement…"
                      : "Redirection…"
                    : `Participer — ${amountNum || 0} €`}
                </button>
                <span className="text-center text-[11px] text-text-faint">
                  {mode === "especes" ? "Déclaration de paiement en espèces" : "Paiement sécurisé via Stripe"}
                </span>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
