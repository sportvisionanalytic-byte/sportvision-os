// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.
// Étape à faire à chaque édition : Supabase Dashboard → Edge Functions →
// clubplus-family-invite → coller ce code → Deploy.
// Oublier cette étape est la cause la plus fréquente de "le code est bon
// mais ça ne marche pas en prod" sur ce projet (déjà arrivé sur au moins
// 5 fonctions : clubplus-billing-portal, create-clubplus-subscription-
// checkout, dispatch-notifications, create-guest-rdv, create-guest-request).

// Supabase Edge Function — clubplus-family-invite
// Invite un joueur ou un parent sur l'espace Connect.
//
// ── Ce qu'elle fait, depuis le 10/09/2026 ──
// Elle enregistre une invitation (`player_invitations` / `parent_invitations`) et écrit à la
// personne. Elle ne crée AUCUN compte : c'est l'invité qui prend possession du sien, et il
// retrouve son invitation parce qu'elle porte son adresse (`lister_mes_invitations`, v103).
// L'adresse EST le jeton — une invitation ne se transfère pas.
//
// Elle ne crée pas davantage de `player_profiles`, `parent_profiles` ni `membership_requests` :
// c'est l'acceptation qui s'en charge (`accepter_invitation_joueur` / `accept_parent_invitation`),
// en respectant le mode de validation du club.
//
// ── Sécurité ──
// Une seule autorité, celle de la base : `peut_operer_club` (administrateurs du club, CM
// SportVision qui l'exploite) ou `is_team_educateur` pour un coach sur SON équipe. Rien n'est
// réécrit ici — voir le bloc d'autorisation plus bas pour pourquoi.
// (migration-cm-delegation-droits-etendus.sql). Un CM délégué n'a en général
// aucune ligne club_members, donc vérifié indépendamment.
// Idempotent : une invitation 'envoyee' déjà existante pour le même
// club+email(+équipe pour un joueur) est renvoyée telle quelle.
//
// Deploy via Supabase dashboard > Edge Functions > New Function (name: clubplus-family-invite)
// Secrets requis : SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (déjà présents par défaut)
// Secret optionnel : CONNECT_URL (comme clubplus-invite — fix du 08/08/2026,
// pointait vers l'ancienne app Club+ séparée absorbée par Connect)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Anti-abus : limite de fréquence PAR UTILISATEUR authentifié (10/heure), même
// mécanisme que create-guest-request (table guest_rate_limits, migration-portail-v11.sql).
// Un compte Supabase Auth gratuit et auto-créé suffisait jusqu'ici à appeler cette
// fonction en boucle sans coût — audit du 2026-08-06 (AUDIT-RATE-LIMITING.md).
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

// deno-lint-ignore no-explicit-any
async function checkRateLimit(admin: any, identifiant: string) {
  // Fonction atomique (migration-audit-25-08-corrections-batch1.sql, 25/08/2026) : l'ancien
  // motif COUNT puis INSERT séparés laissait une fenêtre de course entre deux appels concurrents
  // (répété tel quel dans ~20 edge functions) — verrou transactionnel scopé à l'identifiant côté
  // Postgres, plus de race condition possible.
  const { data, error } = await admin.rpc("check_and_record_rate_limit", {
    p_identifiant: identifiant,
    p_max: RATE_LIMIT_MAX,
    p_window_seconds: RATE_LIMIT_WINDOW_MS / 1000,
  });
  if (error) return false;
  return data === true;
}

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

/** Copie conforme de la fonction du même nom dans dispatch-notifications (les fonctions n'ont pas
 *  de code partagé) ; tests/emails-adresses-test-prenom.test.mjs vérifie que les deux copies sont
 *  identiques. Renvoie la raison si l'adresse ne doit jamais recevoir d'e-mail, sinon null. */
function adresseNonDistribuable(adresse: string | null | undefined): string | null {
  const a = String(adresse ?? "").trim().toLowerCase();
  const arobase = a.lastIndexOf("@");
  if (arobase < 1) return null; // adresse mal formée : laissée au traitement habituel (le fournisseur la refusera)
  const local = a.slice(0, arobase);
  const domaine = a.slice(arobase + 1).replace(/\.+$/, "");
  const tld = domaine.split(".").pop() || "";
  if (["invalid", "test", "example", "localhost"].includes(tld)) return `domaine réservé (.${tld})`;
  if (/(^|\.)example\.(com|net|org)$/.test(domaine)) return `domaine réservé (${domaine})`;
  if (domaine === "sportvision-test.fr" || domaine.endsWith(".sportvision-test.fr")) return "domaine de test sportvision-test.fr";
  if (domaine === "sportvision-an.fr" && local.startsWith("zz-")) return "adresse de test zz-…@sportvision-an.fr";
  return null;
}

/** L'e-mail reçu par le joueur ou le parent. Il mène vers Connect — pas vers Club+ : un joueur
 *  rejoint son espace personnel, il n'a rien à faire dans l'outil de gestion du club (§38). */
