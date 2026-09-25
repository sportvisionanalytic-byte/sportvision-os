// Supabase Edge Function — iap-valider
//
// Un achat encaissé par Apple ou par Google devient un droit d'accès. UNE fonction pour les deux
// magasins, et c'est délibéré : elle remplace apple-iap-valider du 25/09 plutôt que de lui ajouter
// une jumelle. Tout ce qui suit la vérification — résoudre le bénéficiaire, écrire la commande,
// ouvrir les droits — est identique d'un magasin à l'autre. Le dupliquer aurait garanti qu'un jour
// une correction ne soit appliquée que d'un côté, comme ce projet l'a déjà vécu.
//
// Seule la VÉRIFICATION diffère, et elle est isolée dans deux fonctions en bas de ce fichier.
//
// ── CE QUI EST VÉRIFIÉ, ET CONTRE QUOI ──
//
// L'app n'est jamais crue. Elle envoie un jeton d'achat ; c'est le magasin qu'on interroge
// ensuite, directement, sur une requête signée par notre propre clé. Un faux jeton ne passe pas.
//
// Trois attaques, trois barrières :
//
//  1. Fabriquer un achat → le verdict vient du magasin, pas du jeton.
//  2. Rejouer SON achat pour ouvrir deux accès → l'index unique media_orders_store_tx_uniq.
//     Côté Google c'est le cas NORMAL, pas une attaque : un achat non consommé est représenté à
//     chaque lancement de l'app.
//  3. Rejouer l'achat de QUELQU'UN D'AUTRE dont on aurait intercepté le jeton → l'identifiant du
//     compte Supabase est gravé dans la transaction au moment de l'achat (appAccountToken chez
//     Apple, obfuscatedAccountId chez Google), le magasin nous le rend, et on refuse s'il ne
//     désigne pas l'appelant. Sans ce contrôle, le premier à présenter un jeton gagnerait
//     l'accès, y compris celui qui ne l'a pas payé.
//
// ── LE MONTANT ENREGISTRÉ ──
//
// Apple rend le prix réellement facturé, on l'écrit. Google ne le rend PAS sur cet appel : on
// écrit alors le tarif du club, qui est exact puisque Google accepte le prix libre (19,90 côté
// Play là où Apple impose 19,99). Le note_encaissement porte l'identifiant de commande du magasin,
// de quoi rapprocher avec les versements.
//
// Secrets requis :
//   communs   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//   Apple     APPLE_ASC_KEY_ID, APPLE_ASC_ISSUER_ID, APPLE_ASC_PRIVATE_KEY, APPLE_BUNDLE_ID
//   Google    GOOGLE_PLAY_SERVICE_ACCOUNT (le JSON du compte de service), APPLE_BUNDLE_ID sert
//             aussi de nom de paquet Android (fr.sportvision.app, identique aux deux plateformes)
//
// Déploiement : bash livrables/SportVision-TV/scripts/deployer-fonction.sh iap-valider
// verify_jwt reste à true : seul un utilisateur connecté achète.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const b64url = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Le corps d'un JWS, SANS vérification de signature. Ne sert qu'à en extraire un numéro de
 *  transaction à soumettre à Apple. Rien de ce qui en sort n'est cru sur parole. */
function corpsNonVerifie(jws: string): Record<string, unknown> | null {
  const parts = jws.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  } catch {
    return null;
  }
}

/** Le corps DER d'une clé PEM, en ArrayBuffer net.
 *
 *  Le type de retour compte : `Uint8Array` peut, en théorie, reposer sur un SharedArrayBuffer, que
 *  crypto.subtle.importKey refuse. Rendre un ArrayBuffer construit ici lève l'ambiguïté au lieu de
 *  la masquer par une assertion de type. */
function derDepuisPem(pem: string): ArrayBuffer {
  const brut = atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""));
  const buf = new ArrayBuffer(brut.length);
  const vue = new Uint8Array(buf);
  for (let i = 0; i < brut.length; i++) vue[i] = brut.charCodeAt(i);
  return buf;
}

