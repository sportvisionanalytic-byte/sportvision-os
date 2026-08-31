// Headers de sécurité définis ici plutôt que dans netlify.toml [[headers]] : vérifié en direct
// après déploiement (audit pré-lancement du 21/08) que le bloc [[headers]] de netlify.toml
// n'atteint pas les routes rendues par le Next Runtime (@netlify/plugin-nextjs) — seul next
// config `headers()` est fiable pour du SSR sur Netlify. font-src/style-src incluent
// fonts.googleapis.com/fonts.gstatic.com car layout.tsx charge Material Symbols via un <link>
// direct (pas next/font) — voir INC-011, la CSP a déjà cassé des Google Fonts par le passé sur
// un autre site de ce projet. Le paiement Stripe est une redirection pleine page
// (window.location.href), jamais un iframe/script embarqué — pas besoin d'autoriser de domaine
// Stripe ici.
//
// 'unsafe-eval' en développement uniquement (audit du 31/08/2026) : cette CSP s'applique à
// TOUTES les routes, y compris sous `next dev` — sans 'unsafe-eval', le runtime React Refresh
// de webpack (qui s'appuie sur eval() pour le hot-reload en dev) est bloqué par le navigateur,
// ce qui casse silencieusement l'hydratation de TOUT composant client testé via `npm run dev`
// (aucune erreur visible sauf un pageerror CSP en console) : les inputs contrôlés affichent bien
// ce qui est tapé au clavier (comportement natif du DOM, indépendant de React) mais React ne
// reçoit jamais l'événement onChange, donc aucun state ne bouge — trouvé en testant le montant
// de /cotisation/[token] (le bouton "Participer" restait bloqué à "0 €" quel que soit le montant
// tapé). `next build`/`next start` (et donc Netlify en production) n'utilisent pas eval() pour
// leurs bundles : ce correctif ne change donc RIEN à la CSP réellement servie en production.
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
      `default-src 'self'; script-src 'self' 'unsafe-inline'${process.env.NODE_ENV !== "production" ? " 'unsafe-eval'" : ""}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://lulgezzpvrlbftbykzrc.supabase.co; connect-src 'self' https://lulgezzpvrlbftbykzrc.supabase.co wss://lulgezzpvrlbftbykzrc.supabase.co; frame-src 'none'; object-src 'none'; base-uri 'self'`,
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
