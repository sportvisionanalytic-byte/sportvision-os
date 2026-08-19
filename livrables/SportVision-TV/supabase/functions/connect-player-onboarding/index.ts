// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.
// Étape à faire à chaque édition : Supabase Dashboard → Edge Functions →
// connect-player-onboarding → coller ce code → Deploy (nouvelle fonction, jamais déployée).
// Secrets requis : SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (déjà présents
// par défaut sur le projet).

// Supabase Edge Function — connect-player-onboarding
//
// Sert le nouveau tunnel d'inscription du Connect personnel (12/08/2026, voir
// livrables/SportVision-Connect/app-connect et RAPPORT-MIGRATION-CONNECT-PERSONNEL.md).
//
// Pourquoi une Edge Function plutôt que des appels client directs :
// 1. `organizations` n'a AUCUNE policy de lecture publique pour un visiteur non affilié
//    (seulement org_member_select et organizations_player_family_select, qui exigent déjà
//    une affiliation existante — migration-connect-v25). La recherche se fait ici côté
//    serveur (service role) et ne renvoie que id/nom/ville au client.
// 2. `membership_requests` n'a AUCUNE policy INSERT (seulement des SELECT — migration-
//    clubplus-v14.sql). La demande est créée ici, jamais par un INSERT client direct.
//
// Schéma réel vérifié en direct (service role, requêtes ponctuelles le 12/08/2026 — ne pas
// deviner ces valeurs, elles ont une contrainte CHECK en base) :
//   organizations.statut       ∈ actif_premium | actif_standard | limite_fin_contrat |
//                                 suspendu_impaye | archive | desactive
//   organizations.organization_type ∈ club | academie | coach | projet | sponsor
//   player_profiles.club_id    NOT NULL, référence clubs(id) — PAS organizations(id) — mais
//                               organizations.id RÉUTILISE clubs.id pour une organisation de
//                               type club (migration-connect-v2, "Couche d'unification
//                               Connect"), donc chercher dans organizations et écrire ce même
//                               id dans player_profiles.club_id est correct pour un vrai club.
//   player_profiles.prenom/nom/date_naissance NOT NULL.
//   player_profiles.account_status ∈ sans_compte | invite | en_attente_activation | actif |
//                                     suspendu | retire
//   membership_requests.source ∈ invitation | spontanee | code_equipe
//   membership_requests.statut ∈ a_verifier | autorisation_manquante | en_attente_parent |
//                                 pret_a_valider | validee | refusee | doublon_signale |
//                                 transferee_admin
//   membership_requests.validation_mode ∈ standard | controle | double
//
// Aucun concept de "club non partenaire/déclaré" n'existe dans le schéma actuel
// (organizations.organization_type et clubs.plan n'ont pas de valeur pour ça, et créer une
// fausse ligne clubs/organizations polluerait les décomptes/dashboards réels — le master doc
// interdit justement "un vrai compte Club+ administrable" créé automatiquement). Le cas
// "club non partenaire" est donc traité comme connect-signup-lead : une notification staff,
// AUCUNE écriture organizations/clubs/player_profiles. Un vrai statut "déclaré" nécessiterait
// une migration schéma dédiée — à construire si Fouka veut vraiment persister cette relation
// plutôt que la traiter au cas par cas par le staff.
//
// Actions (`action` dans le body) :
//  - "search"  { query } → clubs partenaires actifs correspondant (recherche sur le nom)
//  - "join"    { orgId, teamName? } → crée player_profiles (si absent) + membership_requests
//               (statut "a_verifier"), le joueur peut utiliser Connect pendant l'attente
//  - "declare" { name, city, team?, prenom, nom } → notifie le staff (aucune écriture DB),
//               même mécanisme que connect-signup-lead
//  - "skip"    { prenom?, nom?, dateNaissance? } → migration-connect-v72 (15/08) :
//               player_profiles.club_id est désormais nullable. Si les 3 champs sont fournis
//               (compte Espace joueur qui choisit "Non/plus tard"), crée une ligne
//               player_profiles avec club_id = null (idempotent — no-op si une ligne existe déjà
//               pour ce user_id), pour que buildPlayerContext() cesse de renvoyer null et que ce
//               compte puisse réserver une prestation. Si un des 3 champs manque (compte Espace
//               particulier, qui n'a jamais de player_profiles — voir migration-connect-v51 §1 —
//               ou rejeu d'un ancien "skip" enregistré en localStorage avant ce correctif), ne
//               crée rien, comportement historique inchangé.
//
// Appelée uniquement après confirmation d'e-mail (par le rejeu de pending-onboarding au
// premier login réussi, jamais juste après signUp() — voir lib/signup/pending-onboarding.ts).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

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

