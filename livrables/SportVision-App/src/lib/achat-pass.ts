// L'achat du Pass Photo dans l'application (25/09/2026).
//
// DECISION DE FOUKA, ET CE QU'ELLE CHANGE
//
// « J'accepte qu'Apple prenne 15 %, pour que les gens puissent payer et deverrouiller le Pass
// directement sur l'application. » Jusqu'ici l'app n'affichait aucun chemin d'achat sur iOS, parce
// que la regle 3.1.1 interdit d'envoyer acheter ailleurs. Le probleme n'etait pas de vendre,
// c'etait de vendre HORS du systeme d'Apple. En passant par StoreKit, l'interdiction tombe.
//
// PUIS GOOGLE, LE MEME JOUR. J'avais d'abord ecrit que Google autorisait le lien externe, et
// c'etait trop affirmatif : Play exige aussi son systeme de facturation, et le lien externe passe
// par un programme d'inscription meme dans l'EEE. Fouka a tranche : « vas-y, fais les trucs de
// paiement sur Google Android ». Le bouton Android n'ouvre donc plus Connect, il achete.
//
// Les chemins aboutissent tous au meme droit d'acces, ecrit par le meme code cote serveur :
//   - dans l'app iOS        -> Apple ;
//   - dans l'app Android    -> Google Play ;
//   - sur Connect, au web   -> Stripe (inchange, et la meilleure marge : a mettre en avant par
//                              QR code et par le club, hors des apps ou c'est interdit d'en
//                              parler) ;
//   - par le club           -> especes ou virement, Fouka ouvre l'acces depuis l'OS.
//
// POURQUOI LE BOUTON PEUT NE PAS APPARAITRE, ET POURQUOI C'EST VOULU
//
// Il faut DEUX accords pour proposer l'achat : la base doit declarer un `apple_product_id` pour
// ce Pass, et StoreKit doit reellement connaitre ce produit. Un seul des deux ne suffit pas.
// Sans cette double condition, un produit declare en base mais pas encore cree dans App Store
// Connect afficherait un bouton qui echoue au moment de payer — la pire des deux situations.
//
// CE QUI N'EST JAMAIS DECIDE ICI
//
// L'app ne cree aucun droit et ne croit aucun recu. Elle transmet le recu signe a
// apple-iap-valider, qui demande a Apple ce que cette transaction est vraiment. Le
// `appAccountToken` pose ci-dessous est ce qui empeche qu'un numero de transaction intercepte
// ouvre un acces sur un autre compte : Apple nous le rend, le serveur le compare a l'appelant.
import { Platform } from "react-native";
import { supabase } from "./supabase";
import { SUPABASE_URL } from "./config";

/** Le magasin du telephone. Sur le web (Expo web) il n'y en a aucun, et rien n'est propose. */
type Magasin = "apple" | "google";
function magasin(): Magasin | null {
  if (Platform.OS === "ios") return "apple";
  if (Platform.OS === "android") return "google";
  return null;
}

export interface PassProposable {
  /** Quel magasin encaissera. Porte jusqu'au serveur : c'est lui qui decide qui interroger. */
  plateforme: Magasin;
  productId: string;
  /** Le libelle du club, pour les ecrans web. Sur iOS on affiche celui d'Apple. */
  nom: string;
  dejaActif: boolean;
  /** Le prix TEL QUE LE MAGASIN L'AFFICHE, deja formate dans sa devise. Jamais le tarif du club :
   *  Apple impose ses paliers (19,99 la ou le club affiche 19,90) alors que Google accepte le prix
   *  exact. Annoncer un prix different de celui qui sera debite est une reclamation assuree, et le
   *  seul moyen de ne jamais se tromper est de ne jamais le calculer soi-meme. */
  prixMagasin: string;
  /** L'identifiant du produit chez CE magasin. */
  skuMagasin: string;
}

