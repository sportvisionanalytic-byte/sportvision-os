// Les pages de Connect ouvertes dans l'application, avec la session déjà faite (24/09/2026).
//
// CE QUI EST ICI, ET POURQUOI CE N'EST PAS DU NATIF
//
// Les commandes, les factures, les cotisations de groupe, les affiliations, l'aide et la
// reconnaissance existent déjà dans Connect, écrites, testées, corrigées pendant des semaines.
// Les réécrire en natif reviendrait à entretenir deux versions de la même règle métier — et la
// règle de consentement de la reconnaissance, avec ses seuils d'âge, est exactement le genre de
// chose qu'on ne veut pas voir exister en double. Le jour où les deux divergent, plus personne
// ne sait laquelle fait foi.
//
// Ce qui est natif, c'est ce qu'on regarde tous les jours : l'accueil, le calendrier, les photos,
// le profil, et la réservation d'une prestation, parce que c'est ce qui se vend.
//
// LE PASSAGE DE SESSION
//
// La session native vit dans le stockage de l'application, celle du site dans les cookies. Sans
// rien faire, une personne déjà connectée retombe sur l'écran de connexion de Connect. Se
// connecter deux fois pour voir son propre reçu, personne ne le fait : elle referme.
//
// On remet donc les deux jetons à /auth/app, qui les valide auprès de Supabase et pose les
// cookies. En POST, jamais dans l'adresse : un jeton dans une URL finit dans l'historique, dans
// les journaux du serveur et dans l'en-tête Referer envoyé au site suivant.
import { supabase } from "./supabase";

/** L'adresse de Connect. Exportee pour que rien ne la recopie : une seconde ecriture en dur
 *  serait une seconde a corriger le jour d'un changement de domaine. */
export const CONNECT = "https://connect.sportvision-an.fr";
/** Club+ vit sur son propre domaine, sous le prefixe /clubplus impose par son Next.js. */
const CLUBPLUS = "https://clubplus.sportvision-an.fr/clubplus";

export type PageConnect =
  | "commandes" | "factures" | "cotisations" | "affiliations" | "reconnaissance" | "aide"
  | "contenus" | "galeries" | "equipes" | "messages" | "prestations" | "profil" | "acces";

/**
 * Le chemin réel dans Connect, et le titre affiché dans la barre de l'application.
 *
 * Les libellés sont ceux du menu de Connect, mot pour mot. Une famille qui a commencé sur le
 * site et continue dans l'application doit retrouver les mêmes noms : « Paiement collectif »
 * dans un endroit et « Cotisations » dans l'autre, c'est déjà deux produits dans sa tête.
 */
export const PAGES: Record<PageConnect, { chemin: string; titre: string }> = {
  // Médias
  contenus:       { chemin: "/contenus",       titre: "Mes contenus" },
  galeries:       { chemin: "/galeries",       titre: "Mes galeries" },
  // Mon univers
  affiliations:   { chemin: "/affiliations",   titre: "Mon affiliation" },
  equipes:        { chemin: "/equipes",        titre: "Mes équipes" },
  messages:       { chemin: "/messages",       titre: "Messages" },
  // Services
  prestations:    { chemin: "/prestations",    titre: "Prestations" },
  cotisations:    { chemin: "/cotisations",    titre: "Paiement collectif" },
  commandes:      { chemin: "/commandes",      titre: "Mes commandes" },
  factures:       { chemin: "/factures",       titre: "Factures et paiements" },
  // Mon compte
  profil:         { chemin: "/profil",         titre: "Mon profil" },
  // ATTENTION AU MOT « ACCES ». Ici, c'est celui du site : qui a le droit de voir MON profil,
  // avec les demandes a accepter ou refuser. L'ecran de l'application qui portait le meme nom
  // expliquait comment obtenir ses photos — deux choses differentes sous un seul mot. Il
  // s'appelle desormais « aide-photos ».
  acces:          { chemin: "/acces",          titre: "Accès à mon profil" },
  reconnaissance: { chemin: "/reconnaissance", titre: "Me reconnaître" },
  aide:           { chemin: "/aide",           titre: "Aide" },
};

export type SourceConnect =
  | {
      /** Une page minuscule qui se soumet toute seule. Voir sourceConnect pour le pourquoi. */
      html: string;
      /** L'origine de Connect : sans elle, iOS traite la page comme « about:blank » et le POST part
       *  d'une origine nulle, que le serveur refuse. */
      baseUrl: string;
    }
  /** Le chemin court : la page directement, quand les cookies de Connect sont deja poses. */
  | { uri: string };

