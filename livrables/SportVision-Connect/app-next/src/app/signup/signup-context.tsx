"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { OrgType, PlanCode } from "@/lib/types";

// État du tunnel d'inscription — voir ACTIONS.md § 2. Pas un fichier de route (pas de
// `page.tsx`/`layout.tsx`), donc ignoré par le routeur App Router : colocalisé avec les 7 écrans
// qu'il alimente plutôt que dans src/lib pour rester un module autonome, propre à l'inscription.
//
// Persisté en mémoire le temps de la session de navigation : le layout `signup/layout.tsx` reste
// monté d'une étape à l'autre (navigation interne au même groupe de routes), donc le contexte
// survit aux changements de page. Pas de backend branché (voir README.md du projet) : les
// données saisies ne sont conservées que pour faire fonctionner le tunnel de bout en bout.

export interface SignupAccount {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  jobTitle: string;
  password: string;
}

export interface SignupOrg {
  logoUrl: string;
  name: string;
  address: string;
  instagram: string;
  siret: string;
  teamCount: string;
  memberCount: string;
}

export interface SignupPayment {
  cardNumber: string;
  expiry: string;
  cvc: string;
}

export interface SignupState {
  orgType: OrgType | null;
  /** Uniquement pour orgType === "player" — voir ACTIONS.md § 2, étape 1 · Affiliation. */
  playerAffiliation: "self" | "join_club" | null;
  account: SignupAccount;
  org: SignupOrg;
  needs: { selected: string[]; freeText: string };
  planCode: PlanCode | null;
  /** Uniquement pour club_plus_start/club_plus_performance — voir src/lib/plans.ts. */
  engagement: "12mois" | "sans";
  /** Recherche de club — remplace le choix d'offre pour un joueur affilié. Texte libre : aucune
   * recherche en direct n'est branchée (aucune policy de lecture publique sur `organizations` à
   * ce jour) — un conseiller SportVision retrouve et valide le club manuellement. */
  clubSearch: string;
  payment: SignupPayment;
  /** Message de mise en relation — remplace le paiement pour Full Communication. */
  quoteMessage: string;
}

const EMPTY_STATE: SignupState = {
  orgType: null,
  playerAffiliation: null,
  account: { firstName: "", lastName: "", email: "", phone: "", jobTitle: "", password: "" },
  org: { logoUrl: "", name: "", address: "", instagram: "", siret: "", teamCount: "", memberCount: "" },
  needs: { selected: [], freeText: "" },
  planCode: null,
  engagement: "12mois",
  clubSearch: "",
  payment: { cardNumber: "", expiry: "", cvc: "" },
  quoteMessage: "",
};

interface SignupContextValue {
  state: SignupState;
  patch: (partial: Partial<SignupState>) => void;
}

const SignupContext = createContext<SignupContextValue | null>(null);

export function SignupProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SignupState>(EMPTY_STATE);
  const value = useMemo<SignupContextValue>(
    () => ({
      state,
      patch: (partial) => setState((prev) => ({ ...prev, ...partial })),
    }),
    [state],
  );
  return <SignupContext.Provider value={value}>{children}</SignupContext.Provider>;
}

export function useSignup(): SignupContextValue {
  const value = useContext(SignupContext);
  if (!value) throw new Error("useSignup must be used within a SignupProvider");
  return value;
}

// Filtrage des offres par type — voir ACTIONS.md § 2, étape 5. "Essentiel" retiré le 11/08/2026
// (décision Fouka, voir plans.ts) : n'a jamais eu de vrai tarif ni de vraie existence côté
// backend pour un club réel. Remplacé par "one_off" (aucun engagement, facturé à la commande)
// pour club/académie/coach — un club peut avoir son espace Connect et réserver des prestations à
// la carte sans souscrire à Club+ ni à Full Communication.
export const PLAN_OPTIONS_BY_TYPE: Record<OrgType, PlanCode[]> = {
  club: ["one_off", "club_plus_start", "club_plus_performance", "full_communication"],
  academy: ["one_off", "club_plus_start", "club_plus_performance", "full_communication"],
  coach: ["one_off", "club_plus_start", "full_communication"],
  event: ["one_off", "full_communication"],
  player: ["one_off"],
  generic: ["one_off"],
  // Non proposés à l'inscription (rattachement uniquement) : parent, cm_agency, sponsor.
  parent: [],
  cm_agency: [],
  sponsor: [],
};

export const ORG_TYPE_OPTIONS: { type: OrgType; label: string; description: string }[] = [
  { type: "club", label: "Club", description: "Équipes, licenciés, compétitions" },
  { type: "academy", label: "Académie", description: "Groupes, stages, formation" },
  { type: "coach", label: "Coach", description: "Activité individuelle ou indépendante" },
  { type: "player", label: "Joueur", description: "Votre book et vos contenus personnels" },
  { type: "generic", label: "Autre structure sportive", description: "Ligue, comité, association, entreprise" },
  { type: "event", label: "Événement", description: "Tournoi, compétition ponctuelle" },
];

export const NEEDS_OPTIONS = [
  "Photos et vidéos de matchs",
  "Communication sur les réseaux sociaux",
  "Affiches et visuels pour les événements",
  "Gestion de la billetterie ou des inscriptions",
  "Recherche et suivi de sponsors",
  "Rapports de performance et statistiques",
  "Formation de mon équipe communication",
  "Accompagnement stratégique global",
];

export const STEPS: { href: string; label: string }[] = [
  { href: "/signup/type", label: "Structure" },
  { href: "/signup/account", label: "Vous" },
  { href: "/signup/org", label: "Organisation" },
  { href: "/signup/needs", label: "Besoins" },
  { href: "/signup/plan", label: "Offre" },
  { href: "/signup/checkout", label: "Paiement" },
  { href: "/signup/done", label: "Confirmation" },
];
