// Timeline "Mes commandes" — voir design-connect-personnel-12-08/README.md § Espace joueur →
// Mes commandes : "En validation → Confirmée → Planifiée → En production → Livrée → Terminée
// (branche Annulée)". `prestations.statut` (CHECK réel en base, migration-prestations-
// transitions-statut.sql) a ~25 valeurs internes destinées au staff (à_qualifier,
// offre_en_préparation, devis_envoyé, équipe_affectée, médias_à_transférer...) — ce fichier les
// regroupe dans les 6 étapes du vocabulaire client, sur le même principe de compression déjà
// utilisé par app-next/src/lib/data/projet/services.ts (STATUS_MAP), mais retargeté sur le
// vocabulaire à 6 étapes de CE brief plutôt que le vocabulaire à 10 statuts de l'Espace Projet.

export type OrderStage = "en_validation" | "confirmee" | "planifiee" | "en_production" | "livree" | "terminee" | "annulee";

export const STAGE_LABEL: Record<OrderStage, string> = {
  en_validation: "En validation",
  confirmee: "Confirmée",
  planifiee: "Planifiée",
  en_production: "En production",
  livree: "Livrée",
  terminee: "Terminée",
  annulee: "Annulée",
};

// Réutilise les tokens Tailwind déjà définis (tailwind.config.ts) — aucune couleur inventée.
export const STAGE_COLOR: Record<OrderStage, { fg: string; bg: string }> = {
  en_validation: { fg: "#FBBF24", bg: "rgba(251,191,36,.14)" }, // attente
  confirmee: { fg: "#22D3EE", bg: "rgba(34,211,238,.14)" }, // affiliations
  planifiee: { fg: "#8CA9FF", bg: "rgba(79,125,255,.16)" }, // prestations
  en_production: { fg: "#C084FC", bg: "rgba(168,85,247,.16)" }, // contenus
  livree: { fg: "#F472B6", bg: "rgba(244,114,182,.14)" }, // cotisations
  terminee: { fg: "#9A9AB8", bg: "rgba(255,255,255,.07)" }, // text-tertiary
  annulee: { fg: "#F472B6", bg: "rgba(244,114,182,.08)" }, // danger
};

/** Ordre d'affichage de la timeline (branche "annulee" à part, jamais insérée dans la ligne). */
export const TIMELINE_STAGES: OrderStage[] = ["en_validation", "confirmee", "planifiee", "en_production", "livree", "terminee"];

const RAW_TO_STAGE: Record<string, OrderStage> = {
  "demande_reçue": "en_validation",
  "à_qualifier": "en_validation",

  "offre_en_préparation": "confirmee",
  "devis_envoyé": "confirmee",
  "en_attente_réponse": "confirmee",
  "devis_accepté": "confirmee",
  "en_attente_signature": "confirmee",
  "en_attente_acompte": "confirmee",
  "documents_complets": "confirmee",

  "à_valider_production": "planifiee",
  "confirmée": "planifiee",
  "à_planifier": "planifiee",
  "planifiée": "planifiee",
  "équipe_affectée": "planifiee",
  "prête": "planifiee",
  "équipe_en_route": "planifiee",
  "arrivée_sur_place": "planifiee",

  "production_démarrée": "en_production",
  "production_terminée": "en_production",
  "médias_à_transférer": "en_production",
  "médias_complets": "en_production",
  "à_monter": "en_production",
  "montage_en_cours": "en_production",
  "prêt_validation": "en_production",
  "à_valider_client": "en_production",

  "prête_à_livrer": "livree",
  "livrée": "livree",

  "facturée": "terminee",
  "partiellement_payée": "terminee",
  "payée": "terminee",
  "clôturée": "terminee",

  "annulée": "annulee",
  "refusée": "annulee",
};

export function stageFromStatut(statut: string): OrderStage {
  return RAW_TO_STAGE[statut] ?? "en_validation";
}

export type OrderBucket = "a_venir" | "en_cours" | "terminees" | "annulees";

export function bucketFromStage(stage: OrderStage): OrderBucket {
  if (stage === "annulee") return "annulees";
  if (stage === "livree" || stage === "terminee") return "terminees";
  if (stage === "en_production") return "en_cours";
  return "a_venir"; // en_validation, confirmee, planifiee
}

export const BUCKET_LABEL: Record<OrderBucket, string> = {
  a_venir: "À venir",
  en_cours: "En cours",
  terminees: "Terminées",
  annulees: "Annulées",
};
