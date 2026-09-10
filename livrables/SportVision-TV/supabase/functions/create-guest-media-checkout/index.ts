// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.
// Étape à faire à chaque édition : Supabase Dashboard → Edge Functions →
// create-guest-media-checkout → coller ce code → Deploy.

// Supabase Edge Function — create-guest-media-checkout
// 04/09/2026 (prompt #8 backlog Club+ V2, décision Fouka : construire le parcours invité) —
// équivalent SANS AUTHENTIFICATION de create-pass-photo-checkout, pour une famille qui n'a pas
// encore de compte SportVision Connect. Appelée depuis /media-checkout/[token] (app-connect, page
// publique, voir middleware PUBLIC_PATHS).
//
// Différence de fond avec create-guest-funding-contribution-checkout (paiement collectif, aucun
// compte requis même après paiement) : un media_entitlements est un DROIT D'ACCÈS DURABLE, pas un
// paiement ponctuel — sans compte pour le vérifier plus tard, l'invité n'aurait aucun moyen de
// revoir ce qu'il a acheté. Cette fonction crée donc (ou réutilise, jamais deviné) un compte
// auth.users via l'API Admin, exactement comme clubplus-family-invite le fait déjà pour les
// invitations joueur/parent — même motif copié tel quel (inviteUserByEmail, catch "already", puis
// listUsers pour retrouver le compte existant).
//
// DETTE CONNUE (10/09/2026, décision de Fouka de NE PAS la traiter maintenant) : le compte est créé,
// et l'e-mail d'invitation Supabase envoyé, AVANT le paiement. Qui abandonne au moment de payer
// garde un compte et un e-mail qu'il n'a pas demandés. Le bon ordre serait de ne créer le compte
// qu'au paiement confirmé (stripe-webhook) — mais c'est le circuit Stripe de production, et cette
// fonction n'est aujourd'hui atteinte par aucun lien : l'écran de l'OS qui fabrique les liens
// /media-checkout/<jeton> existe, mais media_guest_checkout_tokens est vide (0 ligne au 10/09/2026).
// À reprendre avant la première diffusion d'un tel lien.
//
// Sécurité : le token est LA vérification (généré côté staff pour un produit + bénéficiaire
// précis, voir migration-media-guest-checkout.sql) — aucune donnée sensible n'est acceptée depuis
// le client au-delà du token + l'e-mail de l'acheteur. Le tarif n'est jamais transmis par le
// client (relu depuis media_products, comme create-pass-photo-checkout). media_entitlements
// n'est JAMAIS écrit ici : c'est le webhook Stripe (stripe-webhook, branche déjà existante
// metadata.product==='media_pass') qui l'écrit — aucune modification du webhook nécessaire, la
// commande créée ici a exactement la même forme que celle du parcours authentifié.
//
// Secrets requis : SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY,
//                  CONNECT_URL

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

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

// deno-lint-ignore no-explicit-any
async function checkRateLimit(admin: any, identifiant: string) {
  const { data, error } = await admin.rpc("check_and_record_rate_limit", {
    p_identifiant: identifiant,
    p_max: RATE_LIMIT_MAX,
    p_window_seconds: RATE_LIMIT_WINDOW_MS / 1000,
  });
  if (error) return false;
  return data === true;
}

/** Le compte dont l'adresse (en minuscules) est exactement `email`, en parcourant TOUTES les pages
 *  de l'API d'administration, ou null.
 *  La boucle ne s'arrête que sur une page VIDE, et non sur une page « incomplète » : si l'API
 *  plafonnait un jour la taille des pages en dessous de ce qu'on demande, une page de 50 comptes
 *  sur 1000 demandés ne voudrait pas dire « fin ». Coût : un appel de plus (au 10/09/2026, moins de
 *  50 comptes : deux appels). Le plafond de pages n'est qu'un garde-fou contre une boucle sans fin. */
