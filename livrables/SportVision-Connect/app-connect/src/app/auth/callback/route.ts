import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Échange le code PKCE reçu dans le lien de confirmation d'e-mail (voir signup/club/page.tsx,
// emailRedirectTo) contre une vraie session, puis renvoie vers /auth/confirming qui rejoue
// le pending onboarding (localStorage, donc accessible seulement côté client) avant /dashboard.
// Sans cette route, le lien mail atterrissait sur "/" avec ?code=... jamais traité : le
// middleware voyait "pas de session" et renvoyait systématiquement vers /auth/login (bug
// corrigé le 14/08 — le clic sur "Confirmer" ne connectait jamais réellement l'utilisateur).
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}/auth/confirming`);
    }
  }

  return NextResponse.redirect(`${origin}/auth/login?confirmation=failed`);
}
