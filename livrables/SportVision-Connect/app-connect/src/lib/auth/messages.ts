// Ce que la personne lit quand Supabase Auth refuse une inscription, une connexion ou un renvoi
// d'e-mail.
//
// POURQUOI CE FICHIER. Jusqu'au 10/09/2026, l'inscription n'avait que deux messages : « Un compte
// utilise déjà cette adresse » (si le texte anglais contenait « already ») et « Impossible de créer
// le compte pour le moment » pour TOUT le reste. Or le projet est plafonné à 15 e-mails par heure :
// quand la limite tombe (HTTP 429, `over_email_send_rate_limit`), un parent qui s'inscrit depuis le
// groupe WhatsApp de l'équipe lisait « pour le moment », réessayait dix fois, et abandonnait — sans
// savoir que ses informations étaient bonnes et qu'il suffisait d'attendre. Même impasse pour une
// adresse mal formée ou un réseau coupé. Mesuré en production (réponse 429 rejouée dans le vrai
// tunnel) : « Impossible de créer le compte pour le moment. »
//
// On lit `code` (stable) avant `message` (anglais, susceptible de changer), et jamais le texte
// anglais n'est montré tel quel.

type ErreurAuth = { code?: string; status?: number; message?: string; name?: string } | null | undefined;

export type ContexteAuth = "inscription" | "connexion" | "renvoi";

export function messageErreurAuth(erreur: ErreurAuth, contexte: ContexteAuth): string {
  const code = erreur?.code ?? "";
  const message = erreur?.message ?? "";

  // Plafond d'e-mails du projet, OU délai minimal entre deux e-mails à la même adresse (60 s) :
  // GoTrue renvoie le même code, seul le texte dit « after N seconds ».
  if (code === "over_email_send_rate_limit" || /email rate limit/i.test(message)) {
    const secondes = message.match(/after (\d+) seconds?/i)?.[1];
    if (secondes) {
      return `Un e-mail vient déjà d'être envoyé à cette adresse. Patientez ${secondes} secondes avant d'en redemander un.`;
    }
    return contexte === "inscription"
      ? "Trop d'e-mails de confirmation ont été envoyés en peu de temps. Vos informations sont bonnes et restent saisies : réessayez un peu plus tard (au plus tard dans une heure)."
      : "Trop d'e-mails ont été envoyés en peu de temps. Réessayez un peu plus tard (au plus tard dans une heure).";
  }
  if (code === "over_request_rate_limit" || erreur?.status === 429) {
    return "Trop de tentatives en peu de temps. Patientez quelques minutes puis réessayez.";
  }
  if (code === "user_already_exists" || code === "email_exists" || /already (been )?registered|already exists/i.test(message)) {
    return "Un compte SportVision utilise déjà cette adresse.";
  }
  if (code === "weak_password" || /password should/i.test(message)) {
    return "Ce mot de passe est trop faible. Choisissez-en un d'au moins 8 caractères.";
  }
  if (code === "email_address_invalid" || (code === "validation_failed" && /email/i.test(message))) {
    return "Cette adresse e-mail n'est pas valide. Vérifiez qu'elle ne contient ni espace ni faute de frappe.";
  }
  if (code === "email_not_confirmed") {
    return "Votre adresse e-mail n'est pas encore confirmée. Ouvrez le lien reçu par e-mail (pensez à regarder dans les courriers indésirables), ou demandez-en un nouveau ci-dessous.";
  }
  if (code === "invalid_credentials") {
    return "Adresse e-mail ou mot de passe incorrect.";
  }
  if (code === "signup_disabled") {
    return "Les inscriptions sont momentanément fermées. Écrivez-nous à contact@sportvision-an.fr.";
  }
  if (code === "captcha_failed") {
    return "La vérification de sécurité a échoué. Rechargez la page puis réessayez.";
  }
  // Réseau coupé (tunnel, ascenseur, 4G qui décroche) : supabase-js lève une erreur sans statut HTTP.
  if (erreur?.name === "AuthRetryableFetchError" || erreur?.status === 0 || /failed to fetch|network|load failed/i.test(message)) {
    return "La connexion internet a été interrompue. Vérifiez votre réseau puis réessayez.";
  }
  if (contexte === "connexion") return "Adresse e-mail ou mot de passe incorrect.";
  if (contexte === "renvoi") return "L'e-mail n'a pas pu être renvoyé. Réessayez dans un instant.";
  return "La création du compte a échoué. Réessayez dans un instant ; si cela persiste, écrivez-nous à contact@sportvision-an.fr.";
}
