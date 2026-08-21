// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.
// Étape à faire à chaque édition : Supabase Dashboard → Edge Functions →
// clubplus-invite → coller ce code → Deploy.
// Oublier cette étape est la cause la plus fréquente de "le code est bon
// mais ça ne marche pas en prod" sur ce projet (déjà arrivé sur au moins
// 5 fonctions : clubplus-billing-portal, create-clubplus-subscription-
// checkout, dispatch-notifications, create-guest-rdv, create-guest-request).

// Supabase Edge Function — clubplus-invite
// Appelée par un admin de club depuis SportVision Club+ (module Utilisateurs) pour
// inviter un nouveau membre par e-mail. Utilise l'API Admin de Supabase Auth
// (inviteUserByEmail) : crée le compte auth.users et envoie l'e-mail d'invitation
// intégré au projet (aucun secret e-mail supplémentaire requis). L'invité clique le
// lien, atterrit sur le site public avec une session temporaire dans le fragment
// d'URL (#access_token=...&type=invite), définit son mot de passe, puis la ligne
// club_members passe de 'invitation' à 'actif' via une requête cm_self_update
// (déjà autorisée par migration-clubplus-v1.sql).
//
// Sécurité : l'appelant doit être admin ACTIF du club ciblé (vérifié via
// club_members, en contournant le RLS avec le service role — on ne peut pas se fier
// à un rôle envoyé dans le body). Idempotent : réinviter un e-mail déjà membre du
// même club renvoie sa ligne existante sans dupliquer.
//
// Deploy via Supabase dashboard > Edge Functions > New Function (name: clubplus-invite)
// Secrets requis : SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (déjà présents par défaut)
// Secret optionnel : CONNECT_URL (URL de SportVision Connect pour le lien de retour ; à
// défaut https://connect.sportvision-an.fr est utilisée)
//
// Fix du 08/08/2026 : pointait vers l'ancienne app Club+ séparée
// (SportVision-Club-Plus.html, absorbée par Connect — cf. ARCHITECTURE-
// CONNECT.md) au lieu de rediriger vers Connect comme le fait déjà
// org-invite pour les autres types d'organisation. Le lien de connexion
// #access_token=...&type=invite est désormais géré par Connect
// (consumeRecoveryHash étendu aux liens invite le même jour).

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

const VALID_ROLES = [
  "admin", "president", "secretaire", "comm", "cm_externe", "coach",
  "resp_equipe", "sponsor_mgr", "tresorier", "membre_bureau", "lecture_seule",
  "directeur_sportif", "administratif",
];

// 19/08/2026 — plafonds d'utilisateurs par plan (décision Fouka, ajout de Club+ Gratuit) :
// null = illimité. Reste ici plutôt qu'importé de plans.ts côté app-next (aucun partage de code
// entre l'app Next.js et les Edge Functions Deno sur ce projet — même limite déjà acceptée pour
// CREDITS_BY_PLAN dans clubplus-onboarding/clubplus-activate/stripe-webhook).
const MAX_USERS_BY_PLAN: Record<string, number | null> = { free: 1, club: 5, performance: null };

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
    const email: string = (body.email || "").trim().toLowerCase();
    const prenom: string = body.prenom || "";
    const nom: string = body.nom || "";
    const telephone: string = body.telephone || "";
    const clubId: string = body.club_id || "";
    const role: string = VALID_ROLES.includes(body.role) ? body.role : "coach";
    const teams: string[] = Array.isArray(body.teams) ? body.teams : [];

    if (!email || !clubId) return json({ error: "E-mail et club sont obligatoires." }, 400);

    const admin = createClient(supabaseUrl, serviceKey);

    const rateOk = await checkRateLimit(admin, `clubplus-invite:${caller.id}`);
    if (!rateOk) {
      return json({ error: "Trop de tentatives. Réessayez dans une heure." }, 429);
    }

    // Vérifie que l'appelant est bien admin ACTIF du club ciblé (jamais de confiance
    // dans un rôle/club envoyé par le client — seule cette requête service-role fait foi).
    const { data: callerMember } = await admin
      .from("club_members")
      .select("id")
      .eq("user_id", caller.id)
      .eq("club_id", clubId)
      .eq("role", "admin")
      .eq("status", "actif")
      .maybeSingle();
    if (!callerMember) return json({ error: "Seul un administrateur du club peut inviter un utilisateur." }, 403);

    // 19/08/2026 — plafond d'utilisateurs par plan (Club+ Gratuit : 1, Start : 5, Performance :
    // illimité). Vérifié ici, service-role, avant d'envoyer une invitation — jamais côté client.
    const { data: clubRow } = await admin.from("clubs").select("plan").eq("id", clubId).maybeSingle();
    const clubPlan: string = (clubRow as { plan?: string } | null)?.plan || "club";
    const maxUsers = MAX_USERS_BY_PLAN[clubPlan] ?? MAX_USERS_BY_PLAN.club;
    if (maxUsers !== null) {
      const { count: memberCount } = await admin
        .from("club_members")
        .select("id", { count: "exact", head: true })
        .eq("club_id", clubId)
        .in("status", ["actif", "invitation"]);
      if ((memberCount || 0) >= maxUsers) {
        return json(
          { error: `Ce plan est limité à ${maxUsers} utilisateur${maxUsers > 1 ? "s" : ""}. Passez à une formule supérieure pour inviter davantage de monde.` },
          403,
        );
      }
    }

    // Idempotence : déjà membre de CE club → renvoie la ligne existante.
    const { data: existingUserRes } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
    // listUsers ne filtre pas par email nativement sur toutes les versions ; on
    // tente plutôt l'invite directement et on gère le cas "déjà inscrit" via l'erreur,
    // plus fiable. (existingUserRes non utilisé, gardé hors chemin critique.)
    void existingUserRes;

    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${connectUrl}/`,
      data: { prenom, nom, telephone },
    });

    let invitedUserId: string | null = invited?.user?.id ?? null;

    if (inviteErr) {
      // "already been registered" : l'e-mail a déjà un compte Supabase Auth
      // (autre club, ou invitation précédente). On le retrouve pour lier ce club.
      const msg = inviteErr.message || "";
      if (!/already/i.test(msg)) return json({ error: msg }, 500);
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const match = list?.users?.find((u) => (u.email || "").toLowerCase() === email);
      if (!match) return json({ error: "Cet e-mail est déjà utilisé mais introuvable." }, 500);
      invitedUserId = match.id;
    }

    if (!invitedUserId) return json({ error: "Échec de la création du compte invité." }, 500);

    const { data: existingMember } = await admin
      .from("club_members")
      .select("id, status")
      .eq("user_id", invitedUserId)
      .eq("club_id", clubId)
      .maybeSingle();
    if (existingMember) {
      return json({ id: existingMember.id, already_invited: true });
    }

    const { data: created, error: cmErr } = await admin
      .from("club_members")
      .insert({
        user_id: invitedUserId,
        club_id: clubId,
        role,
        prenom: prenom || null,
        nom: nom || null,
        telephone: telephone || null,
        teams,
        status: "invitation",
      })
      .select("id")
      .single();
    if (cmErr) return json({ error: cmErr.message }, 500);

    return json({ id: created.id, already_invited: false });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
