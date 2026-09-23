// L'adresse de la base et la clé publique (23/09/2026).
//
// POURQUOI CES DEUX VALEURS SONT ÉCRITES DANS app.json, ET PAS DANS UN FICHIER .env
//
// Elles l'étaient, et c'était un piège. La clé était lue dans l'environnement avec un repli sur
// la chaîne vide : une compilation faite sans le fichier `.env` — par un développeur qui vient
// de cloner le dépôt, par un service de compilation dans le nuage — produisait une application
// qui démarre normalement, affiche tous ses écrans, et ne charge jamais rien. Sans message,
// sans plantage, sans la moindre piste. Le genre de panne qu'on met trois jours à comprendre.
//
// Ces valeurs ne sont pas des secrets. La clé publique est déjà dans le JavaScript du site,
// lisible par n'importe quel navigateur ; ce qui protège les données, ce sont les règles de
// sécurité en base, vérifiées par 154 suites de tests. La mettre dans un fichier versionné ne
// change rien à la sécurité, et supprime une panne silencieuse. C'est un bon échange.
//
// L'environnement reste prioritaire : il sert à pointer une base de recette sans toucher au
// code. S'il est absent, app.json fait foi. Si les deux manquent, on refuse de démarrer, fort
// et clair — mieux vaut un écran rouge en développement qu'une application muette en production.
import Constants from "expo-constants";

const extra = (Constants.expoConfig?.extra ?? {}) as {
  supabaseUrl?: string;
  supabaseCle?: string;
};

function exiger(valeur: string | undefined, quoi: string): string {
  if (valeur && valeur.trim()) return valeur.trim();
  throw new Error(
    `SportVision : ${quoi} est introuvable. Elle doit se trouver dans app.json (expo.extra), `
    + `ou être fournie par l'environnement. L'application ne peut pas démarrer sans.`,
  );
}

export const SUPABASE_URL = exiger(
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? extra.supabaseUrl,
  "l'adresse de la base",
);

export const SUPABASE_CLE = exiger(
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? extra.supabaseCle,
  "la clé publique",
);
