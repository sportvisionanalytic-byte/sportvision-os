// URLs publiques des pages légales — hébergées sur le site vitrine (livrables/SportVision),
// pas dans cette app. Même constante que app-connect/src/lib/legal-links.ts (dupliquée à
// l'identique plutôt que partagée : app-next et app-connect sont deux apps Next.js séparées,
// sans package commun entre elles dans ce repo).
export const VITRINE_ORIGIN = "https://sportvision-an.fr";

export const LEGAL_URLS = {
  cgv: `${VITRINE_ORIGIN}/cgv`,
  confidentialite: `${VITRINE_ORIGIN}/confidentialite`,
  mentionsLegales: `${VITRINE_ORIGIN}/mentions-legales`,
} as const;
