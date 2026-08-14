"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Modale "Participer" / "Payer le reste" — voir design-connect-personnel-12-08/README.md
// § Cotisations. Appelle l'Edge Function create-funding-contribution-checkout (jamais un
// update direct de group_fundings.montant_collecte) et redirige vers Stripe Checkout —
// le montant collecté ne bouge qu'après confirmation par le webhook (master doc §25).
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
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(suggested ? String(suggested) : "");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        {!payRestLabel && <span className="material-symbols-rounded !text-[19px]">volunteer_activism</span>}
        {payRestLabel || "Participer"}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/66 p-6 backdrop-blur-sm"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            className="flex w-full max-w-[440px] flex-col gap-[18px] rounded-sv-modal border border-border bg-bg-elevated-accent p-[22px] shadow-[0_30px_70px_-20px_rgba(0,0,0,.75)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="font-sora text-[19px] font-semibold tracking-tight">Votre participation</span>
                <span className="text-[13px] text-text-tertiary">reste {remaining.toLocaleString("fr-FR")} €</span>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="ml-auto flex h-9 w-9 flex-none items-center justify-center rounded-sv bg-white/[.06] text-text-secondary hover:bg-white/[.12]"
              >
                <span className="material-symbols-rounded !text-[20px]">close</span>
              </button>
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="part-amount" className="text-[13px] font-medium text-text-secondary">
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
                <span className="text-[12px] text-danger">
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
                      className={`rounded-sv-pill border px-3.5 py-2 text-[13px] font-medium ${
                        amountNum === v ? "border-cotisations/60 bg-cotisations-bg text-text" : "border-border text-text-secondary"
                      }`}
                    >
                      {v === remaining ? `Solde ${v.toLocaleString("fr-FR")} €` : `${v.toLocaleString("fr-FR")} €`}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {error && <span className="text-[13px] text-danger">{error}</span>}

            <button
              type="button"
              onClick={confirm}
              disabled={busy}
              className="flex h-[54px] items-center justify-center gap-2 rounded-sv bg-sv-gradient font-sora text-[16px] font-semibold text-white hover:brightness-[1.12] disabled:cursor-wait disabled:opacity-75"
            >
              {busy && <span className="h-[18px] w-[18px] animate-sv-spin rounded-full border-2 border-white/35 border-t-white" />}
              {busy ? "Redirection…" : `Participer — ${amountNum || 0} €`}
            </button>
            <span className="text-center text-[11px] text-text-faint">Paiement sécurisé via Stripe</span>
          </div>
        </div>
      )}
    </>
  );
}
