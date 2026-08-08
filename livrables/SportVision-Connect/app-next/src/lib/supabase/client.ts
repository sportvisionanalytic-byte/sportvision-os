import { createBrowserClient } from "@supabase/ssr";

// Client Supabase navigateur — Client Components uniquement ("use client").
// Même projet que l'app vanilla SportVision-Connect/app (voir .env.local).
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
