// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.
// Étape à faire à chaque édition : Supabase Dashboard → Edge Functions →
// connect-agent-billing-portal → coller ce code → Deploy.
// Oublier cette étape est la cause la plus fréquente de "le code est bon
// mais ça ne marche pas en prod" sur ce projet (déjà arrivé sur au moins
// 5 fonctions : clubplus-billing-portal, create-clubplus-subscription-
// checkout, dispatch-notifications, create-guest-rdv, create-guest-request).

// Supabase Edge Function — connect-agent-billing-portal
// Ouvre le Portail de facturation Stripe hébergé pour l'abonnement Agent d'un utilisateur :
// historique et téléchargement des factures, moyen de paiement. Décision volontaire (voir rapport
// final) : réutiliser le Portail Stripe standard pour CE besoin précis plutôt que de reconstruire
// une page de factures — Stripe le fournit déjà, testé, accessible, et à jour avec les vraies
// données de facturation. Le changement de palier et la résiliation, eux, passent PAR
// manage-agent-subscription (API directe), PAS par ce portail — pas besoin d'activer "Customers
// can switch plans" côté dashboard Stripe pour ce chantier (à la différence de Club+, dont le
// portail gère aussi le changement de formule).
//
// Sécurité : l'appelant doit être authentifié et n'ouvre le portail QUE pour SON PROPRE
// stripe_customer_id (résolu depuis son propre user_id, jamais un paramètre transmis par le
// client — contrairement à clubplus-billing-portal où club_id est un paramètre parce que
// l'appelant agit pour un club, pas pour lui-même).
//
// Deploy via Supabase dashboard > Edge Functions > New Function (name: connect-agent-billing-portal)
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

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: sub } = await admin
      .from("connect_agent_subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!sub?.stripe_customer_id) {
      return json({ error: "Aucun abonnement Stripe pour ce compte — souscrivez d'abord un abonnement Agent." }, 400);
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${connectUrl}/particulier/abonnement`,
    });

    return json({ url: portalSession.url });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
