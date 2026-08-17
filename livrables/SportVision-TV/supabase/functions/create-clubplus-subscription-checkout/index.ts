// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.
// Étape à faire à chaque édition : Supabase Dashboard → Edge Functions →
// create-clubplus-subscription-checkout → coller ce code → Deploy.
// Oublier cette étape est la cause la plus fréquente de "le code est bon
// mais ça ne marche pas en prod" sur ce projet (déjà arrivé sur au moins
// 5 fonctions : clubplus-billing-portal, create-clubplus-subscription-
// checkout, dispatch-notifications, create-guest-rdv, create-guest-request).

// Supabase Edge Function — create-clubplus-subscription-checkout
// Crée une session Stripe Checkout en mode `subscription` pour l'abonnement
// mensuel SportVision Club+ d'un club. C'est le seul point d'entrée pour
// démarrer un vrai prélèvement récurrent : jusqu'ici l'abonnement Club+ était
// entièrement simulé côté app (clubs.plan/engagement existaient en base mais
// aucun paiement n'y était rattaché).
//
// Sécurité :
//   * l'appelant doit être admin ACTIF du club ciblé (vérifié en service_role
//     sur club_members — jamais de confiance dans un rôle envoyé par le client) ;
//   * le PRIX n'est jamais transmis par le client : seuls `plan` et
//     `engagement` le sont, et le tarif est relu dans la table CLUBPLUS_TARIFS
//     ci-dessous (même principe que create-checkout-session, qui relit le
//     montant depuis le catalogue plutôt que depuis le body) ;
//   * clubs.plan / engagement / subscription_status / stripe_* ne sont JAMAIS
//     écrits ici : c'est le webhook Stripe (paiement réellement encaissé) qui
//     les met à jour, jamais l'intention de payer.
//
// Prix Stripe réutilisables (objets `Price` avec lookup_key stable) plutôt que
// des price_data inline : un prix inline n'existe que dans la session, il est
// invisible du Portail de facturation Stripe et impossible à retrouver depuis
// un événement webhook. Avec un vrai Price identifié par lookup_key et portant
// plan/engagement dans ses metadata, le webhook peut relire la formule réelle
// de l'abonnement à tout moment (y compris après un changement de formule fait
// par le club depuis le Portail Stripe) — cf. stripe-webhook, handler
// customer.subscription.updated. Les prix sont créés à la première utilisation
// et réutilisés ensuite ; si le tarif change dans CLUBPLUS_TARIFS, un nouveau
// Price est créé et le lookup_key lui est transféré (transfer_lookup_key), les
// abonnements en cours restant sur leur ancien prix (comportement Stripe
// standard, et comportement voulu : on ne réajuste pas un club déjà engagé).
//
// Deploy via Supabase dashboard > Edge Functions > New Function
// (name: create-clubplus-subscription-checkout)
// Secrets requis : SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
//                  STRIPE_SECRET_KEY, CONNECT_URL
//
// Fix du 08/08/2026 : success_url/cancel_url pointaient vers l'ancienne app
// Club+ (app.html) au lieu de Connect. Le module club-abonnement.js de
// Connect lit déjà ?abonnement=succes|annule (handleAbonnementReturn) —
// paramètre conservé tel quel, seul le domaine change.

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

// Tarifs publics affichés dans le wizard d'inscription Club+
// (SportVision-Club-Plus.html, étapes 3 et 4) — source de vérité côté serveur.
// Toute modification ici doit rester alignée avec l'affichage public ET avec
// CLUBPLUS_PLAN_CREDITS dans stripe-webhook (crédits mensuels par formule).
const CLUBPLUS_TARIFS: Record<string, Record<string, { euros: number; label: string }>> = {
  club: {
    "12mois": { euros: 49, label: "SportVision Club+ — engagement 12 mois" },
    "sans": { euros: 59, label: "SportVision Club+ — sans engagement" },
  },
  performance: {
    "12mois": { euros: 129, label: "SportVision Club+ Performance — engagement 12 mois" },
    // 17/08/2026 — 139€ (pas 149€) : aligné sur la vitrine publique (club-plus.html), qui
    // faisait foi — audit complet Club+ du 17/08/2026, confirmé par Fouka. ensurePrice()
    // en dessous crée automatiquement un nouveau Price Stripe et bascule le lookup_key
    // dessus au prochain checkout, sans action manuelle sur le dashboard Stripe.
    "sans": { euros: 139, label: "SportVision Club+ Performance — sans engagement" },
  },
};

const PRODUCT_IDS: Record<string, string> = {
  club: "sportvision_clubplus",
  performance: "sportvision_clubplus_performance",
};

const PRODUCT_NAMES: Record<string, string> = {
  club: "SportVision Club+",
  performance: "SportVision Club+ Performance",
};

