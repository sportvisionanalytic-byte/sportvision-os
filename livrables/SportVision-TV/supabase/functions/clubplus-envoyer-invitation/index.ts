// Déploiement : bash scripts/deployer-fonction.sh clubplus-envoyer-invitation
// (jamais `supabase functions deploy` nu — voir supabase/functions/README.md).

// Supabase Edge Function — clubplus-envoyer-invitation
//
// Envoie par e-mail une invitation nominative Club+ déjà préparée (table `club_invitations`,
// migrations v100/v101), puis la marque comme envoyée. Depuis le 10/09/2026, l'e-mail passe par la
// file d'envoi (notification_outbox, gabarit clubplus.invitation) au lieu d'un appel direct à Resend.
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
// La clé de service sert à deux choses, et seulement après la lecture de l'invitation sous le
// jeton de l'appelant : le compteur anti-abus, qui doit s'écrire même quand l'appelant n'a le droit
// de rien, et la mise en file de l'e-mail (enqueue_notification n'est pas ouverte aux comptes
// connectés). Si l'appelant n'a pas le droit de lire l'invitation, on s'arrête avant l'une et l'autre.
//
// Secrets requis : SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, CLUBPLUS_URL
// (facultatif, origine seule sans /clubplus). L'envoi lui-même est fait par dispatch-notifications.

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

    // ── Par la file d'envoi, comme tous les autres e-mails (liste V1.1, 10/09/2026) ──
    // Cette fonction appelait Resend directement. L'e-mail partait, mais hors de
    // notification_outbox : aucune relance si le fournisseur tousse, aucune liste de suppression,
    // et surtout aucune trace — impossible de repondre a « le coach dit qu'il n'a rien recu »
    // autrement qu'en devinant. Il est desormais mis en file, envoye par dispatch-notifications
    // (cron chaque minute), trace et relance comme les autres. Le texte est celui du gabarit
    // clubplus.invitation, repris mot pour mot de l'ancien e-mail direct.
    //
    // Les variables sont du texte brut : la file les echappe avant de les inserer.
    const url = `${clubplusUrl}/clubplus/rejoindre?token=${encodeURIComponent(inv.token)}`;
    const equipes = Array.isArray(inv.teams) ? inv.teams.filter((e: unknown) => typeof e === "string" && e) : [];
    // Le client de service existe deja plus haut (compteur anti-abus) : on le reutilise. Le 10/09,
    // une seconde declaration `const admin` ici a empeche la fonction de DEMARRER (BOOT_ERROR) —
    // toutes les invitations par e-mail sont tombees le temps de revenir a la version precedente.
    const { data: fileId, error: fileErr } = await admin.rpc("enqueue_notification", {
      p_event_type: "clubplus.invitation.envoyee",
      p_template_key: "clubplus.invitation",
      p_channel: "EMAIL",
      // Une fenetre de 30 s absorbe un double clic ou un nouvel essai reseau immediat, sans
      // bloquer un vrai « renvoyer » quelques minutes plus tard — meme regle que la
      // reinitialisation de mot de passe, et pour la meme raison (defaut du 23/08).
      p_idempotency_key: `clubplus.invitation:v1:${inv.id}:${Math.floor(Date.now() / 30000)}`,
      p_recipient_email: inv.email,
      p_entity_type: "club_invitation",
      p_entity_id: inv.id,
      p_payload: {
        salutation: inv.prenom ? `Bonjour ${inv.prenom},` : "Bonjour,",
        club_nom: club?.nom ?? "Votre club",
        role_label: ROLE_LABELS[inv.role] ?? inv.role,
        equipes_texte: equipes.length > 0 ? ` de ${equipes.join(", ")}` : "",
        invitation_url: url,
        expire_le: new Date(inv.expire_at).toLocaleDateString("fr-FR", {
          timeZone: "Europe/Paris", day: "numeric", month: "long", year: "numeric",
        }),
      },
    });
    if (fileErr) {
      console.error("[clubplus-envoyer-invitation] mise en file impossible", fileErr);
      return json({ error: "L'e-mail n'a pas pu être envoyé. Copiez le lien à la place." }, 502);
    }
    // fileId nul = meme invitation deja mise en file dans les 30 dernieres secondes : c'est un
    // doublon absorbe, pas une erreur. L'e-mail est bien en route.

    // Marquee envoyee une fois l'e-mail en file. Il n'est pas encore parti, mais la file le
    // relancera jusqu'a ce qu'il parte, et un echec definitif y reste visible (statut FAILED) —
    // ce que l'appel direct a Resend ne permettait pas.
    const { error: majErr } = await userClient.rpc("marquer_invitation_envoyee", { p_id: inv.id });
    if (majErr) console.error("[clubplus-envoyer-invitation] e-mail en file, statut non mis a jour", majErr);

    return json({ envoye: true, email: inv.email, en_file: true });
  } catch (e) {
    console.error("[clubplus-envoyer-invitation]", e);
    return json({ error: "Envoi impossible." }, 500);
  }
});
