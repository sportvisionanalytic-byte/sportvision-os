// Protection d'accès du Review Hub (et, à terme, des apps Review).
// noindex empêche seulement l'indexation par les moteurs — ceci empêche
// l'accès lui-même. Mot de passe lu depuis une variable d'environnement
// Netlify (jamais commit, jamais présente dans le HTML/JS servi au client).
//
// Pour configurer : `netlify env:set REVIEW_HUB_PASSWORD "..."` (voir
// instructions transmises séparément — cette valeur n'est jamais demandée
// ni vue par Claude).

export default async (request: Request) => {
  const expectedPassword = Netlify.env.get("REVIEW_HUB_PASSWORD");

  // Pas de mot de passe configuré : on bloque par défaut plutôt que de
  // laisser le hub grand ouvert (fail closed, pas fail open).
  if (!expectedPassword) {
    return new Response("Review Hub : accès non configuré.", { status: 503 });
  }

  const expectedUser = Netlify.env.get("REVIEW_HUB_USER") || "review";
  const authHeader = request.headers.get("authorization") || "";
  const expected = "Basic " + btoa(`${expectedUser}:${expectedPassword}`);

  if (authHeader !== expected) {
    return new Response("Authentification requise — SportVision Review Hub.", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="SportVision Review", charset="UTF-8"' },
    });
  }

  // Pas de return : laisse passer la requête vers le fichier statique demandé.
};

export const config = { path: "/*" };