/** Ce qu'un magasin affirme d'un achat, réduit à ce dont on a besoin. */
interface Verdict {
  productId: string;
  /** L'identifiant de compte gravé à l'achat. Vide = on refuse (voir barrière 3). */
  compte: string;
  /** Montant réellement facturé, en centimes, quand le magasin le donne. */
  centimes: number | null;
  devise: string | null;
  /** Remboursé, révoqué, annulé : tout ce qui interdit d'ouvrir un accès. */
  invalide: string | null;
  /** Pour la trace comptable. */
  reference: string;
  environnement: string;
}

// ─────────────────────────────── Apple ───────────────────────────────

async function jetonApple(): Promise<string> {
  const keyId = Deno.env.get("APPLE_ASC_KEY_ID") ?? "";
  const issuerId = Deno.env.get("APPLE_ASC_ISSUER_ID") ?? "";
  const bundleId = Deno.env.get("APPLE_BUNDLE_ID") ?? "";
  const pem = (Deno.env.get("APPLE_ASC_PRIVATE_KEY") ?? "").replace(/\\n/g, "\n");
  if (!keyId || !issuerId || !bundleId || !pem) throw new Error("Configuration Apple incomplète.");

  const cle = await crypto.subtle.importKey(
    "pkcs8", derDepuisPem(pem), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"],
  );
  const now = Math.floor(Date.now() / 1000);
  const enc = new TextEncoder();
  const aSigner = `${b64url(enc.encode(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" })))}`
    + `.${b64url(enc.encode(JSON.stringify({
      iss: issuerId, iat: now, exp: now + 600, aud: "appstoreconnect-v1", bid: bundleId,
    })))}`;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, cle, enc.encode(aSigner));
  return `${aSigner}.${b64url(sig)}`;
}

async function verifierApple(jeton: string): Promise<Verdict> {
  const brut = corpsNonVerifie(jeton);
  const transactionId = String(brut?.transactionId ?? "");
  if (!transactionId) throw new Error("Reçu d'achat illisible.");

  const auth = await jetonApple();
  // Production d'abord, bac à sable ensuite. Une app en cours d'examen et les essais TestFlight
  // passent par le bac à sable : refuser leurs achats ferait échouer la revue Apple elle-même.
  const bases = [
    "https://api.storekit.itunes.apple.com",
    "https://api.storekit-sandbox.itunes.apple.com",
  ];
  let derniere = "";
  for (const base of bases) {
    const r = await fetch(`${base}/inApps/v1/transactions/${encodeURIComponent(transactionId)}`, {
      headers: { Authorization: `Bearer ${auth}` },
    });
    if (r.ok) {
      const { signedTransactionInfo } = await r.json();
      const c = corpsNonVerifie(signedTransactionInfo ?? "");
      if (!c) { derniere = "Réponse Apple illisible."; continue; }
      // Ce corps vient d'Apple sur TLS authentifié : c'est lui qui fait foi.
      if (c.bundleId !== Deno.env.get("APPLE_BUNDLE_ID")) {
        throw new Error("Cet achat n'appartient pas à cette application.");
      }
      return {
        productId: String(c.productId ?? ""),
        compte: String(c.appAccountToken ?? ""),
        // `price` est en millièmes d'unité : 19990 = 19,99 €.
        centimes: typeof c.price === "number" ? Math.round(c.price / 10) : null,
        devise: c.currency ? String(c.currency).toLowerCase() : null,
        invalide: c.revocationDate ? "Cet achat a été remboursé." : null,
        reference: transactionId,
        environnement: base.includes("sandbox") ? "sandbox" : "production",
      };
    }
    derniere = `${r.status} ${await r.text()}`;
    if (r.status !== 404) break;   // 404 = inconnu de cet environnement, on essaie l'autre
  }
  throw new Error(`Apple n'a pas reconnu cet achat (${derniere}).`);
}

// ─────────────────────────────── Google ───────────────────────────────

