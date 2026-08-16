"use client";

import Link from "next/link";
import { ArrowLeft, Sparkles } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { PLANS, formatPlanCredits, formatPlanPrice } from "@/lib/plans";
import { Card, CardPremium } from "@/components/ui/Card";

// /communication/credits — sous-page "Crédits" du Centre communication (Bible §9, nav
// "Communication : Centre communication / Résultats & informations / Demandes de visuels /
// Crédits / Mes contenus"). Choix documenté (brief Fouka 17/08/2026) : sous-page dédiée plutôt
// qu'une section dans /communication, parce que la Bible liste "Crédits" comme sa propre entrée
// de navigation (donc sa propre URL bookmarkable), et parce que le Centre communication
// (page.tsx, CommunicationHub) est déjà un hub à 5 cartes — y ajouter une 6e section aurait
// nui à "une page = une priorité" (Bible §22).
//
// Volontairement minimal (brief : "rien d'autre à inventer") : Subscription.creditsRemaining/
// creditsReserved existent déjà dans la session (session.ts § buildClubActiveContext, lus depuis
// clubs.credits_balance/credits_reserved), aucune table d'historique de mouvements de crédits
// n'existe côté réel (grep "credit" sur livrables/SportVision-TV/migration-clubplus-*.sql : seuls
// club_requests.credits_reserved et clubs.credits_balance/credits_monthly/credits_reserved
// existent, pas de table de mouvements/historique) — donc pas d'historique construit ici, juste
// le solde, cohérent avec la Bible §2 "Recharge / report / expiration : jamais hardcodés dans
// Club+" (rien à afficher que le backend n'expose pas réellement).
export default function CommunicationCreditsPage() {
  const { ctx } = useSession();
  const plan = PLANS[ctx.subscription.planCode];
  const hasGauge = plan.monthlyCredits !== null;
  const pct = hasGauge && plan.monthlyCredits! > 0 ? Math.round((ctx.subscription.creditsRemaining / plan.monthlyCredits!) * 100) : 0;

  return (
    <div className="flex flex-col gap-5">
      <Link href="/communication" className="inline-flex w-fit items-center gap-1.5 text-[12.5px] font-bold text-brand-blue-electric">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        Retour au Centre communication
      </Link>

      <div>
        <div className="text-[12px] font-bold text-text-soft">Communication</div>
        <h1 className="mt-1.5 text-[29px] font-extrabold leading-tight tracking-tight">Crédits</h1>
        <p className="mt-1.5 max-w-2xl text-[13.5px] text-text-soft">
          Les crédits pilotent vos demandes de visuels. Un résultat de match ou l&apos;ouverture d&apos;un formulaire ne
          consomme jamais de crédit — seule une demande confirmée en consomme.
        </p>
      </div>

      <CardPremium>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-extrabold uppercase tracking-[.1em] text-brand-blue-pale">{plan.name}</div>
            <div className="mt-1 text-[13px] text-[#B9C7EB]">{formatPlanPrice(plan)}</div>
          </div>
          <Sparkles className="h-6 w-6 text-brand-cyan" aria-hidden />
        </div>

        {hasGauge ? (
          <div className="mt-5">
            <div className="flex items-baseline justify-between">
              <span className="text-[12px] font-semibold text-[#B9C7EB]">Crédits disponibles</span>
              <span className="text-[22px] font-extrabold">{ctx.subscription.creditsRemaining}</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/[.16]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-brand-cyan to-brand-violet"
                style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
              />
            </div>
            <div className="mt-1.5 text-[12px] text-[#B9C7EB]">{formatPlanCredits(plan)}</div>
          </div>
        ) : (
          <p className="mt-5 text-[13.5px] leading-relaxed text-[#B9C7EB]">
            Volume sur mesure, suivi directement avec votre Community Manager SportVision.
          </p>
        )}

        {ctx.subscription.creditsReserved > 0 && (
          <div className="mt-4 rounded-xl bg-white/[.08] px-3.5 py-2.5 text-[12.5px] font-semibold text-white">
            {ctx.subscription.creditsReserved} crédit{ctx.subscription.creditsReserved > 1 ? "s" : ""} réservé
            {ctx.subscription.creditsReserved > 1 ? "s" : ""} sur des demandes en cours.
          </div>
        )}
      </CardPremium>

      <Card className="p-5">
        <div className="text-[13.5px] font-extrabold tracking-tight">Comment les crédits sont utilisés</div>
        <ul className="mt-3 flex flex-col gap-2 text-[13px] leading-relaxed text-text-soft">
          <li>• Enregistrer un résultat de match : aucun crédit.</li>
          <li>• Ouvrir un formulaire de demande de visuel : aucun crédit.</li>
          <li>• Envoyer une demande de visuel confirmée : selon l&apos;urgence choisie, décompté à l&apos;envoi.</li>
          <li>• Recharge, report et expiration sont définis par votre offre — parlez-en à votre interlocuteur SportVision.</li>
        </ul>
      </Card>
    </div>
  );
}
