// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.
// Étape à faire à chaque édition : Supabase Dashboard → Edge Functions →
// clubplus-billing-portal → coller ce code → Deploy.
// Oublier cette étape est la cause la plus fréquente de "le code est bon
// mais ça ne marche pas en prod" sur ce projet (déjà arrivé sur au moins
// 5 fonctions : clubplus-billing-portal, create-clubplus-subscription-
// checkout, dispatch-notifications, create-guest-rdv, create-guest-request).

// Supabase Edge Function — clubplus-billing-portal
// Ouvre le Portail de facturation Stripe hébergé pour l'abonnement Club+ d'un
// club : historique et téléchargement des factures, moyen de paiement,
// changement de formule (avec proration) et résiliation. Toute cette UI est
// fournie par Stripe — elle n'est volontairement PAS réimplémentée côté Club+,
// qui se contente de rediriger vers l'URL retournée ici.
//
// Sécurité : l'appelant doit être admin ACTIF du club ciblé (vérifié en
// service_role sur club_members, jamais depuis un rôle envoyé par le client).
// Un club sans stripe_customer_id n'a jamais payé : il doit d'abord passer par
// create-clubplus-subscription-checkout.
//
// CONFIGURATION STRIPE REQUISE (une fois, dans le dashboard) :
// Stripe → Settings → Billing → Customer portal
//   * activer « Invoice history » (factures téléchargeables) ;
//   * activer « Cancel subscriptions » (résiliation) ;
//   * pour autoriser le changement de formule : activer « Customers can switch
//     plans » et y ajouter les 2 produits SportVision Club+ créés par
//     create-clubplus-subscription-checkout (sportvision_clubplus et
//     sportvision_clubplus_performance) avec leurs 2 prix chacun (engagement
//     12 mois / sans engagement).
// Tant que « switch plans » n'est pas activé côté dashboard, le portail ne
// propose QUE la consultation des factures, le moyen de paiement et la
// résiliation — le changement de formule reste alors à faire par SportVision.
// Ce n'est pas un bug silencieux : le webhook (customer.subscription.updated)
// sait déjà relire la formule réelle depuis le Price de l'abonnement, donc
// activer l'option dans le dashboard suffit à rendre le changement de formule
// fonctionnel de bout en bout, sans redéploiement.
//
// Deploy via Supabase dashboard > Edge Functions > New Function
// (name: clubplus-billing-portal)
// Secrets requis : SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
//                  STRIPE_SECRET_KEY, CONNECT_URL
//
// Fix du 08/08/2026 : return_url pointait vers l'ancienne app Club+
// (app.html) au lieu de Connect.

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
    const connectUrl = Deno.env.get("CONNECT_URL") || "https://connect.sportvision.fr";

    if (!stripeSecretKey) return json({ error: "STRIPE_SECRET_KEY non configurée" }, 500);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Session invalide" }, 401);
    const user = userData.user;

    const body = await req.json();
    const clubId: string = body.club_id || "";
    if (!clubId) return json({ error: "club_id est obligatoire" }, 400);

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: callerMember } = await admin
      .from("club_members")
      .select("id")
      .eq("user_id", user.id)
      .eq("club_id", clubId)
      .eq("role", "admin")
      .eq("status", "actif")
      .maybeSingle();
    if (!callerMember) {
      return json({ error: "Seul un administrateur du club peut gérer l'abonnement." }, 403);
    }

    const { data: club } = await admin
      .from("clubs")
      .select("id, stripe_customer_id")
      .eq("id", clubId)
      .maybeSingle();
    if (!club) return json({ error: "Club introuvable" }, 404);
    if (!club.stripe_customer_id) {
      return json({ error: "Aucun abonnement Stripe pour ce club — activez d'abord votre abonnement." }, 400);
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: club.stripe_customer_id,
      return_url: `${connectUrl}/`,
    });

    return json({ url: portalSession.url });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
