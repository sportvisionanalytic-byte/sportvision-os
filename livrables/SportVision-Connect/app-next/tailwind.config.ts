import type { Config } from "tailwindcss";

// Tokens exacts issus de ../../context/import/SportVision-Connect-Design/CHARTE.md.
// Les tokens thématisés (bg, surface, text, border...) sont des variables CSS définies
// dans src/app/globals.css pour :root (sombre, défaut) et [data-theme="light"].
// Les tokens de marque sont fixes dans les deux thèmes.

const config: Config = {
  darkMode: ["selector", '[data-theme="dark"]'],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--sv-bg)",
        "bg-alt": "var(--sv-bg-alt)",
        surface: "var(--sv-surface)",
        "surface-alt": "var(--sv-surface-alt)",
        "surface-sunken": "var(--sv-surface-sunken)",
        elevated: "var(--sv-elevated)",
        border: "var(--sv-border)",
        "border-strong": "var(--sv-border-strong)",
        divider: "var(--sv-divider)",
        text: "var(--sv-text)",
        "text-soft": "var(--sv-text-soft)",
        "text-secondary": "var(--sv-text-secondary)",
        "text-faint": "var(--sv-text-faint)",
        "row-hover": "var(--sv-row-hover)",
        "input-bg": "var(--sv-input-bg)",

        // Chrome — reste #070A17 dans les deux thèmes, jamais lié au token de fond de page.
        chrome: "#070A17",

        // Marque — identique dans les deux thèmes.
        brand: {
          blue: "#2454FF",
          "blue-electric": "#1686FF",
          cyan: "#00C8FF",
          violet: "#832DFF",
          "violet-light": "#C337FF",
          "blue-pale": "#8FB4FF",
        },

        // Sémantique — paires fond/texte thématisées via variables CSS.
        success: { bg: "var(--sv-success-bg)", fg: "var(--sv-success-fg)" },
        warning: { bg: "var(--sv-warning-bg)", fg: "var(--sv-warning-fg)" },
        danger: { bg: "var(--sv-danger-bg)", fg: "var(--sv-danger-fg)" },
        info: { bg: "var(--sv-info-bg)", fg: "var(--sv-info-fg)" },
        accent: { bg: "var(--sv-accent-bg)", fg: "var(--sv-accent-fg)" },
        cyan: { bg: "var(--sv-cyan-bg)", fg: "var(--sv-cyan-fg)" },
        neutral: { bg: "var(--sv-neutral-bg)", fg: "var(--sv-neutral-fg)" },

        due: "var(--sv-due)",
        "due-warn": "var(--sv-due-warn)",
        "due-late": "var(--sv-due-late)",
        "due-muted": "var(--sv-due-muted)",
      },
      fontFamily: {
        sans: ["var(--font-plus-jakarta-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        sv: "12px",
        "sv-card": "16px",
        "sv-panel": "18px",
        "sv-modal": "22px",
      },
      boxShadow: {
        "sv-card": "var(--sv-shadow-card)",
        "sv-card-hover": "var(--sv-shadow-card-hover)",
        "sv-dropdown": "var(--sv-shadow-dropdown)",
        "sv-modal": "var(--sv-shadow-modal)",
        "sv-panel": "var(--sv-shadow-panel)",
        "sv-button": "0 8px 20px -10px rgba(36,84,255,.8)",
      },
      transitionDuration: {
        sv: "160ms",
      },
      keyframes: {
        svfade: {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "none" },
        },
        svshimmer: {
          "0%": { backgroundPosition: "-420px 0" },
          "100%": { backgroundPosition: "420px 0" },
        },
        svpulse: {
          "0%, 100%": { opacity: ".45" },
          "50%": { opacity: "1" },
        },
      },
      animation: {
        svfade: "svfade 160ms ease both",
        svshimmer: "svshimmer 1.3s linear infinite",
        svpulse: "svpulse 2.2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
