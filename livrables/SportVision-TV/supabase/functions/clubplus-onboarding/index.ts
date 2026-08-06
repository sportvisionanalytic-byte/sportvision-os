// Supabase Edge Function — clubplus-onboarding
// Appelée juste après l'inscription d'un dirigeant sur SportVision Club+ (Supabase Auth signUp).
// Idempotente : si l'utilisateur a déjà une ligne club_members, la renvoie telle quelle
// sans rien recréer (cf. handleLogin() côté client, qui rappelle cette fonction comme
// filet de sécurité au premier login si la confirmation par e-mail était activée).
//
// Portée v1 : crée toujours un NOUVEAU club avec l'appelant comme admin. La jonction
// à un club existant via lien d'invitation ou lien d'activation privé (PILOT_MODE)
// sera ajoutée dans une fonction séparée (clubplus-accept-invite / clubplus-activate)
// une fois ces flux développés côté SportVision OS.
//
// Deploy via Supabase dashboard > Edge Functions > New Function (name: clubplus-onboarding)
// Secrets requis : SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (déjà présents par défaut sur le projet)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

const CREDITS_BY_PLAN: Record<string, number> = { club: 5, performance: 20 };

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

    // Vérifie le JWT de l'appelant (aucune confiance dans un id fourni par le body)
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Session invalide" }, 401);
    const user = userData.user;

    const body = await req.json();
    const prenom: string = body.prenom || "";
    const nom: string = body.nom || "";
    const telephone: string = body.telephone || "";
    const club = body.club || {};
    const plan: string = CREDITS_BY_PLAN[body.plan] ? body.plan : "club";

    const admin = createClient(supabaseUrl, serviceKey);

    // Idempotence : déjà onboardé (quel que soit le club) → ne rien recréer.
    const { data: existing } = await admin
      .from("club_members")
      .select("id, club_id, role")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    if (existing) {
      return json({ club_id: existing.club_id, role: existing.role, already_onboarded: true });
    }

    if (!club.nom || !String(club.nom).trim()) {
      return json({ error: "Le nom du club est obligatoire." }, 400);
    }

    const { data: createdClub, error: clubErr } = await admin
      .from("clubs")
      .insert({
        nom: String(club.nom).trim(),
        ville: club.ville || null,
        discipline: club.discipline || null,
        plan,
        engagement: body.engagement === "sans" ? "sans" : "12mois",
        credits_monthly: CREDITS_BY_PLAN[plan],
        credits_balance: CREDITS_BY_PLAN[plan],
      })
      .select("id")
      .single();
    if (clubErr) return json({ error: clubErr.message }, 500);

    const { error: cmErr } = await admin.from("club_members").insert({
      user_id: user.id,
      club_id: createdClub.id,
      role: "admin",
      prenom: prenom || null,
      nom: nom || null,
      telephone: telephone || null,
      status: "actif",
    });
    if (cmErr) return json({ error: cmErr.message }, 500);

    // Pont Documents ↔ Portail (best-effort, ne bloque jamais la création du club) :
    // si un `clients` Portail existe déjà pour cet e-mail (club déjà suivi
    // commercialement par SportVision avant son inscription à Club+), relie
    // clubs.portail_client_id et fait de l'admin un client_users pour ce
    // client — il peut alors lire ses vrais devis/factures/contrats via les
    // vues client_devis/client_factures/client_contrats (migration-portail-
    // v1.sql), sans aucune donnée dupliquée ni nouvelle policy Portail.
    // Le pont ci-dessous donne accès aux devis/factures/contrats réels d'un
    // client Portail existant sur simple correspondance d'e-mail — ne le
    // faire que si Supabase a confirmé que l'appelant possède bien cette
    // adresse (email_confirmed_at non nul). Sans cette vérification, si la
    // confirmation par e-mail était un jour désactivée côté projet, n'importe
    // qui pourrait s'inscrire avec l'e-mail de quelqu'un d'autre et hériter
    // immédiatement de ses documents financiers. Découvert lors de l'audit
    // du 2026-08-06.
    if (user.email && user.email_confirmed_at) {
      try {
        const { data: matchedClient } = await admin
          .from("clients")
          .select("id")
          .ilike("email", user.email)
          .limit(1)
          .maybeSingle();
        if (matchedClient) {
          await admin.from("clubs").update({ portail_client_id: matchedClient.id }).eq("id", createdClub.id);
          await admin
            .from("client_users")
            .upsert({ id: user.id, client_id: matchedClient.id, prenom: prenom || null, nom: nom || null, telephone: telephone || null }, { onConflict: "id" });
        }
      } catch (_e) {
        // best-effort : une erreur ici ne doit pas empêcher la création du club
      }
    }

    // Notifie le staff — avant, un club pouvait s'auto-inscrire en self-service
    // sans que personne chez SportVision ne le sache (aucune alerte nulle
    // part). Best-effort, ne bloque jamais la création du club.
    try {
      await admin.rpc("notify_staff_by_role", {
        p_roles: ["admin", "sec"],
        p_titre: "Nouveau club Club+ auto-inscrit",
        p_message: `${String(club.nom).trim()} vient de créer son compte Club+ (formule ${plan}).`,
        p_priorite: "normale",
        p_prestation_id: null,
        p_client_id: null,
      });
    } catch (_e) {
      // ignoré volontairement
    }

    return json({ club_id: createdClub.id, role: "admin", already_onboarded: false });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
