"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

// État du tunnel unifié "Demande d'ouverture d'un espace Club+" — voir
// SIGNUP-UNIFIE-MASTER-PROMPT.md (transmis par Fouka le 17/08/2026). Pas un fichier de route
// (pas de `page.tsx`/`layout.tsx`), donc ignoré par le routeur App Router : colocalisé avec les
// écrans qu'il alimente (src/app/signup/request/*) plutôt que dans src/lib, pour rester un
// module autonome propre à l'inscription.
//
// Persisté en mémoire le temps de la session de navigation : le layout `signup/layout.tsx` reste
// monté d'une étape à l'autre (navigation interne au même groupe de routes), donc le contexte
// survit aux changements de page (§60-62 du master prompt). Un refresh de page perd cet état en
// mémoire — chaque écran du tunnel s'en protège via un garde qui renvoie à l'écran 1 plutôt que
// d'afficher un formulaire à moitié vide (voir chaque page.tsx de src/app/signup/request/*).
//
// 17/08/2026 — remplace entièrement :
//  - l'ancien tunnel /signup/club-request/* (4 étapes, club uniquement) ;
//  - l'ancien tunnel générique /signup/type → .../done (7 étapes, création de compte + org
//    ACTIVE immédiate pour coach/académie/générique/tournoi, via connect-org-signup/
//    portal-onboarding, retiré par cette décision — voir la note d'architecture en bas de
//    SIGNUP-UNIFIE-MASTER-PROMPT.md).
// Ce tunnel ne crée JAMAIS de compte ni d'organisation active : il envoie une simple demande à
// l'Edge Function publique connect-club-signup-request (déjà déployée, généralisée à 7 types de
// structure — voir livrables/SportVision-TV/supabase/functions/connect-club-signup-request/index.ts,
// source de vérité pour tous les noms de champs et listes fermées ci-dessous).

/** Type de structure — écran 1 (master prompt §5). Valeurs exactes attendues par le champ
 * `organization_type` de connect-club-signup-request (ORG_TYPES côté Edge Function). */
export type RequestOrgType = "club" | "academie" | "coach" | "structure_coaching" | "tournoi" | "stage" | "projet";

export interface RequestState {
  organizationType: RequestOrgType | null;

  // Écran 2 · Votre structure
  nom: string;
  /** "Statut juridique" à l'écran — correspond au champ serveur `structure_type` (sous-
   * classification administrative). Obligatoire uniquement pour club (comportement hérité de
   * l'ancien tunnel /signup/club-request, préservé à l'identique — voir la contrainte non
   * négociable en bas du master prompt). Facultatif pour académie/association, non pertinent
   * pour les 4 autres types (voir STRUCTURE_TYPE_RELEVANT_FOR còté Edge Function). */
  structureType: string;
  ville: string;
  codePostal: string;
  siteWeb: string;
  /** Sport pratiqué par la structure (audit de cohérence, 01/09/2026) — même liste que le
   * sélecteur Connect (SPORT_OPTIONS ci-dessous), résolu en pole_id réel (Football/Basket)
   * par connect-club-signup-review au moment de la validation. Requis pour tous les types :
   * même un tournoi/stage/association a un sport de rattachement. */
  sport: string;
  sportAutre: string;
  /** Coach uniquement (§12). */
  activiteType: string;
  activiteTypeAutre: string;
  exerceSousPropreNom: boolean;
  /** Tournoi uniquement (§13), facultatif. */
  nomEvenementPrincipal: string;

  // Écran 3 · Vous
  contactPrenom: string;
  contactNom: string;
  contactEmail: string;
  contactTelephone: string;
  fonction: string;
  fonctionAutre: string;

  // Écran 4 · Votre besoin
  besoins: string[];
  besoinAutrePrecision: string;

  // Écran 5 · Validation
  certificationAcceptee: boolean;
}

