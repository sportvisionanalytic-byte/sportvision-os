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
  const isPublicRoute =
    pathname.startsWith("/auth") ||
    pathname.startsWith("/signup") ||
    pathname.startsWith("/activation") ||
    pathname.startsWith("/org-activation");

  if (!user && !isPublicRoute) {
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
