// URLs publiques des pages légales — hébergées sur le site vitrine (livrables/SportVision),
// pas dans cette app. Chemins "propres" (redirects Netlify vers *.html, voir netlify.toml
// de la vitrine), cohérents avec ce que la vitrine utilise déjà en interne.
export const VITRINE_ORIGIN = "https://sportvision-an.fr";

export const LEGAL_URLS = {
  cgv: `${VITRINE_ORIGIN}/cgv`,
  confidentialite: `${VITRINE_ORIGIN}/confidentialite`,
  mentionsLegales: `${VITRINE_ORIGIN}/mentions-legales`,
} as const;
