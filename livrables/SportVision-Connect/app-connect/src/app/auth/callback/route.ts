import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cheminInterne } from "@/lib/signup/pending-onboarding";

// Échange le code PKCE reçu dans le lien de confirmation d'e-mail (voir signup/club/page.tsx,
// emailRedirectTo) contre une vraie session, puis renvoie vers /auth/confirming qui rejoue
// le pending onboarding (localStorage, donc accessible seulement côté client) avant /dashboard.
// Sans cette route, le lien mail atterrissait sur "/" avec ?code=... jamais traité : le
// middleware voyait "pas de session" et renvoyait systématiquement vers /auth/login (bug
// corrigé le 14/08 — le clic sur "Confirmer" ne connectait jamais réellement l'utilisateur).
//
// 31/08/2026, audit complet : `new URL(request.url).origin` renvoyait
// "https://sportvision-connect.netlify.app" même pour une requête reçue sur
// "https://connect.sportvision-an.fr" — confirmé en conditions réelles (Playwright, vrai lien de
// confirmation cliqué en prod) : le Next Runtime de Netlify ne préserve pas le domaine personnalisé
// dans `request.url` pour les Route Handlers derrière le CDN, seulement dans les en-têtes
// x-forwarded-*. Conséquence réelle : TOUT nouveau compte Connect qui confirmait son e-mail
// atterrissait sur l'ancienne app vanille (sportvision-connect.netlify.app/auth/login), perdait sa
// session fraîchement échangée ET son rattachement club en attente (localStorage isolé par
// origine, jamais transmis à ce domaine-là). Corrigé en reconstruisant l'origin depuis
// x-forwarded-host/x-forwarded-proto quand présents, avec repli sur request.url sinon (dev local).
//
// 10/09/2026 — le lien ouvert dans un AUTRE navigateur que celui de l'inscription. Mesuré en
// production : inscription dans le navigateur de WhatsApp, e-mail ouvert dans Gmail. Supabase
// confirme bien l'adresse (vérifié en base) puis renvoie ici un code PKCE ; mais la clé qui permet
// de l'échanger n'existe que dans le premier navigateur. L'échange échouait, et la personne lisait
// « Ce lien de confirmation n'est plus valide… recommencez votre inscription » — alors que son
// compte était actif. En recommençant, elle tombait sur « Un compte utilise déjà cette adresse ».
// Ce cas précis (`pkce_code_verifier_not_found`) signifie au contraire que l'adresse EST
// confirmée : on l'envoie se connecter en le lui disant. `next` (la page d'où elle venait, par ex.
// /mes-invitations) est transmis dans tous les cas.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host");
  const origin = forwardedHost
    ? `${request.headers.get("x-forwarded-proto") || "https"}://${forwardedHost}`
    : url.origin;
  const code = url.searchParams.get("code");
  const next = cheminInterne(url.searchParams.get("next"));
  const avecSuite = (base: string) =>
    next ? `${base}${base.includes("?") ? "&" : "?"}next=${encodeURIComponent(next)}` : base;

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${avecSuite("/auth/confirming")}`);
    }
    if (error.code === "pkce_code_verifier_not_found" || error.name === "AuthPKCECodeVerifierMissingError") {
      return NextResponse.redirect(`${origin}${avecSuite("/auth/login?confirmation=ok")}`);
    }
  }

  return NextResponse.redirect(`${origin}${avecSuite("/auth/login?confirmation=failed")}`);
}
