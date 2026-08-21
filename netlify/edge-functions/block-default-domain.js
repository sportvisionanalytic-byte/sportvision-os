// SportVision OS ne doit être joignable QUE via son domaine privé
// (bc6m3cgdz.sportvision-an.fr, jamais publié nulle part) — demande explicite de Fouka le
// 21/08/2026 : "je ne veux pas qu'on puisse le trouver à moins que ça soit une personne membre
// de SV". Netlify sert toujours le contenu sur son sous-domaine par défaut
// (sportvision-os.netlify.app) en plus de tout domaine personnalisé — il n'existe pas de bascule
// simple pour le désactiver sur ce plan. Cette fonction Edge intercepte spécifiquement ce
// hostname par défaut et renvoie un 404 générique, sans jamais toucher au domaine privé ni aux
// URLs de deploy preview (deploy-preview-N--sportvision-os.netlify.app, utiles en interne).
export default async (request, context) => {
  const host = request.headers.get("host") || "";
  if (host === "sportvision-os.netlify.app") {
    return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
  }
  return context.next();
};

export const config = { path: "/*" };
