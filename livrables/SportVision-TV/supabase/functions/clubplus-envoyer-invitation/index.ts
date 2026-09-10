// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Supabase Dashboard → Edge Functions → clubplus-envoyer-invitation → Deploy.

// Supabase Edge Function — clubplus-envoyer-invitation
//
// Envoie par e-mail une invitation nominative Club+ déjà préparée (table `club_invitations`,
// migrations v100/v101), puis la marque comme envoyée.
//
// ── Ce qu'elle ne fait pas, et c'est le point ──
// Elle ne crée AUCUN compte, et n'émet AUCUN jeton. Le jeton existe déjà : c'est celui que le CM
// peut aussi copier depuis l'écran. Le canal ne change pas l'invitation — même lien, même
// expiration, même révocation. C'est la règle §30 du master prompt : « ne crée pas deux
// invitations différentes parce qu'il clique sur les deux boutons ».
//
// ── L'autorisation n'est pas réécrite ici ──
// La fonction agit avec le JETON DE L'APPELANT, jamais avec la clé de service. La policy
// `ci_operateur_all` (peut_operer_club) décide donc seule de qui peut lire et envoyer quelle
// invitation. Une deuxième vérification écrite à la main dans ce fichier serait un second endroit
// où se tromper — c'est exactement ce qui a produit le bug des liens joueurs, où l'écran affichait
// 43 équipes et la base refusait tout.
//
// La clé de service ne sert qu'à une chose : le compteur anti-abus, qui doit s'écrire même quand
// l'appelant n'a le droit de rien.
//
// Secrets requis : SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY,
// FROM_EMAIL (facultatif), CLUBPLUS_URL (facultatif, origine seule sans /clubplus).

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

const ROLE_LABELS: Record<string, string> = {
  coach: "Coach",
  resp_equipe: "Responsable d'équipe",
  directeur_sportif: "Directeur sportif",
  president: "Président",
  secretaire: "Secrétaire",
  comm: "Responsable communication",
  tresorier: "Trésorier",
  membre_bureau: "Membre du bureau",
  administratif: "Administratif",
  sponsor_mgr: "Responsable sponsors",
  lecture_seule: "Lecture seule",
};

