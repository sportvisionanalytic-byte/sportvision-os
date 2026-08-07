// Supabase Edge Function — invite-collaborateur
// Remplace le flux actuel (créerCollaborateur() côté OS révèle un mot de
// passe provisoire en clair à l'écran, à communiquer "à la main" — exactement
// le problème signalé par le cahier des charges Communication Hub, AUTH-01).
//
// Nouveau flux : génère un vrai lien d'invitation à usage unique via Supabase
// Auth (admin.generateLink, type 'invite' — ne déclenche PAS l'e-mail par
// défaut de Supabase), crée la ligne profiles avec le rôle choisi, puis passe
// par le Communication Hub (enqueue_notification) pour un e-mail SportVision
// branded, envoyé par le worker dispatch-notifications via Brevo.
//
// Réservé au staff admin (vérifie le JWT appelant + son rôle, même pattern
// que send-devis-email/send-facture-email).
//
// Secrets requis : aucun secret supplémentaire — utilise SUPABASE_URL et
// SUPABASE_SERVICE_ROLE_KEY déjà présents par défaut sur le projet.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ROLE_LABELS: Record<string, string> = {
  sec: "Secrétaire", prod: "Resp. Production", photo: "Photographe / Vidéaste",
  cm: "Community Manager", compta: "Comptable", com: "Commercial", admin: "Administrateur",
  expert_comptable: "Expert-comptable", auditeur: "Auditeur",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Authentification requise" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Session invalide" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: callerProfile } = await admin.from("profiles").select("role").eq("id", userData.user.id).maybeSingle();
    if (!callerProfile || callerProfile.role !== "admin") return json({ error: "Réservé aux administrateurs" }, 403);

    const { email, prenom, nom, role, organization_name, redirect_url } = await req.json();
    if (!email || !prenom || !nom || !role) return json({ error: "Champs manquants" }, 400);
    if (!ROLE_LABELS[role]) return json({ error: "Rôle invalide" }, 400);

    // Génère l'invitation Supabase (crée le compte auth s'il n'existe pas) sans
    // envoyer l'e-mail par défaut de Supabase — on utilise le nôtre ensuite.
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "invite",
      email,
      options: { data: { role, prenom, nom }, redirectTo: redirect_url },
    });
    if (linkErr) return json({ error: linkErr.message }, 400);

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 jours

    const idempotencyKey = "auth.invitation:v1:" + linkData.user.id;
    const { error: enqueueErr } = await admin.rpc("enqueue_notification", {
      p_event_type: "user.invited",
      p_template_key: "auth.invitation",
      p_channel: "EMAIL",
      p_idempotency_key: idempotencyKey,
      p_recipient_email: email,
      p_recipient_user_id: linkData.user.id,
      p_entity_type: "collaborateur",
      p_entity_id: linkData.user.id,
      p_payload: {
        first_name: prenom,
        inviter_name: userData.user.user_metadata?.prenom || "L'équipe SportVision",
        organization_name: organization_name || "SportVision",
        role_label: ROLE_LABELS[role],
        expires_at_local: expiresAt.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" }),
        invitation_url: linkData.properties.action_link,
      },
    });
    if (enqueueErr) return json({ error: enqueueErr.message }, 500);

    return json({ user_id: linkData.user.id, success: true });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
});
