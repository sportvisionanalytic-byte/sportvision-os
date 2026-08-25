// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.
// Étape à faire à chaque édition : Supabase Dashboard → Edge Functions →
// clubplus-family-invite → coller ce code → Deploy.
// Oublier cette étape est la cause la plus fréquente de "le code est bon
// mais ça ne marche pas en prod" sur ce projet (déjà arrivé sur au moins
// 5 fonctions : clubplus-billing-portal, create-clubplus-subscription-
// checkout, dispatch-notifications, create-guest-rdv, create-guest-request).

// Supabase Edge Function — clubplus-family-invite
// Équivalent de clubplus-invite (module Utilisateurs, dirigeants) mais pour
// le module Espace Joueur & Famille : invite un joueur ou un parent par
// e-mail. Une fonction Postgres ne peut pas appeler l'API Admin de Supabase
// Auth (inviteUserByEmail) — c'est pourquoi la création du compte auth.users
// vit ici, en Edge Function, et pas dans une RPC SQL.
//
// Ce que cette fonction NE fait PAS : elle ne crée ni player_profiles, ni
// parent_profiles, ni membership_requests. Elle crée seulement le compte
// auth.users (ou réutilise l'existant) et une ligne player_invitations /
// parent_invitations. C'est l'invité lui-même qui, une fois son mot de passe
// défini et connecté, appelle accept_player_invitation / accept_parent_invitation
// (migration-clubplus-v14.sql) pour créer sa fiche et sa demande d'adhésion.
//
// Sécurité : l'appelant doit être admin ACTIF du club (toute équipe), ou
// coach/resp_equipe ACTIF restreint aux équipes listées dans son propre
// club_members.teams (jamais de confiance dans un rôle/équipe envoyé par le
// client — vérifié ici via une requête service-role sur club_members).
// Un CM délégué (cm_agency_club_access, migration-connect-v80) a aussi accès
// complet (toute équipe, comme un admin) — décision Fouka du 22/08/2026,
// même niveau que is_club_admin()/is_team_educateur() étendus côté SQL
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

    // Vérifie l'habilitation de l'appelant : admin (toute équipe) ou
    // coach/resp_equipe (restreint à ses propres équipes, comparaison par nom
    // d'équipe car club_members.teams est un jsonb de noms, pas d'ids).
    const { data: callerMember } = await admin
      .from("club_members")
      .select("role, teams")
      .eq("user_id", caller.id)
      .eq("club_id", clubId)
      .eq("status", "actif")
      .maybeSingle();

    // CM délégué (cm_agency_club_access) : accès complet équivalent admin, toute équipe.
    // Vérifié indépendamment de club_members (un CM délégué n'y a généralement pas de ligne).
    let isDelegatedCm = false;
    if (!callerMember || callerMember.role !== "admin") {
      const today = new Date().toISOString().slice(0, 10);
      const { data: delegations } = await admin
        .from("cm_agency_club_access")
        .select("cm_agency_org_id, expires_at")
        .eq("club_id", clubId);
      for (const d of delegations || []) {
        if (d.expires_at && d.expires_at < today) continue;
        const { data: membership } = await admin
          .from("memberships")
          .select("id")
          .eq("organization_id", d.cm_agency_org_id)
          .eq("user_id", caller.id)
          .eq("status", "actif")
          .maybeSingle();
        if (membership) { isDelegatedCm = true; break; }
      }
    }

    // "CM responsable" (22/08/2026, migration-cm-agency-super-access-staff.sql) : un membre actif
    // d'une organisation cm_agency avec cm_super_access=true a accès à TOUS les clubs, sans ligne
    // cm_agency_club_access par club — même garde-fou que is_club_admin()/is_team_educateur() côté
    // SQL et buildDelegatedClubActiveContext() côté app-next.
    if (!isDelegatedCm && (!callerMember || callerMember.role !== "admin")) {
      const { data: superMemberships } = await admin
        .from("memberships")
        .select("organization_id")
        .eq("user_id", caller.id)
        .eq("status", "actif")
        .eq("cm_super_access", true);
      for (const sm of superMemberships || []) {
        const { data: org } = await admin.from("organizations").select("organization_type").eq("id", sm.organization_id).maybeSingle();
        if (org?.organization_type === "cm_agency") { isDelegatedCm = true; break; }
      }
    }

    if (!callerMember && !isDelegatedCm) return json({ error: "Non autorisé sur ce club." }, 403);

    if (!isDelegatedCm && callerMember!.role !== "admin") {
      if (!["coach", "resp_equipe"].includes(callerMember!.role)) {
        return json({ error: "Seuls un administrateur ou un éducateur/responsable d'équipe peuvent inviter." }, 403);
      }
      if (!teamId) return json({ error: "Équipe obligatoire pour un éducateur." }, 400);
      const { data: team } = await admin.from("club_teams").select("name, club_id").eq("id", teamId).maybeSingle();
      const callerTeams: string[] = Array.isArray(callerMember!.teams) ? callerMember!.teams : [];
      if (!team || team.club_id !== clubId || !callerTeams.includes(team.name)) {
        return json({ error: "Vous ne pouvez inviter que pour vos propres équipes." }, 403);
      }
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

    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${connectUrl}/`,
      data: { prenom, nom },
    });

    let invitedUserId: string | null = invited?.user?.id ?? null;

    if (inviteErr) {
      // "already been registered" : compte auth.users déjà existant (autre
      // club, autre invitation, ou déjà utilisateur Club+/Portail). On le
      // retrouve pour l'attacher à cette invitation plutôt que d'échouer.
      const msg = inviteErr.message || "";
      if (!/already/i.test(msg)) return json({ error: msg }, 500);
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const match = list?.users?.find((u) => (u.email || "").toLowerCase() === email);
      if (!match) return json({ error: "Cet e-mail est déjà utilisé mais introuvable." }, 500);
      invitedUserId = match.id;
    }

    if (!invitedUserId) return json({ error: "Échec de la création du compte invité." }, 500);

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
      return json({ id: created.id, already_invited: false });
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
      return json({ id: created.id, already_invited: false });
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
