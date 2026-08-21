// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.
// Étape à faire à chaque édition : Supabase Dashboard → Edge Functions →
// clubplus-activate → coller ce code → Deploy.
// Oublier cette étape est la cause la plus fréquente de "le code est bon
// mais ça ne marche pas en prod" sur ce projet (déjà arrivé sur au moins
// 5 fonctions : clubplus-billing-portal, create-clubplus-subscription-
// checkout, dispatch-notifications, create-guest-rdv, create-guest-request).

// Supabase Edge Function — clubplus-activate
// Variante de clubplus-onboarding (lire ce fichier d'abord : mêmes conventions, même
// idempotence) pour le flux d'activation PRIVÉ d'un club déjà suivi commercialement
// par SportVision. Appelée juste après que la personne invitée a créé son compte
// Supabase Auth depuis l'écran #/activation?token=… de SportVision Club+.
//
// Différence essentielle avec clubplus-onboarding : le rattachement au client Portail
// n'est pas DEVINÉ par correspondance d'e-mail, il est PORTÉ PAR LE TOKEN, donc
// explicitement décidé par le staff SportVision au moment où il a généré le lien
// (clubplus-generate-activation). C'est pourquoi la vérification email_confirmed_at,
// indispensable dans clubplus-onboarding — sans elle, quiconque pouvait s'inscrire
// avec l'e-mail d'un client existant et hériter de ses devis/factures, faille trouvée
// à l'audit du 2026-08-06 — n'a pas d'équivalent ici : l'e-mail saisi par l'invité
// n'entre à aucun moment dans la décision de rattachement. Ce qui fait autorité, c'est
// la possession du token, secret de 122 bits transmis par le staff lui-même.
//
// Facturation : l'activation ne déclenche AUCUN paiement. Le club est créé en
// pilot_mode = true (accès offert / pilote décidé par le staff) ; la souscription
// payante reste un acte distinct et ultérieur. Le champ `plan` porté par le token est
// la formule pré-choisie par le staff, modifiable ensuite normalement.
//
// Sécurité : le token est REVÉRIFIÉ ici (validité, expiration, révocation, non-usage)
// — la vérification faite plus tôt par clubplus-check-activation-token est un simple
// confort d'affichage côté navigateur, jamais une autorisation. La consommation du
// token est atomique (UPDATE conditionnel used_at is null), pour que deux appels
// concurrents avec le même lien ne puissent pas créer deux clubs.
//
// Deploy via Supabase dashboard > Edge Functions > New Function (name: clubplus-activate)
// Secrets requis : SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (déjà présents par défaut)

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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// 17/08/2026 — 10 (Start) / 40 (Performance) : alignés sur l'affichage réel
// (plans.ts monthlyCredits), qui faisait foi jusqu'ici sans être ce qui était
// réellement posé en base — trouvé lors de l'audit complet Club+ du 17/08/2026,
// confirmé par Fouka.
// 19/08/2026 — ajout de "free" (0 crédit) : ce plan est en pratique attribué en self-service
// via clubplus-onboarding (voir ce fichier), jamais via un lien d'activation, mais la clé est
// ajoutée ici par cohérence pour éviter qu'un plan non reconnu retombe silencieusement sur les
// crédits Start.
const CREDITS_BY_PLAN: Record<string, number> = { free: 0, club: 10, performance: 40 };

