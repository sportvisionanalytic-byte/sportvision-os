// Headers de sécurité définis ici plutôt que dans netlify.toml [[headers]] : vérifié en direct
// après déploiement (audit pré-lancement du 21/08) que le bloc [[headers]] de netlify.toml
// n'atteint pas les routes rendues par le Next Runtime (@netlify/plugin-nextjs) — seul next
// config `headers()` est fiable pour du SSR sur Netlify. font-src/style-src incluent
// fonts.googleapis.com/fonts.gstatic.com car layout.tsx charge Material Symbols via un <link>
// direct (pas next/font) — voir INC-011, la CSP a déjà cassé des Google Fonts par le passé sur
// un autre site de ce projet. Le paiement Stripe est une redirection pleine page
// (window.location.href), jamais un iframe/script embarqué — pas besoin d'autoriser de domaine
// Stripe ici.
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  {
    key: "Content-Security-Policy",
    value:
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://lulgezzpvrlbftbykzrc.supabase.co; connect-src 'self' https://lulgezzpvrlbftbykzrc.supabase.co; frame-src 'none'; object-src 'none'; base-uri 'self'",
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