function echapper(texte: string): string {
  return texte
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Le message reçu par la personne. Il dit trois choses et pas une de plus : qui l'invite, à quel
 *  titre, et quoi faire. Le §31 du master prompt en donne le ton. */
function corpsHtml(info: {
  prenom: string | null;
  clubNom: string;
  roleLabel: string;
  equipes: string[];
  url: string;
  expireLe: string;
}): string {
  const bonjour = info.prenom ? `Bonjour ${echapper(info.prenom)},` : "Bonjour,";
  const surEquipe =
    info.equipes.length > 0
      ? ` de <strong>${echapper(info.equipes.join(", "))}</strong>`
      : "";
  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#06111F;font-family:Arial,sans-serif;color:#F7F9FC">
  <div style="max-width:520px;margin:32px auto;background:#10243E;border-radius:14px;overflow:hidden">
    <div style="background:#0B1B33;padding:26px 32px">
      <div style="font-size:20px;font-weight:800;color:#fff">SPORTVISION</div>
    </div>
    <div style="padding:28px 32px">
      <p style="font-size:15px;line-height:1.6">${bonjour}</p>
      <p style="font-size:14px;line-height:1.7;color:#9DAEC3">
        <strong>${echapper(info.clubNom)}</strong> vous invite sur SportVision Club+.<br>
        Vous y êtes ajouté comme <strong>${echapper(info.roleLabel)}</strong>${surEquipe}.
      </p>
      <p style="font-size:14px;line-height:1.7;color:#9DAEC3">
        Activez votre espace pour retrouver votre équipe, son calendrier et ses outils.
      </p>
      <div style="text-align:center;margin:26px 0">
        <a href="${info.url}" style="display:inline-block;background:#32D8E6;color:#06111F;font-weight:800;text-decoration:none;padding:14px 28px;border-radius:10px;font-size:15px">Activer mon espace</a>
      </div>
      <p style="font-size:12.5px;line-height:1.6;color:#6C7E93">
        Ce lien est personnel : il ne fonctionne qu'avec l'adresse à laquelle il a été envoyé.
        Il expire le ${echapper(info.expireLe)}.<br>
        Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br>
        <span style="word-break:break-all">${info.url}</span>
      </p>
    </div>
  </div>
</body></html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Authentification requise." }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    // CLUBPLUS_URL porte l'ORIGINE seule, sans le basePath : c'est la convention de
    // clubplus-generate-activation et connect-club-signup-review, qui écrivent toutes deux
    // `${clubplusUrl}/clubplus/...`. S'en écarter ici aurait produit des liens sans /clubplus,
    // donc morts, sans qu'aucun test ne le voie.
    const clubplusUrl = (Deno.env.get("CLUBPLUS_URL") || "https://clubplus.sportvision-an.fr").replace(/\/+$/, "");

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Session invalide." }, 401);

    const body = await req.json().catch(() => ({}));
    const invitationId: string = (body.invitation_id || "").trim();
    if (!invitationId) return json({ error: "Invitation manquante." }, 400);

    // Anti-abus : avec la clé de service, parce qu'un compteur qui ne s'écrit que pour les
    // appelants légitimes ne compte pas ce qu'il faut compter.
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: rateOk } = await admin.rpc("check_and_record_rate_limit", {
      p_identifiant: `clubplus-envoyer-invitation:${userData.user.id}`,
      p_max: 40,
      p_window_seconds: 3600,
    });
    if (rateOk !== true) {
      return json({ error: "Trop d'envois pour le moment. Réessayez dans une heure." }, 429);
    }

    // Lecture AVEC les droits de l'appelant : s'il n'opère pas ce club, la RLS ne lui rend rien,
    // et il ne peut donc pas envoyer une invitation qui ne le regarde pas.
    const { data: inv, error: invErr } = await userClient
      .from("club_invitations")
      .select("id, club_id, email, prenom, role, teams, token, statut, expire_at")
      .eq("id", invitationId)
      .maybeSingle();
    if (invErr) return json({ error: "Lecture de l'invitation impossible." }, 500);
    if (!inv) return json({ error: "Invitation introuvable, ou hors de votre périmètre." }, 404);
    if (inv.statut === "acceptee") return json({ error: "Cette invitation a déjà été acceptée." }, 409);
    if (inv.statut === "revoquee") return json({ error: "Cette invitation a été révoquée." }, 409);
    if (new Date(inv.expire_at).getTime() <= Date.now()) {
      return json({ error: "Cette invitation a expiré. Préparez-en une nouvelle." }, 409);
    }

    const { data: club } = await userClient
      .from("organizations")
      .select("nom")
      .eq("id", inv.club_id)
      .maybeSingle();

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      // On le dit franchement plutôt que de marquer l'invitation « envoyée » : rien n'est parti.
      return json({ error: "L'envoi d'e-mail n'est pas configuré. Copiez le lien à la place." }, 503);
    }
    const fromEmail = Deno.env.get("FROM_EMAIL") || "SportVision <contact@sportvision-an.fr>";

    const url = `${clubplusUrl}/clubplus/rejoindre?token=${encodeURIComponent(inv.token)}`;
    const html = corpsHtml({
      prenom: inv.prenom,
      clubNom: club?.nom ?? "Votre club",
      roleLabel: ROLE_LABELS[inv.role] ?? inv.role,
      equipes: Array.isArray(inv.teams) ? inv.teams : [],
      url,
      expireLe: new Date(inv.expire_at).toLocaleDateString("fr-FR", {
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
    });

    const envoi = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: fromEmail,
        to: [inv.email],
        subject: `${club?.nom ?? "Votre club"} vous invite sur SportVision Club+`,
        html,
      }),
    });
    if (!envoi.ok) {
      const detail = await envoi.text();
      console.error("[clubplus-envoyer-invitation] échec Resend", envoi.status, detail);
      return json({ error: "L'e-mail n'a pas pu être envoyé. Copiez le lien à la place." }, 502);
    }

    // Marqué envoyé APRÈS l'envoi, et seulement s'il a réussi : une invitation affichée comme
    // partie alors que rien n'est parti est pire que pas d'invitation du tout — personne ne
    // pense à relancer.
    const { error: majErr } = await userClient.rpc("marquer_invitation_envoyee", { p_id: inv.id });
    if (majErr) console.error("[clubplus-envoyer-invitation] e-mail parti, statut non mis à jour", majErr);

    return json({ envoye: true, email: inv.email });
  } catch (e) {
    console.error("[clubplus-envoyer-invitation]", e);
    return json({ error: "Envoi impossible." }, 500);
  }
});