const EMPTY_STATE: RequestState = {
  organizationType: null,
  nom: "",
  structureType: "",
  ville: "",
  codePostal: "",
  siteWeb: "",
  sport: "",
  sportAutre: "",
  activiteType: "",
  activiteTypeAutre: "",
  exerceSousPropreNom: false,
  nomEvenementPrincipal: "",
  contactPrenom: "",
  contactNom: "",
  contactEmail: "",
  contactTelephone: "",
  fonction: "",
  fonctionAutre: "",
  besoins: [],
  besoinAutrePrecision: "",
  certificationAcceptee: false,
};

interface SignupContextValue {
  state: RequestState;
  patch: (partial: Partial<RequestState>) => void;
}

const SignupContext = createContext<SignupContextValue | null>(null);

export function SignupProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<RequestState>(EMPTY_STATE);
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

// ── Écran 1 · Type de structure (master prompt §5) ─────────────────────────────────────────
export const REQUEST_ORG_TYPE_OPTIONS: { type: RequestOrgType; label: string; description: string }[] = [
  { type: "club", label: "Club", description: "Équipes, joueurs, compétitions." },
  { type: "academie", label: "Académie", description: "Sportifs, groupes, stages." },
  { type: "coach", label: "Coach / Préparateur", description: "Activité individuelle ou indépendante." },
  { type: "structure_coaching", label: "Structure de coaching", description: "Plusieurs coachs, intervenants ou groupes." },
  { type: "tournoi", label: "Tournoi / Événement", description: "Tournoi, compétition ou événement ponctuel." },
  { type: "stage", label: "Stage / Camp", description: "Stage sportif, camp ou session organisée." },
  { type: "projet", label: "Association / Autre structure", description: "Association, ligue, comité ou autre organisation." },
];

// ── Écran 2 · Titre dynamique (§8) et libellé du champ nom (§10) ───────────────────────────
export const STRUCTURE_TITLE: Record<RequestOrgType, string> = {
  club: "Votre club",
  academie: "Votre académie",
  coach: "Votre activité",
  structure_coaching: "Votre structure",
  tournoi: "Votre organisation",
  stage: "Votre stage ou organisation",
  projet: "Votre structure",
};

export const STRUCTURE_NAME_LABEL: Record<RequestOrgType, string> = {
  club: "Nom du club",
  academie: "Nom de l'académie",
  coach: "Nom de votre activité",
  structure_coaching: "Nom de la structure",
  tournoi: "Nom de l'organisation",
  stage: "Nom du stage / camp",
  projet: "Nom de la structure",
};

/** Le champ `structure_type` (§ci-dessus, RequestState.structureType) est requis pour club,
 * facultatif pour académie/association, ignoré par le serveur pour les 4 autres types
 * (STRUCTURE_TYPE_RELEVANT côté Edge Function) — donc pas affiché du tout pour ceux-là. */
export const STRUCTURE_TYPE_FIELD: Record<RequestOrgType, "required" | "optional" | "hidden"> = {
  club: "required",
  academie: "optional",
  projet: "optional",
  coach: "hidden",
  structure_coaching: "hidden",
  tournoi: "hidden",
  stage: "hidden",
};

/** Options du champ "Statut juridique" — reprises telles quelles de l'ancien tunnel
 * /signup/club-request (CLUB_STRUCTURE_TYPE_OPTIONS), le serveur ne valide pas ces valeurs
 * contre une liste fermée (simple présence non vide pour club). */
export const STRUCTURE_TYPE_OPTIONS = [
  "Association loi 1901",
  "Club professionnel / société sportive",
  "Section d'un club omnisports",
  "Structure municipale ou collectivité",
  "Autre",
];

// ── Écran 2 · Sport (audit de cohérence, 01/09/2026) — mêmes valeurs que SPORTS côté Connect
// (app-connect/src/app/signup/signup-context.tsx), résolues par le même resolve_pole_by_sport()
// (migration-poles-v13) — un sport hors Football/Basket reste accepté (signal de demande future,
// pole_id retombe sur Football par défaut côté serveur, jamais un pôle inventé).
export const SPORT_OPTIONS = ["Football", "Futsal", "Basketball", "Handball", "Rugby", "Volleyball", "Athlétisme", "Tennis", "Autre"];

