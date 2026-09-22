// L'identite visuelle de SportVision, telle qu'elle existe deja sur Connect (22/09/2026).
//
// Reprise des variables du site plutot qu'inventee : une application qui ne ressemble pas au site
// donne l'impression de deux produits differents, et c'est le premier reproche qu'on fait a une
// application refaite. Les valeurs viennent de app-connect/src/app/globals.css.
export const C = {
  fond: "#070B18",
  surface: "#0E1424",
  surfaceHaute: "#141C30",
  bordure: "rgba(255,255,255,.09)",
  bordureForte: "rgba(255,255,255,.16)",

  texte: "#F2F4FF",
  texteDoux: "#A9B4D0",
  texteFaible: "#6E7C9E",

  // Le degrade SportVision, du violet au cyan. Sert aux actions principales, jamais au decor.
  accent: "#4F7DFF",
  accentClair: "#8CA9FF",
  violet: "#8B5CF6",
  cyan: "#22D3EE",

  succes: "#2ECC8A",
  alerte: "#E8A33D",
  danger: "#F0445E",
} as const;

export const R = { s: 10, m: 14, l: 18, pill: 999 } as const;
export const E = { xs: 6, s: 10, m: 14, l: 20, xl: 28 } as const;
