// La charte SportVision, celle du site vitrine (22/09/2026).
//
// L'application partait des couleurs de Connect (#4F7DFF, #22D3EE, #8B5CF6). Elles sont proches,
// mais ce ne sont pas celles de la marque : le site, les devis et les livrables utilisent le bleu
// #2454FF et son dégradé vers le cyan puis le violet. Une application qui ne porte pas le bleu de
// la marque donne l'impression d'un produit voisin, et c'est exactement le reproche qui nous a été
// fait en relecture. Les valeurs ci-dessous sont copiées du site, pas réinventées.
export const C = {
  fond: "#070A17",
  surface: "#0E1426",
  surfaceHaute: "#141C33",
  bordure: "rgba(255,255,255,.10)",
  bordureForte: "rgba(255,255,255,.20)",

  texte: "#FFFFFF",
  // Contrastes relevés le 22/09 : le gris d'avant (#A9B4D0, #6E7C9E) passait sous le seuil
  // lisible sur fond nuit, sur les dates et les lieux — c'est-à-dire précisément ce qu'on vient
  // lire. Ces deux valeurs tiennent le 4,5:1 sur #070A17.
  texteDoux: "#B6C0D9",
  texteFaible: "#8491AF",

  // Le bleu de la marque, et ses deux accents. Le dégradé va du bleu au cyan puis au violet vif.
  accent: "#2454FF",
  accentClair: "#1686FF",
  cyan: "#00C7FF",
  violet: "#832DFF",
  violetVif: "#C337FF",

  succes: "#12B76A",
  alerte: "#E8A33D",
  danger: "#F0445E",
} as const;

/** Le dégradé de marque, dans l'ordre du site : bleu, cyan, violet vif. */
export const DEGRADE = [C.accent, C.cyan, C.violetVif] as const;
/** Une version discrète, pour les liserés : on lit le texte par-dessus. */
export const DEGRADE_DOUX = ["rgba(36,84,255,.55)", "rgba(0,199,255,.28)", "rgba(195,55,255,.42)"] as const;

/** Les rayons du site : 16 pour une carte, 24 pour un bloc pleine largeur. */
export const R = { s: 10, m: 14, l: 16, xl: 24, pill: 999 } as const;
export const E = { xs: 6, s: 10, m: 14, l: 20, xl: 28 } as const;

/** La hauteur minimale d'une zone que l'on touche. En dessous, le doigt rate. */
export const TOUCHE = 44;
