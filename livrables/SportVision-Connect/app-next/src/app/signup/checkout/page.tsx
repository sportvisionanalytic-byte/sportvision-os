"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { formatPlanCredits, formatPlanPrice, PLANS } from "@/lib/plans";
import { createClient } from "@/lib/supabase/client";
import { consumePendingOnboarding, savePendingOnboarding, type PendingOnboarding } from "@/lib/signup/pending-onboarding";
import { ORG_TYPE_OPTIONS, useSignup, type SignupState } from "../signup-context";
import { textareaClass } from "../signup-styles";

// Étape 6 · Paiement — voir ACTIONS.md § 2. Trois variantes : abonnement Club+ réel (redirection
// Stripe Checkout), message de mise en relation (Full Communication, sur devis), ou demande de
// rattachement (joueur affilié).
//
// 09/08/2026 — remplace un formulaire de carte bancaire brut (numéro/expiration/CVC saisis dans
// des <input> ordinaires, jamais réellement transmis à Stripe malgré le texte "chiffré par
// Stripe" affiché) : aucune tokenisation PCI-DSS n'existait. La vraie collecte de carte se fait
// désormais exclusivement sur la page Stripe Checkout hébergée, après redirection.
//
// Construit une action d'inscription (PendingOnboarding) à partir de l'état du tunnel, puis crée
// le compte réel (`auth.signUp`). Si la confirmation d'e-mail est active sur ce projet (elle
// l'est — voir pending-onboarding.ts), aucune session n'existe encore : l'action est mémorisée
// et rejouée au premier login. Sinon elle est exécutée immédiatement.
export default function SignupCheckoutPage() {
  const router = useRouter();
  const { state } = useSignup();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quoteMessage, setQuoteMessage] = useState(state.quoteMessage);

  const isAffiliatedPlayer = state.orgType === "player" && state.playerAffiliation === "join_club";
  const plan = state.planCode ? PLANS[state.planCode] : null;
  const isFullCom = plan?.code === "full_communication";
  const orgLabel = ORG_TYPE_OPTIONS.find((o) => o.type === state.orgType)?.label ?? "Structure";
  const isRealBilling = state.orgType === "club" && (plan?.code === "club_plus_start" || plan?.code === "club_plus_performance");

  const canContinue =
    state.account.email.trim().length > 0 &&
    state.account.password.trim().length >= 6 &&
    (isAffiliatedPlayer ? true : isFullCom ? quoteMessage.trim().length > 0 : true);

  function submitLabel() {
    if (submitting) return "Un instant…";
    if (isAffiliatedPlayer) return "Envoyer ma demande de rattachement";
    if (isFullCom) return "Envoyer ma demande de devis";
    if (isRealBilling) return "Continuer vers le paiement";
    return "Créer mon compte";
  }

  async function handleSubmit() {
    if (!canContinue || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const pending = buildPendingOnboarding(state, quoteMessage);
      savePendingOnboarding(pending);

      const supabase = createClient();
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: state.account.email,
        password: state.account.password,
        options: {
          // Mêmes clés que updateUserProfile() (src/lib/data/shared/profile.ts) et
          // buildUserFromAuth() (session.ts) — prenom/nom, pas first_name/last_name. Avec les
          // mauvaises clés, le nom et les initiales restaient vides partout (sidebar, header)
          // jusqu'à ce que l'utilisateur repasse par /settings/profile pour les ressaisir.
          data: { prenom: state.account.firstName, nom: state.account.lastName },
        },
      });
      if (signUpError) throw signUpError;

      if (!signUpData.session) {
        router.push("/signup/done?outcome=confirm_email");
        return;
      }

      const result = await consumePendingOnboarding(supabase);
      if (result?.redirectUrl) {
        window.location.href = result.redirectUrl;
        return;
      }
      router.push(`/signup/done?outcome=${pending.kind === "connect-signup-lead" ? "lead" : "org_created"}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Une erreur est survenue, réessayez.");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-7">
      <div>
        <h1 className="text-[28px] font-extrabold tracking-tight">
          {isAffiliatedPlayer ? "Confirmez votre demande" : isFullCom ? "Votre mise en relation" : "Créer mon compte"}
        </h1>
        <p className="mt-2 text-[14px] text-text-soft">
          {isAffiliatedPlayer
            ? "Un administrateur du club devra valider votre demande de rattachement."
            : isFullCom
              ? "Full Communication est sur devis : un conseiller vous recontacte sous 24h ouvrées."
              : isRealBilling
                ? "L'étape suivante vous redirige vers Stripe pour renseigner votre moyen de paiement en toute sécurité."
                : "Un conseiller SportVision finalise votre offre avec vous."}
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
              <Row label="Engagement" value={isRealBilling ? (state.engagement === "12mois" ? "12 mois" : "Sans engagement") : "—"} />
              <Row
                label="Paiement"
                value={isRealBilling ? "Sur la page suivante (Stripe)" : "Aucun — finalisé avec votre conseiller"}
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
            value={quoteMessage}
            onChange={(e) => setQuoteMessage(e.target.value)}
            className={textareaClass}
            placeholder="Décrivez votre projet pour que votre conseiller prépare une proposition adaptée."
          />
        </label>
      ) : !isRealBilling ? (
        <div className="rounded-xl border border-border-strong bg-surface-alt p-4 text-[13px] text-text-soft">
          Cette offre est finalisée manuellement avec un conseiller SportVision — aucun paiement n&apos;est demandé à cette étape.
        </div>
      ) : null}

      {error && (
        <div className="flex gap-2.5 rounded-xl border border-[#FDA29B] bg-danger-bg px-3.5 py-3">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-none text-danger-fg" aria-hidden />
          <p className="text-[13px] font-semibold leading-relaxed text-danger-fg">{error}</p>
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="secondary" onClick={() => router.push("/signup/plan")} disabled={submitting}>
          Retour
        </Button>
        <Button disabled={!canContinue || submitting} loading={submitting} onClick={handleSubmit}>
          {submitLabel()}
        </Button>
      </div>
    </div>
  );
}

function buildPendingOnboarding(state: SignupState, quoteMessage: string): PendingOnboarding {
  const isAffiliatedPlayer = state.orgType === "player" && state.playerAffiliation === "join_club";
  const plan = state.planCode ? PLANS[state.planCode] : null;
  const prenom = state.account.firstName;
  const nomContact = state.account.lastName;
  const telephone = state.account.phone;

  if (isAffiliatedPlayer) {
    return {
      kind: "connect-signup-lead",
      reason: "player_join_club",
      orgName: "",
      planLabel: "",
      clubSearch: state.clubSearch,
      message: "",
      prenom,
      nomContact,
      telephone,
    };
  }

  if (state.orgType === "club" && (plan?.code === "club_plus_start" || plan?.code === "club_plus_performance")) {
    return {
      kind: "clubplus",
      prenom,
      nom: nomContact,
      telephone,
      orgName: state.org.name,
      ville: "",
      plan: plan.code === "club_plus_performance" ? "performance" : "club",
      engagement: state.engagement,
    };
  }

  if (state.orgType === "club") {
    return {
      kind: "connect-signup-lead",
      reason: "club_plan_manuel",
      orgName: state.org.name,
      planLabel: plan?.name ?? "",
      clubSearch: "",
      message: plan?.code === "full_communication" ? quoteMessage : "",
      prenom,
      nomContact,
      telephone,
    };
  }

  if (state.orgType === "coach" || state.orgType === "academy") {
    return {
      kind: "connect-org-signup",
      organizationType: state.orgType === "academy" ? "academie" : "coach",
      nom: state.org.name,
      prenom,
      nomContact,
      telephone,
      planLabel: plan?.name ?? "",
      message: plan?.code === "full_communication" ? quoteMessage : "",
    };
  }

  // generic, event : client Portail (Espace Projet). Un joueur (orgType === "player") n'atteint
  // plus jamais cette branche depuis le 11/08/2026 : `isAffiliatedPlayer` ci-dessus est
  // désormais toujours vrai pour lui (playerAffiliation ne vaut plus que "join_club", voir
  // signup-context.tsx) et intercepte le cas avant d'arriver ici. Avant ce correctif, un joueur
  // en "gérer mon espace moi-même" tombait dans cette branche generic/portal-onboarding et
  // obtenait un compte organization_type='projet' (memberships.role toujours 'admin' via
  // mapProjetRole) au lieu d'un vrai espace Joueur — c'est ce chemin que Fouka a testé.
  return {
    kind: "portal-onboarding",
    prenom,
    nom: nomContact,
    telephone,
    profil: state.orgType === "event" ? "organisateur" : state.orgType === "generic" ? "entreprise" : "particulier",
  };
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-divider pb-2.5 last:border-0 last:pb-0">
      <dt className="text-text-soft">{label}</dt>
      <dd className="font-bold">{value}</dd>
    </div>
  );
}
