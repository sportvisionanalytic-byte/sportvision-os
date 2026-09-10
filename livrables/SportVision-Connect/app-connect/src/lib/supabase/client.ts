import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublicEnv } from "./env";

// Client Supabase navigateur — Client Components uniquement ("use client").
// Même projet Supabase que Club+ et que l'app vanilla SportVision-Connect/app :
// une seule identité utilisateur partagée entre les trois applications (voir
// MASTER-ECOSYSTEME-V2.md §5).
export function createClient() {
  const { url, anonKey } = getSupabasePublicEnv();
  return createBrowserClient(url, anonKey);
}
