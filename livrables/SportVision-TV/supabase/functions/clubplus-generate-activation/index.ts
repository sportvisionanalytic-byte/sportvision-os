// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.
// Étape à faire à chaque édition : Supabase Dashboard → Edge Functions →
// clubplus-generate-activation → coller ce code → Deploy.
// Oublier cette étape est la cause la plus fréquente de "le code est bon
// mais ça ne marche pas en prod" sur ce projet (déjà arrivé sur au moins
// 5 fonctions : clubplus-billing-portal, create-clubplus-subscription-
// checkout, dispatch-notifications, create-guest-rdv, create-guest-request).

// Supabase Edge Function — clubplus-generate-activation
// Appelée par le STAFF SportVision depuis SportVision OS (fiche client du CRM) pour
// inviter un club déjà suivi commercialement — ligne `clients` existante, avec ses
// devis/prestations dans le Portail — à activer son espace Club+ pré-relié à cet
// historique, sans repasser par l'inscription self-service publique.
//
// Génère un lien privé et l'envoie automatiquement (Resend) à l'adresse e-mail du
// contact client (clients.email) — changement du 21/08/2026, sur demande de Fouka
// (avant cela le staff devait le transmettre lui-même). Ce lien est un SECRET :
// quiconque le possède peut créer le compte admin du club et lire ses devis/factures/
// contrats Portail — il expire au bout de 30 jours (défaut de la table, cf.
// migration-clubplus-v26-activation-tokens.sql). L'URL reste aussi renvoyée dans la
// réponse (le staff peut la voir/recopier, ex. si l'e-mail échoue ou si aucune adresse
// n'est enregistrée) — l'envoi automatique est best-effort et ne bloque jamais la
// création du token.
//
// Sécurité : l'appelant doit avoir un `profiles.role` dans ('admin','sec','com')
// — vérifié en service role, jamais depuis un rôle envoyé dans le body. Le token est
// généré ici avec crypto.randomUUID() (122 bits d'aléa cryptographique), jamais côté
// client. La consommation du lien se fait dans clubplus-activate, sa vérification
// publique dans clubplus-check-activation-token.
//
// Deploy via Supabase dashboard > Edge Functions > New Function (name: clubplus-generate-activation)
// Secrets requis : SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (déjà présents par défaut)
// Secret optionnel : CONNECT_URL (même variable que clubplus-invite / clubplus-family-invite,
// même valeur par défaut — ne pas en créer une seconde)
//
// Fix du 08/08/2026 : générait un lien vers l'ancienne app Club+ séparée
// (SportVision-Club-Plus.html#/activation?token=…). Connect a maintenant son
// propre écran d'activation sur la même route de hash (#/activation?token=…,
// voir index.html : scr-activation / startActivation / handleActivation),
// portée depuis l'ancienne app le même jour — aucun changement de contrat
// avec clubplus-check-activation-token / clubplus-activate, qui restent
// inchangées.

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
const VALID_PLANS = ["free", "club", "performance"];

const PLAN_LABELS: Record<string, string> = {
  free: "Club+ Gratuit",
  club: "Club+",
  performance: "Club+ Performance",
};

