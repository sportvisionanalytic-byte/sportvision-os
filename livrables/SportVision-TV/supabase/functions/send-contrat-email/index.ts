// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.
// Étape à faire à chaque édition : Supabase Dashboard → Edge Functions →
// send-contrat-email → coller ce code → Deploy.
// Oublier cette étape est la cause la plus fréquente de "le code est bon
// mais ça ne marche pas en prod" sur ce projet.

// Supabase Edge Function — send-contrat-email
// Envoie le contrat par e-mail au client. Contrairement à send-devis-email /
// send-facture-email (qui reconstruisent le document côté serveur), le HTML complet
// du contrat est construit côté OS (SportVision-OS-Full.html, fonction
// _construireContratDocumentHTML — la « Banque de contrats », clauses générales +
// conditions particulières par type) et transmis tel quel ici : ce texte engage
// juridiquement SportVision, donc une seule source de vérité pour sa génération
// (le client), jamais une seconde implémentation dupliquée côté edge function qui
// pourrait diverger silencieusement.
// Cette fonction se contente de vérifier l'auth staff, retrouver le contrat/client
// (pour la vérification + le contexte du log), et relayer l'envoi via Resend.
//
// Deploy via Supabase dashboard > Edge Functions > New Function (name: send-contrat-email)
// Secrets requis : RESEND_API_KEY, FROM_EMAIL (optionnel)

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

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Session invalide" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);

    // Seul un membre du staff (ligne dans `profiles`) peut envoyer un contrat par e-mail.
    const { data: staffProfile } = await admin
      .from("profiles")
      .select("id")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (!staffProfile) return json({ error: "Non autorisé" }, 403);

    const { contrat_id: contratId, to, subject, html } = await req.json();
    if (!contratId || !to || !html) {
      return json({ error: "contrat_id, to et html sont requis" }, 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return json({ error: "Adresse e-mail invalide" }, 400);
    }

    // Vérifie que le contrat existe réellement (jamais de confiance dans un id envoyé
    // par le client sans le confirmer en base) — sert aussi de contexte pour le sujet
    // par défaut si le staff n'en a pas fourni.
    const { data: contrat } = await admin
      .from("contrats")
      .select("id, type_contrat, clients(nom)")
      .eq("id", contratId)
      .maybeSingle();
    if (!contrat) return json({ error: "Contrat introuvable." }, 404);

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail = Deno.env.get("FROM_EMAIL") || "SportVision <onboarding@resend.dev>";
    if (!resendApiKey) {
      return json({ error: "RESEND_API_KEY non configurée dans les secrets Supabase." }, 500);
    }

    const clientNom = (contrat as { clients?: { nom?: string } }).clients?.nom || "SportVision";
    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: fromEmail,
        to: [to],
        subject: subject || `Contrat — ${clientNom}`,
        html,
      }),
    });
    const resendData = await resendRes.json();
    if (!resendRes.ok) {
      return json({ error: resendData.message || "Erreur Resend", details: resendData }, 502);
    }

    return json({ success: true, email_id: resendData.id });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
