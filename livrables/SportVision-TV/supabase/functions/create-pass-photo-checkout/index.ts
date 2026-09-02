// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.
// Étape à faire à chaque édition : Supabase Dashboard → Edge Functions →
// create-pass-photo-checkout → coller ce code → Deploy.
// Oublier cette étape est la cause la plus fréquente de "le code est bon
// mais ça ne marche pas en prod" sur ce projet (déjà arrivé sur au moins
// 5 fonctions : clubplus-billing-portal, create-clubplus-subscription-
// checkout, dispatch-notifications, create-guest-rdv, create-guest-request).

// Supabase Edge Function — create-pass-photo-checkout
// 02/09/2026 : généralisée pour le moteur média générique (migration-media-v1-moteur-generique.sql)
// — remplace le Pass Photo figé équipe+saison (migration-connect-pass-photo-v1, jamais activé
// commercialement, aucune vente réelle). Le nom du fichier n'a pas changé pour éviter un
// redéploiement sous un nouveau nom (voir avertissement ci-dessus), mais elle vend désormais
// N'IMPORTE QUEL media_products actif d'un club — le catalogue est 100% configuré depuis l'OS,
// jamais en dur ici.
//
// Sécurité (inchangée sur le fond) :
//   * l'appelant doit être authentifié (JWT Supabase), c'est un joueur qui achète pour lui-même
//     (le cas "parent achète pour son enfant" est une évolution future, non couverte ici — voir
//     beneficiary_person_id ci-dessous) ;
//   * le tarif n'est JAMAIS transmis par le client : seul product_id l'est, price_cents est relu
//     depuis la ligne media_products en base (écriture réservée admin/sec côté RLS,
//     media_staff_write()) — jamais un prix client, jamais deviné ;
//   * media_entitlements n'est JAMAIS écrit ici : c'est le webhook Stripe (paiement réellement
//     encaissé, checkout.session.completed) qui l'écrit, jamais l'intention de payer
//     (MASTER-CONNECT-V1.md §25) ;
//   * un media_orders 'pending' est créé AVANT la session Stripe (séparation Order/Payment/
//     Entitlement, point 14 du master prompt) — le webhook le fait passer à 'paid' et crée
//     l'entitlement en référence, jamais l'inverse.
//
// Secrets requis : SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY,
//                  CONNECT_URL

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Authentification requise" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
    const connectUrl = Deno.env.get("CONNECT_URL") || "https://connect.sportvision-an.fr";

    if (!stripeSecretKey) return json({ error: "STRIPE_SECRET_KEY non configurée" }, 500);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Session invalide" }, 401);
    const user = userData.user;

    const body = await req.json();
    const productId: string = body.product_id || "";
    if (!productId) return json({ error: "product_id est requis" }, 400);

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: product } = await admin
      .from("media_products")
      .select("id, club_id, name, price_cents, currency, status")
      .eq("id", productId)
      .maybeSingle();
    if (!product || product.status !== "active") {
      return json({ error: "Ce produit n'est plus disponible." }, 400);
    }

    // Cette fonction ne gère que le cas "un joueur achète pour lui-même" (persona Espace joueur).
    // Le bénéficiaire du droit est toujours son propre profil joueur, distinct de purchased_by
    // uniquement dans le futur parcours parent→enfant, pas encore construit côté UI.
    const { data: playerProfile } = await admin
      .from("player_profiles")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!playerProfile) {
      return json({ error: "Compte joueur requis pour cet achat." }, 400);
    }

    const { data: existing } = await admin
      .from("media_entitlements")
      .select("id")
      .eq("beneficiary_person_id", playerProfile.id)
      .eq("product_id", productId)
      .eq("status", "active")
      .limit(1);
    if (existing && existing.length > 0) {
      return json({ error: "Vous avez déjà accès à ce produit." }, 400);
    }

    const { data: order, error: orderErr } = await admin
      .from("media_orders")
      .insert({
        club_id: product.club_id,
        product_id: product.id,
        purchased_by_user_id: user.id,
        beneficiary_person_id: playerProfile.id,
        amount_cents: product.price_cents,
        currency: product.currency,
        status: "pending",
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
      success_url: `${connectUrl}/photos?paiement=succes`,
      cancel_url: `${connectUrl}/photos?paiement=annule`,
      client_reference_id: user.id,
      // Lus par stripe-webhook sur checkout.session.completed — product:'media_pass' est le champ
      // distinctif qui branche cette session AVANT tout repli sur paiementId/contributionId (même
      // principe que abonnementClubId/agentUserId, voir son en-tête). order_id porte toute
      // l'information nécessaire (club/produit/bénéficiaire déjà posés en base, jamais redupliqués
      // ici pour éviter toute divergence entre metadata Stripe et media_orders).
      metadata: {
        product: "media_pass",
        order_id: order.id,
      },
      customer_email: user.email ?? undefined,
    });

    return json({ url: session.url });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
