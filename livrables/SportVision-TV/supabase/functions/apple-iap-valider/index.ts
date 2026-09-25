// Supabase Edge Function — apple-iap-valider
//
// 25/09/2026, decision de Fouka : « on met comme quoi j'accepte qu'Apple prenne 15 %, pour que
// les gens puissent payer et deverrouiller le Pass Photo directement sur l'application ».
//
// L'app iOS encaisse par Apple (StoreKit 2). Cette fonction est le seul endroit ou un paiement
// Apple devient un droit d'acces. Elle NE FAIT PAS confiance a l'app : le recu signe qu'elle
// envoie sert uniquement a lire un numero de transaction, puis c'est Apple qu'on interroge
// directement (App Store Server API) pour savoir ce que cette transaction est vraiment.
//
// ── Les trois choses qu'un attaquant pourrait tenter, et ce qui l'arrete ──
//
//  1. Fabriquer un faux recu. Impossible : le verdict ne vient pas du recu mais de la reponse
//     d'Apple a une requete signee par notre cle App Store Connect, sur TLS.
//  2. Rejouer SON PROPRE achat pour ouvrir plusieurs acces. Arrete par l'index unique
//     media_orders_apple_tx_uniq (v274) : une transaction ne cree qu'une commande, jamais deux.
//  3. Rejouer l'achat de QUELQU'UN D'AUTRE dont il aurait intercepte le numero. Arrete par
//     appAccountToken : l'app inscrit l'identifiant du compte Supabase DANS la transaction au
//     moment de l'achat, Apple nous le rend, et on refuse si ce n'est pas l'appelant. Sans ce
//     controle, le premier a presenter un numero de transaction gagnerait l'acces — y compris
//     celui qui ne l'a pas paye.
//
// Le montant enregistre est celui qu'Apple a REELLEMENT facture, pas le tarif affiche par le
// club : Apple impose ses propres paliers (19,99 la ou le club affiche 19,90), et ecrire le tarif
// du club en comptabilite ferait diverger les comptes de ce qui a ete encaisse.
//
// Secrets requis : SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
//                  APPLE_ASC_KEY_ID, APPLE_ASC_ISSUER_ID, APPLE_ASC_PRIVATE_KEY (contenu du .p8),
//                  APPLE_BUNDLE_ID
//
// Deploiement : bash livrables/SportVision-TV/scripts/deployer-fonction.sh apple-iap-valider
// (verify_jwt reste a true : seul un utilisateur connecte achete.)

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

/** Le corps d'un JWS, sans verification : on ne s'en sert QUE pour extraire un numero de
 *  transaction a soumettre a Apple. Rien de ce qui en sort n'est cru sur parole. */
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

