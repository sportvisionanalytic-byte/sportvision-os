// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.
// Étape à faire à chaque édition : Supabase Dashboard → Edge Functions →
// create-funding-contribution-checkout → coller ce code → Deploy (nouvelle
// fonction, jamais encore déployée).
//
// Supabase Edge Function — create-funding-contribution-checkout
//
// Crée une session Stripe Checkout pour une participation authentifiée
// (in-app) à une cotisation personnelle SportVision Connect (group_fundings /
// funding_contributions, migration-connect-v50). Même patron que
// create-team-contribution-checkout (Club+, migration-clubplus-v21) : la
// seule vérité sur le montant collecté vient du webhook Stripe, jamais du
// retour navigateur ni d'un champ envoyé par le client.
//
// Sécurité :
//  - le montant est plafonné côté serveur au solde restant (jamais fait
//    confiance au client au-delà de cette borne) ;
//  - la cotisation doit être 'ouverte' (une cotisation 'objectif_atteint',
//    'expiree' ou 'annulee' n'accepte plus de nouvelles participations) ;
//  - l'accès en lecture à la cotisation est revérifié via
//    can_view_group_funding() (RLS-safe, RPC déjà en place) — un utilisateur
//    ne peut pas contribuer à une cotisation qu'il ne peut même pas voir.
//
// Utilisée par : bouton "Participer" et "Payer le reste" (reste ≤ 48 €,
// même bouton, montant = reste) sur /cotisations/[id].
//
// Deploy via Supabase dashboard > Edge Functions > New Function
// (name: create-funding-contribution-checkout)
// Secrets requis : SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
// STRIPE_SECRET_KEY (déjà utilisés par create-team-contribution-checkout)
// Secret optionnel : CONNECT_URL (déjà utilisé par create-team-contribution-checkout,
// pointe vers https://connect.sportvision-an.fr par défaut)

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

    const { funding_id, montant } = await req.json();
    if (!funding_id || !montant || Number(montant) <= 0) {
      return json({ error: "funding_id et montant sont obligatoires" }, 400);
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // can_view_group_funding() s'appuie sur auth.uid() (SECURITY DEFINER côté
    // Postgres) : on la relance via le client utilisateur (JWT forwardé),
    // jamais via le client admin, sinon auth.uid() serait NULL.
    const { data: canView } = await userClient.rpc("can_view_group_funding", { p_funding_id: funding_id });
    if (!canView) return json({ error: "Cotisation introuvable ou non autorisée" }, 404);

    const { data: funding } = await admin
      .from("group_fundings")
      .select("id, titre, statut, montant_cible, montant_collecte")
      .eq("id", funding_id)
      .maybeSingle();
    if (!funding) return json({ error: "Cotisation introuvable" }, 404);
    if (funding.statut !== "ouverte") {
      return json({ error: "Cette cotisation n'accepte plus de nouvelles participations." }, 400);
    }

    // Plafond serveur : jamais plus que ce qu'il reste à collecter, quelle
    // que soit la valeur envoyée par le client (même garde-fou que
    // create-team-contribution-checkout).
    const montantRestant = Math.round((Number(funding.montant_cible) - Number(funding.montant_collecte || 0)) * 100) / 100;
    if (montantRestant <= 0) {
      return json({ error: "L'objectif de cette cotisation est déjà atteint." }, 400);
    }
    if (Number(montant) > montantRestant) {
      return json({ error: `Le montant dépasse ce qu'il reste à collecter (${montantRestant.toFixed(2)} €).` }, 400);
    }

    const { data: contribution, error: contribErr } = await admin
      .from("funding_contributions")
      .insert({
        funding_id,
        contributor_user_id: user.id,
        montant,
        statut: "en_attente",
      })
      .select("id")
      .single();
    if (contribErr) return json({ error: contribErr.message }, 500);

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
            currency: "eur",
            product_data: { name: `SportVision — Cotisation : ${funding.titre}` },
            unit_amount: Math.round(Number(montant) * 100),
          },
          quantity: 1,
        },
      ],
      success_url: `${connectUrl}/cotisations/${funding_id}?paiement=succes&contribution_id=${contribution.id}`,
      cancel_url: `${connectUrl}/cotisations/${funding_id}?paiement=annule&contribution_id=${contribution.id}`,
      client_reference_id: contribution.id,
      metadata: { funding_contribution_id: contribution.id },
      customer_email: user.email ?? undefined,
    });

    await admin.from("funding_contributions").update({ stripe_checkout_session_id: session.id }).eq("id", contribution.id);

    return json({ url: session.url });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
