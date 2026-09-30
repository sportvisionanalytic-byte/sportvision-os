// L'adresse de la base et la clé publique (30/09/2026).
//
// == CES DEUX VALEURS SONT ÉCRITES ICI, EN CLAIR, ET C'EST DÉLIBÉRÉ =============================
//
// Elles ne sont pas des secrets. La clé publique est déjà dans le JavaScript du site, lisible par
// n'importe quel navigateur ; ce qui protège les données, ce sont les règles de sécurité en base,
// vérifiées par 154 suites de tests. Les écrire dans un fichier versionné ne change rien à la
// sécurité, et supprime une panne.
//
// == LA PANNE QU'ON VIENT DE REPRODUIRE, ET POURQUOI app.json NE SUFFISAIT PAS ==================
//
// Elles étaient dans `app.json`, sous `expo.extra`, lues par `Constants.expoConfig`. Mesuré le
// 30/09 sur le simulateur : `.env` mis de côté, l'application s'arrête au lancement sur
// « l'adresse de la base est introuvable ». Pas en théorie — écran rouge, pile d'appel, application
// morte avant le premier écran. Or `.env` n'est PAS versionné : une compilation faite depuis un
// dépôt fraîchement cloné, ou par un service de compilation dans le nuage, n'en a pas. C'est donc
// exactement ce qu'aurait donné le premier envoi sur TestFlight.
//
// La cause est dans la plomberie d'Expo, et c'est bien ça le problème : `Constants.expoConfig` ne
// vient pas de `app.json` directement. Il vient du manifeste — servi par Metro en développement,
// embarqué par `expo-updates` en production. Vérifié ici : le manifeste servi par Metro contient
// bien les deux valeurs, `EXUpdatesEnabled` vaut `false` dans `Expo.plist`, aucun `app.manifest`
// n'est embarqué, et l'application n'en reçoit rien. Trois pièces doivent s'aligner pour qu'une
// constante arrive à destination ; il en manquait une, sans un mot.
//
// Une constante de fichier n'a pas de plomberie. Elle est dans le paquet JavaScript, donc elle est
// là en développement, en compilation locale, sur TestFlight, et sur un clone neuf.
//
// == L'ENVIRONNEMENT RESTE PRIORITAIRE ==========================================================
//
// `EXPO_PUBLIC_SUPABASE_URL` et `EXPO_PUBLIC_SUPABASE_ANON_KEY` continuent de gagner quand elles
// sont posées : c'est ainsi qu'on pointe une base de recette sans toucher au code. Absentes, les
// valeurs ci-dessous font foi, et l'application démarre.

/** La base de production de SportVision. */
const URL_PRODUCTION = "https://lulgezzpvrlbftbykzrc.supabase.co";

/** La clé PUBLIQUE (`publishable`). Elle n'ouvre rien que la RLS ne laisse ouvert. */
const CLE_PRODUCTION = "sb_publishable_N_S7DxALGutAd6KlQmpaTw_h7cHNaE4";

function choisir(depuisEnv: string | undefined, defaut: string): string {
  const v = depuisEnv?.trim();
  return v ? v : defaut;
}

export const SUPABASE_URL = choisir(process.env.EXPO_PUBLIC_SUPABASE_URL, URL_PRODUCTION);
export const SUPABASE_CLE = choisir(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY, CLE_PRODUCTION);
