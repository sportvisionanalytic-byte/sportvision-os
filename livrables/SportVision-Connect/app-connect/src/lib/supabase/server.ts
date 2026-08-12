import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Client Supabase serveur — Server Components, Route Handlers, Server Actions.
// Lit/écrit la session via les cookies de la requête (App Router).
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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
    },
  );
}
