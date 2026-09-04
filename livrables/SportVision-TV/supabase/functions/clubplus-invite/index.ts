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

const VALID_ROLES = [
  "admin", "president", "secretaire", "comm", "cm_externe", "coach",
  "resp_equipe", "sponsor_mgr", "tresorier", "membre_bureau", "lecture_seule",
  "directeur_sportif", "administratif",
];

// Génère un mot de passe temporaire lisible pour le mode "direct" (23/08/2026, demande Fouka :
// pouvoir créer un compte immédiatement sans dépendre de l'e-mail d'invitation — utile quand
// l'e-mail est prescanné/consommé par le fournisseur avant que la personne ne clique, cf.
// incident 340sportingclub@gmail.com du même jour). Pas de caractères ambigus (0/O, 1/l/I).
function generateTempPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `SV-${out}`;
}

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
    // "direct" (23/08/2026) : crée le compte avec un mot de passe défini immédiatement, aucun
    // e-mail envoyé — l'admin communique lui-même l'identifiant/mot de passe. "email" (défaut,
    // comportement historique inchangé) : invitation par e-mail, mot de passe choisi par l'invité.
    const mode: "email" | "direct" = body.mode === "direct" ? "direct" : "email";

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
    // 23/08/2026 — bug réel trouvé en testant contre V340 SC (Full Communication actif) : ce
    // plafond lit `clubs.plan`, qui reste 'free' pour un club Full Communication (contrat
    // commercial, jamais un plan Club+ vendu par abonnement — même trou que
    // check_club_teams_limit, déjà corrigé côté SQL). Bypass ici aussi si un contrat Full
    // Communication est actif pour ce club.
    const { data: clubRow } = await admin.from("clubs").select("plan, portail_client_id").eq("id", clubId).maybeSingle();
    const clubPlan: string = (clubRow as { plan?: string } | null)?.plan || "club";
    const portailClientId: string | null = (clubRow as { portail_client_id?: string } | null)?.portail_client_id ?? null;
    let isFullComm = false;
    if (portailClientId) {
      const { data: contratRow } = await admin
        .from("contrats")
        .select("id")
        .eq("client_id", portailClientId)
        .eq("type_contrat", "full_communication")
        .eq("statut", "actif")
        .maybeSingle();
      isFullComm = !!contratRow;
    }
    // Bug réel trouvé en testant scénario C5 de l'audit transversal (04/09/2026) : `??` traite
    // `performance: null` (= illimité) comme une valeur manquante et retombe sur le plafond
    // 'club' (5) — un club plan='performance' SANS contrat Full Com actif lié (donc isFullComm
    // faux) se retrouvait plafonné à 5 users au lieu d'illimité. Même classe de bug déjà
    // rencontrée et corrigée pour CREDITS_BY_PLAN dans clubplus-activate (cf. commentaire ligne
    // 172-174 de ce fichier voisin) — hasOwnProperty distingue "valeur null légitime" de "clé
    // absente", contrairement à `??`/truthy.
    const maxUsers = isFullComm
      ? null
      : (Object.prototype.hasOwnProperty.call(MAX_USERS_BY_PLAN, clubPlan) ? MAX_USERS_BY_PLAN[clubPlan] : MAX_USERS_BY_PLAN.club);
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

    let invitedUserId: string | null = null;
    let tempPassword: string | null = null;
    let accountAlreadyExisted = false;

    if (mode === "direct") {
      tempPassword = generateTempPassword();
      const { data: createdUser, error: createErr } = await admin.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { prenom, nom, telephone },
      });
      invitedUserId = createdUser?.user?.id ?? null;
      if (createErr) {
        const msg = createErr.message || "";
        if (!/already|registered|exists/i.test(msg)) return json({ error: msg }, 500);
        const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
        const match = list?.users?.find((u) => (u.email || "").toLowerCase() === email);
        if (!match) return json({ error: "Cet e-mail est déjà utilisé mais introuvable." }, 500);
        invitedUserId = match.id;
        tempPassword = null; // compte déjà existant : son mot de passe n'est jamais modifié ici.
        accountAlreadyExisted = true;
      }
    } else {
      const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${connectUrl}/`,
        data: { prenom, nom, telephone },
      });
      invitedUserId = invited?.user?.id ?? null;
      if (inviteErr) {
        // "already been registered" : l'e-mail a déjà un compte Supabase Auth
        // (autre club, ou invitation précédente). On le retrouve pour lier ce club.
        const msg = inviteErr.message || "";
        if (!/already/i.test(msg)) return json({ error: msg }, 500);
        const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
        const match = list?.users?.find((u) => (u.email || "").toLowerCase() === email);
        if (!match) return json({ error: "Cet e-mail est déjà utilisé mais introuvable." }, 500);
        invitedUserId = match.id;
        accountAlreadyExisted = true;
      }
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

    // En mode direct, le compte est immédiatement actif (mot de passe déjà connu, pas d'étape
    // d'acceptation d'invitation) — sauf si le compte existait déjà avant cet appel, auquel cas
    // on ne préjuge pas de son état et on garde le comportement "invitation" historique.
    const status = mode === "direct" && !accountAlreadyExisted ? "actif" : "invitation";

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
        status,
      })
      .select("id")
      .single();
    if (cmErr) return json({ error: cmErr.message }, 500);

    return json({ id: created.id, already_invited: false, password: tempPassword, account_already_existed: accountAlreadyExisted });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
