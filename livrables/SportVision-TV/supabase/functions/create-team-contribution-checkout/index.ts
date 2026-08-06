// Supabase Edge Function — create-team-contribution-checkout
// Crée une session Stripe Checkout pour une contribution à un projet
// collectif d'équipe (team_projects). Même patron que create-checkout-
// session (Portail), mais ne touche JAMAIS client_users/paiements/
// prestations : un joueur/parent qui contribue n'est pas un client
// Portail (cf. CLUBPLUS_PLAYER_FAMILY_ARCHITECTURE.md, §9.2 et §0 —
// mélanger les deux univers exposerait des données club internes).
//
// Sécurité : vérifie que l'appelant est réellement un membre de la
// famille de l'équipe du projet (joueur majeur avec un rattachement actif,
// ou parent confirmé d'un enfant qui y est rattaché) — jamais de confiance
// dans un player_id/contributor_type envoyé par le client. Un mineur ne
// peut pas contribuer lui-même (même règle que club_bookings, v20) : seul
// son parent le peut, et la contribution est alors enregistrée pour cet
// enfant (player_id), pas pour le compte du parent.
//
// Deploy via Supabase dashboard > Edge Functions > New Function
// (name: create-team-contribution-checkout)
// Secrets requis : SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
// STRIPE_SECRET_KEY (déjà utilisé par create-checkout-session)
// Secret optionnel : CLUBPLUS_URL (comme clubplus-invite/clubplus-family-invite)

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
    const clubplusUrl = Deno.env.get("CLUBPLUS_URL") || "https://clubplus.sportvision.fr";

    if (!stripeSecretKey) return json({ error: "STRIPE_SECRET_KEY non configurée" }, 500);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Session invalide" }, 401);
    const user = userData.user;

    const { project_id, montant } = await req.json();
    if (!project_id || !montant || Number(montant) <= 0) {
      return json({ error: "project_id et montant sont obligatoires" }, 400);
    }

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: project } = await admin
      .from("team_projects")
      .select("id, club_id, team_id, titre, statut, contribution_min, montant_cible, montant_collecte")
      .eq("id", project_id)
      .maybeSingle();
    if (!project) return json({ error: "Projet introuvable" }, 404);
    if (project.statut !== "ouvert") return json({ error: "Ce projet n'accepte plus de contributions pour le moment." }, 400);
    if (project.contribution_min != null && Number(montant) < Number(project.contribution_min)) {
      return json({ error: `Le montant minimum est de ${project.contribution_min} €.` }, 400);
    }
    // Plafond serveur : le montant ne doit jamais dépasser ce qu'il reste à
    // collecter. Sans cette borne, le client contrôlait entièrement `montant`
    // (utilisé tel quel comme unit_amount Stripe) — un appel direct à l'Edge
    // Function pouvait faire créer une session Stripe pour n'importe quel prix.
    const montantRestant = Number(project.montant_cible) - Number(project.montant_collecte || 0);
    if (montantRestant <= 0) {
      return json({ error: "L'objectif de ce projet est déjà atteint." }, 400);
    }
    if (Number(montant) > montantRestant) {
      return json({ error: `Le montant dépasse ce qu'il reste à collecter (${montantRestant.toFixed(2)} €).` }, 400);
    }

    // Résout l'identité de l'appelant dans CETTE équipe — jamais un
    // contributor_type/player_id envoyé par le client.
    let contributorType: "joueur_majeur" | "parent" | null = null;
    let playerId: string | null = null;

    const { data: ownPlayer } = await admin
      .from("player_profiles")
      .select("id, date_naissance")
      .eq("user_id", user.id)
      .maybeSingle();
    if (ownPlayer) {
      const { data: membership } = await admin
        .from("team_memberships")
        .select("id")
        .eq("player_id", ownPlayer.id)
        .eq("team_id", project.team_id)
        .eq("statut", "active")
        .maybeSingle();
      if (membership) {
        const age = (Date.now() - new Date(ownPlayer.date_naissance).getTime()) / (365.25 * 24 * 3600 * 1000);
        if (age >= 18) {
          contributorType = "joueur_majeur";
          playerId = ownPlayer.id;
        } else {
          return json({ error: "En tant que mineur, vous ne pouvez pas contribuer vous-même — demandez à votre parent." }, 403);
        }
      }
    }

    if (!contributorType) {
      const { data: parent } = await admin.from("parent_profiles").select("id").eq("user_id", user.id).maybeSingle();
      if (parent) {
        const { data: rels } = await admin
          .from("parent_player_relationships")
          .select("player_id")
          .eq("parent_id", parent.id)
          .eq("statut", "confirme");
        const childIds = (rels || []).map((r) => r.player_id);
        if (childIds.length) {
          const { data: membership } = await admin
            .from("team_memberships")
            .select("player_id")
            .in("player_id", childIds)
            .eq("team_id", project.team_id)
            .eq("statut", "active")
            .limit(1)
            .maybeSingle();
          if (membership) {
            contributorType = "parent";
            playerId = membership.player_id;
          }
        }
      }
    }

    if (!contributorType) {
      return json({ error: "Vous n'êtes pas rattaché à l'équipe de ce projet." }, 403);
    }

    const { data: contribution, error: contribErr } = await admin
      .from("team_project_contributions")
      .insert({
        project_id,
        contributor_type: contributorType,
        contributor_user_id: user.id,
        player_id: playerId,
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
            product_data: { name: `SportVision — Projet d'équipe : ${project.titre}` },
            unit_amount: Math.round(Number(montant) * 100),
          },
          quantity: 1,
        },
      ],
      success_url: `${clubplusUrl}/app.html?contribution=succes&contribution_id=${contribution.id}`,
      cancel_url: `${clubplusUrl}/app.html?contribution=annule&contribution_id=${contribution.id}`,
      client_reference_id: contribution.id,
      metadata: { contribution_id: contribution.id },
      customer_email: user.email ?? undefined,
    });

    await admin.from("team_project_contributions").update({ stripe_checkout_session_id: session.id }).eq("id", contribution.id);

    return json({ url: session.url });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