async function sendActivationEmail(
  to: string,
  info: { contactPrenom: string | null; clubNom: string; activationUrl: string; plan: string; expiresAt: string },
) {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) {
    console.error("[clubplus-generate-activation] RESEND_API_KEY absent — e-mail non envoyé");
    return false;
  }
  const fromEmail = Deno.env.get("FROM_EMAIL") || "SportVision <onboarding@resend.dev>";
  const dateFmt = new Date(info.expiresAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  const greeting = info.contactPrenom ? `Bonjour ${info.contactPrenom},` : "Bonjour,";

  const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#06111F;font-family:Arial,sans-serif;color:#F7F9FC">
  <div style="max-width:520px;margin:32px auto;background:#10243E;border-radius:14px;overflow:hidden">
    <div style="background:#0B1B33;padding:26px 32px">
      <div style="font-size:20px;font-weight:800;color:#fff">SPORTVISION</div>
    </div>
    <div style="padding:28px 32px">
      <p style="font-size:15px;line-height:1.6">${greeting}</p>
      <p style="font-size:14px;line-height:1.7;color:#9DAEC3">Votre espace <strong>${PLAN_LABELS[info.plan] || "Club+"}</strong> pour ${info.clubNom} est prêt. Activez-le en créant votre compte administrateur :</p>
      <div style="text-align:center;margin:26px 0">
        <a href="${info.activationUrl}" style="display:inline-block;background:#32D8E6;color:#06111F;font-weight:800;text-decoration:none;padding:14px 28px;border-radius:10px;font-size:15px">Activer mon espace Club+</a>
      </div>
      <p style="font-size:12.5px;line-height:1.6;color:#6C7E93">Ce lien est personnel, ne le partagez pas. Il expire le ${dateFmt}. Si vous ne pouvez pas cliquer sur le bouton, copiez ce lien dans votre navigateur :<br><span style="word-break:break-all">${info.activationUrl}</span></p>
    </div>
  </div>
</body></html>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: fromEmail,
      to: [to],
      subject: `Activez votre espace Club+ — ${info.clubNom}`,
      html,
    }),
  });
  if (!res.ok) {
    console.error("[clubplus-generate-activation] échec Resend", res.status, await res.text());
    return false;
  }
  return true;
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
    // 17/08/2026 — CLUBPLUS_URL (pas CONNECT_URL) : Club+ est une app séparée depuis le split du
    // 12/08/2026, avec son propre écran d'activation en route réelle (app-next/src/app/
    // activation/page.tsx, basePath /clubplus) — voir migration-clubplus-v44 et l'audit complet
    // Club+ du 17/08/2026, qui a trouvé que ce lien pointait jusqu'ici vers une route en hash
    // (#/activation?token=…) qu'aucune app actuelle ne sert plus.
    const clubplusUrl = Deno.env.get("CLUBPLUS_URL") || "https://clubplus.sportvision-an.fr";

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Session invalide" }, 401);
    const caller = userData.user;

    const admin = createClient(supabaseUrl, serviceKey);

    // Vérifie le rôle staff côté serveur (jamais de confiance dans le body).
    const { data: callerProfile } = await admin
      .from("profiles")
      .select("role")
      .eq("id", caller.id)
      .maybeSingle();
    if (!callerProfile || !STAFF_ROLES.includes(callerProfile.role)) {
      return json({ error: "Seul le staff SportVision peut générer un lien d'activation Club+." }, 403);
    }

    const body = await req.json();
    const clientId: string = body.client_id || "";
    const plan: string = VALID_PLANS.includes(body.plan) ? body.plan : "club";
    const clubNomPrefill: string = (body.club_nom_prefill || "").trim();

    if (!clientId) return json({ error: "Le client est obligatoire." }, 400);

    // Le client Portail doit exister — sinon le lien pointerait vers un
    // rattachement impossible, découvert seulement à l'activation.
    const { data: client } = await admin
      .from("clients")
      .select("id, nom, email, prenom_contact")
      .eq("id", clientId)
      .maybeSingle();
    if (!client) return json({ error: "Client introuvable." }, 404);

    const token = crypto.randomUUID().replace(/-/g, "");

    const { data: created, error: insErr } = await admin
      .from("clubplus_activation_tokens")
      .insert({
        client_id: client.id,
        token,
        club_nom_prefill: clubNomPrefill || client.nom || null,
        plan,
        created_by: caller.id,
      })
      .select("id, expires_at")
      .single();
    if (insErr) return json({ error: insErr.message }, 500);

    const activationUrl = `${clubplusUrl}/clubplus/activation?token=${token}`;
    const clubNomFinal = clubNomPrefill || client.nom || "votre club";

    let emailSent = false;
    if (client.email) {
      try {
        emailSent = await sendActivationEmail(client.email, {
          contactPrenom: client.prenom_contact || null,
          clubNom: clubNomFinal,
          activationUrl,
          plan,
          expiresAt: created.expires_at,
        });
      } catch (e) {
        // Best-effort : un échec d'envoi ne doit jamais faire échouer la génération
        // du token, qui reste valide et consultable/retransmissible manuellement.
        console.error("[clubplus-generate-activation] exception envoi e-mail", e instanceof Error ? e.message : String(e));
      }
    }

    return json({
      id: created.id,
      token,
      activation_url: activationUrl,
      expires_at: created.expires_at,
      plan,
      club_nom_prefill: clubNomFinal,
      email_sent: emailSent,
      email: client.email || null,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
