// L'achat du Pass Photo dans l'application (25/09/2026).
//
// DECISION DE FOUKA, ET CE QU'ELLE CHANGE
//
// « J'accepte qu'Apple prenne 15 %, pour que les gens puissent payer et deverrouiller le Pass
// directement sur l'application. » Jusqu'ici l'app iOS n'affichait aucun chemin d'achat, parce
// que la regle 3.1.1 interdit d'envoyer acheter ailleurs. Le probleme n'etait pas de vendre,
// c'etait de vendre HORS du systeme d'Apple. En passant par StoreKit, l'interdiction tombe.
//
// Les trois chemins restent ouverts, et ils aboutissent tous au meme droit d'acces :
//   - dans l'app iOS        -> Apple (ce fichier) ;
//   - sur Connect, au web   -> Stripe (inchange) ;
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
import * as IAP from "expo-iap";
import { supabase } from "./supabase";
import { SUPABASE_URL } from "./config";

export interface PassProposable {
  productId: string;
  /** Le libelle du club, pour les ecrans web. Sur iOS on affiche celui d'Apple. */
  nom: string;
  dejaActif: boolean;
  /** Le prix TEL QU'APPLE L'AFFICHE, deja formate dans la devise du magasin de la personne.
   *  Jamais le tarif du club : Apple impose ses paliers (19,99 la ou le club affiche 19,90), et
   *  annoncer un prix different de celui qui sera debite est une reclamation assuree. */
  prixApple: string;
  appleProductId: string;
}

let connecte = false;

/** Ouvrir la liaison au magasin, une seule fois. Sans elle, toute requete produit echoue. */
async function connexion(): Promise<boolean> {
  if (connecte) return true;
  try {
    await IAP.initConnection();
    connecte = true;
    return true;
  } catch {
    return false;
  }
}

/**
 * Le Pass achetable pour ce joueur, ou `null`.
 *
 * Rend `null` sans bruit dans tous les cas ou il n'y a rien a proposer : pas sur iOS, pas de
 * produit Apple declare, produit inconnu du magasin, ou acces deja actif. L'appelant n'a donc
 * qu'une chose a tester.
 */
export async function passProposable(
  clubId: string, playerId: string,
): Promise<PassProposable | null> {
  if (Platform.OS !== "ios") return null;

  const { data, error } = await supabase.rpc("media_pass_disponible", {
    p_club_id: clubId, p_player_id: playerId,
  });
  if (error || !Array.isArray(data) || data.length === 0) return null;

  const p = data[0] as {
    product_id: string; name: string; apple_product_id: string | null; deja_actif: boolean;
  };
  if (!p.apple_product_id || p.deja_actif) return null;

  if (!(await connexion())) return null;

  // Le second accord : le magasin connait-il ce produit ? Tant qu'il n'est pas cree et approuve
  // dans App Store Connect, il ne rend rien, et l'app n'affiche rien.
  let produits: { id?: string; displayPrice?: string; title?: string }[] = [];
  try {
    produits = (await IAP.fetchProducts({ skus: [p.apple_product_id], type: "in-app" })) ?? [];
  } catch {
    return null;
  }
  const produit = produits.find((x) => x?.id === p.apple_product_id);
  if (!produit?.displayPrice) return null;

  return {
    productId: p.product_id,
    nom: produit.title || p.name,
    dejaActif: false,
    prixApple: produit.displayPrice,
    appleProductId: p.apple_product_id,
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
    return { etat: "erreur", message: "L'App Store est injoignable. Réessayez dans un instant." };
  }

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
        const ok = await livrer(recu, pass.productId, beneficiairePlayerId, jeton);
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

    IAP.requestPurchase({
      type: "in-app",
      request: {
        apple: {
          sku: pass.appleProductId,
          quantity: 1,
          // Le verrou anti-reutilisation : Apple grave l'identifiant du compte dans la
          // transaction, et le serveur refuse tout recu dont ce champ ne le designe pas.
          appAccountToken: utilisateur,
        },
      },
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
  recu: string, productId: string, beneficiaire: string | undefined, jeton: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/apple-iap-valider`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jeton}`, "Content-Type": "application/json" },
    body: JSON.stringify({ jws: recu, product_id: productId, beneficiary_player_id: beneficiaire }),
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
 * serveur. Apple conserve la transaction tant qu'elle n'est pas close, et la represente au
 * lancement suivant. Sans ce rattrapage, la personne aurait paye pour rien et n'aurait aucun
 * moyen de s'en sortir seule.
 *
 * Silencieux par construction : appele au demarrage, il ne doit jamais afficher d'erreur a
 * quelqu'un qui n'a rien demande.
 */
export async function reprendreAchatsEnAttente(
  clubId: string, playerId: string, beneficiairePlayerId?: string,
): Promise<boolean> {
  if (Platform.OS !== "ios") return false;
  try {
    if (!(await connexion())) return false;
    const enAttente = (await IAP.getAvailablePurchases()) ?? [];
    if (!enAttente.length) return false;

    const { data: session } = await supabase.auth.getSession();
    const jeton = session.session?.access_token;
    if (!jeton) return false;

    const { data } = await supabase.rpc("media_pass_disponible", {
      p_club_id: clubId, p_player_id: playerId,
    });
    const p = (Array.isArray(data) ? data[0] : null) as
      { product_id: string; apple_product_id: string | null } | null;
    if (!p?.apple_product_id) return false;

    let repris = false;
    for (const achat of enAttente) {
      const a = achat as { purchaseToken?: string | null; id?: string; productId?: string };
      const sku = a.productId ?? a.id;
      if (sku !== p.apple_product_id || !a.purchaseToken) continue;
      const ok = await livrer(a.purchaseToken, p.product_id, beneficiairePlayerId, jeton);
      if (ok.ok) {
        await IAP.finishTransaction({ purchase: achat, isConsumable: true });
        repris = true;
      }
    }
    return repris;
  } catch {
    return false;
  }
}
