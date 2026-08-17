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

/**
 * Tunnel dédié "Demande d'ouverture Connect" — voir /signup/club-request/*. Remplace, pour
 * orgType==='club' uniquement, l'ancien chemin qui appelait clubplus-onboarding immédiatement
 * après l'inscription (compte créé par le visiteur, club actif + admin posés en dur à la même
 * seconde, AUCUNE validation humaine). Brief Fouka du 12/08/2026 : une inscription publique de
 * club ne crée plus jamais directement un club actif — elle crée une demande, transmise au
 * staff SportVision pour validation manuelle (voir migration-connect-v44-club-signup-requests.sql
 * et connect-club-signup-request). Aucun mot de passe ni compte à ce stade : uniquement ces
 * champs, envoyés tels quels par l'Edge Function publique.
 */
export interface ClubSignupRequestState {
  clubNom: string;
  structureType: string;
  ville: string;
  codePostal: string;
  siteWeb: string;
  contactPrenom: string;
  contactNom: string;
  contactEmail: string;
  contactTelephone: string;
  fonction: string;
  fonctionAutre: string;
  besoins: string[];
  besoinAutrePrecision: string;
  certificationAcceptee: boolean;
}

export interface SignupState {
  orgType: OrgType | null;
  account: SignupAccount;
  org: SignupOrg;
  needs: { selected: string[]; freeText: string };
  planCode: PlanCode | null;
  /** Uniquement pour club_plus_start/club_plus_performance — voir src/lib/plans.ts. */
  engagement: "12mois" | "sans";
  payment: SignupPayment;
  /** Message de mise en relation — remplace le paiement pour Full Communication. */
  quoteMessage: string;
  /** Uniquement pour orgType === "club" — voir /signup/club-request/*. */
  clubRequest: ClubSignupRequestState;
}