/**
 * Les cookies de Connect sont-ils deja poses dans la vue web ?
 *
 * LE POURQUOI, ET C'EST LE GROS DU TEMPS D'ATTENTE (28/09/2026). Ouvrir une page de Connect
 * coutait TROIS aller-retours a chaque fois : le pont (une page vide qui se soumet), l'echange de
 * session sur /auth/app, puis seulement la page demandee. Fouka : « ca met du temps a charger,
 * beaucoup trop de temps ».
 *
 * Or l'echange de session pose des cookies, et la vue web les PARTAGE d'un ecran a l'autre
 * (`sharedCookiesEnabled`). Le pont n'est donc necessaire qu'une fois : ensuite la page s'ouvre
 * directement, en UN aller-retour au lieu de trois.
 *
 * On ne devine pas si les cookies tiennent encore : on tente le chemin court, et si Connect
 * renvoie vers /auth/login, l'ecran refait le pont. Le pire cas est l'ancien comportement.
 */
let cookiesConnectPoses = false;
export function cookiesConnectDisponibles(): boolean { return cookiesConnectPoses; }
export function marquerCookiesConnectPoses(): void { cookiesConnectPoses = true; }
export function oublierCookiesConnect(): void { cookiesConnectPoses = false; }

/** La page demandee, sans passer par le pont. A n'utiliser que si les cookies sont poses. */
export function sourceConnectDirecte(page: PageConnect, cheminForce?: string): SourceConnect {
  return { uri: `${CONNECT}${cheminForce ?? PAGES[page].chemin}` };
}

/** Échapper ce qui part dans un attribut HTML. Un jeton ne contient normalement ni guillemet ni
 *  chevron, mais on n'écrit jamais du HTML par concaténation sans échapper : c'est comme ça que
 *  naissent les failles qu'on met six mois à retrouver. */