/** Un jeton d'accès Google, obtenu en signant une assertion avec le compte de service. */
async function jetonGoogle(): Promise<string> {
  const brut = Deno.env.get("GOOGLE_PLAY_SERVICE_ACCOUNT") ?? "";
  if (!brut) throw new Error("Configuration Google Play incomplète.");
  let compte: { client_email?: string; private_key?: string };
  try {
    compte = JSON.parse(brut);
  } catch {
    throw new Error("GOOGLE_PLAY_SERVICE_ACCOUNT n'est pas un JSON valide.");
  }
  if (!compte.client_email || !compte.private_key) {
    throw new Error("Le compte de service Google est incomplet (client_email / private_key).");
  }

  const cle = await crypto.subtle.importKey(
    "pkcs8", derDepuisPem(compte.private_key.replace(/\\n/g, "\n")),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  const now = Math.floor(Date.now() / 1000);
  const enc = new TextEncoder();
  const aSigner = `${b64url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })))}`
    + `.${b64url(enc.encode(JSON.stringify({
      iss: compte.client_email,
      scope: "https://www.googleapis.com/auth/androidpublisher",
      aud: "https://oauth2.googleapis.com/token",
      iat: now, exp: now + 3600,
    })))}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cle, enc.encode(aSigner));

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${aSigner}.${b64url(sig)}`,
    }),
  });
  if (!r.ok) throw new Error(`Google a refusé notre clé de service (${r.status} ${await r.text()}).`);
  const { access_token } = await r.json();
  if (!access_token) throw new Error("Google n'a pas renvoyé de jeton d'accès.");
  return access_token;
}

async function verifierGoogle(jetonAchat: string, productId: string): Promise<Verdict> {
  const paquet = Deno.env.get("APPLE_BUNDLE_ID") ?? "";
  const auth = await jetonGoogle();
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/`
    + `${encodeURIComponent(paquet)}/purchases/products/${encodeURIComponent(productId)}`
    + `/tokens/${encodeURIComponent(jetonAchat)}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${auth}` } });
  if (!r.ok) throw new Error(`Google n'a pas reconnu cet achat (${r.status} ${await r.text()}).`);
  const c = await r.json();

  // purchaseState : 0 acheté, 1 annulé, 2 en attente. « En attente » est un vrai cas (paiement en
  // espèces dans certains pays, validation parentale) : on refuse sans drame, l'achat reviendra de
  // lui-même au prochain lancement quand il sera confirmé.
  const invalide = c.purchaseState === 1 ? "Cet achat a été annulé ou remboursé."
    : c.purchaseState === 2 ? "Ce paiement est encore en attente de confirmation par Google."
    : null;

  return {
    // Google ne renvoie pas le productId : celui du chemin est le seul, et il a servi à
    // interroger l'API, donc un jeton présenté avec un autre produit aurait déjà échoué en 404.
    productId,
    compte: String(c.obfuscatedExternalAccountId ?? ""),
    // L'API des produits uniques ne rend pas le montant. Le tarif du club fait foi, et il est
    // exact : Google accepte le prix libre, contrairement aux paliers d'Apple.
    centimes: null,
    devise: null,
    invalide,
    reference: String(c.orderId ?? jetonAchat),
    // purchaseType 0 = achat de test (compte de licence), absent = achat réel.
    environnement: c.purchaseType === 0 ? "test" : "production",
  };
}