async function envoyerEmailFamille(
  admin: any,
  info: { to: string; prenom: string; targetType: string; clubId: string; teamId: string | null; connectUrl: string },
): Promise<boolean> {
  // Adresse de test ou de domaine réservé (décision du 10/09/2026) : l'invitation est enregistrée,
  // l'e-mail ne part pas. Les tests de parcours joueur/parent appellent cette vraie fonction avec
  // des adresses …@example.invalid : chacun de leurs passages envoyait deux e-mails chez Resend,
  // qui rebondissaient sur la réputation de sportvision-an.fr. Même règle que dispatch-notifications.
  const raisonNonDistribuable = adresseNonDistribuable(info.to);
  if (raisonNonDistribuable) {
    console.log(`[clubplus-family-invite] e-mail non envoyé : ${raisonNonDistribuable}`);
    return false;
  }
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) {
    console.error("[clubplus-family-invite] RESEND_API_KEY absent — invitation enregistrée, e-mail non envoyé");
    return false;
  }
  const fromEmail = Deno.env.get("FROM_EMAIL") || "SportVision <contact@sportvision-an.fr>";

  const { data: club } = await admin.from("organizations").select("nom").eq("id", info.clubId).maybeSingle();
  const clubNom = club?.nom ?? "Votre club";
  let equipe: string | null = null;
  if (info.teamId) {
    const { data: t } = await admin.from("club_teams").select("name").eq("id", info.teamId).maybeSingle();
    equipe = t?.name ?? null;
  }

  const estJoueur = info.targetType === "joueur";
  const url = `${info.connectUrl.replace(/\/+$/, "")}/mes-invitations`;
  const bonjour = info.prenom ? `Bonjour ${info.prenom},` : "Bonjour,";
  const intro = estJoueur
    ? `<strong>${clubNom}</strong> vous invite à rejoindre ${equipe ? `l'équipe <strong>${equipe}</strong>` : "son espace"} sur SportVision Connect.`
    : `<strong>${clubNom}</strong> vous invite sur SportVision Connect en tant que parent.`;
  const promesse = estJoueur
    ? "Retrouvez vos contenus et les services SportVision de votre équipe."
    : "Retrouvez les contenus et services liés à votre enfant.";
  const cta = estJoueur ? "Rejoindre mon équipe" : "Créer mon espace parent";

  const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#06111F;font-family:Arial,sans-serif;color:#F7F9FC">
  <div style="max-width:520px;margin:32px auto;background:#10243E;border-radius:14px;overflow:hidden">
    <div style="background:#0B1B33;padding:26px 32px">
      <div style="font-size:20px;font-weight:800;color:#fff">SPORTVISION</div>
    </div>
    <div style="padding:28px 32px">
      <p style="font-size:15px;line-height:1.6">${bonjour}</p>
      <p style="font-size:14px;line-height:1.7;color:#9DAEC3">${intro}</p>
      <p style="font-size:14px;line-height:1.7;color:#9DAEC3">${promesse}</p>
      <div style="text-align:center;margin:26px 0">
        <a href="${url}" style="display:inline-block;background:#32D8E6;color:#06111F;font-weight:800;text-decoration:none;padding:14px 28px;border-radius:10px;font-size:15px">${cta}</a>
      </div>
      <p style="font-size:12.5px;line-height:1.6;color:#6C7E93">
        Créez votre compte ou connectez-vous avec cette adresse e-mail : votre invitation vous y
        attend.<br>
        Si le bouton ne fonctionne pas, copiez ce lien :<br>
        <span style="word-break:break-all">${url}</span>
      </p>
    </div>
  </div>