const ACTIVE_ORG_STATUSES = ["actif_premium", "actif_standard"];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const admin = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const action = body?.action as string;

    // "search" est la seule action accessible SANS session : elle intervient pendant l'étape
    // 4 du tunnel d'inscription, AVANT l'appel à auth.signUp() (voir signup-context.tsx —
    // le compte n'existe pas encore à ce stade). Faible sensibilité (nom/ville de clubs
    // partenaires déjà destinés à être trouvés par un visiteur), donc limitée par IP plutôt
    // que par utilisateur.
    if (action === "search") {
      const query = String(body?.query || "").trim();
      if (query.length < 2) return json({ results: [] });
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
      const rateOk = await checkRateLimit(admin, `connect-player-onboarding-search:${ip}`);
      if (!rateOk) return json({ error: "Trop de recherches. Réessayez dans une heure." }, 429);
      const { data, error } = await admin
        .from("organizations")
        .select("id, nom, ville, organization_type")
        .eq("organization_type", "club")
        .in("statut", ACTIVE_ORG_STATUSES)
        .ilike("nom", `%${query}%`)
        .limit(20);
      if (error) return json({ error: error.message }, 500);
      return json({
        results: (data || []).map((o) => ({ id: o.id, nom: o.nom, ville: o.ville })),
      });
    }

    // Toute action au-delà de "search" mute des données ou notifie le staff : session requise,
    // et confirmée (voir en-tête du fichier — jamais appelée juste après signUp()).
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Authentification requise" }, 401);
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Session invalide" }, 401);
    const user = userData.user;
    if (!user.email_confirmed_at) return json({ error: "Adresse e-mail non confirmée" }, 403);

    const rateOk = await checkRateLimit(admin, `connect-player-onboarding:${user.id}`);
    if (!rateOk) return json({ error: "Trop de tentatives. Réessayez dans une heure." }, 429);

    if (action === "skip") {
      const prenom = String(body?.prenom || "").trim();
      const nom = String(body?.nom || "").trim();
      const dateNaissance = String(body?.dateNaissance || "").trim();

      // migration-connect-v72 : compte particulier (jamais de player_profiles, voir migration-
      // connect-v51 §1) ou rejeu d'un ancien "skip" enregistré avant ce correctif (localStorage
      // pré-15/08, sans ces 3 champs) — comportement historique inchangé, ne crée rien.
      if (!prenom || !nom || !dateNaissance) {
        return json({ ok: true, hasClub: false });
      }

      const { data: existingProfile } = await admin
        .from("player_profiles")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (existingProfile) {
        // Idempotent (rejeu, ou 2e appel depuis "Continuer sans club" — voir AddClubForm.tsx) :
        // ne PAS mettre à jour club_id/account_status/date_naissance ici — ce sont les colonnes
        // protégées par le trigger guard_player_profile_update() (migration-clubplus-v13/v36),
        // qui bloquerait un UPDATE service role dessus (is_club_admin() est faux en contexte
        // service role, faute de JWT utilisateur forwardé — même constat que documenté pour
        // l'action "leave" ci-dessous). prenom/nom ne sont pas gardés par ce trigger, rafraîchis
        // sans risque.
        await admin.from("player_profiles").update({ prenom, nom }).eq("id", existingProfile.id);
        return json({ ok: true, hasClub: false });
      }

      // club_id = null (migration-connect-v72, colonne rendue nullable) : un joueur qui choisit
      // "Non/plus tard" peut désormais utiliser Connect (dont réserver une prestation) sans être
      // rattaché à un club. account_status="actif" comme pour "join" : ce joueur peut utiliser
      // Connect immédiatement, rien n'est en attente de validation ici (aucun club à valider).
      const { error: insErr } = await admin.from("player_profiles").insert({
        user_id: user.id,
        club_id: null,
        prenom,
        nom,
        date_naissance: dateNaissance,
        account_status: "actif",
      });
      if (insErr) return json({ error: insErr.message }, 500);
      return json({ ok: true, hasClub: false });
    }

    if (action === "declare") {
      const name = String(body?.name || "").trim();
      const city = String(body?.city || "").trim();
      const team = String(body?.team || "").trim();
      if (!name || !city) return json({ error: "Nom et ville du club requis" }, 400);

      const prenom = String(body?.prenom || "").trim();
      const nom = String(body?.nom || "").trim();
      const contact = `${prenom} ${nom}`.trim() || user.email || "contact inconnu";

      // Rapprochement par nom+ville normalisés (migration-connect-v54-declared-clubs-dedup.sql) :
      // sans ça, 3 joueurs qui déclarent indépendamment le même club non partenaire génèrent 3
      // notifications staff isolées, sans aucun moyen de savoir que c'est le même club. Ne crée
      // jamais de ligne organizations/clubs — reste un simple compteur staff, même principe que
      // le reste de cette action (aucune activation automatique).
      let playersCount = 1;
      try {
        const { data: dedup, error: dedupErr } = await admin.rpc("connect_declare_club", {
          p_name: name,
          p_city: city,
          p_team: team,
          p_user_id: user.id,
          p_prenom: prenom,
          p_nom: nom,
        });
        if (dedupErr) throw dedupErr;
        playersCount = Number(dedup?.players_count) || 1;
      } catch (_e) {
        console.error("[connect-player-onboarding] connect_declare_club a échoué :", _e);
        // Non bloquant : la notification staff isolée reste préférable à un échec total.
      }

      const titre = playersCount > 1
        ? `Club non partenaire déclaré — ${name} (${playersCount} joueurs intéressés)`
        : `Club non partenaire déclaré — ${name}`;
      const texte = `${contact} (${user.email}) a déclaré « ${name} » (${city}${team ? ", " + team : ""}) comme club non partenaire lors de son inscription Connect.` +
        (playersCount > 1
          ? ` C'est le ${playersCount}e joueur à déclarer ce club (même nom/ville) — vérifier l'opportunité B2B.`
          : ` Aucun compte Club+ n'a été créé — vérifier et rattacher manuellement si opportunité B2B.`);

      try {
        await admin.rpc("notify_staff_by_role", {
          p_roles: ["admin", "sec"],
          p_titre: titre,
          p_message: texte,
          p_priorite: "normale",
          p_prestation_id: null,
          p_client_id: null,
        });
      } catch (_e) {
        console.error("[connect-player-onboarding] notify_staff_by_role a échoué :", _e);
        return json({ error: "Notification impossible pour le moment." }, 500);
      }

      return json({ ok: true, hasClub: false, declared: true, name, city });
    }

    if (action === "join") {
      const orgId = String(body?.orgId || "").trim();
      if (!orgId) return json({ error: "Club requis" }, 400);
      const prenom = String(body?.prenom || "").trim();
      const nom = String(body?.nom || "").trim();
      const dateNaissance = String(body?.dateNaissance || "").trim();
      if (!prenom || !nom || !dateNaissance) {
        return json({ error: "Prénom, nom et date de naissance requis" }, 400);
      }

      const { data: org, error: orgLookupErr } = await admin
        .from("organizations")
        .select("id, nom")
        .eq("id", orgId)
        .eq("organization_type", "club")
        .in("statut", ACTIVE_ORG_STATUSES)
        .maybeSingle();
      if (orgLookupErr) return json({ error: orgLookupErr.message }, 500);
      if (!org) return json({ error: "Club introuvable" }, 404);

      const { data: existingProfile } = await admin
        .from("player_profiles")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();

      let playerId: string;
      if (existingProfile) {
        playerId = existingProfile.id;
        // BUGFIX 13/08 : un joueur qui a quitté un club (account_status="retire", voir action
        // "leave") et rejoint ensuite un club (même le même club, ou un autre) doit redevenir
        // "actif" — sans ce reset, club_id pointait bien vers le nouveau club et une nouvelle
        // membership_requests était bien créée, mais buildPlayerContext (app-connect,
        // lib/supabase/session.ts) ignore tout profil dont account_status="retire" : le joueur
        // restait invisible sur son propre Dashboard/Mes affiliations malgré une demande créée
        // avec succès — parcours "rejoindre après avoir quitté" silencieusement cassé.
        //
        // BUGFIX 19/08 : cet UPDATE échouait TOUJOURS pour un profil déjà existant (ex. joueur
        // qui avait choisi "Continuer sans club"), quel que soit le club visé — via `admin`
        // (service role), auth.uid() est NULL, donc guard_player_profile_update()
        // (migration-clubplus-v13/v36) refusait tout changement de club_id/date_naissance
        // ("Modification non autorisée sur ces champs"), masqué côté UI par le message
        // générique "Impossible de rejoindre ce club pour le moment." migration-connect-v81
        // ajoute une exception self-service à ce trigger (club_id/date_naissance modifiables sur
        // SA PROPRE ligne) — mais elle ne s'applique que si auth.uid() est réellement résolu, ce
        // qui exige le JWT de l'appelant (userClient), pas le service role.
        const { error: updErr } = await userClient
          .from("player_profiles")
          .update({ club_id: org.id, prenom, nom, date_naissance: dateNaissance, account_status: "actif" })
          .eq("id", playerId);
        if (updErr) return json({ error: updErr.message }, 500);
      } else {
        const { data: created, error: insErr } = await admin
          .from("player_profiles")
          .insert({
            user_id: user.id,
            club_id: org.id,
            prenom,
            nom,
            date_naissance: dateNaissance,
            account_status: "actif",
          })
          .select("id")
          .single();
        if (insErr) return json({ error: insErr.message }, 500);
        playerId = created.id;
      }

      const { error: mrErr } = await admin.from("membership_requests").insert({
        club_id: org.id,
        requested_by_user_id: user.id,
        player_id: playerId,
        source: "spontanee",
        statut: "a_verifier",
        validation_mode: "standard",
      });
      if (mrErr) return json({ error: mrErr.message }, 500);

      return json({ ok: true, hasClub: true, orgNom: org.nom, statut: "a_verifier" });
    }

    // "leave" : player_profiles.account_status était protégé par le trigger
    // guard_player_profile_update() (migration-clubplus-v13.sql) pour TOUT appelant non-admin,
    // service role inclus (les triggers s'exécutent toujours, contrairement aux policies RLS
    // que le service role contourne — is_club_admin() s'appuie sur auth.uid(), NULL en service
    // role, donc même cette edge function était bloquée). migration-clubplus-v36 ajoute une
    // exception étroite : un joueur peut mettre SA PROPRE fiche à 'retire', rien d'autre.
    // L'update passe donc par userClient (JWT du joueur forwardé), pas admin, pour que
    // auth.uid() se résolve dans le trigger — cohérent avec la policy pp_self_update déjà
    // existante (user_id = auth.uid()). Reste strictement scopé à la ligne du joueur
    // authentifié (jamais un id fourni par le body) et au seul champ account_status='retire'.
    if (action === "leave") {
      const { data: profile, error: profileErr } = await admin
        .from("player_profiles")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (profileErr) return json({ error: profileErr.message }, 500);
      if (!profile) return json({ error: "Aucune affiliation à quitter" }, 404);

      const { error: updErr } = await userClient
        .from("player_profiles")
        .update({ account_status: "retire" })
        .eq("id", profile.id);
      if (updErr) return json({ error: updErr.message }, 500);

      return json({ ok: true });
    }

    return json({ error: "Action inconnue" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
