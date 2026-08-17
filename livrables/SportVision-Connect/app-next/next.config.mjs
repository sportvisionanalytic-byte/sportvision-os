/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
