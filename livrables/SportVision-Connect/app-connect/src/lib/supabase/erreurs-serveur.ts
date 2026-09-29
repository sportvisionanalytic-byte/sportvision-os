// Ce que la personne lit quand une Edge Function refuse.
//
// ── POURQUOI CE FICHIER EXISTE (29/09/2026) ──
//
// `connect-player-onboarding` écrit ses refus en français, pour être lus, et certains contiennent la
// seule marche à suivre possible :
//
//   « Votre club a déjà une fiche à ce nom. Pour la rattacher à votre compte, demandez le code
//     d'invitation de votre équipe à votre coach ou au club, puis utilisez « J'ai un code ». »
//
// C'est le cas le plus fréquent chez un vrai club partenaire : le club importe son effectif, puis le
// joueur crée son compte et clique « Rejoindre ce club ». L'écran d'ajout de club remplaçait cette
// phrase par « Impossible de rejoindre ce club pour le moment. Réessayez dans un instant. » — une
// impasse complète : réessayer ne marchera jamais, et rien n'indique que la porte s'appelle « J'ai un
// code ». Même chose pour « Trop de tentatives. Réessayez dans une heure. », annoncée comme « dans un
// instant », et pour « Adresse e-mail non confirmée », qui n'apparaissait nulle part.
//
// ── LE PIÈGE TECHNIQUE ──
//
// La fonction répond `json({ error: "…" }, 500)`. Sur une réponse non-2xx, supabase-js ne met RIEN
// dans `data` et réduit l'erreur au message générique « Edge Function returned a non-2xx status
// code » : le vrai texte n'est plus que dans la Response brute, portée par `error.context`. Il faut
// donc la lire, et c'est précisément ce que personne ne faisait. Même garde que
// `envoyerInvitationParEmail` dans Club+, découverte de la même façon.

/** Le message écrit par la fonction, ou `repli` s'il n'y en a pas d'exploitable.
 *
 *  `donnees` est le corps JSON d'une réponse 2xx (la fonction peut y mettre `error`), `erreur` est
 *  l'objet d'erreur de `functions.invoke`. On passe les deux : selon le code HTTP, l'un des deux est
 *  vide, et l'appelant n'a pas à savoir lequel. */
export async function messageErreurFonction(
  erreur: unknown,
  donnees: unknown,
  repli: string,
): Promise<string> {
  const depuisDonnees = (donnees as { error?: unknown } | null | undefined)?.error;
  if (typeof depuisDonnees === "string" && depuisDonnees.trim()) return nettoyer(depuisDonnees, repli);

  const contexte = (erreur as { context?: unknown } | null | undefined)?.context;
  if (contexte instanceof Response) {
    try {
      // `clone()` : le corps d'une Response ne se lit qu'une fois, et l'appelant peut en avoir besoin.
      const corps = await contexte.clone().json();
      const message = (corps as { error?: unknown } | null)?.error;
      if (typeof message === "string" && message.trim()) return nettoyer(message, repli);
    } catch {
      // Corps vide, HTML d'une passerelle, JSON tronqué : le repli de l'écran est plus honnête
      // qu'un fragment de réponse.
    }
  }
  return repli;
}

/**
 * Le message d'une fonction SQL (RPC), même règle et même raison que ci-dessus.
 *
 * Les fonctions de consentement biométrique en sont l'exemple le plus net : « Avant 15 ans, cet
 * accord doit être donné par un parent. Invitez le vôtre depuis votre espace : il pourra l'accorder
 * en un clic. » (v226), « Cinq photos de référence suffisent. Retirez-en une avant d'en ajouter une
 * autre. » (v332). L'écran de reconnaissance affichait « Réessayez, et écrivez-nous si cela se
 * reproduit » par-dessus : un sportif de 13 ans réessayait un geste qui ne pouvait jamais aboutir,
 * et n'apprenait jamais qu'il devait inviter son parent.
 */
export function messageErreurBase(erreur: unknown, repli: string): string {
  const message = (erreur as { message?: unknown } | null | undefined)?.message;
  if (typeof message !== "string" || !message.trim()) return repli;
  return nettoyer(message, repli);
}

/** Un refus de règle métier passe, une panne retombe sur le repli. Une phrase de Postgres ou du
 *  moteur JavaScript ne dit rien d'utile à une famille, et l'afficher ne ferait que l'inquiéter. */
function nettoyer(message: string, repli: string): string {
  if (
    /^(TypeError|Failed to fetch|Load failed|NetworkError|JSON|column |relation |function |duplicate key|permission denied|new row violates|violates )/i.test(
      message,
    )
  ) {
    return repli;
  }
  return message;
}
