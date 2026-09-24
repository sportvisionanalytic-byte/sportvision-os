import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cheminInterne } from "@/lib/signup/pending-onboarding";

// L'application mobile remet sa session à Connect (24/09/2026).
//
// POURQUOI CETTE ROUTE EXISTE
//
// L'application native ouvre certaines pages de Connect dans une fenêtre web : les commandes,
// les factures, les cotisations de groupe, les affiliations, l'aide, la reconnaissance. Ce ne
// sont pas des écrans qu'on réécrit : ils existent, ils marchent, et les dupliquer en natif
// reviendrait à entretenir deux versions de la même règle métier jusqu'au jour où elles ne
// diraient plus la même chose.
//
// Seulement voilà : la session native vit dans le stockage de l'application, celle du site dans
// les cookies du navigateur. Les deux ne se connaissent pas. Sans cette route, une personne
// déjà connectée dans l'application tombe sur l'écran de connexion de Connect en ouvrant « Mes
// commandes ». Se connecter deux fois pour voir son propre reçu, personne ne le fait : elle
// referme et appelle son club.
//
// CE QUE FAIT LA ROUTE : elle reçoit les deux jetons de la session déjà ouverte, demande à
// Supabase de les valider, et pose les cookies correspondants. Supabase vérifie la signature
// des jetons : un jeton inventé est refusé ici, pas plus loin.
//
// POURQUOI EN POST, ET JAMAIS EN GET
//
// Un jeton dans une adresse se retrouve partout : historique du navigateur, journaux du serveur,
// en-tête Referer envoyé au site suivant, aperçu de lien partagé. En POST, il reste dans le
// corps de la requête, qui n'est journalisé nulle part. C'est la seule raison de ce choix, et
// elle suffit. `react-native-webview` sait charger une page en POST, c'est donc gratuit côté
// application.
//
// CE QUE LA ROUTE NE FAIT PAS : elle n'ouvre aucune session qui n'existait pas. Elle ne fait que
// transporter une session déjà obtenue par mot de passe dans l'application. Ce n'est pas un
// moyen de connexion, c'est un déménagement.
export async function POST(request: Request) {
  const url = new URL(request.url);
  // Netlify ne préserve pas le domaine personnalisé dans `request.url` derrière son CDN : même
  // reconstruction d'origine que dans auth/callback, pour la même raison, découverte de la même
  // façon (audit du 31/08).
  const forwardedHost = request.headers.get("x-forwarded-host");
  const origin = forwardedHost
    ? `${request.headers.get("x-forwarded-proto") || "https"}://${forwardedHost}`
    : url.origin;

  const form = await request.formData().catch(() => null);
  const accessToken = String(form?.get("access_token") ?? "");
  const refreshToken = String(form?.get("refresh_token") ?? "");
  // `cheminInterne` refuse tout ce qui n'est pas un chemin de ce site : sans lui, un « next »
  // fabriqué renverrait la personne connectée vers un domaine choisi par quelqu'un d'autre.
  const next = cheminInterne(String(form?.get("next") ?? "")) || "/dashboard";

  if (!accessToken || !refreshToken) {
    return NextResponse.redirect(`${origin}/auth/login`, { status: 303 });
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  // Jeton expiré, révoqué ou fabriqué : on renvoie simplement vers la connexion. Pas de message
  // détaillé — il ne servirait qu'à celui qui essaie.
  if (error) {
    return NextResponse.redirect(`${origin}/auth/login`, { status: 303 });
  }

  // 303 et non 307 : la redirection qui suit doit être un GET, sinon le navigateur rejouerait le
  // POST sur la page d'arrivée avec les jetons dans le corps.
  return NextResponse.redirect(`${origin}${next}`, { status: 303 });
}
