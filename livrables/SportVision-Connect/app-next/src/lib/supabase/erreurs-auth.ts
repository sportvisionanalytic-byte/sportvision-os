// Les réponses de Supabase Auth, traduites pour la personne qui crée son compte.
//
// ── Pourquoi ce fichier ──
// Audit des créations de compte du 10/09/2026 : chaque écran d'inscription affichait
// `error.message` tel quel. Supabase répond en anglais et en termes techniques — un coach invité
// lisait « Invalid login credentials », « Email not confirmed », « Password should be at least 8
// characters. » ou « email rate limit exceeded » au moment précis où il essayait d'entrer dans son
// club. Pire, l'écran de connexion répondait « Identifiants incorrects » à quelqu'un dont le mot de
// passe était juste mais l'adresse pas encore confirmée : il allait réinitialiser un mot de passe
// qui n'avait rien de faux.
//
// On lit le `code` d'erreur (stable, documenté par Supabase) avant le texte, qui peut changer d'une
// version à l'autre. Tout ce qui n'est pas reconnu retombe sur le repli de l'écran, toujours en
// français : on préfère un message général à une phrase anglaise.
//
// ── Ce qu'on ne dit jamais ──
// `email_not_confirmed` n'est renvoyé par Supabase que si le mot de passe est BON (mesuré le
// 10/09/2026 : mauvais mot de passe sur un compte non confirmé → `invalid_credentials`). Le
// distinguer ne révèle donc rien à quelqu'un qui ne connaît pas le mot de passe.

type ErreurAuth = { code?: unknown; status?: unknown; message?: unknown; name?: unknown } | null | undefined;

export const MESSAGE_MOT_DE_PASSE_COURT = "Le mot de passe doit contenir au moins 8 caractères.";

export function messageErreurAuth(e: unknown, repli: string): string {
  const err = e as ErreurAuth;
  const code = typeof err?.code === "string" ? err.code : "";
  const status = typeof err?.status === "number" ? err.status : 0;
  const message = typeof err?.message === "string" ? err.message : "";

  if (code === "invalid_credentials" || /invalid login credentials/i.test(message)) {
    return "Adresse e-mail ou mot de passe incorrect.";
  }
  if (code === "email_not_confirmed" || /email not confirmed/i.test(message)) {
    return "Votre adresse e-mail n'est pas encore confirmée. Ouvrez l'e-mail de confirmation SportVision (pensez aux courriers indésirables), cliquez sur le lien, puis reconnectez-vous.";
  }
  if (code === "weak_password" || /password should (be|contain)/i.test(message)) {
    return MESSAGE_MOT_DE_PASSE_COURT;
  }
  if (code === "same_password" || /should be different from the old password/i.test(message)) {
    return "Le nouveau mot de passe doit être différent de l'ancien.";
  }
  if (code === "user_already_exists" || code === "email_exists" || /already (been )?registered/i.test(message)) {
    return "Un compte existe déjà avec cette adresse e-mail. Connectez-vous avec son mot de passe.";
  }
  if (code === "email_address_invalid" || /unable to validate email address|invalid format/i.test(message)) {
    return "Cette adresse e-mail n'est pas valide.";
  }
  // « For security purposes, you can only request this after 37 seconds. » : un second envoi trop
  // rapproché du premier pour la même adresse (double clic, ou retour sur l'écran).
  const attente = message.match(/only request this after (\d+) seconds?/i);
  if (attente) {
    return `Pour des raisons de sécurité, patientez ${attente[1]} secondes avant de réessayer.`;
  }
  // Le plafond d'e-mails du projet (partagé par Connect, Club+ et l'OS, 15 par heure au
  // 10/09/2026) : l'adresse n'y est pour rien, la personne doit simplement réessayer plus tard. On le
  // dit, plutôt qu'un « échec » qui laisse croire que son adresse est refusée.
  if (code === "over_email_send_rate_limit" || /email rate limit/i.test(message)) {
    return "Trop d'e-mails ont été envoyés en peu de temps par SportVision. Votre adresse n'est pas en cause : réessayez dans quelques minutes.";
  }
  if (code === "over_request_rate_limit" || status === 429 || /rate limit|too many requests/i.test(message)) {
    return "Trop de tentatives en peu de temps. Patientez quelques minutes, puis réessayez.";
  }
  if (code === "signup_disabled" || /signups? not allowed/i.test(message)) {
    return "La création de compte est momentanément fermée. Contactez SportVision.";
  }
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(message) || err?.name === "AuthRetryableFetchError") {
    return "Connexion au serveur impossible. Vérifiez votre connexion internet, puis réessayez.";
  }
  return repli;
}

/**
 * Supabase ne dit JAMAIS « ce compte existe déjà » à une inscription quand la confirmation
 * d'e-mail est active : pour ne pas révéler quelles adresses sont inscrites, il renvoie un faux
 * utilisateur, sans session, avec une liste d'identités VIDE — et n'envoie aucun e-mail (mesuré le
 * 10/09/2026). Les écrans affichaient donc « vérifiez vos e-mails » à quelqu'un qui n'en recevrait
 * jamais : typiquement un parent déjà inscrit sur Connect, invité comme coach dans Club+.
 *
 * La liste vide est le seul signal fiable. Un vrai nouveau compte a toujours une identité
 * « email ».
 */
export function inscriptionSurCompteExistant(user: { identities?: unknown[] | null } | null | undefined): boolean {
  return Boolean(user) && Array.isArray(user?.identities) && user!.identities!.length === 0;
}