</body></html>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: fromEmail,
      to: [info.to],
      subject: estJoueur ? `${clubNom} vous invite sur SportVision Connect` : `${clubNom} vous invite sur SportVision Connect`,
      html,
    }),
  });
  if (!res.ok) {
    console.error("[clubplus-family-invite] échec Resend", res.status, await res.text());
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
    const connectUrl = Deno.env.get("CONNECT_URL") || "https://connect.sportvision-an.fr";

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Session invalide" }, 401);
    const caller = userData.user;

    const body = await req.json();
    const targetType: string = body.target_type;
    if (!["joueur", "parent"].includes(targetType)) {
      return json({ error: "target_type invalide (joueur ou parent)" }, 400);
    }

    const email: string = (body.email || "").trim().toLowerCase();
    const prenom: string = body.prenom || "";
    const nom: string = body.nom || "";
    const clubId: string = body.club_id || "";
    const teamId: string | null = body.team_id || null;
    const dateNaissance: string | null = body.date_naissance || null;
    const playerId: string | null = body.player_id || null;

    if (!email || !clubId) return json({ error: "E-mail et club sont obligatoires." }, 400);
    if (targetType === "joueur" && (!teamId || !dateNaissance)) {
      return json({ error: "Équipe et date de naissance sont obligatoires pour inviter un joueur." }, 400);
    }

    const admin = createClient(supabaseUrl, serviceKey);

    const rateOk = await checkRateLimit(admin, `clubplus-family-invite:${caller.id}`);
    if (!rateOk) {
      return json({ error: "Trop de tentatives. Réessayez dans une heure." }, 429);
    }

    // ── Autorisation : une seule source, celle de la base ──
    // 10/09/2026 — Ce bloc réécrivait à la main ce que `peut_operer_club` (migration v99) sait
    // déjà : membre admin du club, délégation d'agence, super-accès CM. Il ignorait en revanche
    // les affectations nominatives (`club_cm_affectations`) et les métiers d'exploitation
    // SportVision — c'est-à-dire précisément la façon dont les vrais CM sont rattachés à leurs
    // clubs aujourd'hui. Résultat : « Non autorisé sur ce club » pour la personne qui administre
    // le club au quotidien, troisième occurrence du même défaut après les liens joueurs et
    // l'écran « Coachs & dirigeants ».
    //
    // On demande donc, avec les droits de l'APPELANT, et on ne recopie plus la règle ici.
    const { data: peutOperer } = await userClient.rpc("peut_operer_club", { p_club_id: clubId });
    let autorise = peutOperer === true;

    // Un coach ou un responsable d'équipe peut inviter, mais pour SON équipe seulement.
    // `is_team_educateur` porte déjà cette restriction : inutile de comparer des noms d'équipes à
    // la main, ce que faisait l'ancien code.
    if (!autorise) {
      if (!teamId) {
        return json({ error: "Vous ne pouvez inviter que pour vos propres équipes : précisez laquelle." }, 403);
      }
      const { data: team } = await admin
        .from("club_teams")
        .select("club_id")
        .eq("id", teamId)
        .maybeSingle();
      if (!team || team.club_id !== clubId) {
        return json({ error: "Cette équipe n'appartient pas à ce club." }, 400);
      }
      const { data: educateur } = await userClient.rpc("is_team_educateur", { p_team_id: teamId });
      autorise = educateur === true;
    }

    if (!autorise) {
      return json({ error: "Vous n'êtes pas autorisé à inviter sur ce club." }, 403);
    }


    // Idempotence : une invitation en attente identique existe déjà.
    if (targetType === "joueur") {
      const { data: existingInv } = await admin
        .from("player_invitations")
        .select("id")
        .eq("club_id", clubId)
        .eq("email", email)
        .eq("team_id", teamId)
        .eq("statut", "envoyee")
        .maybeSingle();
      if (existingInv) return json({ id: existingInv.id, already_invited: true });
    } else {
      let query = admin.from("parent_invitations").select("id").eq("club_id", clubId).eq("email", email).eq("statut", "envoyee");
      query = playerId ? query.eq("player_id", playerId) : query.is("player_id", null);
      const { data: existingInv } = await query.maybeSingle();
      if (existingInv) return json({ id: existingInv.id, already_invited: true });
    }

    // ── Aucun compte n'est créé ici, et c'est le point ──
    // 10/09/2026 — Cette fonction appelait `inviteUserByEmail`, qui crée le compte auth.users et
    // envoie l'e-mail d'invitation Supabase. Deux raisons de s'en défaire :
    //
    //   le principe posé par Fouka — « le club crée l'accès potentiel, la personne prend
    //   possession de son compte ». Un compte fabriqué par le club serait une identité de plus
    //   pour quelqu'un qui est peut-être déjà parent d'un joueur et acheteur Connect ;
    //
    //   et le fait, constaté avant d'écrire, que ça ne menait NULLE PART. Aucun écran de Connect
    //   ne lisait `player_invitations` ni `parent_invitations` — `accept_parent_invitation`
    //   existait depuis des mois sans être appelée d'aucune application servie. La personne
    //   recevait un e-mail, posait un mot de passe, arrivait dans Connect, et rien ne lui disait
    //   pourquoi elle était là.
    //
    // Désormais : on enregistre l'invitation, on écrit nous-mêmes à la personne, et elle la
    // retrouve dans Connect parce que l'invitation porte son adresse (`lister_mes_invitations`,
    // migration v103). L'adresse EST le jeton : une invitation ne se transfère pas, et une chaîne
    // de moins est à sécuriser.

    if (targetType === "joueur") {
      const { data: created, error: insErr } = await admin
        .from("player_invitations")
        .insert({
          club_id: clubId,
          team_id: teamId,
          email,
          prenom: prenom || null,
          nom: nom || null,
          date_naissance: dateNaissance,
          invited_by: caller.id,
        })
        .select("id")
        .single();
      if (insErr) return json({ error: insErr.message }, 500);
      const envoye = await envoyerEmailFamille(admin, {
        to: email, prenom, targetType: "joueur", clubId, teamId, connectUrl,
      });
      return json({ id: created.id, already_invited: false, email_envoye: envoye });
    } else {
      const { data: created, error: insErr } = await admin
        .from("parent_invitations")
        .insert({
          club_id: clubId,
          player_id: playerId,
          email,
          prenom: prenom || null,
          nom: nom || null,
          invited_by: caller.id,
        })
        .select("id")
        .single();
      if (insErr) return json({ error: insErr.message }, 500);
      const envoye = await envoyerEmailFamille(admin, {
        to: email, prenom, targetType: "parent", clubId, teamId: null, connectUrl,
      });
      return json({ id: created.id, already_invited: false, email_envoye: envoye });
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
