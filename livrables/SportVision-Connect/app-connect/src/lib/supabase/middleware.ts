import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Rafraîchit le cookie de session Supabase sur chaque requête et protège les routes
// applicatives — appelé depuis src/middleware.ts (racine, requis par Next.js).
// "/aide" doit rester public : c'est un lien affiché sur l'écran de connexion, atteignable par
// un visiteur non authentifié ("Besoin d'aide ?") — sans cette entrée, un visiteur non connecté
// qui clique sur ce lien était renvoyé silencieusement vers /auth/login (bug corrigé le 13/08).
// "/auth/callback" doit rester public : c'est la route qui échange le code de confirmation
// contre une session, donc appelée AVANT qu'aucune session n'existe (sinon le middleware
// redirige vers /auth/login avant même que la route ait pu poser le cookie — bug corrigé le
// 14/08, voir auth/callback/route.ts). "/auth/confirming" aussi, le temps que la session tout
// juste posée soit lisible par le middleware sur la requête suivante.
const PUBLIC_PATHS = [
  "/auth/login",
  "/auth/forgot",
  "/auth/reset",
  "/auth/callback",
  "/auth/confirming",
  "/signup",
  "/cotisation",
  "/aide",
];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublic = PUBLIC_PATHS.some((p) => request.nextUrl.pathname.startsWith(p));
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/login";
    return NextResponse.redirect(url);
  }

  return response;
}