// Identifiant stable du tarif chez Stripe : permet de retrouver/réutiliser le
// même Price d'un déploiement à l'autre sans stocker d'ID en base.
function lookupKey(plan: string, engagement: string): string {
  return `sportvision_clubplus_${plan}_${engagement}`;
}

async function ensureProduct(stripe: Stripe, plan: string): Promise<string> {
  const id = PRODUCT_IDS[plan];
  try {
    const existing = await stripe.products.retrieve(id);
    if (existing?.id) return existing.id;
  } catch (_e) {
    // Produit inexistant (première utilisation) : on le crée ci-dessous — cas
    // attendu, pas une vraie erreur, mais tracé pour distinguer ce cas d'un
    // souci réseau/API Stripe si la création ci-dessous échoue aussi.
    console.error("[create-clubplus-subscription-checkout] ensureProduct : produit Stripe non trouvé, création :", _e);
  }
  const created = await stripe.products.create({
    id,
    name: PRODUCT_NAMES[plan],
    metadata: { plan },
  });
  return created.id;
}

async function ensurePrice(stripe: Stripe, plan: string, engagement: string): Promise<string> {
  const tarif = CLUBPLUS_TARIFS[plan][engagement];
  const key = lookupKey(plan, engagement);
  const unitAmount = Math.round(tarif.euros * 100);

  const existing = await stripe.prices.list({ lookup_keys: [key], active: true, limit: 1 });
  const found = existing.data[0];
  if (found && found.unit_amount === unitAmount && found.currency === "eur" && found.recurring?.interval === "month") {
    return found.id;
  }

  const productId = await ensureProduct(stripe, plan);
  const price = await stripe.prices.create({
    product: productId,
    currency: "eur",
    unit_amount: unitAmount,
    recurring: { interval: "month" },
    nickname: tarif.label,
    lookup_key: key,
    // Le tarif a changé depuis la création du Price : on reprend le lookup_key
    // sur le nouveau plutôt que de laisser deux prix concurrents.
    transfer_lookup_key: Boolean(found),
    metadata: { plan, engagement },
  });
  return price.id;
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
    const clubId: string = body.club_id || "";
    const plan: string = body.plan || "";
    const engagement: string = body.engagement || "";

    if (!clubId) return json({ error: "club_id est obligatoire" }, 400);
    if (!CLUBPLUS_TARIFS[plan]) return json({ error: "Formule inconnue" }, 400);
    if (!CLUBPLUS_TARIFS[plan][engagement]) return json({ error: "Engagement inconnu" }, 400);

    const admin = createClient(supabaseUrl, serviceKey);

    // L'appelant doit être admin ACTIF de CE club — seule cette requête
    // service_role fait foi (même patron que clubplus-invite).
    const { data: callerMember } = await admin
      .from("club_members")
      .select("id")
      .eq("user_id", user.id)
      .eq("club_id", clubId)
      .eq("role", "admin")
      .eq("status", "actif")
      .maybeSingle();
    if (!callerMember) {
      return json({ error: "Seul un administrateur du club peut souscrire l'abonnement." }, 403);
    }

    const { data: club } = await admin
      .from("clubs")
      .select("id, nom, stripe_customer_id, stripe_subscription_id, subscription_status")
      .eq("id", clubId)
      .maybeSingle();
    if (!club) return json({ error: "Club introuvable" }, 404);

    // Un club déjà abonné doit passer par le Portail de facturation Stripe
    // (clubplus-billing-portal) pour changer de formule ou résilier : créer une
    // seconde session d'abonnement le ferait payer deux fois.
    if (club.stripe_subscription_id && club.subscription_status === "actif") {
      return json({ error: "Ce club a déjà un abonnement actif — utilisez « Gérer mon abonnement »." }, 400);
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    // Client Stripe : créé une fois par club, réutilisé ensuite (le
    // stripe_customer_id porte tout l'historique de facturation du club et
    // conditionne l'accès au Portail de facturation).
    let customerId: string = club.stripe_customer_id || "";
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        name: club.nom || undefined,
        metadata: { club_id: clubId },
      });
      customerId = customer.id;
      // Écrit tout de suite pour ne jamais recréer un client Stripe en double
      // si le club abandonne le paiement puis recommence.
      await admin.from("clubs").update({ stripe_customer_id: customerId }).eq("id", clubId);
    }

    const priceId = await ensurePrice(stripe, plan, engagement);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${connectUrl}/?abonnement=succes`,
      cancel_url: `${connectUrl}/?abonnement=annule`,
      client_reference_id: clubId,
      metadata: { club_id: clubId, plan, engagement },
      // Recopiés sur l'abonnement lui-même : le webhook retrouve ainsi le club
      // sur les événements customer.subscription.* et invoice.*, qui ne portent
      // pas les metadata de la session Checkout.
      subscription_data: { metadata: { club_id: clubId, plan, engagement } },
    });

    return json({ url: session.url });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
