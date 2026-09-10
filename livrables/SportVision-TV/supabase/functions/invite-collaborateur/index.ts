// Déploiement : UNIQUEMENT `bash livrables/SportVision-TV/scripts/deployer-fonction.sh
// invite-collaborateur` (règle de production du 10/09/2026, voir CLAUDE.md) — jamais
// `supabase functions deploy` nu, qui réinitialise la vérification JWT.
//
// 28/08/2026 (refonte interface Secrétaire, spec §23/§24 "Création de comptes
// collaborateurs" + tableau permissions "Collaborateurs : créer compte/
// onboarding") : ouvert au rôle 'sec' en plus de 'admin', mais seulement pour
// les rôles opérationnels (voir INVITABLE_ROLES_SEC) — les rôles sensibles
// (admin/compta/expert_comptable/auditeur) restent réservés à un admin, pour
// éviter qu'une secrétaire puisse s'auto-attribuer ou attribuer un accès
// financier/administratif via ce formulaire.

// Supabase Edge Function — invite-collaborateur
// Remplace le flux actuel (créerCollaborateur() côté OS révèle un mot de
// passe provisoire en clair à l'écran, à communiquer "à la main" — exactement
// le problème signalé par le cahier des charges Communication Hub, AUTH-01).
//
// Nouveau flux : génère un vrai lien d'invitation à usage unique via Supabase
// Auth (admin.generateLink, type 'invite' — ne déclenche PAS l'e-mail par
// défaut de Supabase), crée la ligne profiles avec le rôle choisi, puis passe
// par le Communication Hub (enqueue_notification) pour un e-mail SportVision
// branded, envoyé par le worker dispatch-notifications via Brevo.
//
// Réservé au staff admin et secrétaire (vérifie le JWT appelant + son rôle,
// même pattern que send-devis-email/send-facture-email ; secrétaire limitée
// aux rôles opérationnels, cf. INVITABLE_ROLES_SEC).
//
// Secrets requis : aucun secret supplémentaire — utilise SUPABASE_URL et
// SUPABASE_SERVICE_ROLE_KEY déjà présents par défaut sur le projet.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ROLE_LABELS: Record<string, string> = {
  sec: "Secrétaire", prod: "Resp. Production", photo: "Photographe / Vidéaste",
  cm: "Community Manager", compta: "Comptable", com: "Commercial", admin: "Administrateur",
  expert_comptable: "Expert-comptable", auditeur: "Auditeur", rh: "Secrétaire générale / RH",
};