// LA BIBLIOTHEQUE EST CHARGEE A LA DEMANDE, ET C'EST UN GARDE-FOU (26/09/2026).
//
// `runtimeVersion` suit la politique `appVersion`, donc les builds 6, 7 et 8 partagent tous le
// meme runtime « 1.0.0 ». Une mise a jour a distance publiee aujourd'hui atteindrait donc AUSSI le
// build 6, qui n'embarque pas le module natif d'achat : un import statique de expo-iap y serait
// evalue au chargement de ce fichier, avant tout garde-fou, et l'ecran des galeries tomberait chez
// quelqu'un qui n'a rien demande.
//
// En chargeant a la demande, un build sans le module natif ne paie rien : l'import echoue, on rend
// `null`, aucun bouton ne s'affiche, et le reste de l'ecran fonctionne normalement. C'est le
// comportement qu'on veut de toute facon quand le magasin est injoignable.
type ModuleIAP = typeof import("expo-iap");
let _iap: ModuleIAP | null = null;

async function iap(): Promise<ModuleIAP | null> {
  if (_iap) return _iap;
  try {
    _iap = await import("expo-iap");
    return _iap;
  } catch {
    return null;
  }
}

let connecte = false;

/** Ouvrir la liaison au magasin, une seule fois. Sans elle, toute requete produit echoue. */
async function connexion(): Promise<boolean> {
  if (connecte) return true;
  const m = await iap();
  if (!m) return false;
  try {
    await m.initConnection();
    connecte = true;
    return true;
  } catch {
    return false;
  }
}

/**
 * OU EN EST LE PASS, ET POURQUOI CE N'EST PAS UN SIMPLE `null` (corrige le 26/09/2026).
 *
 * `passProposable` rendait `null` dans trois situations qui n'ont rien a voir : le Pass est deja
 * acquis, aucun Pass n'existe pour ce club, ou le magasin ne connait pas encore le produit. L'ecran
 * ne pouvait donc pas savoir quoi demander — et Fouka l'a constate : « ca ne me met pas d'acheter le
 * pass, ca me met directement deposer ma photo de reference ». On reclamait une photo de reference a
 * quelqu'un qui n'avait pas paye.
 *
 * Les trois etats sont desormais distincts :
 *   a_prendre  il y a un Pass a payer. `offre` porte le produit du magasin, ou `null` quand le
 *              magasin ne le sert pas encore (produit pas encore approuve) : dans ce cas on ne
 *              propose rien, mais on ne passe SURTOUT pas a l'etape suivante.
 *   acquis     le Pass est pris. C'est la, et seulement la, qu'on parle de reconnaissance.
 *   aucun      ce club ne vend pas de Pass. Rien a payer, on peut passer a la suite.
 */
export type EtatPass =
  | { etat: "a_prendre"; offre: PassProposable | null }
  | { etat: "acquis" }
  | { etat: "aucun" };

export async function etatDuPass(clubId: string, playerId: string): Promise<EtatPass> {
  const { data, error } = await supabase.rpc("media_pass_disponible", {
    p_club_id: clubId, p_player_id: playerId,
  });
  if (error || !Array.isArray(data) || data.length === 0) return { etat: "aucun" };
  const p = data[0] as { deja_actif: boolean };
  if (p.deja_actif) return { etat: "acquis" };
  return { etat: "a_prendre", offre: await passProposable(clubId, playerId) };
}

/**
 * Le Pass achetable pour ce joueur, ou `null` quand le magasin ne peut pas le vendre.
 *
 * Reserve a `etatDuPass`, qui seul sait interpreter le `null`. L'appeler directement fait perdre la
 * distinction qui compte.
 */
