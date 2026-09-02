// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.

// Supabase Edge Function — serve-os-html
//
// Solution de secours (02/09/2026) : le déploiement Netlify habituel de l'OS
// (bc6m3cgdz.sportvision-an.fr) est bloqué, crédits Netlify épuisés
// ("Account credit usage exceeded"). SportVision-OS-Full.html a été uploadé
// dans le bucket Storage public sportvision-os-hosting/index.html, mais
// Supabase Storage sert TOUT fichier HTML public avec
// `Content-Security-Policy: default-src 'none'; sandbox` (protection anti-XSS
// contre du contenu HTML arbitraire uploadé par un utilisateur) — la page
// s'affiche mais son propre JavaScript ne s'exécute jamais (sandbox sans
// allow-scripts). Cette fonction récupère le contenu brut depuis Storage et
// le resert avec un Content-Type/CSP normaux, comme le ferait n'importe quel
// hébergeur statique classique. Déployée avec --no-verify-jwt : doit être
// ouvrable directement dans un navigateur, sans en-tête Authorization.
//
// À retirer dès que le déploiement Netlify normal est débloqué (crédits
// ajoutés) — solution de contournement, pas la solution long terme.

const STORAGE_URL =
  "https://lulgezzpvrlbftbykzrc.supabase.co/storage/v1/object/public/sportvision-os-hosting/index.html";

Deno.serve(async () => {
  const upstream = await fetch(STORAGE_URL, { headers: { "Cache-Control": "no-cache" } });
  if (!upstream.ok) {
    return new Response("Impossible de charger l'OS depuis Storage.", { status: 502 });
  }
  const body = await upstream.text();
  return new Response(body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
});
