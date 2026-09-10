// URL Club+ utilisée par le lien "Mes espaces" (profil, compte partagé Club+/Connect).
// Dérivée d'une variable d'env avec la valeur de production comme repli — aucun
// changement de comportement en production, mais un déploiement Review peut la
// surcharger pour rester dans l'environnement Review. Même correctif que
// app-next/src/lib/urls.ts, trouvé en testant Connect Review en réel.
export const CLUBPLUS_URL = process.env.NEXT_PUBLIC_CLUBPLUS_URL || "https://clubplus.sportvision-an.fr";
