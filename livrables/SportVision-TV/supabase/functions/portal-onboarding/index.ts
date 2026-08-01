// Supabase Edge Function — portal-onboarding
// Appelée juste après l'inscription d'un client sur SportVision Portail (Supabase Auth signUp).
// Cherche un client existant par e-mail (prospect déjà en base côté OS), sinon en crée un,
// puis crée la ligne client_users qui lie le compte auth au client.
// Envoie aussi un e-mail de bienvenue via Resend au premier onboarding (idempotent :
// ne renvoie rien si le compte a déjà été onboardé auparavant).
// Deploy via Supabase dashboard > Edge Functions > New Function (name: portal-onboarding)
// Secrets requis : SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (déjà présents par défaut sur le projet)
// Secrets optionnels : RESEND_API_KEY, FROM_EMAIL (sans eux, l'onboarding fonctionne quand même, l'e-mail est juste ignoré)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TYPE_CLIENT_MAP: Record<string, string> = {
  club: "club",
  organisateur: "association",
  entreprise: "entreprise",
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

    // Vérifie le JWT du client (aucune confiance dans un id fourni par le body)
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Session invalide" }, 401);
    const user = userData.user;

    const { prenom, nom, telephone, profil } = await req.json();

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: existing } = await admin
      .from("client_users")
      .select("id, client_id")
      .eq("id", user.id)
      .maybeSingle();
    if (existing) {
      return json({ client_id: existing.client_id, already_onboarded: true });
    }

    let clientId: string | null = null;
    if (user.email) {
      const { data: matched } = await admin
        .from("clients")
        .select("id")
        .ilike("email", user.email)
        .limit(1)
        .maybeSingle();
      if (matched) clientId = matched.id;
    }

    if (!clientId) {
      const typeClient = TYPE_CLIENT_MAP[profil] || "particulier";
      const nomAffichage =
        typeClient === "particulier"
          ? `${prenom || ""} ${nom || ""}`.trim() || "Client Portail"
          : nom || prenom || "Client Portail";

      const { data: created, error: createErr } = await admin
        .from("clients")
        .insert({
          statut: "prospect",
          type_client: typeClient,
          nom: nomAffichage,
          nom_contact: nom || null,
          prenom_contact: prenom || null,
          email: user.email,
          telephone: telephone || null,
          origine_prospect: "portail",
        })
        .select("id")
        .single();
      if (createErr) return json({ error: createErr.message }, 500);
      clientId = created.id;
    }

    const { error: cuErr } = await admin.from("client_users").insert({
      id: user.id,
      client_id: clientId,
      prenom: prenom || null,
      nom: nom || null,
      telephone: telephone || null,
    });
    if (cuErr) return json({ error: cuErr.message }, 500);

    if (user.email) {
      await sendWelcomeEmail(user.email, prenom).catch(() => {});
    }

    return json({ client_id: clientId, already_onboarded: false });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
});

async function sendWelcomeEmail(to: string, prenom?: string) {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) return; // optionnel : pas d'e-mail si le secret n'est pas configuré
  const fromEmail = Deno.env.get("FROM_EMAIL") || "SportVision <onboarding@resend.dev>";
  const portalUrl = Deno.env.get("PORTAL_URL") || "https://portail.sportvision.fr";

  const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#06111F;font-family:Arial,sans-serif;color:#F7F9FC">
  <div style="max-width:520px;margin:32px auto;background:#10243E;border-radius:14px;overflow:hidden">
    <div style="background:#0B1B33;padding:26px 32px">
      <div style="font-size:20px;font-weight:800;color:#fff">SPORTVISION</div>
      <div style="font-size:10px;color:#32D8E6;letter-spacing:.1em;margin-top:2px">PORTAIL</div>
    </div>
    <div style="padding:28px 32px">
      <p style="font-size:15px;line-height:1.6">Bonjour ${prenom || ""},</p>
      <p style="font-size:14px;line-height:1.7;color:#9DAEC3">Votre espace client SportVision est prêt. Vous pouvez désormais suivre vos demandes, devis, factures et livrables directement depuis votre Portail.</p>
      <a href="${portalUrl}" style="display:inline-block;margin-top:14px;background:#168BFF;color:#fff;text-decoration:none;padding:12px 22px;border-radius:9px;font-size:14px;font-weight:700">Accéder à mon espace</a>
    </div>
  </div>
</body></html>`;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: fromEmail, to: [to], subject: "Bienvenue sur votre espace SportVision", html }),
  });
}
