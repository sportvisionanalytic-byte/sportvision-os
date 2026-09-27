// Appliquer une mise à jour au lancement, et pas au lancement d'après.
//
// LE DÉFAUT QUE ÇA CORRIGE (27/09/2026). Fouka, après une publication : « j'ai rechargé, je ne vois
// rien. » L'application ne contenait AUCUN code de mise à jour : elle s'en remettait entièrement au
// comportement par défaut d'expo-updates, qui télécharge au lancement et n'applique qu'au lancement
// SUIVANT. Un rechargement ne suffisait donc jamais — il en fallait deux, et personne ne peut le
// devenir. Pendant deux jours nous avons cherché un défaut de paiement alors que le correctif n'était
// simplement pas encore chargé.
//
// CE QUI EST FAIT ICI : on demande, on télécharge, et on relance TOUT DE SUITE si c'est nouveau.
//
// LES TROIS GARDE-FOUS, chacun pour une raison précise :
//   • une seule tentative par lancement — `deja` — sinon un échec réseau peut relancer la boucle ;
//   • on ne relance QUE si `isNew` est vrai, sinon une mise à jour déjà appliquée provoquerait un
//     redémarrage sans fin ;
//   • toute erreur est avalée : hors réseau, l'application doit démarrer normalement avec ce qu'elle
//     a. Une mise à jour est un confort, jamais une condition de démarrage.
import * as Updates from "expo-updates";

let deja = false;

/** Vrai si l'application a redémarré pour appliquer une mise à jour. */
export async function appliquerMiseAJour(): Promise<boolean> {
  if (deja || __DEV__ || !Updates.isEnabled) return false;
  deja = true;
  try {
    const dispo = await Updates.checkForUpdateAsync();
    if (!dispo.isAvailable) return false;
    const recue = await Updates.fetchUpdateAsync();
    if (!recue.isNew) return false;
    await Updates.reloadAsync();
    return true;
  } catch {
    // Hors réseau, serveur injoignable, canal absent : on garde ce qui est installé.
    return false;
  }
}
