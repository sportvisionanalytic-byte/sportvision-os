// Le chemin où ramener quelqu'un après une confirmation d'e-mail ou une connexion (`?next=`).
//
// Il n'existe qu'une raison de s'en servir aujourd'hui : ramener un encadrant invité sur SON
// invitation (/rejoindre?token=…) après qu'il a confirmé son adresse ou s'est connecté — sinon il
// atterrit sur un tableau de bord qui ne sait rien de l'invitation (audit du 10/09/2026).
//
// Un `next` venu de l'URL est une donnée hostile tant qu'il n'est pas vérifié : « //site.fr » ou
// « /\site.fr » sont lus par le navigateur comme une autre origine, et une page de connexion qui
// redirige où on lui dit devient un relais d'hameçonnage. On n'accepte donc qu'un chemin interne,
// SANS le préfixe /clubplus (le routeur l'ajoute lui-même ; les rares redirections construites à
// la main l'ajoutent explicitement).
export function cheminInterneSur(brut: string | null | undefined): string | null {
  if (!brut) return null;
  const chemin = brut.trim();
  if (!chemin.startsWith("/") || chemin.startsWith("//") || chemin.startsWith("/\\")) return null;
  // Espaces et caractères de contrôle : certains navigateurs les suppriment avant d'interpréter
  // l'URL, ce qui peut transformer « /<tab>/site.fr » en « //site.fr ».
  if (/\s/.test(chemin) || [...chemin].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) return null;
  // Un lien déjà préfixé (copié depuis la barre d'adresse) : on retire le préfixe plutôt que de le
  // doubler en /clubplus/clubplus/….
  const sansPrefixe =
    chemin === "/clubplus" ? "/" : chemin.startsWith("/clubplus/") ? chemin.slice("/clubplus".length) : chemin;
  // Revenir sur l'écran de connexion ou sur ce même rebond ferait tourner en rond.
  if (/^\/auth\/(login|callback|confirming)/.test(sansPrefixe)) return null;
  return sansPrefixe;
}
