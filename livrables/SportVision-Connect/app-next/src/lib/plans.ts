import type { PlanCode } from "./types";

// Catalogue d'offres — source de vérité unique. Voir DATA_MODEL.md § Plan.
// Confirmé par le client : crédits 0 / 10 / 40, et Full Communication sur devis.
// Non confirmé : les montants mensuels 190 / 390 / 690 € sont une hypothèse de la maquette.

export interface PlanDefinition {
  code: PlanCode;
  name: string;
  tier: 1 | 2 | 3;
  /** null = « sur devis » ou « à la commande » : l'interface affiche le libellé, pas un montant. */
  monthlyPrice: number | null;
  monthlyPriceConfirmed: boolean;
  /** null = « sur mesure » (Full Communication). */
  monthlyCredits: number | null;
  seasonPresences: number;
  /** null = illimité. */
  maxUsers: number | null;
}

export const PLANS: Record<PlanCode, PlanDefinition> = {
  essentiel: {
    code: "essentiel",
    name: "Essentiel",
    tier: 1,
    monthlyPrice: 190,
    monthlyPriceConfirmed: false,
    monthlyCredits: 0,
    seasonPresences: 0,
    maxUsers: 3,
  },
  club_plus_start: {
    code: "club_plus_start",
    name: "Club+ Start",
    tier: 2,
    monthlyPrice: 390,
    monthlyPriceConfirmed: false,
    monthlyCredits: 10,
    seasonPresences: 2,
    maxUsers: 8,
  },
  club_plus_performance: {
    code: "club_plus_performance",
    name: "Club+ Performance",
    tier: 2,
    monthlyPrice: 690,
    monthlyPriceConfirmed: false,
    monthlyCredits: 40,
    seasonPresences: 5,
    maxUsers: null,
  },
  full_communication: {
    code: "full_communication",
    name: "Full Communication",
    tier: 3,
    monthlyPrice: null,
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
    monthlyPriceConfirmed: true,
    monthlyCredits: 1,
    seasonPresences: 1,
    maxUsers: 2,
  },
};

/** Libellé de prix prêt à afficher. Jamais un montant quand monthlyPrice est null. */
export function formatPlanPrice(plan: PlanDefinition): string {
  if (plan.code === "full_communication") return "Sur devis";
  if (plan.code === "one_off") return "Facturé à la commande";
  if (plan.code === "club_access") return "Inclus dans l'offre du club";
  return `${plan.monthlyPrice} € / mois`;
}

/** Libellé de crédits prêt à afficher. Essentiel n'a pas de jauge, il travaille « à la carte ». */
export function formatPlanCredits(plan: PlanDefinition): string {
  if (plan.monthlyCredits === null) return "Sur mesure";
  if (plan.monthlyCredits === 0) return "À la carte";
  return `${plan.monthlyCredits} crédits / mois`;
}