const b64url = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Le jeton ES256 exige par l'App Store Server API, signe avec la cle .p8 App Store Connect. */
async function jetonApple(): Promise<string> {
  const keyId = Deno.env.get("APPLE_ASC_KEY_ID") ?? "";
  const issuerId = Deno.env.get("APPLE_ASC_ISSUER_ID") ?? "";
  const bundleId = Deno.env.get("APPLE_BUNDLE_ID") ?? "";
  const pem = (Deno.env.get("APPLE_ASC_PRIVATE_KEY") ?? "").replace(/\\n/g, "\n");
  if (!keyId || !issuerId || !bundleId || !pem) throw new Error("Configuration Apple incomplète.");

  const der = Uint8Array.from(
    atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")),
    (c) => c.charCodeAt(0),
  );
  const cle = await crypto.subtle.importKey(
    "pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"],
  );

  const maintenant = Math.floor(Date.now() / 1000);
  const enTete = { alg: "ES256", kid: keyId, typ: "JWT" };
  const corps = {
    iss: issuerId, iat: maintenant, exp: maintenant + 600,
    aud: "appstoreconnect-v1", bid: bundleId,
  };
  const enc = new TextEncoder();
  const aSigner = `${b64url(enc.encode(JSON.stringify(enTete)))}.${b64url(enc.encode(JSON.stringify(corps)))}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, cle, enc.encode(aSigner),
  );
  return `${aSigner}.${b64url(signature)}`;
}

/** Ce qu'Apple dit de cette transaction. Production d'abord, bac a sable ensuite : une app en
 *  cours d'examen et les tests TestFlight passent par le bac a sable, et refuser leurs achats
 *  ferait echouer la revue Apple elle-meme. */
async function demanderAApple(transactionId: string, jeton: string) {
  const bases = [
    "https://api.storekit.itunes.apple.com",
    "https://api.storekit-sandbox.itunes.apple.com",
  ];
  let derniere = "";
  for (const base of bases) {
    const r = await fetch(`${base}/inApps/v1/transactions/${encodeURIComponent(transactionId)}`, {
      headers: { Authorization: `Bearer ${jeton}` },
    });
    if (r.ok) {
      const { signedTransactionInfo } = await r.json();
      const charge = corpsNonVerifie(signedTransactionInfo ?? "");
      // Ce corps-la vient d'Apple sur TLS authentifie : c'est lui qui fait foi.
      if (charge) return { charge, environnement: base.includes("sandbox") ? "sandbox" : "production" };
      derniere = "Réponse Apple illisible.";
    } else {
      derniere = `${r.status} ${await r.text()}`;
      // 404 = inconnue de cet environnement, on essaie l'autre. Toute autre erreur est definitive.
      if (r.status !== 404) break;
    }
  }
  throw new Error(`Apple n'a pas reconnu cet achat (${derniere}).`);
}

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
    const jws: string = body.jws || "";
    const productId: string = body.product_id || "";
    const beneficiaryPlayerIdRaw: string = body.beneficiary_player_id || "";
    if (!jws || !productId) return json({ error: "jws et product_id sont requis" }, 400);

    const brut = corpsNonVerifie(jws);
    const transactionId = String(brut?.transactionId ?? "");
    if (!transactionId) return json({ error: "Reçu d'achat illisible." }, 400);

    const admin = createClient(supabaseUrl, serviceKey);

    // Rejeu : si cette transaction a deja ouvert un acces, on le redit sans rien recreer. C'est le
    // cas NORMAL d'une restauration d'achat ou d'une reinstallation, pas une anomalie.
    const { data: dejaVue } = await admin
      .from("media_orders").select("id, status")
      .eq("apple_transaction_id", transactionId).maybeSingle();
    if (dejaVue) return json({ ok: true, deja_active: true, order_id: dejaVue.id });

    const { charge, environnement } = await demanderAApple(transactionId, await jetonApple());

    // ── Ce qu'Apple affirme doit correspondre a ce qu'on vend ──
    const bundleId = Deno.env.get("APPLE_BUNDLE_ID") ?? "";
    if (charge.bundleId !== bundleId) {
      return json({ error: "Cet achat n'appartient pas à cette application." }, 403);
    }
    if (charge.revocationDate) {
      return json({ error: "Cet achat a été remboursé." }, 400);
    }
    // Le verrou qui empeche de reutiliser le numero d'un autre acheteur (voir en-tete).
    if (String(charge.appAccountToken ?? "").toLowerCase() !== user.id.toLowerCase()) {
      return json({ error: "Cet achat a été réalisé depuis un autre compte." }, 403);
    }

    const { data: product } = await admin
      .from("media_products")
      .select("id, club_id, name, price_cents, currency, status, apple_product_id")
      .eq("id", productId).maybeSingle();
    if (!product || product.status !== "active") {
      return json({ error: "Ce produit n'est plus disponible." }, 400);
    }
    if (!product.apple_product_id || product.apple_product_id !== charge.productId) {
      // Payer le Pass d'un club pour ouvrir celui d'un autre : le produit Apple achete doit etre
      // exactement celui que ce media_products declare.
      return json({ error: "Cet achat ne correspond pas à ce produit." }, 400);
    }

    // ── Le beneficiaire, jamais pris tel quel (meme doctrine que create-pass-photo-checkout) ──
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

    // Le montant REELLEMENT facture par Apple. `price` est en milliemes d'unite (19990 = 19,99 €).
    const prixApple = typeof charge.price === "number" ? Math.round(charge.price / 10) : null;

    const { data: order, error: orderErr } = await admin
      .from("media_orders")
      .insert({
        club_id: product.club_id,
        product_id: product.id,
        purchased_by_user_id: user.id,
        beneficiary_person_id: beneficiaryPlayerId,
        amount_cents: prixApple ?? product.price_cents,
        currency: String(charge.currency ?? product.currency ?? "eur").toLowerCase(),
        status: "pending",
        shipping_status: "non_requis",
        source: "apple",
        apple_transaction_id: transactionId,
        note_encaissement: `App Store (${environnement})`,
      })
      .select("id").single();

    if (orderErr) {
      // Course entre deux appels simultanes pour la meme transaction : l'index unique a tranche,
      // et c'est le bon resultat. On rend l'acces deja cree plutot qu'une erreur.
      const { data: concurrente } = await admin
        .from("media_orders").select("id")
        .eq("apple_transaction_id", transactionId).maybeSingle();
      if (concurrente) return json({ ok: true, deja_active: true, order_id: concurrente.id });
      return json({ error: "Impossible d'enregistrer cet achat." }, 500);
    }

    // Le moteur unique de la v274 — le meme que Stripe et que l'encaissement manuel.
    const { data: active, error: activErr } = await admin
      .rpc("media_activer_commande", { p_order_id: order!.id });
    if (activErr) {
      console.error("[apple-iap-valider] activation échouée :", activErr);
      return json({ error: "Achat enregistré, mais l'accès n'a pas pu s'ouvrir. Contactez-nous." }, 500);
    }

    return json({ ok: true, order_id: order!.id, droits: (active as { droits?: number })?.droits ?? 0 });
  } catch (e) {
    console.error("[apple-iap-valider]", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
