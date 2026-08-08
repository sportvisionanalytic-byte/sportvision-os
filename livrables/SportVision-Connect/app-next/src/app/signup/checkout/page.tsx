"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { formatPlanCredits, formatPlanPrice, PLANS } from "@/lib/plans";
import { ORG_TYPE_OPTIONS, useSignup } from "../signup-context";
import { inputClass, textareaClass } from "../signup-styles";

// Étape 6 · Paiement — voir ACTIONS.md § 2. Trois variantes : carte bancaire, message de mise
// en relation (Full Communication, sur devis), ou demande de rattachement (joueur affilié).
export default function SignupCheckoutPage() {
  const router = useRouter();
  const { state, patch } = useSignup();

  const isAffiliatedPlayer = state.orgType === "player" && state.playerAffiliation === "join_club";
  const plan = state.planCode ? PLANS[state.planCode] : null;
  const isFullCom = plan?.code === "full_communication";
  const orgLabel = ORG_TYPE_OPTIONS.find((o) => o.type === state.orgType)?.label ?? "Structure";

  const canContinue = isAffiliatedPlayer
    ? true
    : isFullCom
      ? state.quoteMessage.trim().length > 0
      : state.payment.cardNumber.trim().length >= 12 && state.payment.expiry.trim() && state.payment.cvc.trim().length >= 3;

  function submitLabel() {
    if (isAffiliatedPlayer) return "Envoyer ma demande de rattachement";
    if (isFullCom) return "Envoyer ma demande de devis";
    return "Valider et payer";
  }

  return (
    <div className="flex flex-col gap-7">
      <div>
        <h1 className="text-[28px] font-extrabold tracking-tight">
          {isAffiliatedPlayer ? "Confirmez votre demande" : isFullCom ? "Votre mise en relation" : "Paiement"}
        </h1>
        <p className="mt-2 text-[14px] text-text-soft">
          {isAffiliatedPlayer
            ? "Un administrateur du club devra valider votre demande de rattachement."
            : isFullCom
              ? "Full Communication est sur devis : un conseiller vous recontacte sous 24h ouvrées."
              : "Vos informations de paiement sont chiffrées et gérées par Stripe."}
        </p>
      </div>

      <Card className="p-5">
        <div className="text-[13px] font-extrabold">Récapitulatif</div>
        <dl className="mt-3 flex flex-col gap-2.5 text-[13px]">
          <Row label="Structure" value={orgLabel} />
          <Row label="Organisation" value={state.org.name || "—"} />
          {isAffiliatedPlayer ? (
            <>
              <Row label="Club recherché" value={state.clubSearch || "—"} />
              <Row label="Accès" value="Financé par le club (3 crédits inclus)" />
              <Row label="Paiement" value="Aucun — validation par le club" />
              <Row label="Statut" value="En attente de l'administrateur" />
            </>
          ) : (
            <>
              <Row label="Offre" value={plan?.name ?? "—"} />
              <Row label="Tarif" value={plan ? formatPlanPrice(plan) : "—"} />
              <Row label="Crédits inclus" value={plan ? formatPlanCredits(plan) : "—"} />
              <Row label="Engagement" value={isFullCom ? "Défini avec votre conseiller" : "12 mois"} />
              <Row
                label="Total à régler aujourd'hui"
                value={isFullCom ? "Aucun paiement" : plan?.monthlyPrice ? `${plan.monthlyPrice} € TTC` : "—"}
              />
            </>
          )}
        </dl>
      </Card>

      {isAffiliatedPlayer ? (
        <div className="rounded-xl border border-border-strong bg-surface-alt p-4 text-[13px] text-text-soft">
          Votre demande sera transmise à l&apos;administrateur de <strong className="text-text">{state.clubSearch || "ce club"}</strong>.
          Vous recevrez une notification dès qu&apos;elle sera validée.
        </div>
      ) : isFullCom ? (
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">Message de mise en relation</span>
          <textarea
            value={state.quoteMessage}
            onChange={(e) => patch({ quoteMessage: e.target.value })}
            className={textareaClass}
            placeholder="Décrivez votre projet pour que votre conseiller prépare une proposition adaptée."
          />
        </label>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-[12.5px] font-bold text-text-soft">Numéro de carte</span>
            <input
              value={state.payment.cardNumber}
              onChange={(e) => patch({ payment: { ...state.payment, cardNumber: e.target.value } })}
              className={inputClass}
              placeholder="4242 4242 4242 4242"
              inputMode="numeric"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-bold text-text-soft">Expiration</span>
            <input
              value={state.payment.expiry}
              onChange={(e) => patch({ payment: { ...state.payment, expiry: e.target.value } })}
              className={inputClass}
              placeholder="MM / AA"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-bold text-text-soft">CVC</span>
            <input
              value={state.payment.cvc}
              onChange={(e) => patch({ payment: { ...state.payment, cvc: e.target.value } })}
              className={inputClass}
              placeholder="123"
              inputMode="numeric"
            />
          </label>
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="secondary" onClick={() => router.push("/signup/plan")}>
          Retour
        </Button>
        <Button disabled={!canContinue} onClick={() => router.push("/signup/done")}>
          {submitLabel()}
        </Button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-divider pb-2.5 last:border-0 last:pb-0">
      <dt className="text-text-soft">{label}</dt>
      <dd className="font-bold">{value}</dd>
    </div>
  );
}