export async function passProposable(
  clubId: string, playerId: string,
): Promise<PassProposable | null> {
  const m = magasin();
  if (!m) return null;

  const { data, error } = await supabase.rpc("media_pass_disponible", {
    p_club_id: clubId, p_player_id: playerId,
  });
  if (error || !Array.isArray(data) || data.length === 0) return null;

  const p = data[0] as {
    product_id: string; name: string; deja_actif: boolean;
    apple_product_id: string | null; google_product_id: string | null;
  };
  const sku = m === "apple" ? p.apple_product_id : p.google_product_id;
  if (!sku || p.deja_actif) return null;

  if (!(await connexion())) return null;

  // Le second accord : le magasin connait-il ce produit ? Tant qu'il n'est pas cree et approuve
  // dans App Store Connect, il ne rend rien, et l'app n'affiche rien.
  let produits: { id?: string; displayPrice?: string; title?: string }[] = [];
  try {
    produits = (await (await iap())!.fetchProducts({ skus: [sku], type: "in-app" })) ?? [];
  } catch {
    return null;
  }
  const produit = produits.find((x) => x?.id === sku);
  if (!produit?.displayPrice) return null;

  return {
    plateforme: m,
    productId: p.product_id,
    nom: produit.title || p.name,
    dejaActif: false,
    prixMagasin: produit.displayPrice,
    skuMagasin: sku,
  };
}

export type Resultat =
  | { etat: "ouvert" }
  | { etat: "annule" }
  | { etat: "erreur"; message: string };

/**
 * Acheter, puis faire ouvrir l'acces par le serveur.
 *
 * L'ordre compte : on ne cloture la transaction aupres d'Apple (`finishTransaction`) QU'APRES que
 * le serveur a confirme l'ouverture du droit. Cloturer avant, c'est perdre le recu si le reseau
 * tombe entre les deux — la personne a paye, Apple considere l'affaire close, et il ne reste plus
 * rien a presenter pour reclamer l'acces. Tant qu'elle n'est pas close, le recu revient tout seul
 * au prochain lancement (voir `reprendreAchatsEnAttente`).
 */
export async function acheterPass(
  pass: PassProposable, beneficiairePlayerId?: string,
): Promise<Resultat> {
  const { data: session } = await supabase.auth.getSession();
  const utilisateur = session.session?.user?.id;
  const jeton = session.session?.access_token;
  if (!utilisateur || !jeton) return { etat: "erreur", message: "Votre session a expiré. Reconnectez-vous." };

  if (!(await connexion())) {
    return {
      etat: "erreur",
      message: pass.plateforme === "apple"
        ? "L'App Store est injoignable. Réessayez dans un instant."
        : "Google Play est injoignable. Réessayez dans un instant.",
    };
  }
  // `connexion()` a reussi, donc le module est charge : le `!` est sur, et le seul autre chemin
  // (module absent) est deja sorti juste au-dessus.
  const IAP = (await iap())!;

  return await new Promise<Resultat>((resolve) => {
    let fini = false;
    const terminer = (r: Resultat) => {
      if (fini) return;
      fini = true;
      succes.remove();
      echec.remove();
      resolve(r);
    };

    const succes = IAP.purchaseUpdatedListener(async (achat) => {
      const recu = (achat as { purchaseToken?: string | null }).purchaseToken;
      if (!recu) return;
      try {
        const ok = await livrer(pass.plateforme, recu, pass.productId, beneficiairePlayerId, jeton);
        if (!ok.ok) { terminer({ etat: "erreur", message: ok.message }); return; }
        // Le serveur a ouvert l'acces : on peut cloturer sans rien perdre.
        await IAP.finishTransaction({ purchase: achat, isConsumable: true });
        terminer({ etat: "ouvert" });
      } catch (e) {
        terminer({
          etat: "erreur",
          message: e instanceof Error ? e.message
            : "Le paiement est passé mais l'accès n'a pas pu s'ouvrir. Rouvrez l'application, il se débloquera tout seul.",
        });
      }
    });

    const echec = IAP.purchaseErrorListener((err) => {
      const code = String((err as { code?: string })?.code ?? "");
      if (code.includes("UserCancel") || code.includes("user-cancelled")) {
        terminer({ etat: "annule" });
      } else {
        terminer({ etat: "erreur", message: (err as { message?: string })?.message || "L'achat n'a pas abouti." });
      }
    });

    // LE VERROU ANTI-REUTILISATION, ecrit deux fois parce que les deux magasins ne l'appellent
    // pas pareil : appAccountToken chez Apple, obfuscatedAccountId chez Google. Le magasin grave
    // l'identifiant du compte Supabase dans la transaction, nous le rend a la verification, et le
    // serveur refuse tout jeton dont ce champ ne designe pas l'appelant. Sans ca, le premier a
    // presenter un jeton intercepte gagnerait l'acces, y compris celui qui ne l'a pas paye.
    IAP.requestPurchase({
      type: "in-app",
      request: pass.plateforme === "apple"
        ? { apple: { sku: pass.skuMagasin, quantity: 1, appAccountToken: utilisateur } }
        : { google: { skus: [pass.skuMagasin], obfuscatedAccountId: utilisateur } },
    }).catch((e) => terminer({
      etat: "erreur",
      message: e instanceof Error ? e.message : "L'achat n'a pas pu démarrer.",
    }));
  });
}

