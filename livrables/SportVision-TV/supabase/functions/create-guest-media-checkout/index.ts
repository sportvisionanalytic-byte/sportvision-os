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
    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${connectUrl}/`,
    });
    let buyerUserId: string | null = invited?.user?.id ?? null;
    if (inviteErr) {
      const msg = inviteErr.message || "";
      if (!/already/i.test(msg)) return json({ error: msg }, 500);
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const match = list?.users?.find((u: { email?: string }) => (u.email || "").toLowerCase() === email);
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
