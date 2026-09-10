import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabasePublicEnv } from "./env";

// Client Supabase serveur — Server Components, Route Handlers, Server Actions.
// Lit/écrit la session via les cookies de la requête (App Router).
export async function createClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = getSupabasePublicEnv();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Appelé depuis un Server Component (lecture seule) : ignoré, le middleware
          // rafraîchit déjà la session sur chaque requête.
        }
      },
    },
  });
}
