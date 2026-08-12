import type { Config } from "tailwindcss";

// Tokens exacts du design de référence : ../design-connect-personnel-12-08/README.md
// (section "Direction artistique"). Fond bleu nuit très sombre, surfaces vitrées, dégradé
// signature violet → bleu → cyan réservé aux CTA et aux éléments forts.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#09081A",
        "bg-elevated": "#0D0B22",
        "bg-elevated-accent": "#100C24",
        surface: "rgba(255,255,255,.05)",
        "surface-hover": "rgba(255,255,255,.09)",
        border: "rgba(255,255,255,.09)",
        "border-strong": "rgba(255,255,255,.16)",
        text: "#F7F7FB",
        "text-secondary": "#C7C7DE",
        "text-tertiary": "#9A9AB8",
        "text-faint": "#7A7A9C",
        "text-label": "#6C6C90",

        // Une couleur par pilier fonctionnel (README § Direction artistique).
        affiliations: { DEFAULT: "#22D3EE", bg: "rgba(34,211,238,.14)" },
        contenus: { DEFAULT: "#C084FC", bg: "rgba(168,85,247,.16)" },
        prestations: { DEFAULT: "#8CA9FF", bg: "rgba(79,125,255,.16)" },
        cotisations: { DEFAULT: "#F472B6", bg: "rgba(244,114,182,.14)" },
        attente: { DEFAULT: "#FBBF24", bg: "rgba(251,191,36,.14)" },
        danger: { DEFAULT: "#F472B6", bg: "rgba(244,114,182,.08)", border: "rgba(244,114,182,.4)" },
      },
      fontFamily: {
        sora: ["var(--font-sora)", "sans-serif"],
        sans: ["var(--font-dm-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-ibm-plex-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        sv: "16px",
        "sv-card": "22px",
        "sv-modal": "22px",
        "sv-pill": "999px",
      },
      backgroundImage: {
        "sv-gradient": "linear-gradient(120deg,#A855F7,#4F7DFF 55%,#22D3EE)",
        "sv-gradient-cotisation": "linear-gradient(90deg,#A855F7,#F472B6)",
        "sv-gradient-financee": "linear-gradient(90deg,#4F7DFF,#22D3EE)",
      },
      keyframes: {
        "sv-in": {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "none" },
        },
        "sv-sheet": {
          from: { transform: "translateY(100%)" },
          to: { transform: "none" },
        },
        "sv-fade": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "sv-spin": {
          to: { transform: "rotate(360deg)" },
        },
      },
      animation: {
        "sv-in": "sv-in 280ms ease both",
        "sv-sheet": "sv-sheet 260ms cubic-bezier(.22,1,.36,1) both",
        "sv-fade": "sv-fade 180ms ease both",
        "sv-spin": "sv-spin .7s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
