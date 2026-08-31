// Headers de sécurité définis ici plutôt que dans netlify.toml [[headers]] : vérifié en direct
// après déploiement (audit pré-lancement du 21/08) que le bloc [[headers]] de netlify.toml
// n'atteint pas les routes rendues par le Next Runtime (@netlify/plugin-nextjs) — seul next
// config `headers()` est fiable pour du SSR sur Netlify. Pas de fonts.googleapis.com ici :
// layout.tsx utilise next/font pour toutes ses polices, servies depuis le domaine propre au
// build. Le paiement/abonnement Stripe est une redirection pleine page (window.location.href),
// jamais un iframe/script embarqué — pas besoin d'autoriser de domaine Stripe ici.
// script-src : 'unsafe-eval' est ajouté UNIQUEMENT en dev (jamais en production, cf. valeur figée
// ci-dessous), même correctif que app-connect/next.config.js (audit du 31/08/2026). `next dev`
// empaquette chaque module avec eval() pour le Fast Refresh/HMR (devtool eval-source-map) — sans
// 'unsafe-eval', cet eval() est bloqué par la CSP et React n'hydrate JAMAIS silencieusement :
// aucun onClick/onSubmit ne se branche. Reproduit ici avec Playwright (pageerror "Evaluating a
// string as JavaScript violates ... script-src") avant même de pouvoir se connecter en local.
// `next build`/`next start` (et donc Netlify en production) n'utilisent pas eval() pour leurs
// bundles : ce correctif ne change rien à la CSP réellement servie en production.
const SCRIPT_SRC = process.env.NODE_ENV === "production" ? "'self' 'unsafe-inline'" : "'self' 'unsafe-inline' 'unsafe-eval'";

const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  {
    key: "Content-Security-Policy",
    value:
      // connect-src doit inclure wss:// en plus de https:// pour le même host : le SDK Supabase
      // Realtime (postgres_changes, voir lib/supabase/realtime.ts) ouvre un WebSocket vers
      // /realtime/v1/websocket, bloqué silencieusement par la CSP sans cette entrée séparée (une
      // URL https:// n'autorise pas automatiquement son équivalent wss://). Même bug reproduit et
      // corrigé côté app-connect (audit du 30/08/2026, compte Connect tout neuf) — jamais vérifié
      // ici jusqu'à cet audit, mais la CSP est strictement identique.
      `default-src 'self'; script-src ${SCRIPT_SRC}; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: https://lulgezzpvrlbftbykzrc.supabase.co; connect-src 'self' https://lulgezzpvrlbftbykzrc.supabase.co wss://lulgezzpvrlbftbykzrc.supabase.co; frame-src 'none'; object-src 'none'; base-uri 'self'`,
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  // 17/08/2026 — HANDOFF-CLUBPLUS.md § 5 préfixe toutes les routes conceptuelles en /clubplus/*
  // (ex. /clubplus/services). L'app est déjà servie sur son propre sous-domaine dédié
  // (clubplus.sportvision-an.fr) — le préfixe est donc redondant en pratique (clubplus.
  // sportvision-an.fr/clubplus/dashboard), signalé à Fouka qui a confirmé le vouloir quand même
  // pour rester strictement conforme au handoff. `basePath` préfixe automatiquement tout ce qui
  // passe par next/link et next/navigation (router.push, etc.) — voir les 2 exceptions qui ne le
  // sont PAS automatiquement : src/app/auth/forgot/page.tsx et signup/checkout/page.tsx
  // construisent une URL absolue via `window.location.origin` (raw browser API, jamais réécrite
  // par Next), corrigées pour inclure le préfixe à la main.
  basePath: "/clubplus",
  // `basePath` seul renvoie un 404 sur la racine véritable du domaine (vérifié en local : "/"
  // sort 404 une fois le basePath actif, alors que c'est la page que verrait n'importe qui
  // tapant clubplus.sportvision-an.fr) — jamais auto-redirigé par Next, il faut le déclarer
  // explicitement avec `basePath: false` sur la règle pour qu'elle s'applique à la vraie racine
  // plutôt qu'à "/clubplus" (qui, lui, redirige déjà correctement vers /clubplus/auth/login ou
  // /clubplus/dashboard via le middleware existant, inchangé).
  async redirects() {
    return [
      {
        source: "/",
        destination: "/clubplus",
        basePath: false,
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
