// URLs cross-app (Connect, Club+) utilisées par les liens de navigation et les
// générateurs de lien d'invitation/réservation. Dérivées de variables d'env
// avec la valeur de production comme repli — donc aucun changement de
// comportement en production (qui ne définit pas ces variables), mais un
// déploiement Review peut les surcharger pour rester entièrement dans
// l'environnement Review plutôt que de fuiter vers la production.
//
// Trouvé en testant Club+ Review en réel (post-Phase 5, audit de cohérence) :
// plusieurs liens/générateurs de lien pointaient en dur vers connect.sportvision-an.fr
// et clubplus.sportvision-an.fr, y compris la génération même des liens
// d'invitation — cassant silencieusement les parcours cross-app testés en Review.
export const CONNECT_URL = process.env.NEXT_PUBLIC_CONNECT_URL || "https://connect.sportvision-an.fr";
export const CLUBPLUS_URL = process.env.NEXT_PUBLIC_CLUBPLUS_URL || "https://clubplus.sportvision-an.fr";
