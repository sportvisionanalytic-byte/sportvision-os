import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

// Client Supabase avec la clé de service — SERVEUR UNIQUEMENT.
//
// À n'importer que depuis une route serveur (`src/app/api/**`). La clé contourne entièrement la
// RLS : si elle atteignait un jour un bundle navigateur, n'importe quel visiteur obtiendrait un
// accès total à la base. C'est pour ça qu'elle s'appelle SUPABASE_SECRET_KEY sans préfixe
// NEXT_PUBLIC_ : Next refuse de l'exposer côté client, et ce fichier n'est référencé par aucun
// composant.
//
// Le seul usage aujourd'hui est la synchronisation nocturne des calendriers, qui doit écrire pour
// des clubs sans qu'aucun humain ne soit connecté. Tout ce qui part d'un navigateur continue de
// passer par la session de l'utilisateur et par la RLS.
export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error("Configuration serveur incomplète : NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SECRET_KEY manquante.");
  }
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
