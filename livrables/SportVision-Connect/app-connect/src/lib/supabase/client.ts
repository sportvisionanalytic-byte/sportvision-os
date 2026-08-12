import { createBrowserClient } from "@supabase/ssr";

// Client Supabase navigateur — Client Components uniquement ("use client").
// Même projet Supabase que Club+ et que l'app vanilla SportVision-Connect/app :
// une seule identité utilisateur partagée entre les trois applications (voir
// MASTER-ECOSYSTEME-V2.md §5).
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
