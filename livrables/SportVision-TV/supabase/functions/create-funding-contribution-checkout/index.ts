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
      .select("id, titre, statut, montant_cible, montant_collecte, date_limite")
      .eq("id", funding_id)
      .maybeSingle();
    if (!funding) return json({ error: "Cotisation introuvable" }, 404);
    // Pas de cron qui bascule group_fundings.statut à 'expiree' (voir migration-connect-v50,
    // list_my_fundings()/get_funding_detail() dérivent l'expiration à la lecture) — la colonne
    // `statut` en base reste donc 'ouverte' indéfiniment après la date limite. Le bouton
    // "Participer" est déjà masqué côté UI une fois expirée (get_funding_detail renvoie le
    // statut dérivé), mais cette fonction doit revérifier elle-même la date limite pour ne pas
    // dépendre uniquement de ce que l'écran affiche — même correctif déjà en place côté
    // create-guest-funding-contribution-checkout (bug trouvé lors de l'audit du 15/08 : cette
    // fonction-ci ne le vérifiait pas, contrairement à la version invité).
    const expiree = funding.statut === "ouverte" && funding.date_limite && funding.date_limite < new Date().toISOString().slice(0, 10);
    if (funding.statut !== "ouverte" || expiree) {
      return json({ error: "Cette cotisation n'accepte plus de nouvelles participations." }, 400);
    }

    // Plafond serveur : jamais plus que ce qu'il reste à collecter, quelle
    // que soit la valeur envoyée par le client (même garde-fou que
    // create-team-contribution-checkout).
    //
    // Durcissement du 16/08/2026 (audit paiements) : `montant_collecte` ne reflète que les
    // contributions déjà 'paye' (trigger recompute_group_funding_amount) — deux contributeurs
    // qui demandent chacun "payer le reste" à quelques secondes d'intervalle voyaient tous les
    // deux le MÊME solde restant, avant que le premier paiement n'ait eu le temps d'être confirmé
    // par le webhook. Les deux sessions Stripe étaient donc valides, et si les deux paient,
    // l'objectif est dépassé (déjà atténué côté webhook par une notification staff best-effort,
    // voir stripe-webhook/index.ts, mais rien n'empêchait la création des deux sessions ici).
    // Réduit la fenêtre de course (ne l'élimine pas — deux requêtes strictement simultanées à la
    // milliseconde près resteraient possibles, un verrou DB tenu pendant tout l'appel Stripe
    // serait plus risqué que utile) en comptant aussi les contributions 'en_attente' encore
    // valides (session Stripe pas encore expirée, 24h par défaut en mode 'payment' — au-delà,
    // checkout.session.expired les repasse à 'echoue' et elles ne comptent plus).
    const { data: enAttente } = await admin
      .from("funding_contributions")
      .select("montant")
      .eq("funding_id", funding_id)
      .eq("statut", "en_attente")
      .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    const montantEnAttente = (enAttente || []).reduce((sum, c) => sum + Number(c.montant), 0);

    const montantRestant = Math.round((Number(funding.montant_cible) - Number(funding.montant_collecte || 0) - montantEnAttente) * 100) / 100;
    if (montantRestant <= 0) {
      return json({ error: "L'objectif de cette cotisation est déjà atteint ou en cours de règlement par d'autres contributeurs — réessayez dans quelques minutes." }, 400);
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
