// Headers de sécurité définis ici plutôt que dans netlify.toml [[headers]] : vérifié en direct
// après déploiement (audit pré-lancement du 21/08) que le bloc [[headers]] de netlify.toml
// n'atteint pas les routes rendues par le Next Runtime (@netlify/plugin-nextjs) — seul next
// config `headers()` est fiable pour du SSR sur Netlify. font-src/style-src incluent
// fonts.googleapis.com/fonts.gstatic.com car layout.tsx charge Material Symbols via un <link>
// direct (pas next/font) — voir INC-011, la CSP a déjà cassé des Google Fonts par le passé sur
// un autre site de ce projet. Le paiement Stripe est une redirection pleine page
// (window.location.href), jamais un iframe/script embarqué — pas besoin d'autoriser de domaine
// Stripe ici.
// script-src : 'unsafe-eval' est ajouté UNIQUEMENT en dev (jamais en production, cf. valeur figée
// ci-dessous). `next dev` empaquette chaque module avec eval() pour le Fast Refresh/HMR (devtool
// eval-source-map) — sans 'unsafe-eval', cet eval() est bloqué par la CSP et React n'hydrate
// JAMAIS silencieusement : aucun onClick/onSubmit ne se branche, un clic sur un <button
// type="submit"> retombe sur la soumission native du <form> (rechargement complet de la page).
// Trouvé le 31/08/2026 en auditant Connect avec Playwright en local : "Se connecter" semblait ne
// rien faire (aucune requête d'auth, 0 cookie posé) alors que la même action fonctionne en
// production (voir connect.sportvision-an.fr) — le build de prod n'utilise pas eval(), donc la CSP
// stricte y est sans danger. process.env.NODE_ENV vaut "production" pour `next build`/`next start`
// (et pour le déploiement Netlify), "development" uniquement pour `next dev`.
const SCRIPT_SRC = process.env.NODE_ENV === "production" ? "'self' 'unsafe-inline'" : "'self' 'unsafe-inline' 'unsafe-eval'";

const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  {
    key: "Content-Security-Policy",
    value:
      // connect-src doit inclure le schéma wss:// en plus de https:// : le SDK Supabase Realtime
      // (postgres_changes, ex. NotificationBell.tsx) ouvre un WebSocket vers /realtime/v1/websocket,
      // bloqué silencieusement par la CSP sans cette entrée séparée (une URL https:// n'autorise
      // pas automatiquement son équivalent wss://). Trouvé en testant en réel un compte Connect
      // tout neuf (audit du 30/08/2026) : erreur console "violates ... connect-src" + pageerror
      // "cannot add postgres_changes callbacks ... after subscribe()" dès l'arrivée sur le dashboard.
      `default-src 'self'; script-src ${SCRIPT_SRC}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://lulgezzpvrlbftbykzrc.supabase.co; connect-src 'self' https://lulgezzpvrlbftbykzrc.supabase.co wss://lulgezzpvrlbftbykzrc.supabase.co; frame-src 'none'; object-src 'none'; base-uri 'self'`,
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

module.exports = nextConfig;
