import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cheminInterneSur } from "@/lib/supabase/chemin-retour";

// L'application mobile remet sa session à Club+ (25/09/2026).
//
// POURQUOI CETTE ROUTE EXISTE
//
// L'application ouvre l'espace club dans une fenêtre. Un coach déjà connecté dans l'application
// tombait sur l'écran de connexion de Club+ et devait ressaisir son mot de passe — alors que
// l'application connaît déjà sa session. Une fois suffit à agacer, et au bord d'un terrain on ne
// retape pas un mot de passe.
//
// C'est la même route que celle écrite pour Connect le 25/09, à deux différences près : Club+
// vit sous le préfixe /clubplus, et ses chemins passent par `cheminInterneSur` qui sait le
// retirer d'un lien déjà préfixé.
//
// EN POST, ET JAMAIS EN GET. Un jeton dans une adresse finit dans l'historique du navigateur,
// dans les journaux du serveur et dans l'en-tête Referer envoyé au site suivant. En POST il
// reste dans le corps, qui n'est journalisé nulle part.
//
// ELLE N'OUVRE AUCUNE SESSION QUI N'EXISTAIT PAS : elle déménage celle qui a déjà été obtenue
// par mot de passe dans l'application. Supabase vérifie la signature des jetons — un jeton
// inventé est refusé ici, pas plus loin.
export async function POST(request: Request) {
  const url = new URL(request.url);
  // Netlify ne préserve pas le domaine personnalisé dans `request.url` derrière son CDN : même
  // reconstruction d'origine que dans auth/callback, pour la même raison.
  const forwardedHost = request.headers.get("x-forwarded-host");
  const origin = forwardedHost
    ? `${request.headers.get("x-forwarded-proto") || "https"}://${forwardedHost}`
    : url.origin;
  const prefixe = "/clubplus";

  const form = await request.formData().catch(() => null);
  const accessToken = String(form?.get("access_token") ?? "");
  const refreshToken = String(form?.get("refresh_token") ?? "");
  const next = cheminInterneSur(String(form?.get("next") ?? "")) ?? "/dashboard";

  const versConnexion = () =>
    NextResponse.redirect(`${origin}${prefixe}/auth/login`, { status: 303 });

  if (!accessToken || !refreshToken) return versConnexion();

  const supabase = await createClient();
  const { error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  // Jeton expiré, révoqué ou fabriqué : on renvoie vers la connexion, sans détailler. Un message
  // précis ne servirait qu'à celui qui essaie.
  if (error) return versConnexion();

  // 303 et non 307 : la redirection qui suit doit être un GET, sinon le navigateur rejouerait le
  // POST sur la page d'arrivée avec les jetons dans le corps.
  const reponse = NextResponse.redirect(`${origin}${prefixe}${next}`, { status: 303 });

  // « Je viens de l'application » : la coque de Club+ lit ce cookie et masque sa propre
  // navigation, qui sinon se superposerait à la barre d'onglets de l'application. Un cookie et
  // non un paramètre d'adresse : le paramètre se perdrait au premier lien cliqué dans la page.
  //
  // Il ne porte AUCUN droit : il ne décide que de l'affichage.
  reponse.cookies.set("sv_app", "1", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  return reponse;
}
