// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.
// Étape à faire à chaque édition : Supabase Dashboard → Edge Functions →
// send-candidature-refus-email → coller ce code → Deploy.

// Supabase Edge Function — send-candidature-refus-email
// Appelée depuis l'OS (recrutMove, SportVision-OS-Full.html) quand le staff passe
// une candidature au statut "refuse". Envoie un e-mail cordial au candidat via
// Resend — même provider/secrets que send-devis-email, send-contrat-email, etc.
// Required secrets: RESEND_API_KEY, FROM_EMAIL (optionnel, défaut onboarding@resend.dev)

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

const POSTE_LABELS: Record<string, string> = {
  photographe: "photographe",
  videaste: "vidéaste",
  les_deux: "photographe & vidéaste",
  community_manager: "community manager",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Même garde que send-devis-email/send-contrat-email : la clé anon publique ne
    // suffit pas, il faut une session staff authentifiée valide (ligne dans `profiles`).
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Authentification requise" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Session invalide" }, 401);

    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

    const { data: staffProfile } = await admin
      .from("profiles")
      .select("id")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (!staffProfile) return json({ error: "Non autorisé" }, 403);

    const { application_id } = await req.json();
    if (!application_id) return json({ error: "application_id requis" }, 400);

    // Les données du candidat (email, prénom, poste) sont relues côté serveur depuis
    // la table plutôt que fournies par le client, pour ne jamais envoyer un e-mail de
    // refus à une adresse qui n'est pas réellement celle du candidat concerné.
    const { data: app, error: appErr } = await admin
      .from("recruitment_applications")
      .select("email, prenom, poste, statut")
      .eq("id", application_id)
      .maybeSingle();
    if (appErr || !app) return json({ error: "Candidature introuvable" }, 404);

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) return json({ error: "RESEND_API_KEY non configurée dans les secrets Supabase." }, 500);
    const fromEmail = Deno.env.get("FROM_EMAIL") || "SportVision <onboarding@resend.dev>";

    const posteLabel = POSTE_LABELS[app.poste as string] || "cette candidature";

    const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#06111F;font-family:Arial,sans-serif;color:#F7F9FC">
  <div style="max-width:520px;margin:32px auto;background:#10243E;border-radius:14px;overflow:hidden">
    <div style="background:#0B1B33;padding:26px 32px">
      <div style="font-size:20px;font-weight:800;color:#fff">SPORTVISION</div>
    </div>
    <div style="padding:28px 32px">
      <p style="font-size:15px;line-height:1.6;margin:0 0 16px">Bonjour ${app.prenom},</p>
      <p style="font-size:14px;line-height:1.7;color:#E4EAF2;margin:0 0 14px">
        Nous vous remercions sincèrement pour l'intérêt que vous avez porté à SportVision en candidatant au poste de ${posteLabel}, ainsi que pour le temps consacré à votre candidature.
      </p>
      <p style="font-size:14px;line-height:1.7;color:#E4EAF2;margin:0 0 14px">
        Après une étude attentive de votre profil, nous avons fait le choix de ne pas donner suite pour le moment. Cette décision ne remet pas en cause vos compétences : elle tient avant tout à nos besoins actuels et aux spécificités des missions à pourvoir.
      </p>
      <p style="font-size:14px;line-height:1.7;color:#E4EAF2;margin:0 0 14px">
        Nous conservons votre candidature et n'hésiterons pas à revenir vers vous si une opportunité correspondant à votre profil se présente.
      </p>
      <p style="font-size:14px;line-height:1.7;color:#E4EAF2;margin:0 0 4px">
        Nous vous souhaitons une pleine réussite dans vos projets professionnels.
      </p>
      <p style="font-size:14px;line-height:1.7;color:#E4EAF2;margin:20px 0 0">
        Cordialement,<br>L'équipe SportVision
      </p>
    </div>
  </div>
</body></html>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: fromEmail,
        to: [app.email],
        subject: "Votre candidature chez SportVision",
        html,
      }),
    });
    const resendData = await res.json();
    if (!res.ok) {
      return json({ error: resendData.message || "Erreur Resend", details: resendData }, 502);
    }

    return json({ success: true, email_id: resendData.id });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
