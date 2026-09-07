import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Rafraîchit le cookie de session Supabase sur chaque requête et protège les routes
// applicatives — appelé depuis src/middleware.ts (racine, requis par Next.js).
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

  const pathname = request.nextUrl.pathname;
  // /auth/* (login), /signup/* (parcours d'inscription) et /activation, /org-activation (lien
  // d'activation privé envoyé par e-mail, voir app/activation/page.tsx) sont publics — accessibles
  // sans compte, la page d'activation elle-même crée le compte via auth.signUp(). Bug trouvé lors
  // de l'audit complet Club+ du 17/08/2026 : /activation et /org-activation redirigeaient vers
  // /auth/login avant même que la page ait pu lire le token dans l'URL.
  // /demo (19/08/2026) : démo publique interne, sans login, données 100 % fictives — voir
  // src/lib/demo/*. Aucune page sous /demo ne lit/écrit de données réelles.
  // /api/calendar/cron (07/09/2026) : la synchronisation nocturne des calendriers est appelee par
  // une fonction planifiee, pas par un navigateur. Elle n'a donc pas de session et s'authentifie
  // elle-meme avec un secret partage compare en temps constant (voir la route). Sans cette
  // exception, le middleware la renverrait vers /auth/login et la tache ne tournerait jamais.
  const isPublicRoute =
    pathname.startsWith("/auth") ||
    pathname.startsWith("/signup") ||
    pathname.startsWith("/activation") ||
    pathname.startsWith("/org-activation") ||
    pathname.startsWith("/demo") ||
    pathname.startsWith("/api/calendar/cron");

  if (!user && !isPublicRoute) {
    // Une route d'API ne doit jamais etre redirigee vers une page de connexion : l'appelant est du
    // code, il attend du JSON. Un fetch() recevrait ici une page HTML avec un statut 200 apres
    // redirection, et croirait avoir reussi. Trouve en testant /api/calendar/fetch en production,
    // qui repondait 307 au lieu de 401.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Non authentifie." }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/auth/login";
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/auth/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return response;
}
