// SportVision OS (l'outil réel, données clients/finances réelles) ne doit être joignable QUE via
// son domaine privé (bc6m3cgdz.sportvision-an.fr, jamais publié nulle part) — demande explicite
// de Fouka le 21/08/2026 : "je ne veux pas qu'on puisse le trouver à moins que ça soit une
// personne membre de SV". Netlify sert toujours le contenu sur son sous-domaine par défaut
// (sportvision-os.netlify.app) en plus de tout domaine personnalisé — il n'existe pas de bascule
// simple pour le désactiver sur ce plan. Cette fonction Edge intercepte ce hostname par défaut et
// renvoie un 404 générique — SAUF sur /demo* : ce sont des pages de démonstration commerciale
// publiques (données factices, `noindex` mais volontairement partageables par lien direct avec
// des prospects/audits externes — voir audit-pack/SPORTVISION_OS_DEMO_URLS.md, dont l'URL de
// base documentée est justement sportvision-os.netlify.app) qui n'ont pas vocation à être
// cachées, contrairement au vrai OS. Ne touche jamais au domaine privé ni aux URLs de deploy
// preview (deploy-preview-N--sportvision-os.netlify.app, utiles en interne).
export default async (request, context) => {
  const host = request.headers.get("host") || "";
  const path = new URL(request.url).pathname;
  const isDemo = path === "/demo" || path.startsWith("/demo/");
  if (host === "sportvision-os.netlify.app" && !isDemo) {
    return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
  }
  return context.next();
};

export const config = { path: "/*" };
