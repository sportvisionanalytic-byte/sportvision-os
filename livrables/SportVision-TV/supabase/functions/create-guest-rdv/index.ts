// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.
// Étape à faire à chaque édition : Supabase Dashboard → Edge Functions →
// create-guest-rdv → coller ce code → Deploy.
// Oublier cette étape est la cause la plus fréquente de "le code est bon
// mais ça ne marche pas en prod" sur ce projet (déjà arrivé sur au moins
// 5 fonctions : clubplus-billing-portal, create-clubplus-subscription-
// checkout, dispatch-notifications, create-guest-rdv, create-guest-request).

// Supabase Edge Function — create-guest-rdv
// Permet à un visiteur de prendre rendez-vous SANS créer de compte, comme dans le
// parcours de la maquette de référence (prendre rendez-vous est une étape avant
// engagement, ne doit pas obliger à créer un compte). Même logique de recherche/
// création du client par e-mail que create-guest-request.
// Deploy via Supabase dashboard > Edge Functions > New Function (name: create-guest-rdv)
// Secrets requis : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Anti-abus : champ honeypot ("site_web", doit rester vide, un bot le remplit
// généralement) + limite de fréquence par IP (5 demandes / heure max), via la
// table guest_rate_limits (migration-portail-v11.sql).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

// deno-lint-ignore no-explicit-any
async function checkRateLimit(admin: any, identifiant: string) {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  const { count } = await admin
    .from("guest_rate_limits")
    .select("id", { count: "exact", head: true })
    .eq("identifiant", identifiant)
    .gte("created_at", since);
  if ((count || 0) >= RATE_LIMIT_MAX) return false;
  await admin.from("guest_rate_limits").insert({ identifiant });
  return true;
}

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

// Même pattern que sendGuestRequestConfirmationEmail (create-guest-request) et
// sendPaymentReceiptEmail (stripe-webhook) : un rendez-vous demandé sans compte
// n'avait jusqu'ici aucune trace écrite pour le visiteur, seul un message à
// l'écran. Best-effort, jamais bloquant pour la création du rendez-vous.
async function sendRdvConfirmationEmail(
  to: string,
  info: { prenom: string; type_rdv: string; date_demandee: string; heure_demandee: string | null; objet: string | null },
) {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) {
    console.error("[sendRdvConfirmationEmail] RESEND_API_KEY absent des secrets de cette fonction — e-mail non envoyé");
    return;
  }
  const fromEmail = Deno.env.get("FROM_EMAIL") || "SportVision <onboarding@resend.dev>";
  const dateFmt = new Date(info.date_demandee).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  const typeLbl = info.type_rdv === "physique" ? "Rendez-vous physique" : "Appel téléphonique";

  const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#06111F;font-family:Arial,sans-serif;color:#F7F9FC">
  <div style="max-width:520px;margin:32px auto;background:#10243E;border-radius:14px;overflow:hidden">
    <div style="background:#0B1B33;padding:26px 32px">
      <div style="font-size:20px;font-weight:800;color:#fff">SPORTVISION</div>
    </div>
    <div style="padding:28px 32px">
      <p style="font-size:15px;line-height:1.6">Bonjour ${info.prenom},</p>
      <p style="font-size:14px;line-height:1.7;color:#9DAEC3">Nous avons bien reçu votre demande de rendez-vous${info.objet ? " — " + info.objet : ""}. Notre équipe vous recontactera pour confirmer sous 24 heures.</p>
      <div style="background:#0B1B33;border-radius:10px;padding:16px 20px;margin:18px 0">
        <div style="font-size:12px;color:#9DAEC3">${typeLbl}</div>
        <div style="font-size:18px;font-weight:800;color:#32D8E6;margin-top:4px">${dateFmt}${info.heure_demandee ? " à " + info.heure_demandee : ""}</div>
      </div>
    </div>
  </div>
</body></html>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: fromEmail, to: [to], subject: "Demande de rendez-vous reçue — SportVision", html }),
  });
  if (!res.ok) {
    console.error("[sendRdvConfirmationEmail] échec Resend", res.status, await res.text());
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const admin = createClient(supabaseUrl, serviceKey);

    const { prenom, nom, email, telephone, profil, type_rdv, objet, date_demandee, heure_demandee, site_web } = await req.json();

    // Honeypot : champ invisible pour un humain, rempli seulement par des bots.
    // On répond succès (sans rien écrire) pour ne pas révéler la détection.
    if (site_web) {
      return json({ rdv_id: null, client_email: email || null });
    }

    if (!email || !prenom || !nom || !date_demandee) {
      return json({ error: "Prénom, nom, e-mail et date sont requis" }, 400);
    }
    if (!["appel", "physique"].includes(type_rdv)) {
      return json({ error: "Type de rendez-vous invalide" }, 400);
    }

    // Validation minimale au-delà du honeypot, même logique que create-guest-request.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: "Adresse e-mail invalide" }, 400);
    }
    if (prenom.length > 100 || nom.length > 100) {
      return json({ error: "Prénom ou nom trop long" }, 400);
    }
    if (objet && objet.length > 500) {
      return json({ error: "Objet trop long" }, 400);
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("cf-connecting-ip") || "inconnu";
    const rateOk = await checkRateLimit(admin, `rdv:${ip}`);
    if (!rateOk) {
      return json({ error: "Trop de demandes envoyées récemment. Merci de réessayer plus tard." }, 429);
    }

    let clientId: string | null = null;
    const { data: matched } = await admin.from("clients").select("id").ilike("email", email).limit(1).maybeSingle();
    if (matched) {
      clientId = matched.id;
    } else {
      const typeClient = TYPE_CLIENT_MAP[profil] || "particulier";
      const nomAffichage = typeClient === "particulier" ? `${prenom} ${nom}`.trim() : nom;
      const { data: created, error: createErr } = await admin
        .from("clients")
        .insert({
          statut: "prospect",
          type_client: typeClient,
          nom: nomAffichage,
          nom_contact: nom,
          prenom_contact: prenom,
          email,
          telephone: telephone || null,
          origine_prospect: "connect",
        })
        .select("id")
        .single();
      if (createErr) return json({ error: createErr.message }, 500);
      clientId = created.id;
    }

    const { data: rdv, error: rdvErr } = await admin
      .from("rendez_vous")
      .insert({
        client_id: clientId,
        type_rdv,
        objet: objet || null,
        date_demandee,
        heure_demandee: heure_demandee || null,
        statut: "a_confirmer",
      })
      .select("id")
      .single();
    if (rdvErr) return json({ error: rdvErr.message }, 500);

    try {
      await sendRdvConfirmationEmail(email, { prenom, type_rdv, date_demandee, heure_demandee: heure_demandee || null, objet: objet || null });
    } catch (e) {
      // Best-effort : un échec d'envoi ne doit jamais faire échouer une demande
      // valide — mais on log pour pouvoir diagnostiquer (Supabase Dashboard →
      // Edge Functions → create-guest-rdv → Logs).
      console.error("[create-guest-rdv] exception envoi e-mail", e instanceof Error ? e.message : String(e));
    }

    return json({ rdv_id: rdv.id, client_email: email });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