// ─────────────────────────────── Le tronc commun ───────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Authentification requise" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Session invalide" }, 401);
    const user = userData.user;

    const body = await req.json();
    const plateforme: string = body.plateforme || "";
    const jetonAchat: string = body.jeton || "";
    const productId: string = body.product_id || "";
    const beneficiaryPlayerIdRaw: string = body.beneficiary_player_id || "";
    if (plateforme !== "apple" && plateforme !== "google") {
      return json({ error: "Plateforme inconnue." }, 400);
    }
    if (!jetonAchat || !productId) return json({ error: "jeton et product_id sont requis" }, 400);

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: product } = await admin
      .from("media_products")
      .select("id, club_id, name, price_cents, currency, status, apple_product_id, google_product_id")
      .eq("id", productId).maybeSingle();
    if (!product || product.status !== "active") {
      return json({ error: "Ce produit n'est plus disponible." }, 400);
    }
    const attendu = plateforme === "apple" ? product.apple_product_id : product.google_product_id;
    if (!attendu) return json({ error: "Ce produit n'est pas vendu sur cette plateforme." }, 400);

    // Rejeu : si ce jeton a déjà ouvert un accès, on le redit sans rien recréer. C'est le cas
    // NORMAL d'une restauration d'achat ou d'une réinstallation, surtout sur Android.
    const { data: dejaVue } = await admin
      .from("media_orders").select("id")
      .eq("store_transaction_id", jetonAchat).maybeSingle();
    if (dejaVue) return json({ ok: true, deja_active: true, order_id: dejaVue.id });

    const verdict = plateforme === "apple"
      ? await verifierApple(jetonAchat)
      : await verifierGoogle(jetonAchat, attendu);

    if (verdict.invalide) return json({ error: verdict.invalide }, 400);
    if (verdict.productId !== attendu) {
      // Payer le Pass d'un club pour ouvrir celui d'un autre.
      return json({ error: "Cet achat ne correspond pas à ce produit." }, 400);
    }
    // La barrière 3 : le compte gravé à l'achat doit être l'appelant.
    if (verdict.compte.toLowerCase() !== user.id.toLowerCase()) {
      return json({ error: "Cet achat a été réalisé depuis un autre compte." }, 403);
    }

    // ── Le bénéficiaire, jamais pris tel quel ──
    let beneficiaryPlayerId: string;
    if (beneficiaryPlayerIdRaw) {
      const { data: parentProfile } = await admin
        .from("parent_profiles").select("id").eq("user_id", user.id).maybeSingle();
      if (!parentProfile) return json({ error: "Compte parent requis pour cet achat." }, 403);
      const { data: relationship } = await admin
        .from("parent_player_relationships").select("id")
        .eq("parent_id", parentProfile.id)
        .eq("player_id", beneficiaryPlayerIdRaw)
        .eq("statut", "confirme").maybeSingle();
      if (!relationship) return json({ error: "Cet enfant n'est pas confirmé sur votre compte." }, 403);
      beneficiaryPlayerId = beneficiaryPlayerIdRaw;
    } else {
      const { data: playerProfile } = await admin
        .from("player_profiles").select("id").eq("user_id", user.id).maybeSingle();
      if (!playerProfile) return json({ error: "Compte joueur requis pour cet achat." }, 400);
      beneficiaryPlayerId = playerProfile.id;
    }

    const { data: order, error: orderErr } = await admin
      .from("media_orders")
      .insert({
        club_id: product.club_id,
        product_id: product.id,
        purchased_by_user_id: user.id,
        beneficiary_person_id: beneficiaryPlayerId,
        amount_cents: verdict.centimes ?? product.price_cents,
        currency: verdict.devise ?? product.currency ?? "eur",
        status: "pending",
        shipping_status: "non_requis",
        source: plateforme,
        store_transaction_id: jetonAchat,
        note_encaissement: `${plateforme === "apple" ? "App Store" : "Google Play"}`
          + ` (${verdict.environnement}) · ${verdict.reference}`,
      })
      .select("id").single();

    if (orderErr) {
      // Course entre deux appels pour le même jeton : l'index unique a tranché, et c'est le bon
      // résultat. On rend l'accès déjà créé plutôt qu'une erreur.
      const { data: concurrente } = await admin
        .from("media_orders").select("id")
        .eq("store_transaction_id", jetonAchat).maybeSingle();
      if (concurrente) return json({ ok: true, deja_active: true, order_id: concurrente.id });
      console.error("[iap-valider] insertion refusée :", orderErr);
      return json({ error: "Impossible d'enregistrer cet achat." }, 500);
    }

    // Le moteur unique de la v274 — le même que Stripe et que l'encaissement au club.
    const { data: active, error: activErr } = await admin
      .rpc("media_activer_commande", { p_order_id: order!.id });
    if (activErr) {
      console.error("[iap-valider] activation échouée :", activErr);
      return json({ error: "Achat enregistré, mais l'accès n'a pas pu s'ouvrir. Contactez-nous." }, 500);
    }

    return json({ ok: true, order_id: order!.id, droits: (active as { droits?: number })?.droits ?? 0 });
  } catch (e) {
    console.error("[iap-valider]", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