// deno-lint-ignore no-explicit-any
async function compteParAdresse(admin: any, email: string): Promise<{ id: string } | null> {
  for (let page = 1; page <= 1000; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const comptes: { id: string; email?: string }[] = data?.users ?? [];
    if (comptes.length === 0) return null;
    const trouve = comptes.find((u) => (u.email || "").trim().toLowerCase() === email);
    if (trouve) return { id: trouve.id };
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
    const connectUrl = Deno.env.get("CONNECT_URL") || "https://connect.sportvision-an.fr";
    if (!stripeSecretKey) return json({ error: "STRIPE_SECRET_KEY non configurée" }, 500);

    const admin = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const token: string = (body.token || "").trim();
    const email: string = (body.email || "").trim().toLowerCase();
    const shipping = body.shipping as { name?: string; addressLine?: string; postalCode?: string; city?: string } | undefined;
    if (!token || !email) return json({ error: "token et email sont requis" }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json({ error: "Adresse e-mail invalide" }, 400);

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("cf-connecting-ip") || "inconnu";
    const rateOk = await checkRateLimit(admin, `media_guest:${ip}`);
    if (!rateOk) {
      return json({ error: "Trop de demandes envoyées récemment. Merci de réessayer plus tard." }, 429);
    }

    const { data: tokenRow } = await admin
      .from("media_guest_checkout_tokens")
      .select("id, club_id, product_id, beneficiary_person_id, max_uses, used_count, expires_at")
      .eq("token", token)
      .maybeSingle();
    if (!tokenRow) return json({ error: "Ce lien n'existe pas ou n'est plus valide." }, 404);
    if (new Date(tokenRow.expires_at).getTime() < Date.now()) return json({ error: "Ce lien a expiré." }, 400);
    if (tokenRow.used_count >= tokenRow.max_uses) return json({ error: "Ce lien a déjà été utilisé." }, 400);

    const { data: product } = await admin
      .from("media_products")
      .select("id, club_id, name, price_cents, currency, status, physical_product")
      .eq("id", tokenRow.product_id)
      .maybeSingle();
    if (!product || product.status !== "active") {
      return json({ error: "Ce produit n'est plus disponible." }, 400);
    }
    if (product.physical_product && (!shipping?.name || !shipping.addressLine || !shipping.postalCode || !shipping.city)) {
      return json({ error: "Adresse de livraison requise pour ce produit." }, 400);
    }

    const { data: existing } = await admin
      .from("media_entitlements")
      .select("id")
      .eq("beneficiary_person_id", tokenRow.beneficiary_person_id)
      .eq("product_id", tokenRow.product_id)
      .eq("status", "active")
      .limit(1);
    if (existing && existing.length > 0) {
      return json({ error: "L'accès a déjà été accordé pour ce produit." }, 400);
    }

    // Résolution du compte acheteur — jamais un doublon (voir clubplus-family-invite, même motif
    // copié tel quel) : une Fonction Postgres ne peut pas appeler l'API Admin Auth, d'où sa
    // présence ici plutôt que dans une RPC SQL.
    //
    // 10/09/2026 — le lien de l'e-mail d'invitation menait à `${connectUrl}/`. C'est un lien à
    // jetons dans le fragment (#access_token=…) que Connect n'ouvre pas à cet endroit : mesuré avec
    // le même lien (generate_link type=invite), l'acheteur arrivait sur l'écran de connexion, adresse
    // confirmée mais sans session ni mot de passe, et sans un mot d'explication. /auth/reset lit ce
    // fragment et fait choisir le mot de passe (vérifié : puis Espace particulier). L'intention
    // « compte particulier » voyage dans les métadonnées, rejouée par cet écran — un acheteur de
    // photos n'est pas un joueur (voir lib/signup/pending-onboarding.ts côté Connect).
    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${connectUrl}/auth/reset`,
      data: { sv_inscription: { action: "skip", accountType: "particulier", email } },
    });
    let buyerUserId: string | null = invited?.user?.id ?? null;
    if (inviteErr) {
      const msg = inviteErr.message || "";
      if (!/already/i.test(msg)) return json({ error: msg }, 500);
      // Recherche exhaustive (10/09/2026, décision de Fouka). L'ancienne ne lisait que la première
      // page de 200 comptes : au 201e compte du projet, un acheteur déjà inscrit recevait « Cet
      // e-mail est déjà utilisé mais introuvable » et ne pouvait plus payer. `email` est déjà en
      // minuscules (plus haut) ; la comparaison l'est aussi côté comptes.
      const match = await compteParAdresse(admin, email);
      if (!match) return json({ error: "Cet e-mail est déjà utilisé mais introuvable." }, 500);
      buyerUserId = match.id;
    }
    if (!buyerUserId) return json({ error: "Échec de la résolution du compte." }, 500);

    // Verrou d'usage : n'incrémente que si used_count < max_uses au moment de l'écriture — évite
    // qu'un même lien dépasse max_uses sous deux requêtes concurrentes.
    const { data: lockedToken } = await admin
      .from("media_guest_checkout_tokens")
      .update({ used_count: tokenRow.used_count + 1 })
      .eq("id", tokenRow.id)
      .lt("used_count", tokenRow.max_uses)
      .select("id")
      .maybeSingle();
    if (!lockedToken) return json({ error: "Ce lien a déjà été utilisé." }, 400);

    const { data: order, error: orderErr } = await admin
      .from("media_orders")
      .insert({
        club_id: product.club_id,
        product_id: product.id,
        purchased_by_user_id: buyerUserId,
        beneficiary_person_id: tokenRow.beneficiary_person_id,
        amount_cents: product.price_cents,
        currency: product.currency,
        status: "pending",
        shipping_status: product.physical_product ? "a_preparer" : "non_requis",
        shipping_name: product.physical_product ? shipping!.name : null,
        shipping_address_line: product.physical_product ? shipping!.addressLine : null,
        shipping_postal_code: product.physical_product ? shipping!.postalCode : null,
        shipping_city: product.physical_product ? shipping!.city : null,
      })
      .select("id")
      .single();
    if (orderErr || !order) return json({ error: "Impossible de créer la commande." }, 500);

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: product.currency,
            unit_amount: product.price_cents,
            product_data: { name: product.name },
          },
          quantity: 1,
        },
      ],
      success_url: `${connectUrl}/media-checkout/${token}?paiement=succes`,
      cancel_url: `${connectUrl}/media-checkout/${token}?paiement=annule`,
      client_reference_id: buyerUserId,
      // Même branche que le parcours authentifié (create-pass-photo-checkout) — le webhook ne
      // sait pas et n'a pas besoin de savoir que cette commande vient d'un invité.
      metadata: { product: "media_pass", order_id: order.id },
      customer_email: email,
    });

    return json({ url: session.url });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
