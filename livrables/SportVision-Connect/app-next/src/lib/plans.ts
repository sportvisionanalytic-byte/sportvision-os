import type { PlanCode } from "./types";

// Catalogue d'offres — source de vérité unique. Voir DATA_MODEL.md § Plan.
//
// 09/08/2026 — tarifs Club+ Start/Performance corrigés pour correspondre aux montants
// RÉELLEMENT facturés via Stripe (CLUBPLUS_TARIFS, livrables/SportVision-TV/supabase/
// functions/create-clubplus-subscription-checkout/index.ts — 49/59€ Start, 129/149€
// Performance), et à la vitrine publique (club-plus.html). Les anciens montants
// 390/690€ de cette maquette n'ont jamais été les vrais prix : la fonction Stripe
// existait déjà avec les bons montants, seule cette maquette front n'avait jamais été
// mise à jour en conséquence. Full Communication n'a toujours aucun montant réel
// branché côté backend (aucune table/Price Stripe ne la représente) — gardé "sur
// devis" plutôt que d'afficher un chiffre inventé.
//
// 11/08/2026 — offre "Essentiel" retirée (décision Fouka) : elle n'a jamais eu de vrai
// tarif ("sur devis" en permanence), n'a jamais été proposée sur la vitrine publique
// (club-plus.html ne montre que Club+ Start/Performance), et côté backend un club réel
// n'a jamais ce plan (clubs.plan ne vaut que 'club'/'performance', voir mapClubPlan
// dans supabase/mappers.ts) — c'était un choix mort du tunnel d'inscription front-end,
// jamais connecté à rien de réel. L'offre réelle : Club+ Start, Club+ Performance, Full
// Communication, plus "one_off" (aucun engagement, facturé à la commande) pour un club/
// académie/coach qui veut juste réserver des prestations à la carte sans s'abonner.

export interface PlanDefinition {
  code: PlanCode;
  name: string;
  tier: 1 | 2 | 3;
  /** null = « sur devis » / « à la commande » / pas encore de tarif réel : l'interface affiche un libellé, jamais un montant inventé. */
  monthlyPrice: number | null;
  /** Uniquement pour club_plus_start/performance : deuxième tarif réel (Stripe), sans engagement 12 mois. */
  monthlyPriceNoCommitment: number | null;
  monthlyPriceConfirmed: boolean;
  /** null = « sur mesure » (Full Communication). */
  monthlyCredits: number | null;
  seasonPresences: number;
  /** null = illimité. */
  maxUsers: number | null;
}

export const PLANS: Record<PlanCode, PlanDefinition> = {
  club_plus_start: {
    code: "club_plus_start",
    name: "Club+ Start",
    tier: 2,
    monthlyPrice: 49,
    monthlyPriceNoCommitment: 59,
    monthlyPriceConfirmed: true,
    monthlyCredits: 10,
    seasonPresences: 2,
    maxUsers: 8,
  },
  club_plus_performance: {
    code: "club_plus_performance",
    name: "Club+ Performance",
    tier: 2,
    monthlyPrice: 129,
    monthlyPriceNoCommitment: 149,
    monthlyPriceConfirmed: true,
    monthlyCredits: 40,
    seasonPresences: 5,
    maxUsers: null,
  },
  full_communication: {
    code: "full_communication",
    name: "Full Communication",
    tier: 3,
    monthlyPrice: null,
    monthlyPriceNoCommitment: null,
    monthlyPriceConfirmed: true,
    monthlyCredits: null,
    seasonPresences: 12,
    maxUsers: null,
  },
  club_access: {
    code: "club_access",
    name: "Accès via le club",
    tier: 1,
    monthlyPrice: 0,
    monthlyPriceNoCommitment: null,
    monthlyPriceConfirmed: true,
    monthlyCredits: 3,
    seasonPresences: 0,
    maxUsers: 1,
  },
  one_off: {
    code: "one_off",
    name: "Prestation unique",
    tier: 1,
    monthlyPrice: null,
    monthlyPriceNoCommitment: null,
    monthlyPriceConfirmed: true,
    monthlyCredits: 1,
    seasonPresences: 1,
    maxUsers: 2,
  },
};

/**
 * Libellé de prix court, une seule valeur — utilisé partout où un abonnement est déjà
 * souscrit (ex. ClubPlusDashboard : "49 € / mois · renouvellement le ..."). Affiche le
 * tarif "avec engagement 12 mois" par défaut. Jamais un montant inventé quand
 * monthlyPrice est null.
 */
export function formatPlanPrice(plan: PlanDefinition): string {
  if (plan.code === "full_communication") return "Sur devis";
  if (plan.code === "one_off") return "Facturé à la commande";
  if (plan.code === "club_access") return "Inclus dans l'offre du club";
  if (plan.monthlyPrice === null) return "Sur devis";
  return `${plan.monthlyPrice} € / mois`;
}

/**
 * Libellé de prix complet, avec les deux tarifs (engagement 12 mois / sans engagement)
 * quand les deux existent — utilisé uniquement à l'inscription, où le visiteur choisit
 * encore entre les deux, contrairement à un abonné déjà engagé (voir formatPlanPrice).
 */
export function formatPlanPriceRange(plan: PlanDefinition): string {
  if (plan.monthlyPrice !== null && plan.monthlyPriceNoCommitment !== null) {
    return `${plan.monthlyPrice} € / mois (12 mois) · ${plan.monthlyPriceNoCommitment} € sans engagement`;
  }
  return formatPlanPrice(plan);
}

/** Libellé de crédits prêt à afficher. "Prestation unique" n'a pas de jauge, il travaille « à la carte ». */
export function formatPlanCredits(plan: PlanDefinition): string {
  if (plan.monthlyCredits === null) return "Sur mesure";
  if (plan.monthlyCredits === 0) return "À la carte";
  return `${plan.monthlyCredits} crédits / mois`;
}