// ── Écran 2 · Champ conditionnel coach (§12) — verbatim ACTIVITE_TYPES côté Edge Function ──
export const ACTIVITE_TYPE_OPTIONS = ["Coach indépendant", "Préparateur physique", "Personal trainer", "Coach personnel", "Autre"];

// ── Écran 3 · Fonction (§19) — verbatim FONCTIONS côté Edge Function ───────────────────────
export const FONCTION_OPTIONS = [
  "Président(e)",
  "Vice-président(e)",
  "Directeur/Directrice",
  "Secrétaire",
  "Trésorier/Trésorière",
  "Responsable communication",
  "Community Manager",
  "Directeur sportif",
  "Responsable sportif",
  "Responsable administratif",
  "Coach",
  "Éducateur",
  "Préparateur physique",
  "Responsable d'équipe",
  "Responsable partenariat/sponsoring",
  "Propriétaire/Gérant",
  "Bénévole",
  "Membre du bureau",
  "Autre",
];

// ── Écran 4 · Votre besoin (§23-28) ─────────────────────────────────────────────────────────
// Les 3 blocs visuels décrits en §23-26 et la liste fermée "recommandée" de §27-28 (= BESOINS
// côté Edge Function) ne s'énumèrent pas item pour item dans le master prompt (§23-26 cite par
// exemple "Découvrir Club+"/"Création de contenus", absents de la liste fermée §27-28). Les 9
// valeurs ci-dessous sont la liste fermée réellement acceptée par le serveur ; leur répartition
// dans les 3 blocs reprend l'intention de §23-26 (Espace & accompagnement / Prestations / Autre).
export const BESOIN_BLOCKS: { title: string; options: string[] }[] = [
  {
    title: "Espace & accompagnement",
    options: ["Découvrir les services SportVision", "Full Communication", "Communication de ma structure", "Création de visuels"],
  },
  {
    title: "Prestations",
    options: ["Photo / vidéo", "Couverture de matchs", "Captation Veo / Drone", "Tournoi / stage / événement"],
  },
  {
    title: "Autre besoin",
    options: ["Autre"],
  },
];

/**
 * Revalidation complète (hors certification) — utilisée par l'écran 5 · Validation pour
 * défensivement garder le CTA "Envoyer ma demande" désactivé (§40) même si l'état a été modifié
 * entre deux écrans (retour navigateur, édition via un lien "Modifier") sans repasser par la
 * validation inline de chaque écran (structure/page.tsx, contact/page.tsx).
 */
export function isRequestComplete(state: RequestState): boolean {
  if (!state.organizationType) return false;
  const structureTypeMode = STRUCTURE_TYPE_FIELD[state.organizationType];
  if (!state.nom.trim() || !state.ville.trim()) return false;
  if (!state.sport.trim()) return false;
  if (state.sport === "Autre" && !state.sportAutre.trim()) return false;
  if (structureTypeMode === "required" && !state.structureType.trim()) return false;
  if (state.organizationType === "coach") {
    if (!state.activiteType.trim()) return false;
    if (state.activiteType === "Autre" && !state.activiteTypeAutre.trim()) return false;
  }
  if (!state.contactPrenom.trim() || !state.contactNom.trim()) return false;
  if (!/\S+@\S+\.\S+/.test(state.contactEmail)) return false;
  if (!state.contactTelephone.trim()) return false;
  if (!state.fonction.trim()) return false;
  if (state.fonction === "Autre" && !state.fonctionAutre.trim()) return false;
  if (state.besoins.length === 0) return false;
  return true;
}

// ── Frise de progression (§2-3) — 5 étapes exactement, jamais Offre/Paiement/Confirmation ──
export const REQUEST_STEPS: { href: string; label: string }[] = [
  { href: "/signup/request", label: "Type de structure" },
  { href: "/signup/request/structure", label: "Votre structure" },
  { href: "/signup/request/contact", label: "Vous" },
  { href: "/signup/request/needs", label: "Votre besoin" },
  { href: "/signup/request/review", label: "Validation" },
];