/** Remettre le recu au serveur. Rend le message d'erreur tel que le serveur l'a ecrit : il est
 *  en francais et decrit la vraie cause, la masquer derriere « une erreur est survenue »
 *  rendrait le probleme impossible a comprendre pour la personne comme pour le support. */
async function livrer(
  plateforme: Magasin, recu: string, productId: string,
  beneficiaire: string | undefined, jeton: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/iap-valider`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jeton}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      plateforme, jeton: recu, product_id: productId, beneficiary_player_id: beneficiaire,
    }),
  });
  const corps = await r.json().catch(() => ({}));
  if (!r.ok || corps?.error) {
    return { ok: false, message: corps?.error || "L'accès n'a pas pu s'ouvrir." };
  }
  return { ok: true };
}

/**
 * Rattraper un achat paye dont l'acces ne s'est jamais ouvert.
 *
 * Le cas arrive : reseau coupe juste apres le paiement, application fermee pendant l'appel au
 * serveur. Les deux magasins conservent la transaction tant qu'elle n'est pas close et la
 * representent au lancement suivant — chez Google c'est meme la regle, un achat non consomme
 * revient systematiquement. Sans ce rattrapage, la personne aurait paye pour rien et n'aurait
 * aucun moyen de s'en sortir seule.
 *
 * Silencieux par construction : appele au demarrage, il ne doit jamais afficher d'erreur a
 * quelqu'un qui n'a rien demande.
 */
export async function reprendreAchatsEnAttente(
  clubId: string, playerId: string, beneficiairePlayerId?: string,
): Promise<boolean> {
  const m = magasin();
  if (!m) return false;
  try {
    if (!(await connexion())) return false;
    const m2 = (await iap())!;
    const enAttente = (await m2.getAvailablePurchases()) ?? [];
    if (!enAttente.length) return false;

    const { data: session } = await supabase.auth.getSession();
    const jeton = session.session?.access_token;
    if (!jeton) return false;

    const { data } = await supabase.rpc("media_pass_disponible", {
      p_club_id: clubId, p_player_id: playerId,
    });
    const p = (Array.isArray(data) ? data[0] : null) as
      { product_id: string; apple_product_id: string | null; google_product_id: string | null } | null;
    const attendu = m === "apple" ? p?.apple_product_id : p?.google_product_id;
    if (!p || !attendu) return false;

    let repris = false;
    for (const achat of enAttente) {
      const a = achat as { purchaseToken?: string | null; id?: string; productId?: string };
      const sku = a.productId ?? a.id;
      if (sku !== attendu || !a.purchaseToken) continue;
      const ok = await livrer(m, a.purchaseToken, p.product_id, beneficiairePlayerId, jeton);
      if (ok.ok) {
        await m2.finishTransaction({ purchase: achat, isConsumable: true });
        repris = true;
      }
    }
    return repris;
  } catch {
    return false;
  }
}