// Rôles qu'une secrétaire peut attribuer elle-même (opérationnels). Les rôles
// financiers/administratifs (admin, compta, expert_comptable, auditeur)
// restent réservés à un admin. 'rh' (migration-poles-v14, 31/08/2026) : accès
// staff transversal à tous les pôles, reste réservé à un admin comme les
// autres rôles sensibles — une secrétaire ne peut pas se créer une collègue
// avec une visibilité plus large que la sienne.
const INVITABLE_ROLES_SEC = new Set(["sec", "prod", "photo", "cm", "com"]);
// 'rh' (migration-poles-v14) peut attribuer les mêmes rôles opérationnels
// qu'une secrétaire + un autre poste 'rh' — jamais admin/compta/expert_comptable/auditeur.
const INVITABLE_ROLES_RH = new Set([...INVITABLE_ROLES_SEC, "rh"]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// Duree de vie REELLE d'un lien d'invitation : c'est Supabase Auth qui la fixe (Auth >
// mailer_otp_exp, 3600 s sur ce projet, mesure le 10/09/2026 : un lien clique 2 h apres son
// envoi revient en `otp_expired`). Jusqu'ici l'e-mail et l'OS annoncaient « 7 jours » : une recrue
// qui ouvrait son e-mail le lendemain tombait sur « Ce lien n'est plus valable » en ayant suivi
// les consignes a la lettre. Si mailer_otp_exp change, cette valeur doit suivre.
const VALIDITE_LIEN_S = 3600;

// Adresse canonique : Supabase Auth enregistre l'adresse en minuscules, mais la file d'envoi
// gardait la saisie brute (« Nophotopix@gmail.Com » vu le 09/09). Une adresse qui ne peut pas
// recevoir d'e-mail (« prenom@gmail », sans extension) etait acceptee par Supabase : le compte
// etait cree et l'e-mail restait en echec dans la file, sans que personne ne le voie.
function adresseCanonique(v: unknown): string | null {
  const e = String(v ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e : null;
}

// Champs de fiche repris d'une candidature (Recrutement > « Creer le collaborateur »). Ecrits ici,
// avec les droits du serveur : la secretaire et la RH n'ont pas le droit de modifier le profil
// d'un collegue, et leur mise a jour depuis l'OS etait refusee sans bruit (fiche vide, compte
// actif immediatement alors que l'ecran annoncait « onboarding demarre »).
const CHAMPS_FICHE = ["ville", "telephone", "vehicule", "permis", "zone", "materiel_personnel", "portfolio_url"];

function dateLocale(d: Date) {
  return d.toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" });
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

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: callerProfile } = await admin.from("profiles").select("role, actif").eq("id", userData.user.id).maybeSingle();
    // Un compte desactive garde un jeton valable (et un jeton de rafraichissement) : seul l'OS le
    // mettait dehors. Mesure le 10/09/2026, une secretaire desactivee pouvait encore creer des
    // comptes en appelant cette fonction directement.
    if (callerProfile?.actif === false) return json({ error: "Ce compte a été désactivé." }, 403);
    const callerIsAdmin = callerProfile?.role === "admin";
    const callerIsSec = callerProfile?.role === "sec";
    // 'rh' (migration-poles-v14, 31/08/2026) : Secrétaire générale, mêmes droits d'invitation
    // qu'une secrétaire (rôles opérationnels + un autre poste 'rh'), voir INVITABLE_ROLES_RH.
    const callerIsRh = callerProfile?.role === "rh";
    if (!callerIsAdmin && !callerIsSec && !callerIsRh) {
      return json({ error: "Réservé aux administrateurs, à la secrétaire et à la RH" }, 403);
    }

    const corps = await req.json();
    const { prenom, nom, role, organization_name, redirect_url, pole_ids, responsable_pole_ids, onboarding, fiche } = corps;
    if (!corps.email || !prenom || !nom || !role) return json({ error: "Champs manquants" }, 400);
    const email = adresseCanonique(corps.email);
    if (!email) return json({ error: "Adresse e-mail invalide. Vérifiez qu'elle est complète (ex. prenom.nom@gmail.com)." }, 400);
    if (!ROLE_LABELS[role]) return json({ error: "Rôle invalide" }, 400);
    if (callerIsSec && !INVITABLE_ROLES_SEC.has(role)) {
      return json({ error: "La secrétaire ne peut pas attribuer ce rôle. Seul un administrateur le peut." }, 403);
    }
    if (callerIsRh && !INVITABLE_ROLES_RH.has(role)) {
      return json({ error: "La RH ne peut pas attribuer ce rôle. Seul un administrateur le peut." }, 403);
    }

    // Multi-pôles (migration-poles-v11/v12, étendu v14 le 31/08/2026 pour supporter un
    // collaborateur flexible multi-sport) : pole_ids optionnel (tableau), transmis par le
    // formulaire d'invitation UNIQUEMENT quand plusieurs pôles existent et le rôle n'est pas
    // 'rh' (accès global par rôle, pas par affectation — voir ensure_default_pole_affectation()).
    // Absent/vide -> le trigger retombe sur Football, comportement historique implicite.
    // Validé ici (existence réelle de chaque pôle) pour ne jamais transmettre un id invalide en
    // metadata — le trigger a de toute façon son propre garde-fou, mais autant échouer
    // proprement ici avec un message clair.
    const poleIds: string[] = Array.isArray(pole_ids) ? pole_ids.filter((p) => typeof p === "string" && p) : [];
    if (poleIds.length > 0) {
      const { data: poleRows } = await admin.from("poles").select("id").in("id", poleIds);
      if (!poleRows || poleRows.length !== poleIds.length) return json({ error: "Pôle sportif invalide." }, 400);
    }

    // Nomination directe "Responsable de pôle" à l'invitation (migration-poles-v25/v26,
    // 31/08/2026, demande explicite de Fouka) : réservée à l'admin (accès en écriture large sur
    // le pôle, cf. migration-poles-v23) — une secrétaire/rh ne peut pas nommer un Responsable,
    // même si elle peut inviter des rôles opérationnels. Toujours un sous-ensemble de pole_ids :
    // on ne rend jamais quelqu'un Responsable d'un pôle auquel il n'est pas affecté.
    const responsablePoleIds: string[] = Array.isArray(responsable_pole_ids)
      ? responsable_pole_ids.filter((p) => typeof p === "string" && poleIds.includes(p))
      : [];
    if (responsablePoleIds.length > 0 && !callerIsAdmin) {
      return json({ error: "Seul un administrateur peut nommer un Responsable de pôle." }, 403);
    }

    const inviterName = userData.user.user_metadata?.prenom || "L'équipe SportVision";

    // Met l'e-mail d'invitation dans la file d'envoi (Communication Hub -> Brevo).
    async function envoyer(userId: string, lien: string, cle: string, expire: Date, qui = { prenom, role }) {
      return await admin.rpc("enqueue_notification", {
        p_event_type: "user.invited",
        p_template_key: "auth.invitation",
        p_channel: "EMAIL",
        p_idempotency_key: cle,
        p_recipient_email: email,
        p_recipient_user_id: userId,
        p_entity_type: "collaborateur",
        p_entity_id: userId,
        p_payload: {
          first_name: qui.prenom,
          inviter_name: inviterName,
          organization_name: organization_name || "SportVision",
          role_label: ROLE_LABELS[qui.role] || ROLE_LABELS[role],
          expires_at_local: dateLocale(expire),
          invitation_url: lien,
        },
      });
    }

    // Idempotence (spec : "une invitation rejouée ne crée pas deux profils").
    //
    // Comparaison EXACTE sur l'adresse canonique. L'ancien `ilike` traitait « _ » et « % » comme
    // des jokers : inviter jean_dupont@… repondait « deja invite » si jean.dupont@… existait.
    const { data: existing } = await admin.from("profiles").select("id, role, prenom, actif, onboarding_started_at").eq("email", email).maybeSingle();
    if (existing) {
      const { data: au } = await admin.auth.admin.getUserById(existing.id);
      const compte = au?.user;
      const jamaisActive = !!compte && !compte.email_confirmed_at && !compte.last_sign_in_at;
      if (!jamaisActive) {
        // Compte deja active : aucun nouveau lien, on dit pourquoi et quoi faire.
        return json({
          user_id: existing.id, success: true, already_existed: true, deja_active: true,
          desactive: existing.actif === false && !existing.onboarding_started_at,
        });
      }
      // RENVOI. La recrue n'a jamais clique son lien, qui ne vit qu'une heure : jusqu'ici
      // l'OS repondait « deja invite — aucun nouvel envoi » et l'administrateur n'avait AUCUN
      // moyen de lui en faire parvenir un nouveau. Re-inviter la meme adresse ne cree pas de
      // second compte : Supabase regenere le lien du meme utilisateur (et l'ancien meurt).
      //
      // Garde anti double-clic : un lien emis il y a moins d'une minute n'est pas remplace, sinon
      // un second clic tuerait le lien que le premier vient d'envoyer.
      const emisIlYa = Date.now() - new Date(compte!.confirmation_sent_at || compte!.invited_at || 0).getTime();
      if (emisIlYa < 60_000) {
        return json({ user_id: existing.id, success: true, already_existed: true, envoi_recent: true });
      }
      const { data: re, error: reErr } = await admin.auth.admin.generateLink({ type: "invite", email, options: { redirectTo: redirect_url } });
      if (reErr || !re?.properties?.action_link) {
        console.error("invite-collaborateur renvoi :", reErr?.message);
        return json({ error: "Impossible de générer un nouveau lien pour cette adresse. Réessayez dans un instant." }, 500);
      }
      const expire = new Date(Date.now() + VALIDITE_LIEN_S * 1000);
      // L'e-mail decrit le compte tel qu'il existe (role, prenom), pas la saisie du second envoi :
      // un renvoi ne modifie pas le compte.
      const { error: eErr } = await envoyer(existing.id, re.properties.action_link, "auth.invitation:v1:" + existing.id + ":" + Date.now(), expire,
        { prenom: existing.prenom || prenom, role: existing.role || role });
      if (eErr) console.error("invite-collaborateur renvoi, file d'envoi :", eErr.message);
      return json({
        user_id: existing.id, success: true, renvoye: true, email_en_file: !eErr,
        invitation_url: re.properties.action_link, expires_at: expire.toISOString(),
      });
    }

    // Génère l'invitation Supabase (crée le compte auth s'il n'existe pas) sans
    // envoyer l'e-mail par défaut de Supabase — on utilise le nôtre ensuite.
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "invite",
      email,
      // pole_ids (optionnel, tableau) : lu par ensure_default_pole_affectation() côté trigger DB
      // (migration-poles-v12, étendu v14) pour affecter ce nouveau collaborateur à un ou
      // plusieurs pôles sportifs dès sa création — jamais laissé sans aucune affectation pour un
      // rôle non-'rh' (verrouillage RLS total sinon). 2+ éléments = collaborateur flexible
      // multi-sport (migration-poles-v14, 31/08/2026).
      options: {
        data: {
          role, prenom, nom,
          ...(poleIds.length > 0 ? { pole_ids: poleIds } : {}),
          ...(responsablePoleIds.length > 0 ? { responsable_pole_ids: responsablePoleIds } : {}),
        },
        redirectTo: redirect_url,
      },
    });
    if (linkErr) {
      // Le texte brut de Supabase Auth (en anglais) arrivait tel quel dans l'OS.
      console.error("invite-collaborateur generateLink :", linkErr.message);
      if (/already been registered|email_exists|already registered/i.test(linkErr.message + " " + ((linkErr as { code?: string }).code ?? ""))) {
        return json({ error: "Cette adresse est déjà utilisée par un compte client (Connect ou Club+). Utilisez une autre adresse pour son accès à l'OS." }, 409);
      }
      if (/validate email|invalid format|invalid email/i.test(linkErr.message)) {
        return json({ error: "Adresse e-mail invalide. Vérifiez qu'elle est complète (ex. prenom.nom@gmail.com)." }, 400);
      }
      return json({ error: "Invitation impossible pour le moment. Réessayez dans un instant." }, 400);
    }

    // Recrutement > « Creer le collaborateur » : la fiche demarre en onboarding (acces bloque tant
    // que la checklist n'est pas complete) avec les coordonnees de la candidature. Pose ici, avec
    // les droits du serveur, pour que la regle tienne quel que soit le role de celui qui invite.
    let onboardingApplique = false;
    if (onboarding === true) {
      const maj: Record<string, unknown> = { actif: false, onboarding_started_at: new Date().toISOString() };
      if (fiche && typeof fiche === "object") {
        for (const k of CHAMPS_FICHE) if (k in fiche) maj[k] = (fiche as Record<string, unknown>)[k];
      }
      const { error: majErr } = await admin.from("profiles").update(maj).eq("id", linkData.user.id);
      if (majErr) console.error("invite-collaborateur onboarding :", majErr.message);
      onboardingApplique = !majErr;
    }

    const expiresAt = new Date(Date.now() + VALIDITE_LIEN_S * 1000);
    const { error: enqueueErr } = await envoyer(linkData.user.id, linkData.properties.action_link, "auth.invitation:v1:" + linkData.user.id, expiresAt);
    // Le compte existe deja a ce stade : un echec de mise en file ne doit pas le faire croire
    // absent (l'OS proposerait de recommencer). Le lien est renvoye de toute facon, ci-dessous.
    if (enqueueErr) console.error("invite-collaborateur file d'envoi :", enqueueErr.message);

    // Le lien est RENVOYE, pas seulement mis dans la file d'envoi.
    //
    // Le 08/09/2026, Fouka a du reinviter trois fois la meme personne en huit minutes parce que
    // rien n'arrivait : l'e-mail existait, il etait juste lent. Trois comptes ont ete crees pour
    // un seul collaborateur. Avec le lien sous la main, on le transmet et on n'attend personne.
    return json({
      user_id: linkData.user.id,
      success: true,
      invitation_url: linkData.properties.action_link,
      expires_at: expiresAt.toISOString(),
      email_en_file: !enqueueErr,
      ...(onboarding === true ? { onboarding_applique: onboardingApplique } : {}),
    });
  } catch (e) {
    console.error("invite-collaborateur :", ((e as { message?: string })?.message ?? String(e)));
    return json({ error: "Invitation impossible pour le moment. Réessayez dans un instant." }, 500);
  }
});
