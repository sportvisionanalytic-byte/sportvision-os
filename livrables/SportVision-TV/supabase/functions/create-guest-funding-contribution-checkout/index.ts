// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.
// Étape à faire à chaque édition : Supabase Dashboard → Edge Functions →
// create-guest-funding-contribution-checkout → coller ce code → Deploy
// (nouvelle fonction, jamais encore déployée).
//
// Supabase Edge Function — create-guest-funding-contribution-checkout
//
// Crée une session Stripe Checkout pour une participation SANS COMPTE à une
// cotisation personnelle SportVision Connect (page publique "Connect
// Cotisation Publique", route /cotisation/[token] dans app-connect — voir
// design-connect-personnel-12-08/Connect Cotisation Publique.dc.html).
// Même patron anti-abus que create-guest-payment-checkout (rate limit par IP
// via guest_rate_limits) et même règle de vérité que le reste du chantier :
// le webhook Stripe confirme, jamais le retour navigateur seul.
//
// Le token (group_fundings.share_token) est un identifiant opaque non
// prédictible (32 caractères hex, généré par gen_random_uuid() côté SQL,
// migration-connect-v50) — c'est la seule "authentification" de cette route
// entièrement publique, exactement comme prestation_id+email pour
// create-guest-payment-checkout.
//
// Deploy via Supabase dashboard > Edge Functions > New Function
// (name: create-guest-funding-contribution-checkout)
// Secrets requis : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY

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
  // Fonction atomique (migration-audit-25-08-corrections-batch1.sql, 25/08/2026) : l'ancien
  // motif COUNT puis INSERT séparés laissait une fenêtre de course entre deux appels concurrents
  // (répété tel quel dans ~20 edge functions) — verrou transactionnel scopé à l'identifiant côté
  // Postgres, plus de race condition possible.
  const { data, error } = await admin.rpc("check_and_record_rate_limit", {
    p_identifiant: identifiant,
    p_max: RATE_LIMIT_MAX,
    p_window_seconds: RATE_LIMIT_WINDOW_MS / 1000,
  });
  if (error) return false;
  return data === true;
}

function validEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v).trim());
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

    const { token, prenom, email, montant } = await req.json();
    if (!token || !prenom || !email || !montant || Number(montant) <= 0) {
      return json({ error: "token, prenom, email et montant sont obligatoires" }, 400);
    }
    if (!validEmail(String(email))) {
      return json({ error: "Adresse e-mail invalide" }, 400);
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("cf-connecting-ip") || "inconnu";
    const rateOk = await checkRateLimit(admin, `funding:${ip}`);
    if (!rateOk) {
      return json({ error: "Trop de demandes envoyées récemment. Merci de réessayer plus tard." }, 429);
    }

    const { data: funding } = await admin
      .from("group_fundings")
      .select("id, titre, statut, montant_cible, montant_collecte, date_limite")
      .eq("share_token", token)
      .maybeSingle();
    if (!funding) return json({ error: "Cotisation introuvable" }, 404);

    const expiree = funding.statut === "ouverte" && funding.date_limite && funding.date_limite < new Date().toISOString().slice(0, 10);
    if (funding.statut !== "ouverte" || expiree) {
      return json({ error: "Cette cotisation n'accepte plus de nouvelles participations." }, 400);
    }

    // Durcissement du 16/08/2026 (audit paiements) — même correctif que la version authentifiée
    // create-funding-contribution-checkout : compte aussi les contributions 'en_attente' encore
    // valides (session Stripe pas expirée, 24h) pour réduire la fenêtre de course entre deux
    // contributeurs qui demanderaient "payer le reste" quasi simultanément.
    const { data: enAttente } = await admin
      .from("funding_contributions")
      .select("montant")
      .eq("funding_id", funding.id)
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
        funding_id: funding.id,
        guest_prenom: String(prenom).trim(),
        guest_email: String(email).trim(),
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
      success_url: `${connectUrl}/cotisation/${token}?paiement=succes&contribution_id=${contribution.id}`,
      cancel_url: `${connectUrl}/cotisation/${token}?paiement=annule&contribution_id=${contribution.id}`,
      client_reference_id: contribution.id,
      metadata: { funding_contribution_id: contribution.id },
      customer_email: String(email).trim(),
    });

    await admin.from("funding_contributions").update({ stripe_checkout_session_id: session.id }).eq("id", contribution.id);

    return json({ url: session.url });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