function pourAttribut(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/"/g, "&quot;")
    .replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * De quoi charger une page de Connect déjà connectée.
 *
 * Rend `null` quand il n'y a pas de session : l'écran affiche alors une explication au lieu
 * d'ouvrir une page qui renverrait vers un formulaire de connexion. Une fenêtre web qui demande
 * un mot de passe à quelqu'un qui vient de le saisir, c'est ce qui fait fermer l'application.
 */
export async function sourceConnect(
  page: PageConnect, cheminForce?: string,
): Promise<SourceConnect | null> {
  // ON RAFRAICHIT AVANT DE TRANSMETTRE (28/09/2026).
  //
  // Fouka : « ca met du temps a charger, limite la ca m'a dit de me reconnecter ». Ce n'etait pas
  // une deconnexion : c'etait CET ecran, parce que le jeton transmis a Connect etait perime. On
  // envoyait ce que `getSession()` avait sous la main sans regarder sa date de fin — et une session
  // qui expire dans dix secondes tient le temps de partir, pas le temps d'arriver : la page fait
  // trois aller-retours (le pont, l'echange de session, puis la page elle-meme), et le jeton meurt
  // en route. Connect repond alors « reconnectez-vous » a quelqu'un qui est connecte.
  //
  // Deux minutes de marge : c'est plus que la chaine ne prend, meme sur un reseau lent.
  let s = (await supabase.auth.getSession()).data.session;
  const finBientot = s?.expires_at ? s.expires_at * 1000 - Date.now() < 120_000 : false;
  if (!s || finBientot) {
    // Un echec ici n'est pas fatal : si on avait deja une session, on tente quand meme avec elle
    // plutot que d'afficher « session expiree » a quelqu'un dont la session est peut-etre bonne.
    try {
      const rafraichie = (await supabase.auth.refreshSession()).data.session;
      if (rafraichie) s = rafraichie;
    } catch { /* on garde ce qu'on avait */ }
  }
  if (!s?.access_token || !s?.refresh_token) return null;

  // POURQUOI UNE PAGE QUI SE SOUMET, ET PAS UN CHARGEMENT EN POST (corrigé le 25/09/2026)
  //
  // La première version passait par `source={{ uri, method: "POST", body }}`. Ça marche sur
  // Android. Sur iOS, PAS DU TOUT : l'implémentation native de react-native-webview n'écrit
  // jamais httpMethod ni httpBody — vérifié dans son code, il n'y en a aucune trace. Le chargement
  // partait donc en GET, les jetons n'arrivaient nulle part, et Connect réclamait le mot de passe
  // à quelqu'un qui venait de le saisir. Signalé par Fouka : « quand j'appuie sur prestation, ça
  // me fait me reconnecter ».
  //
  // Une page HTML qui contient un formulaire et le soumet elle-même fait exactement le même
  // travail, sur les deux plateformes, sans dépendre de ce que le composant natif veut bien
  // transmettre. Les jetons restent dans le corps de la requête et n'apparaissent jamais dans une
  // adresse — c'était le but du POST, il est conservé.
  const champs = [
    ["access_token", s.access_token],
    ["refresh_token", s.refresh_token],
    ["next", cheminForce ?? PAGES[page].chemin],
  ]
    .map(([n, v]) => `<input type="hidden" name="${n}" value="${pourAttribut(String(v))}">`)
    .join("");

  // Le fond est celui de l'application : sans lui, un flash blanc apparaît le temps de la
  // soumission, et sur un écran sombre ça se voit beaucoup.
  const html = `<!doctype html><html><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<style>html,body{margin:0;height:100%;background:#070A17}</style></head>`
    + `<body><form id="f" method="POST" action="${CONNECT}/auth/app">${champs}</form>`
    + `<script>document.getElementById("f").submit();</script></body></html>`;

  return { html, baseUrl: `${CONNECT}/` };
}

/**
 * La reconnaissance, vue par un parent.
 *
 * Mesuré le 25/09 : pour un compte parent, /reconnaissance répond 307 et renvoie vers
 * /particulier — cette page-là est celle d'un JOUEUR qui donne son propre accord. Un parent
 * consent pour un enfant précis, et la page vit donc sous la fiche de cet enfant. Signalé par
 * Fouka : « me reconnaître, ça bugue un peu ».
 *
 * Le même texte d'engagement est servi des deux côtés, avec sa version, et c'est voulu : deux
 * écrans séparés finiraient par faire accepter deux choses différentes sous le même nom.
 */
export function cheminReconnaissanceEnfant(kind: string, refId: string): string {
  return `/particulier/sportifs/${kind}/${refId}/reconnaissance`;
}

/**
 * L'espace club, ouvert déjà connecté (25/09/2026).
 *
 * Un coach qui ouvrait l'espace club depuis l'application tombait sur l'écran de connexion de
 * Club+ et devait ressaisir son mot de passe — alors que l'application connaît déjà sa session.
 * Une fois suffit à agacer, et au bord d'un terrain on ne retape pas un mot de passe.
 *
 * Même mécanique que pour Connect, sur l'autre domaine : une page qui se soumet toute seule,
 * parce que le composant natif d'iOS n'envoie jamais le corps d'une requête POST.
 */
/**
 * LE RACCOURCI DE CLUB+, SUR SON PROPRE DOMAINE (29/09/2026).
 *
 * Connect a le sien depuis le 28/09 : une fois les cookies posés, les pages suivantes s'ouvrent
 * directement, en un aller-retour au lieu de trois. Club+ ne l'avait pas, et refaisait donc le
 * pont complet À CHAQUE OUVERTURE de l'espace club — la première impression d'un coach, chaque
 * fois qu'il ouvre l'application.
 *
 * Un drapeau à part, et non celui de Connect : ce sont deux domaines, et leurs cookies ne se
 * partagent pas. Les confondre ferait croire au raccourci là où il n'y a rien de posé, et un
 * coach tomberait sur l'écran de connexion de Club+ sans rien pour en sortir.
 */
let cookiesClubPlusPoses = false;
export function cookiesClubPlusDisponibles(): boolean { return cookiesClubPlusPoses; }
export function marquerCookiesClubPlusPoses(): void { cookiesClubPlusPoses = true; }
export function oublierCookiesClubPlus(): void { cookiesClubPlusPoses = false; }

/** La page demandée, sans passer par le pont. À n'utiliser que si les cookies sont posés. */
export function sourceClubPlusDirecte(chemin = "/dashboard"): SourceConnect {
  return { uri: `${CLUBPLUS}${chemin}` };
}

export async function sourceClubPlus(chemin = "/dashboard"): Promise<SourceConnect | null> {
  // ON RAFRAICHIT AVANT DE TRANSMETTRE (28/09/2026).
  //
  // Fouka : « ca met du temps a charger, limite la ca m'a dit de me reconnecter ». Ce n'etait pas
  // une deconnexion : c'etait CET ecran, parce que le jeton transmis a Connect etait perime. On
  // envoyait ce que `getSession()` avait sous la main sans regarder sa date de fin — et une session
  // qui expire dans dix secondes tient le temps de partir, pas le temps d'arriver : la page fait
  // trois aller-retours (le pont, l'echange de session, puis la page elle-meme), et le jeton meurt
  // en route. Connect repond alors « reconnectez-vous » a quelqu'un qui est connecte.
  //
  // Deux minutes de marge : c'est plus que la chaine ne prend, meme sur un reseau lent.
  let s = (await supabase.auth.getSession()).data.session;
  const finBientot = s?.expires_at ? s.expires_at * 1000 - Date.now() < 120_000 : false;
  if (!s || finBientot) {
    // Un echec ici n'est pas fatal : si on avait deja une session, on tente quand meme avec elle
    // plutot que d'afficher « session expiree » a quelqu'un dont la session est peut-etre bonne.
    try {
      const rafraichie = (await supabase.auth.refreshSession()).data.session;
      if (rafraichie) s = rafraichie;
    } catch { /* on garde ce qu'on avait */ }
  }
  if (!s?.access_token || !s?.refresh_token) return null;

  const champs = [
    ["access_token", s.access_token],
    ["refresh_token", s.refresh_token],
    ["next", chemin],
  ]
    .map(([n, v]) => `<input type="hidden" name="${n}" value="${pourAttribut(String(v))}">`)
    .join("");

  const html = `<!doctype html><html><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<style>html,body{margin:0;height:100%;background:#070A17}</style></head>`
    + `<body><form id="f" method="POST" action="${CLUBPLUS}/auth/app">${champs}</form>`
    + `<script>document.getElementById("f").submit();</script></body></html>`;

  return { html, baseUrl: `${CLUBPLUS}/` };
}