const EMPTY_STATE: SignupState = {
  orgType: null,
  account: { firstName: "", lastName: "", email: "", phone: "", jobTitle: "", password: "" },
  org: { logoUrl: "", name: "", address: "", instagram: "", siret: "", teamCount: "", memberCount: "" },
  needs: { selected: [], freeText: "" },
  planCode: null,
  engagement: "12mois",
  payment: { cardNumber: "", expiry: "", cvc: "" },
  quoteMessage: "",
  clubRequest: {
    clubNom: "",
    structureType: "",
    ville: "",
    codePostal: "",
    siteWeb: "",
    contactPrenom: "",
    contactNom: "",
    contactEmail: "",
    contactTelephone: "",
    fonction: "",
    fonctionAutre: "",
    besoins: [],
    besoinAutrePrecision: "",
    certificationAcceptee: false,
  },
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
//
// `player`/`parent` : jamais proposés à l'inscription Club+ — ces deux personas vivent
// exclusivement sur SportVision Connect (app-connect), jamais sur Club+ (brief Fouka 17/08/2026,
// confirmé par HANDOFF-CLUBPLUS.md § 1 : "SportVision Connect = la personne... SportVision Club+
// = la structure"). Le chemin "Joueur affilié à un club" qui existait ici avant le split
// Connect/Club+ (11/08/2026, recherche de club + rattachement) a été entièrement retiré : un
// joueur qui veut rejoindre un club le fait depuis Connect, pas depuis ce tunnel.
// tournament_organizer/camp : bascule 2 org types séparés (migration-clubplus-v44, 17/08/2026),
// remplace l'ancien OrgType unique `event`. Comportement du tunnel INCHANGÉ — voir la note en
// tête de fichier § "Événement" : ce tunnel ne crée jamais une vraie organisation
// tournoi/stage, seulement un Espace Projet générique (portal-onboarding, profil "organisateur").
// `camp` n'a pas d'entrée dans ORG_TYPE_OPTIONS ci-dessous (jamais proposé à l'inscription, comme
// cm_agency/sponsor) mais doit rester présent ici pour que ce Record<OrgType, ...> reste exhaustif.
export const PLAN_OPTIONS_BY_TYPE: Record<OrgType, PlanCode[]> = {
  club: ["one_off", "club_plus_start", "club_plus_performance", "full_communication"],
  academy: ["one_off", "club_plus_start", "club_plus_performance", "full_communication"],
  coach: ["one_off", "club_plus_start", "full_communication"],
  tournament_organizer: ["one_off", "full_communication"],
  camp: [],
  generic: ["one_off"],
  player: [],
  parent: [],
  cm_agency: [],
  sponsor: [],
};

export const ORG_TYPE_OPTIONS: { type: OrgType; label: string; description: string }[] = [
  { type: "club", label: "Club", description: "Équipes, licenciés, compétitions" },
  { type: "academy", label: "Académie", description: "Groupes, stages, formation" },
  { type: "coach", label: "Coach", description: "Activité individuelle ou indépendante" },
  { type: "generic", label: "Autre structure sportive", description: "Ligue, comité, association, entreprise" },
  { type: "tournament_organizer", label: "Événement", description: "Tournoi, compétition ponctuelle" },
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

// ── Tunnel /signup/club-request — voir ClubSignupRequestState ci-dessus ────────────────────
//
// Type de structure : liste non fournie verbatim par Fouka (contrairement à Fonction et
// Besoin ci-dessous, transcrites telles quelles depuis son brief) — jugement produit, classification
// légale/administrative usuelle d'un club sportif français. Pas de champ "Autre" conditionnel ici
// (contrairement à Fonction) : Fouka ne l'a demandé que pour Fonction, et le staff peut toujours
// demander une précision via l'action "Demander des informations" du nouvel écran de traitement.
export const CLUB_STRUCTURE_TYPE_OPTIONS = [
  "Association loi 1901",
  "Club professionnel / société sportive",
  "Section d'un club omnisports",
  "Structure municipale ou collectivité",
  "Autre",
];

// Liste transcrite verbatim depuis le brief de Fouka (12/08/2026). Distinction stricte avec le
// rôle Connect : ce champ est purement informatif, il ne détermine JAMAIS le rôle
// technique/permissions dans Connect (choisi séparément par le staff SportVision au moment de la
// validation, jamais automatiquement à partir de ce choix) — c'est le cœur de ce chantier de
// sécurité, voir migration-connect-v44-club-signup-requests.sql.
export const CLUB_FONCTION_OPTIONS = [
  "Président(e)",
  "Vice-président(e)",
  "Directeur / Directrice",
  "Secrétaire",
  "Trésorier / Trésorière",
  "Responsable communication",
  "Community Manager",
  "Responsable sportif / Directeur sportif",
  "Responsable administratif",
  "Responsable partenariat / sponsoring",
  "Éducateur / Éducatrice",
  "Entraîneur / Entraîneuse",
  "Responsable d'équipe",
  "Photographe / Vidéaste du club",
  "Joueur / Joueuse",
  "Bénévole",
  "Membre du bureau",
  "Autre",
];

// Liste transcrite verbatim depuis le brief de Fouka (12/08/2026).
export const CLUB_BESOIN_OPTIONS = [
  "Prestations photo / vidéo",
  "Communication du club",
  "Création de visuels",
  "Full Communication",
  "Club+",
  "Couverture de matchs",
  "Tournoi / stage",
  "Veo / captation",
  "Je souhaite simplement découvrir SportVision",
  "Autre",
];

/**
 * Frise de progression propre au tunnel /signup/club-request (4 étapes, voir layout.tsx §
 * ProgressBar) — distincte de STEPS/getSteps ci-dessus, qui restent inchangés pour les autres
 * types d'organisation (coach/académie/joueur/générique/événement).
 */
export const CLUB_REQUEST_STEPS: { href: string; label: string }[] = [
  { href: "/signup/club-request", label: "Votre club" },
  { href: "/signup/club-request/contact", label: "Vous" },
  { href: "/signup/club-request/needs", label: "Votre besoin" },
  { href: "/signup/club-request/review", label: "Validation" },
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

