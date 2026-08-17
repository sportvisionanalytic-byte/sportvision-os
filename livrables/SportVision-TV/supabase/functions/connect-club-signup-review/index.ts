// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.
// Étape à faire à chaque édition : Supabase Dashboard → Edge Functions →
// connect-club-signup-review → coller ce code → Deploy.
// Oublier cette étape est la cause la plus fréquente de "le code est bon
// mais ça ne marche pas en prod" sur ce projet (déjà arrivé sur au moins
// 5 fonctions : clubplus-billing-portal, create-clubplus-subscription-
// checkout, dispatch-notifications, create-guest-rdv, create-guest-request).

// Supabase Edge Function — connect-club-signup-review
// Appelée par le STAFF SportVision depuis l'écran de traitement des demandes
// de SportVision OS pour traiter une ligne connect_clubplus_signup_requests
// (migration-connect-v78-signup-unifie-clubplus.sql). Trois actions :
//
//  - "demander_infos" / "refuser" : change juste le statut + note, IDENTIQUE
//    quel que soit organization_type — aucune écriture ailleurs.
//
//  - "valider" : le comportement diverge selon organization_type (17/08/2026,
//    généralisation à 7 types — SIGNUP-UNIFIE-MASTER-PROMPT.md + décision
//    d'architecture en bas du fichier) :
//
//    · organization_type === 'club' : comportement EXACTEMENT identique à
//      avant ce chantier. Le staff CHOISIT EXPLICITEMENT le rôle Connect
//      initial du contact (initial_role — jamais déduit de la fonction
//      déclarée) et génère un lien d'activation privé sur le patron exact de
//      clubplus-generate-activation : résout ou crée la fiche `clients` CRM,
//      crée une ligne clubplus_activation_tokens (client_id, initial_role,
//      source_request_id), et NE CRÉE NI club NI club_members ici — ça reste
//      le travail de clubplus-activate, à la consommation du token.
//
//    · organization_type dans ('academie','coach','structure_coaching',
//      'tournoi','stage','projet') : plus de pipeline clients/clubplus_
//      activation_tokens (intrinsèquement club — clubplus-activate écrit
//      TOUJOURS dans la table `clubs`). Route à la place vers le mécanisme
//      DÉJÀ EN PROD pour tournoi/stage/cm_agency (migration-connect-v20) :
//      un connect_org_activation_tokens est créé (organization_type,
//      nom_prefill, client_id=null — aucune fiche CRM résolue à ce stade,
//      contrairement au club), consommé par connect-org-activate qui crée
//      RÉELLEMENT organizations+memberships à l'activation, jamais avant.
//      Le rôle initial (admin) est posé à l'activation par connect-org-
//      activate (lu depuis organization_role_catalog, is_admin=true pour ce
//      type) — pas de choix de rôle ici, un seul rôle admin existe par type
//      (même principe que event/cm_agency avant cette généralisation) :
//      cohérent avec "aucun rôle admin automatique déduit de la fonction
//      déclarée" (master prompt §51).
//
// Sécurité : l'appelant doit avoir un `profiles.role` dans ('admin','sec','com')
// — vérifié en service role, jamais depuis un rôle envoyé dans le body. Même
// garde que clubplus-generate-activation / connect-staff-create-org.
//
// Deploy via Supabase dashboard > Edge Functions > New Function (name: connect-club-signup-review)
// Secrets requis : SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
// Secret optionnel : CONNECT_URL (même variable que clubplus-generate-activation / connect-staff-create-org)

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

