// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.
// Étape à faire à chaque édition : Supabase Dashboard → Edge Functions →
// connect-staff-create-org → coller ce code → Deploy.
// Oublier cette étape est la cause la plus fréquente de "le code est bon
// mais ça ne marche pas en prod" sur ce projet.

// Supabase Edge Function — connect-staff-create-org
// Appelée par le STAFF SportVision depuis SportVision OS pour générer un lien
// d'activation privé permettant de créer directement une organisation Connect
// (sans passer par une demande publique connect_clubplus_signup_requests),
// pour tout type qui route par ce mécanisme : academie, coach,
// structure_coaching, tournoi, stage, cm_agency, projet (17/08/2026,
// généralisation — voir migration-connect-v78-signup-unifie-clubplus.sql).
// À l'origine limité à `event`/`cm_agency` (migration-connect-v20) ; `event`
// n'existe plus comme organization_type depuis la bascule tournoi/stage
// (migration-clubplus-v44) — VALID_TYPES corrigé en conséquence et étendu
// aux 4 nouveaux types qui partagent désormais exactement le même mécanisme
// (connect_org_activation_tokens / connect-org-activate).
//
// Même patron exact que clubplus-generate-activation : renvoie un lien privé
// à transmettre par le staff (jamais envoyé automatiquement — SECRET, quiconque
// le possède peut créer le compte admin de l'organisation), qui expire au bout
// de 30 jours (défaut de la table connect_org_activation_tokens).
//
// Sécurité : l'appelant doit avoir un `profiles.role` dans ('admin','sec','com')
// — vérifié en service role, jamais depuis un rôle envoyé dans le body. Le
// token est généré ici avec crypto.randomUUID(), jamais côté client. La
// consommation du lien se fait dans connect-org-activate.
//
// client_id (optionnel) : si le staff a déjà une fiche `clients` CRM
// correspondante (ex. un événement organisé avec un club/fédération déjà
// suivi), il la choisit ici — le rattachement est PORTÉ PAR LE TOKEN, jamais
// deviné par correspondance d'e-mail à l'activation (même raisonnement que
// clubplus-activate vs clubplus-onboarding). Sans client_id, l'organisation
// sera créée sans historique Portail (rattachable à la main plus tard si besoin).
//
// Deploy via Supabase dashboard > Edge Functions > New Function
// (name: connect-staff-create-org)
// Secrets requis : SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
// Secret optionnel : CONNECT_URL (même variable que les autres fonctions de liens Connect)

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
const VALID_TYPES = new Set(["academie", "coach", "structure_coaching", "tournoi", "stage", "cm_agency", "projet"]);

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
      return json({ error: "Seul le staff SportVision peut générer un lien de création d'organisation." }, 403);
    }

    const body = await req.json();
    const organizationType: string = body.organization_type || "";
    const nomPrefill: string = (body.nom_prefill || "").trim();
    const clientId: string = body.client_id || "";

    if (!VALID_TYPES.has(organizationType)) {
      return json({ error: "Type d'organisation non pris en charge (club exclu — voir clubplus-generate-activation)." }, 400);
    }

    let linkedClientId: string | null = null;
    if (clientId) {
      const { data: client } = await admin.from("clients").select("id, nom").eq("id", clientId).maybeSingle();
      if (!client) return json({ error: "Client introuvable." }, 404);
      linkedClientId = client.id;
    }

    const token = crypto.randomUUID().replace(/-/g, "");

    const { data: created, error: insErr } = await admin
      .from("connect_org_activation_tokens")
      .insert({
        organization_type: organizationType,
        nom_prefill: nomPrefill || null,
        client_id: linkedClientId,
        token,
        created_by: caller.id,
      })
      .select("id, expires_at")
      .single();
    if (insErr) return json({ error: insErr.message }, 500);

    const activationUrl = `${connectUrl}/#/org-activation?token=${token}`;

    return json({
      id: created.id,
      token,
      activation_url: activationUrl,
      expires_at: created.expires_at,
      organization_type: organizationType,
      nom_prefill: nomPrefill || null,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
