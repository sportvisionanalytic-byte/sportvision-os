import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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
export async function GET(request: Request) {
  const url = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host");
  const origin = forwardedHost
    ? `${request.headers.get("x-forwarded-proto") || "https"}://${forwardedHost}`
    : url.origin;
  const code = url.searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}/auth/confirming`);
    }
  }

  return NextResponse.redirect(`${origin}/auth/login?confirmation=failed`);
}
