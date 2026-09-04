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
// "/demo" : démo interne à données fictives (demandée par Fouka le 19/08, voir src/app/demo/) —
// aucune page sous /demo ne lit/écrit de données réelles (sauf catalogue_offres, public en
// lecture). Temporaire, à retirer avec src/app/demo/ avant le lancement public si plus utile.
// "/join" (migration-clubplus-v57, 03/09/2026) : page publique du Smart Link/QR club/équipe —
// doit afficher "Vous rejoignez [Club] [Équipe]" AVANT authentification (preview_invite_code est
// volontairement callable en anonyme côté base), sinon un parent qui scanne un QR sans être
// connecté est redirigé vers /auth/login sans jamais voir ce qu'il s'apprête à rejoindre.
const PUBLIC_PATHS = [
  "/auth/login",
  "/auth/forgot",
  "/auth/reset",
  "/auth/callback",
  "/auth/confirming",
  "/signup",
  "/cotisation",
  "/aide",
  "/demo",
  "/join",
  "/media-checkout",
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

  // Comparaison par segment de chemin, jamais un startsWith brut : "/cotisation" (page publique
  // /cotisation/[token], sans compte) matchait aussi "/cotisations" (liste/création, protégées)
  // avec un simple startsWith — "cotisations" commence par "cotisation" caractère à caractère.
  // Bug corrigé le 14/08 (audit) : aucune fuite de données n'en résultait (chaque page sous
  // /cotisations fait elle-même un redirect(/auth/login) si !user), mais le middleware laissait
  // passer ces requêtes sans le filet de sécurité qu'il est censé fournir en premier rideau.
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    // BUGFIX (audit QA fonctionnelle réservation/compte du 30/08/2026) : le CTA "Créer mon
    // espace Connect" affiché après une demande de réservation/devis sur le site vitrine
    // (reserver.html, demande-de-devis.html) pointe vers "/?signup=1&email=...", pour amener le
    // visiteur directement sur le tunnel d'inscription avec son e-mail déjà pré-rempli — promesse
    // de la FAQ vitrine (a-propos.html : "Un espace SportVision Connect vous est ensuite proposé
    // pour créer votre accès"). Avant ce correctif, TOUTE requête non authentifiée vers "/"
    // (page absente de PUBLIC_PATHS) était renvoyée vers "/auth/login" sans distinction — le lien
    // existait, la cible en tenait compte (src/app/page.tsx), mais ce garde-fou, exécuté AVANT la
    // page, redirigeait déjà ailleurs : le paramètre n'atteignait jamais le composant qui savait
    // le lire. Trouvé par test réel (Playwright, navigation contrôlée) : l'URL finale observée
    // était "/auth/login?signup=1&email=..." — /auth/login ignore ces deux paramètres (ne lit que
    // `next`/`confirmation`, voir son commentaire), le visiteur devait donc retaper son adresse
    // e-mail lui-même après avoir cliqué "Créer mon compte" sur cet écran.
    // "/signup" est déjà public (PUBLIC_PATHS) : `email` y est lu par signup-context.tsx pour
    // pré-remplir l'étape Identité, sans écraser un tunnel déjà repris depuis le localStorage.
    if (pathname === "/" && url.searchParams.get("signup") === "1" && url.searchParams.get("email")) {
      const email = url.searchParams.get("email")!;
      url.pathname = "/signup";
      url.search = "";
      url.searchParams.set("email", email);
      return NextResponse.redirect(url);
    }
    url.pathname = "/auth/login";
    return NextResponse.redirect(url);
  }

  return response;
}