const STATUS_MESSAGES: Record<string, string> = {
  invalid: "Ce lien d'activation n'est pas valide.",
  expired: "Ce lien d'activation a expiré. Demandez-en un nouveau à SportVision.",
  used: "Ce lien d'activation a déjà été utilisé.",
  revoked: "Ce lien d'activation a été retiré par SportVision.",
};

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

    // Vérifie le JWT de l'appelant (aucune confiance dans un id fourni par le body)
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Session invalide" }, 401);
    const user = userData.user;

    const body = await req.json();
    const token: string = (body.token || "").trim();
    const prenom: string = body.prenom || "";
    const nom: string = body.nom || "";
    const telephone: string = body.telephone || "";
    const clubNomSaisi: string = (body.club_nom || "").trim();

    if (!token) return json({ error: STATUS_MESSAGES.invalid, status: "invalid" }, 400);

    const admin = createClient(supabaseUrl, serviceKey);

    const rateOk = await checkRateLimit(admin, `clubplus-activate:${user.id}`);
    if (!rateOk) {
      return json({ error: "Trop de tentatives. Réessayez dans une heure." }, 429);
    }

    // Idempotence : déjà onboardé (quel que soit le chemin) → ne rien recréer,
    // et surtout ne pas consommer le token pour rien.
    const { data: existing } = await admin
      .from("club_members")
      .select("id, club_id, role")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    if (existing) {
      return json({ club_id: existing.club_id, role: existing.role, already_activated: true });
    }

    // Revérification complète du token côté serveur — jamais confiance dans
    // clubplus-check-activation-token, qui n'existe que pour l'affichage.
    const { data: tokenRow } = await admin
      .from("clubplus_activation_tokens")
      .select("id, client_id, club_nom_prefill, plan, initial_role, expires_at, used_at, revoked_at")
      .eq("token", token)
      .maybeSingle();

    if (!tokenRow) return json({ error: STATUS_MESSAGES.invalid, status: "invalid" }, 403);
    if (tokenRow.revoked_at) return json({ error: STATUS_MESSAGES.revoked, status: "revoked" }, 403);
    if (tokenRow.used_at) return json({ error: STATUS_MESSAGES.used, status: "used" }, 403);
    if (tokenRow.expires_at && new Date(tokenRow.expires_at).getTime() <= Date.now()) {
      return json({ error: STATUS_MESSAGES.expired, status: "expired" }, 403);
    }

    // Consommation ATOMIQUE : seul le premier appel voit une ligne revenir.
    // Deux ouvertures simultanées du même lien ne peuvent donc pas créer deux clubs.
    const nowIso = new Date().toISOString();
    const { data: claimed } = await admin
      .from("clubplus_activation_tokens")
      .update({ used_at: nowIso })
      .eq("id", tokenRow.id)
      .is("used_at", null)
      .is("revoked_at", null)
      .gt("expires_at", nowIso)
      .select("id")
      .maybeSingle();
    if (!claimed) return json({ error: STATUS_MESSAGES.used, status: "used" }, 409);

    // hasOwnProperty, pas un test de vérité : CREDITS_BY_PLAN['free'] vaut 0, qui est falsy en JS
    // — un test `CREDITS_BY_PLAN[tokenRow.plan] ?` faisait donc retomber tout token plan='free'
    // sur "club" (10 crédits) silencieusement. Trouvé par l'audit pré-lancement du 21/08.
    const plan: string = Object.prototype.hasOwnProperty.call(CREDITS_BY_PLAN, tokenRow.plan) ? tokenRow.plan : "club";
    const clubNom = clubNomSaisi || (tokenRow.club_nom_prefill || "").trim();

    // Libère le token si la suite échoue : sans cela, un incident réseau côté base
    // rendrait le lien définitivement inutilisable et obligerait le staff à en
    // regénérer un.
    const releaseToken = async () => {
      await admin.from("clubplus_activation_tokens").update({ used_at: null }).eq("id", tokenRow.id);
    };

    if (!clubNom) {
      await releaseToken();
      return json({ error: "Le nom du club est obligatoire." }, 400);
    }

    // portail_client_id est posé dès l'INSERT : le trigger protect_sensitive_club_
    // fields (v24) ne s'applique qu'aux UPDATE, et cette colonne reste de toute façon
    // hors de portée d'un admin de club.
    const { data: createdClub, error: clubErr } = await admin
      .from("clubs")
      .insert({
        nom: clubNom,
        plan,
        pilot_mode: true,
        portail_client_id: tokenRow.client_id,
        credits_monthly: CREDITS_BY_PLAN[plan],
        credits_balance: CREDITS_BY_PLAN[plan],
      })
      .select("id")
      .single();
    if (clubErr) {
      await releaseToken();
      return json({ error: clubErr.message }, 500);
    }

    // Rôle Connect posé par le token, jamais en dur — voir migration-connect-v44-
    // club-signup-requests.sql : un lien généré depuis une demande d'ouverture
    // publique (connect-club-signup-review) porte le rôle EXPLICITEMENT choisi par
    // le staff au moment de la validation, qui peut être différent d'admin (ex.
    // fonction déclarée "Secrétaire" mais rôle Connect "Administrateur" si c'est
    // elle qui gère réellement le compte). Défaut "admin" pour les tokens plus
    // anciens ou générés par clubplus-generate-activation (fiche client déjà
    // suivie), qui n'ont jamais eu ce choix et visent toujours un dirigeant déjà
    // identifié comme admin — comportement inchangé pour ce flux.
    const role = tokenRow.initial_role || "admin";

    const { error: cmErr } = await admin.from("club_members").insert({
      user_id: user.id,
      club_id: createdClub.id,
      role,
      prenom: prenom || null,
      nom: nom || null,
      telephone: telephone || null,
      status: "actif",
    });
    if (cmErr) {
      // Rien ne rattache encore ce club à personne : on le retire plutôt que de
      // laisser un club orphelin, et on rend le lien réutilisable.
      await admin.from("clubs").delete().eq("id", createdClub.id);
      await releaseToken();
      return json({ error: cmErr.message }, 500);
    }

    // Pont Documents ↔ Portail : c'est la raison d'être de ce flux. L'appelant
    // devient client_users du client Portail désigné par le token et lit alors ses
    // vrais devis/factures/contrats via les vues client_devis/client_factures/
    // client_contrats (migration-portail-v1.sql). Best-effort comme dans
    // clubplus-onboarding : un échec ici ne doit pas annuler un club déjà créé et
    // déjà accessible — le staff peut rattacher à la main depuis SportVision OS.
    let portailLie = false;
    try {
      const { error: cuErr } = await admin
        .from("client_users")
        .upsert(
          {
            id: user.id,
            client_id: tokenRow.client_id,
            prenom: prenom || null,
            nom: nom || null,
            telephone: telephone || null,
          },
          { onConflict: "id" },
        );
      portailLie = !cuErr;
    } catch (_e) {
      console.error("[clubplus-activate] rattachement client_users (historique Portail) a échoué :", _e);
    }

    // Notifie le staff — un club qui active son accès depuis un lien privé est un
    // événement commercial, pas un simple événement technique. Best-effort.
    try {
      await admin.rpc("notify_staff_by_role", {
        p_roles: ["admin", "sec"],
        p_titre: "Club+ activé depuis un lien d'invitation",
        p_message:
          `${clubNom} vient d'activer son espace Club+ (formule ${plan}, accès pilote).` +
          (portailLie ? " Son historique Portail est rattaché." : " Le rattachement Portail a échoué, à vérifier."),
        p_priorite: "normale",
        p_prestation_id: null,
        p_client_id: tokenRow.client_id,
      });
    } catch (_e) {
      console.error("[clubplus-activate] notify_staff_by_role (activation Club+) a échoué :", _e);
    }

    return json({
      club_id: createdClub.id,
      role,
      already_activated: false,
      portail_lie: portailLie,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
