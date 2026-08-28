// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.
// Étape à faire à chaque édition : Supabase Dashboard → Edge Functions →
// create-pass-photo-checkout → coller ce code → Deploy.
// Oublier cette étape est la cause la plus fréquente de "le code est bon
// mais ça ne marche pas en prod" sur ce projet (déjà arrivé sur au moins
// 5 fonctions : clubplus-billing-portal, create-clubplus-subscription-
// checkout, dispatch-notifications, create-guest-rdv, create-guest-request).

// Supabase Edge Function — create-pass-photo-checkout
// Crée une session Stripe Checkout en mode `payment` (achat PONCTUEL, pas un abonnement) pour le
// "Pass Photo" — déverrouille tous les albums photo publiés (photo_albums) d'UNE équipe + UNE
// saison pour l'utilisateur Connect payeur (migration-connect-pass-photo-v1.sql).
//
// Calque EXACT du patron déjà en prod pour l'abonnement Agent (create-agent-subscription-
// checkout) sur les points de sécurité qui comptent, avec UNE différence volontaire : `mode:
// "payment"` (achat ponctuel) au lieu de `mode: "subscription"`, cf. migration §2 — pas de
// `subscription_data.metadata`, les metadata vont directement sur la session.
//
// Sécurité :
//   * l'appelant doit être authentifié (JWT Supabase) — c'est lui-même qui achète, jamais pour un
//     tiers ;
//   * le tarif n'est JAMAIS transmis par le client : seuls club_id/team_id/season_id le sont, et le
//     Price ID réel est relu depuis la variable d'environnement STRIPE_PRICE_PASS_PHOTO ci-dessous —
//     JAMAIS de `price_data` dynamique calculé côté serveur (même consigne que l'abonnement Agent) ;
//   * photo_pass_entitlements n'est JAMAIS écrit ici : c'est le webhook Stripe (paiement réellement
//     encaissé, checkout.session.completed) qui l'écrit, jamais l'intention de payer
//     (MASTER-CONNECT-V1.md §25).
//
// Deploy via Supabase dashboard > Edge Functions > New Function
// (name: create-pass-photo-checkout)
// Secrets requis : SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY,
//                  CONNECT_URL, STRIPE_PRICE_PASS_PHOTO
//
// ACTION MANUELLE REQUISE AVANT QUE CETTE FONCTION MARCHE : créer UN Price Stripe ponctuel dans le
// Dashboard Stripe → Product catalog (montant décidé par Fouka, décision commerciale) et renseigner
// son Price ID (price_xxx) dans le secret STRIPE_PRICE_PASS_PHOTO. Voir le résumé en fin de
// migration-connect-pass-photo-v1.sql. Tant que ce secret n'est pas configuré, cette fonction
// répond une erreur JSON claire plutôt que de deviner un tarif ou de planter.

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
    const clubId: string = body.club_id || "";
    const teamId: string = body.team_id || "";
    const seasonId: string = (body.season_id || "").toString().trim();
    if (!clubId || !teamId || !seasonId) {
      return json({ error: "club_id, team_id et season_id sont requis" }, 400);
    }

    // Prix jamais transmis par le client, jamais deviné côté serveur : lu exclusivement depuis
    // cette variable d'environnement — même consigne exacte que STRIPE_PRICE_AGENT_* côté
    // create-agent-subscription-checkout. Tant que Fouka n'a pas créé le Price Stripe et posé ce
    // secret, l'achat est proprement bloqué (pas de crash).
    const priceId = Deno.env.get("STRIPE_PRICE_PASS_PHOTO") || "";
    if (!priceId) {
      return json({ error: "Pass Photo pas encore configuré" }, 500);
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // Garde-fou : au moins un album PUBLIÉ doit exister pour cette équipe/saison — sinon rien à
    // déverrouiller, inutile (et trompeur) de laisser payer. Lecture directe service_role (bypass
    // RLS), volontairement : c'est la seule vérification serveur qui a besoin de voir
    // photo_albums en dehors de la RPC photo_album_list (qui, elle, tourne avec le JWT du client).
    const { data: albums } = await admin
      .from("photo_albums")
      .select("id")
      .eq("club_id", clubId)
      .eq("team_id", teamId)
      .eq("season_id", seasonId)
      .eq("status", "published")
      .limit(1);
    if (!albums || albums.length === 0) {
      return json({ error: "Aucun album publié pour cette équipe et cette saison pour le moment." }, 400);
    }

    // Déjà un Pass actif sur cette combinaison club/équipe/saison : pas de second paiement, même
    // principe que create-agent-subscription-checkout ("un utilisateur déjà abonné doit passer par
    // manage-agent-subscription pour changer de palier — créer une seconde session le ferait payer
    // deux fois").
    const { data: existing } = await admin
      .from("photo_pass_entitlements")
      .select("status, expires_at")
      .eq("user_id", user.id)
      .eq("club_id", clubId)
      .eq("team_id", teamId)
      .eq("season_id", seasonId)
      .maybeSingle();
    const alreadyActive = existing?.status === "active" && (!existing.expires_at || new Date(existing.expires_at) > new Date());
    if (alreadyActive) {
      return json({ error: "Vous avez déjà le Pass Photo pour cette équipe et cette saison." }, 400);
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${connectUrl}/photos?paiement=succes`,
      cancel_url: `${connectUrl}/photos?paiement=annule`,
      client_reference_id: user.id,
      // Lus par stripe-webhook sur checkout.session.completed pour retrouver l'utilisateur ET la
      // combinaison club/équipe/saison à déverrouiller — product:'pass_photo' est le champ
      // distinctif qui permet au webhook de brancher cette session-ci AVANT tout repli sur
      // paiementId/contributionId (même principe que abonnementClubId/agentUserId, voir son
      // en-tête).
      metadata: {
        product: "pass_photo",
        user_id: user.id,
        club_id: clubId,
        team_id: teamId,
        season_id: seasonId,
      },
      customer_email: user.email ?? undefined,
    });

    return json({ url: session.url });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
