import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublicEnv } from "./env";

// Client Supabase navigateur — Client Components uniquement ("use client").
// Même projet que l'app vanilla SportVision-Connect/app (voir .env.local).
export function createClient() {
  const { url, anonKey } = getSupabasePublicEnv();
  return createBrowserClient(url, anonKey);
}
