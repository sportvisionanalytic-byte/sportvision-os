import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Échange le code PKCE reçu dans le lien de confirmation d'e-mail (voir signup/checkout/page.tsx,
// emailRedirectTo) contre une vraie session, puis renvoie vers /auth/confirming qui rejoue le
// pending onboarding (localStorage, donc accessible seulement côté client) avant /dashboard.
// Sans cette route, le lien mail atterrissait sur "/" avec ?code=... jamais traité — même bug que
// celui corrigé côté app-connect le 14/08/2026 (voir ce fichier là-bas pour le contexte complet),
// jamais reproduit ici jusqu'à ce que la config Auth Supabase (Site URL/redirect allow-list,
// partagée par tout le projet) soit vérifiée le 17/08/2026 : elle ne couvrait que Connect,
// aucune organisation Club+ n'a donc jamais pu confirmer son e-mail correctement avant ce correctif.
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