const STAFF_ROLES = ["admin", "sec", "com"];
const VALID_PLANS = ["club", "performance"];
// Mêmes valeurs que club_members.role (migration-clubplus-v1.sql) et
// clubplus_activation_tokens.initial_role — UNIQUEMENT pour organization_type === 'club'.
const VALID_ROLES = [
  "admin", "president", "secretaire", "comm", "cm_externe", "coach",
  "resp_equipe", "sponsor_mgr", "tresorier", "membre_bureau", "lecture_seule",
];
const ACTIONS = new Set(["valider", "demander_infos", "refuser"]);
// Les 6 types qui routent vers connect_org_activation_tokens / connect-org-activate
// au lieu du pipeline clients / clubplus_activation_tokens (réservé au club).
const NON_CLUB_ORG_TYPES = new Set(["academie", "coach", "structure_coaching", "tournoi", "stage", "projet"]);

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
    const connectUrl = Deno.env.get("CONNECT_URL") || "https://connect.sportvision-an.fr";

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Session invalide" }, 401);
    const caller = userData.user;

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: callerProfile } = await admin
      .from("profiles")
      .select("role")
      .eq("id", caller.id)
      .maybeSingle();
    if (!callerProfile || !STAFF_ROLES.includes(callerProfile.role)) {
      return json({ error: "Seul le staff SportVision peut traiter une demande d'ouverture Club+." }, 403);
    }

    const body = await req.json();
    const requestId: string = body.request_id || "";
    const action: string = body.action || "";
    const notes: string = (body.notes || "").trim();

    if (!requestId) return json({ error: "La demande est obligatoire." }, 400);
    if (!ACTIONS.has(action)) return json({ error: "Action non reconnue." }, 400);

    const { data: reqRow } = await admin
      .from("connect_clubplus_signup_requests")
      .select("id, organization_type, club_nom, ville, contact_prenom, contact_nom, contact_email, contact_telephone, statut")
      .eq("id", requestId)
      .maybeSingle();
    if (!reqRow) return json({ error: "Demande introuvable." }, 404);
    if (reqRow.statut === "valide" || reqRow.statut === "refuse") {
      return json({ error: "Cette demande a déjà été traitée." }, 409);
    }

    if (action === "demander_infos") {
      if (!notes) return json({ error: "Précisez ce qui manque dans une note." }, 400);
      const { error: updErr } = await admin
        .from("connect_clubplus_signup_requests")
        .update({ statut: "infos_demandees", traite_par: caller.id, traite_le: new Date().toISOString(), notes_staff: notes })
        .eq("id", requestId);
      if (updErr) return json({ error: updErr.message }, 500);
      return json({ statut: "infos_demandees" });
    }

    if (action === "refuser") {
      const { error: updErr } = await admin
        .from("connect_clubplus_signup_requests")
        .update({ statut: "refuse", traite_par: caller.id, traite_le: new Date().toISOString(), notes_staff: notes || null })
        .eq("id", requestId);
      if (updErr) return json({ error: updErr.message }, 500);
      return json({ statut: "refuse" });
    }

    // action === "valider"
    const nomOverride: string = (body.club_nom_override || "").trim();
    const nomFinal = nomOverride || reqRow.club_nom;

    // ── Chemin 1/2 : organization_type === 'club' — INCHANGÉ ────────────────
    if (reqRow.organization_type === "club") {
      const initialRole: string = body.initial_role || "";
      const plan: string = VALID_PLANS.includes(body.plan) ? body.plan : "club";

      if (!VALID_ROLES.includes(initialRole)) {
        return json({ error: "Choisissez explicitement le rôle Connect initial du contact." }, 400);
      }

      // Résout ou crée la fiche client CRM — même logique de recherche que
      // clubplus-onboarding (ilike sur l'e-mail), mais à partir de données déjà
      // vérifiées par le staff (le formulaire public, jamais d'un compte auth
      // deviné). Donne au club une visibilité CRM/Portail dès la validation,
      // avant même que le contact n'ait activé quoi que ce soit.
      let clientId: string;
      const { data: matchedClient } = await admin
        .from("clients")
        .select("id")
        .ilike("email", reqRow.contact_email)
        .limit(1)
        .maybeSingle();
      if (matchedClient) {
        clientId = matchedClient.id;
      } else {
        const { data: createdClient, error: clientErr } = await admin
          .from("clients")
          .insert({
            statut: "prospect",
            type_client: "club",
            nom: nomFinal,
            nom_contact: reqRow.contact_nom,
            prenom_contact: reqRow.contact_prenom,
            email: reqRow.contact_email,
            telephone: reqRow.contact_telephone,
            ville: reqRow.ville,
            origine_prospect: "connect",
          })
          .select("id")
          .single();
        if (clientErr) return json({ error: clientErr.message }, 500);
        clientId = createdClient.id;
      }

      const token = crypto.randomUUID().replace(/-/g, "");

      const { data: createdToken, error: tokErr } = await admin
        .from("clubplus_activation_tokens")
        .insert({
          client_id: clientId,
          token,
          club_nom_prefill: nomFinal,
          plan,
          initial_role: initialRole,
          source_request_id: reqRow.id,
          created_by: caller.id,
        })
        .select("id, expires_at")
        .single();
      if (tokErr) return json({ error: tokErr.message }, 500);

      const { error: updErr } = await admin
        .from("connect_clubplus_signup_requests")
        .update({ statut: "valide", traite_par: caller.id, traite_le: new Date().toISOString(), notes_staff: notes || null })
        .eq("id", requestId);
      if (updErr) return json({ error: updErr.message }, 500);

      const activationUrl = `${connectUrl}/#/activation?token=${token}`;

      return json({
        statut: "valide",
        id: createdToken.id,
        token,
        activation_url: activationUrl,
        expires_at: createdToken.expires_at,
        plan,
        initial_role: initialRole,
        club_nom_prefill: nomFinal,
        client_id: clientId,
        organization_type: "club",
      });
    }

    // ── Chemin 2/2 : les 6 autres types — connect_org_activation_tokens ─────
    if (!NON_CLUB_ORG_TYPES.has(reqRow.organization_type)) {
      return json({ error: "Type de structure non pris en charge par cette fonction." }, 500);
    }

    const token = crypto.randomUUID().replace(/-/g, "");

    const { data: createdToken, error: tokErr } = await admin
      .from("connect_org_activation_tokens")
      .insert({
        organization_type: reqRow.organization_type,
        nom_prefill: nomFinal,
        client_id: null,
        token,
        created_by: caller.id,
      })
      .select("id, expires_at")
      .single();
    if (tokErr) return json({ error: tokErr.message }, 500);

    const { error: updErr } = await admin
      .from("connect_clubplus_signup_requests")
      .update({ statut: "valide", traite_par: caller.id, traite_le: new Date().toISOString(), notes_staff: notes || null })
      .eq("id", requestId);
    if (updErr) return json({ error: updErr.message }, 500);

    const activationUrl = `${connectUrl}/#/org-activation?token=${token}`;

    return json({
      statut: "valide",
      id: createdToken.id,
      token,
      activation_url: activationUrl,
      expires_at: createdToken.expires_at,
      organization_type: reqRow.organization_type,
      nom_prefill: nomFinal,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
