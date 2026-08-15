// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.
// Étape à faire à chaque édition : Supabase Dashboard → Edge Functions →
// create-agent-subscription-checkout → coller ce code → Deploy.
// Oublier cette étape est la cause la plus fréquente de "le code est bon
// mais ça ne marche pas en prod" sur ce projet (déjà arrivé sur au moins
// 5 fonctions : clubplus-billing-portal, create-clubplus-subscription-
// checkout, dispatch-notifications, create-guest-rdv, create-guest-request).

// Supabase Edge Function — create-agent-subscription-checkout
// Crée une session Stripe Checkout en mode `subscription` pour l'abonnement Agent d'un
// utilisateur SportVision Connect (Espace particulier, compte "Agent / représentant" qui suit
// plusieurs sportifs — migration-connect-v57-abonnement-agent.sql). Première intégration Stripe
// RÉCURRENTE côté Espace particulier — même patron de sécurité que
// create-clubplus-subscription-checkout, avec UNE différence volontaire : les 3 Price Stripe
// (Starter/Growth/Pro) sont créés MANUELLEMENT par Fouka dans le dashboard (pas de création
// dynamique via price_data ni via l'API Prices ici) et lus depuis 3 variables d'environnement —
// consigne explicite du brief : "ne invente pas de montant en dur côté code". Si l'une des 3
// variables n'est pas configurée, la fonction répond une erreur claire plutôt que de deviner un
// tarif.
//
// Sécurité :
//   * l'appelant doit être authentifié (JWT Supabase) — c'est lui-même qui s'abonne, jamais pour
//     un tiers (contrairement à create-clubplus-subscription-checkout où un admin agit pour son
//     club) ;
//   * le tarif n'est JAMAIS transmis par le client : seul `tier` (starter|growth|pro) l'est, et le
//     Price ID réel est relu depuis les variables d'environnement ci-dessous ;
//   * connect_agent_subscriptions n'est JAMAIS écrit ici : c'est le webhook Stripe (paiement
//     réellement encaissé) qui l'écrit, jamais l'intention de payer (MASTER-CONNECT-V1.md §25).
//
// Un utilisateur déjà abonné (ligne active) doit passer par manage-agent-subscription pour
// changer de palier — créer une seconde session d'abonnement le ferait payer deux fois.
//
// Deploy via Supabase dashboard > Edge Functions > New Function
// (name: create-agent-subscription-checkout)
// Secrets requis : SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY,
//                  CONNECT_URL, STRIPE_PRICE_AGENT_STARTER, STRIPE_PRICE_AGENT_GROWTH,
//                  STRIPE_PRICE_AGENT_PRO
//
// ACTION MANUELLE REQUISE AVANT QUE CETTE FONCTION MARCHE : créer 3 Price Stripe récurrents
// mensuels (9,90 € / 15,90 € / 24,90 €) dans le Dashboard Stripe → Product catalog, et renseigner
// leurs Price ID (price_xxx) dans les 3 variables d'environnement ci-dessus. Voir le résumé en fin
// de migration-connect-v57-abonnement-agent.sql.

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

const TIER_ENV_KEY: Record<string, string> = {
  starter: "STRIPE_PRICE_AGENT_STARTER",
  growth: "STRIPE_PRICE_AGENT_GROWTH",
  pro: "STRIPE_PRICE_AGENT_PRO",
};

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
    const tier: string = body.tier || "";
    if (!["starter", "growth", "pro"].includes(tier)) {
      return json({ error: "Palier inconnu (starter, growth ou pro attendu)" }, 400);
    }

    const priceId = Deno.env.get(TIER_ENV_KEY[tier]) || "";
    if (!priceId) {
      return json({ error: `${TIER_ENV_KEY[tier]} non configurée — créez d'abord le Price côté Stripe.` }, 500);
    }

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: existing } = await admin
      .from("connect_agent_subscriptions")
      .select("stripe_customer_id, status")
      .eq("user_id", user.id)
      .maybeSingle();

    if (existing?.status === "active") {
      return json({ error: "Vous avez déjà un abonnement Agent actif — utilisez « Changer de palier » depuis Mon abonnement." }, 400);
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    // Client Stripe : créé une fois par utilisateur, réutilisé ensuite (même principe que
    // create-clubplus-subscription-checkout — le stripe_customer_id porte l'historique de
    // facturation et conditionne l'accès au Portail). Écrit tout de suite via une ligne
    // "incomplete" pour ne jamais recréer un client Stripe en double si l'utilisateur abandonne le
    // paiement puis recommence.
    let customerId: string = existing?.stripe_customer_id || "";
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { user_id: user.id },
      });
      customerId = customer.id;
      await admin.from("connect_agent_subscriptions").upsert(
        { user_id: user.id, stripe_customer_id: customerId, tier, status: "incomplete" },
        { onConflict: "user_id" },
      );
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${connectUrl}/particulier/abonnement?abonnement=succes`,
      cancel_url: `${connectUrl}/particulier/abonnement?abonnement=annule`,
      client_reference_id: user.id,
      // Recopiés sur la session ET sur l'abonnement lui-même : stripe-webhook lit metadata.tier
      // sur checkout.session.completed (activation initiale, cf. son en-tête) et retrouve le
      // Price réel de l'abonnement sur customer.subscription.updated (changements ultérieurs,
      // Portail ou API) — les deux chemins sont indépendants et documentés dans stripe-webhook.
      metadata: { user_id: user.id, tier },
      subscription_data: { metadata: { user_id: user.id, tier } },
    });

    return json({ url: session.url });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
