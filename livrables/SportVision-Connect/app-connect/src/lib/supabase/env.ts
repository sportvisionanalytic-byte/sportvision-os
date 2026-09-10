// Variables Supabase publiques (URL + clé anonyme), avec échec explicite si absentes —
// même correctif que app-next/src/lib/supabase/env.ts : les clients navigateur/serveur/
// middleware utilisaient `!` (non-null assertion TypeScript) sans aucun contrôle à
// l'exécution, une variable manquante passait silencieusement "undefined" au SDK
// Supabase plutôt que d'échouer clairement. Important pour un déploiement Review : si
// une variable Review n'est pas configurée, l'application doit échouer nettement plutôt
// que de risquer un repli implicite.
export function getSupabasePublicEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Configuration Supabase incomplète : NEXT_PUBLIC_SUPABASE_URL ou NEXT_PUBLIC_SUPABASE_ANON_KEY manquante.",
    );
  }
  return { url, anonKey };
}
