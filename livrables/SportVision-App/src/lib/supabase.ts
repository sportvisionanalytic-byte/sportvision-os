// Le lien vers la base SportVision (22/09/2026).
//
// LA MEME BASE QUE LE SITE, exactement : memes tables, memes droits, memes fonctions. C'est ce qui
// rend cette reecriture tenable — on refait la peau, pas le squelette. Une galerie achetee depuis
// l'application apparait sur le site dans la seconde, et inversement.
//
// La cle publique n'est pas un secret : elle est deja dans le code du site, visible de tout
// navigateur. Ce qui protege les donnees, ce sont les regles de securite en base (RLS), verifiees
// par 149 suites de tests. Une cle volee ne donne acces a rien de plus qu'une page web ouverte.
import "react-native-url-polyfill/auto";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

const URL = "https://lulgezzpvrlbftbykzrc.supabase.co";
const CLE_PUBLIQUE = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const supabase = createClient(URL, CLE_PUBLIQUE, {
  auth: {
    // La session survit a la fermeture de l'application : personne n'accepte de retaper son mot
    // de passe a chaque ouverture, et c'est la premiere chose qu'on reproche a une app.
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // Pas de lecture d'URL : une application native n'a pas de barre d'adresse.
    detectSessionInUrl: false,
  },
});

// ── Le renouvellement du jeton quand l'application revient au premier plan ────────────────────
//
// Sur un telephone, l'application est suspendue des qu'on la quitte : la minuterie qui renouvelle
// le jeton s'arrete avec elle. Sans ce reveil, une personne qui rouvre l'application le lendemain
// se retrouve avec un jeton perime, la base repond 401, et tous les ecrans se vident. C'est le
// piege le plus connu de Supabase sur mobile, et il ne se voit jamais en developpement, ou l'on
// rouvre l'application toutes les deux minutes.
AppState.addEventListener("change", (etat) => {
  if (etat === "active") supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});
