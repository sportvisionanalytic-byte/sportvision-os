// Tâche planifiée : réveille la synchronisation des calendriers une fois par nuit.
//
// Volontairement minuscule. Tout le travail (récupération, lecture, diff, écriture, journal) vit
// dans la route Next /api/calendar/cron, avec le même moteur que l'import manuel. Cette fonction
// ne fait que sonner à la porte, pour une raison précise : une fonction Netlify autonome n'aurait
// accès ni aux alias de chemin du projet Next ni à son bundle, et finirait par recevoir sa propre
// copie du moteur. C'est exactement le second moteur d'import qu'on refuse depuis le début.
//
// Configuration requise côté Netlify (Site settings → Environment variables) :
//   SUPABASE_SECRET_KEY    clé de service Supabase (écriture hors RLS, jamais exposée au client)
//   CALENDAR_CRON_SECRET   secret partagé entre cette fonction et la route
// Sans l'un des deux, la route répond 503 et rien ne s'exécute : une tâche d'écriture qui
// tournerait sans authentification serait pire que pas de tâche du tout.

export default async function handler() {
  const secret = process.env.CALENDAR_CRON_SECRET;
  if (!secret) {
    console.warn("[calendar-nightly] CALENDAR_CRON_SECRET absent, synchronisation ignorée.");
    return new Response("not configured", { status: 503 });
  }

  // URL du déploiement en cours, fournie par Netlify. On appelle le site par sa propre adresse
  // publique plutôt qu'une URL en dur : la fonction suit ainsi les previews et les changements de
  // domaine sans qu'on ait à y penser.
  const base = process.env.URL ?? process.env.DEPLOY_PRIME_URL;
  if (!base) {
    console.error("[calendar-nightly] URL du site introuvable.");
    return new Response("no site url", { status: 500 });
  }

  const response = await fetch(`${base}/clubplus/api/calendar/cron`, {
    method: "POST",
    headers: { "x-sportvision-cron": secret, "content-type": "application/json" },
    body: "{}",
  });

  const body = await response.text();
  console.log(`[calendar-nightly] ${response.status} ${body.slice(0, 500)}`);
  return new Response(body, { status: response.status });
}

// 04:30 UTC : après les mises à jour de fin de soirée des fédérations, avant que le premier
// dirigeant n'ouvre Club+ le matin.
// Pas d'import de type depuis "@netlify/functions" : le paquet n'est pas une dependance du
// projet et n'a pas a le devenir pour une seule signature. Netlify lit cet objet tel quel.
export const config = {
  schedule: "30 4 * * *",
};
