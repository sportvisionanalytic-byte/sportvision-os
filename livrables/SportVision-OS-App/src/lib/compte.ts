// Fermer son compte (22/09/2026).
//
// L'écran d'appel est dans le profil. Tout le travail est fait par la fonction serveur
// `delete-account`, qui décide en une seule transaction de ce qui part et de ce qui reste :
// les factures et les commandes sont conservées et détachées (obligation comptable de dix ans),
// le compte d'authentification est supprimé en dernier. Si une étape échoue, rien n'a changé.
//
// L'application ne supprime donc rien elle-même et n'envoie aucun identifiant : la fonction
// supprime toujours le compte du jeton, jamais un identifiant reçu dans la requête.
import { supabase } from "./supabase";

export type ResultatSuppression = { ok: true } | { ok: false; message: string };

export async function supprimerMonCompte(): Promise<ResultatSuppression> {
  const { data, error } = await supabase.functions.invoke("delete-account");

  if (error) {
    // Le refus lisible écrit pour la personne voyage dans le corps de la réponse, pas dans le
    // message d'erreur HTTP : sans cette lecture, un compte collaborateur recevrait « Edge
    // Function returned a non-2xx status code », qui ne veut rien dire pour lui.
    const corps = await (error as { context?: { json?: () => Promise<unknown> } }).context?.json?.().catch(() => null);
    const message = (corps as { error?: string } | null)?.error;
    return { ok: false, message: message ?? "La suppression n'a pas pu aboutir. Rien n'a été supprimé." };
  }
  if ((data as { error?: string } | null)?.error) {
    return { ok: false, message: (data as { error: string }).error };
  }
  return { ok: true };
}
