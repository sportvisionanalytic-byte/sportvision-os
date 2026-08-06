// Supabase Edge Function — notify-account-change
// Envoie les e-mails de sécurité AUTH-05 (mot de passe modifié) et AUTH-06
// (adresse e-mail modifiée) via le Communication Hub, après un changement
// déjà effectué côté client via /auth/v1/user (PUT direct, inchangé).
//
// Volontairement une fonction à part plutôt qu'un appel direct depuis le
// navigateur vers enqueue_notification : cette RPC est security definer et
// accepte n'importe quel destinataire/template si on l'appelle sans filtre —
// l'exposer telle quelle permettrait à un compte authentifié d'envoyer un
// e-mail à n'importe qui. Ici, le destinataire est TOUJOURS résolu depuis le
// JWT vérifié de l'appelant, jamais depuis un paramètre du corps de requête —
// impossible de déclencher une notification "changement de sécurité" au nom
// de quelqu'un d'autre.
//
// Body attendu : { type: 'password_changed' } ou
//                 { type: 'email_changed', new_email, old_email }
// Secrets requis : aucun secret supplémentaire.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return email;
  const visible = user.slice(0, 2);
  return visible + "***@" + domain;
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
    const user = userData.user;

    const admin = createClient(supabaseUrl, serviceKey);
    const { type, new_email } = await req.json();

    const firstName = user.user_metadata?.prenom || "";
    const changedAt = new Date().toLocaleString("fr-FR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

    if (type === "password_changed") {
      await admin.rpc("enqueue_notification", {
        p_event_type: "password.changed",
        p_template_key: "auth.password_changed",
        p_channel: "EMAIL",
        p_idempotency_key: "auth.password_changed:v1:" + user.id + ":" + new Date().toISOString().slice(0, 13),
        p_recipient_email: user.email,
        p_recipient_user_id: user.id,
        p_payload: { first_name: firstName, changed_at_local: changedAt, security_url: supabaseUrl },
      });
      return json({ success: true });
    }

    if (type === "email_changed") {
      // Envoyé à l'adresse résolue par le JWT vérifié de l'appelant (celle
      // encore active tant que le changement n'est pas confirmé côté
      // Supabase) — jamais une adresse fournie par le client, pour empêcher
      // de détourner cette alerte de sécurité vers un tiers.
      await admin.rpc("enqueue_notification", {
        p_event_type: "email.changed",
        p_template_key: "auth.email_changed",
        p_channel: "EMAIL",
        p_idempotency_key: "auth.email_changed:v1:" + user.id + ":" + new Date().toISOString().slice(0, 13),
        p_recipient_email: user.email,
        p_recipient_user_id: user.id,
        p_payload: { masked_new_email: maskEmail(new_email || ""), changed_at_local: changedAt, dispute_url: supabaseUrl },
      });
      return json({ success: true });
    }

    return json({ error: "type invalide" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
