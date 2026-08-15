// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.
// Étape à faire à chaque édition : Supabase Dashboard → Edge Functions →
// manage-agent-subscription → coller ce code → Deploy.
// Oublier cette étape est la cause la plus fréquente de "le code est bon
// mais ça ne marche pas en prod" sur ce projet (déjà arrivé sur au moins
// 5 fonctions : clubplus-billing-portal, create-clubplus-subscription-
// checkout, dispatch-notifications, create-guest-rdv, create-guest-request).

// Supabase Edge Function — manage-agent-subscription
// Change de palier (upgrade/downgrade) ou résilie/réactive l'abonnement Agent d'un utilisateur en
// modifiant DIRECTEMENT la Subscription Stripe existante (stripe.subscriptions.update), sans
// jamais recréer de session Checkout — consigne explicite du brief : "pas une nouvelle session
// Checkout à chaque fois". Le Portail de facturation Stripe (connect-agent-billing-portal) reste
// disponible EN PLUS pour l'historique de factures et le moyen de paiement, mais ce fichier-ci est
// le seul point d'entrée pour changer de palier ou annuler, quel que soit le canal (page "Mon
// abonnement" d'app-connect).
//
// Sécurité : l'appelant doit être authentifié et n'agit QUE sur SA PROPRE ligne
// connect_agent_subscriptions (résolue depuis son propre user_id, jamais un paramètre transmis
// par le client). connect_agent_subscriptions n'est jamais écrit directement ici : chaque action
// Stripe déclenche un événement customer.subscription.updated que stripe-webhook traite comme
// source de vérité (MASTER-CONNECT-V1.md §25 — même principe que create-agent-subscription-
// checkout, qui n'écrit pas non plus le statut final). Cette fonction se contente d'appeler
// l'API Stripe et de renvoyer le résultat brut ; l'état affiché à l'utilisateur ne devient
// définitif qu'une fois le webhook traité (délai typique : quelques centaines de ms).
//
// actions supportées (body.action) :
//   "change_tier"  { tier: "starter"|"growth"|"pro" } — proratisé par Stripe (create_prorations,
//                    comportement par défaut), effectif immédiatement dans les deux sens.
//   "cancel"       { }  — résiliation à la fin de la période déjà payée (cancel_at_period_end =
//                    true), jamais immédiate : l'utilisateur a déjà payé ce mois, il garde son
//                    palier jusqu'à l'échéance plutôt que de perdre l'accès à des sportifs suivis
//                    en cours de mois — choix documenté, cohérent avec l'absence de politique de
//                    remboursement au prorata ailleurs dans ce projet.
//   "reactivate"   { }  — annule une résiliation programmée (cancel_at_period_end → false) tant
//                    que la période en cours n'est pas terminée.
//
// Deploy via Supabase dashboard > Edge Functions > New Function (name: manage-agent-subscription)
// Secrets requis : SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY,
//                  STRIPE_PRICE_AGENT_STARTER, STRIPE_PRICE_AGENT_GROWTH, STRIPE_PRICE_AGENT_PRO

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

    if (!stripeSecretKey) return json({ error: "STRIPE_SECRET_KEY non configurée" }, 500);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Session invalide" }, 401);
    const user = userData.user;

    const body = await req.json();
    const action: string = body.action || "";
    if (!["change_tier", "cancel", "reactivate"].includes(action)) {
      return json({ error: "Action inconnue" }, 400);
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: sub } = await admin
      .from("connect_agent_subscriptions")
      .select("stripe_subscription_id, status")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!sub?.stripe_subscription_id) {
      return json({ error: "Aucun abonnement Agent trouvé pour ce compte." }, 404);
    }
    if (sub.status === "canceled") {
      return json({ error: "Cet abonnement est déjà résilié — souscrivez un nouvel abonnement depuis Mon abonnement." }, 400);
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    if (action === "change_tier") {
      const tier: string = body.tier || "";
      if (!["starter", "growth", "pro"].includes(tier)) {
        return json({ error: "Palier inconnu (starter, growth ou pro attendu)" }, 400);
      }
      const priceId = Deno.env.get(TIER_ENV_KEY[tier]) || "";
      if (!priceId) {
        return json({ error: `${TIER_ENV_KEY[tier]} non configurée — créez d'abord le Price côté Stripe.` }, 500);
      }

      const current = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
      const itemId = current.items.data[0]?.id;
      if (!itemId) return json({ error: "Ligne d'abonnement Stripe introuvable." }, 500);

      const updated = await stripe.subscriptions.update(sub.stripe_subscription_id, {
        items: [{ id: itemId, price: priceId }],
        proration_behavior: "create_prorations",
        // Une résiliation programmée annulée implicitement par un changement de palier : changer
        // de formule signifie vouloir continuer, pas confirmer l'arrêt déjà demandé.
        cancel_at_period_end: false,
        metadata: { ...current.metadata, user_id: user.id, tier },
      });

      return json({ ok: true, status: updated.status });
    }

    if (action === "cancel") {
      const updated = await stripe.subscriptions.update(sub.stripe_subscription_id, {
        cancel_at_period_end: true,
      });
      return json({ ok: true, cancel_at_period_end: updated.cancel_at_period_end, current_period_end: updated.current_period_end });
    }

    // action === "reactivate"
    const updated = await stripe.subscriptions.update(sub.stripe_subscription_id, {
      cancel_at_period_end: false,
    });
    return json({ ok: true, cancel_at_period_end: updated.cancel_at_period_end });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
