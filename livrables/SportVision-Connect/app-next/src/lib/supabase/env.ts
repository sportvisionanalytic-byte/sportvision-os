// Variables Supabase publiques (URL + clé anonyme), avec échec explicite si absentes —
// mêmes garanties que createAdminClient() (voir admin.ts), étendues aux clients
// navigateur/serveur/middleware qui utilisaient jusqu'ici `!` (non-null assertion
// TypeScript) sans aucun contrôle à l'exécution : une variable manquante y passait
// silencieusement "undefined" au SDK Supabase plutôt que d'échouer clairement.
// Particulièrement important pour un déploiement Review : si une variable Review
// n'est pas configurée, l'application doit échouer nettement plutôt que de risquer
// un repli implicite vers une autre configuration.
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
