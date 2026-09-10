// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.
// Étape à faire à chaque édition : Supabase Dashboard → Edge Functions →
// org-invite → coller ce code → Deploy.
// Oublier cette étape est la cause la plus fréquente de "le code est bon
// mais ça ne marche pas en prod" sur ce projet (déjà arrivé sur au moins
// 5 fonctions : clubplus-billing-portal, create-clubplus-subscription-
// checkout, dispatch-notifications, create-guest-rdv, create-guest-request).

// Supabase Edge Function — org-invite
//
// Équivalent générique de clubplus-invite (voir ce fichier pour le
// modèle d'origine, non modifié), pour les organisations Connect qui
// n'ont pas de flux d'invitation dédié : Coach, Académie, Sponsor. Club
// garde clubplus-invite tel quel (table club_members, pas memberships)
// — non touché, non remplacé par cette fonction.
//
// v2 (migration-connect-v6-org-admin.sql) : le catalogue de rôles n'est
// plus codé en dur ici — il est lu dans la table `organization_role_
// catalog`, seule source de vérité partagée avec le trigger SQL
// protect_sensitive_membership_fields. Conséquence directe : ajouter un
// nouveau type d'organisation ou un nouveau rôle ne nécessite plus de
// redéployer cette fonction, seulement d'insérer une ligne dans cette
// table.
//
// Utilise l'API Admin de Supabase Auth (inviteUserByEmail), exactement
// comme clubplus-invite : crée le compte auth.users et envoie l'e-mail
// d'invitation intégré au projet. L'invité clique le lien, définit son
// mot de passe, puis sa ligne `memberships` passe de 'invitation' à
// 'actif' via une simple mise à jour directe — autorisée par la policy
// "mb_self_activate" (migration-connect-v5-membership-invite.sql), qui
// n'autorise QUE cette transition précise sur SA PROPRE ligne (un
// trigger bloque toute autre modification, sauf pour un admin
// d'organisation gérant un AUTRE membre — cf. migration v6).
//
// Sécurité : l'appelant doit avoir une adhésion ACTIVE avec un rôle
// marqué `is_admin = true` (table organization_role_catalog) pour
// L'ORGANISATION CIBLÉE (jamais de confiance dans un rôle envoyé par le
// client — seule une requête service-role fait foi). Le rôle attribué à
// l'invité est validé contre ce même catalogue ; toute valeur hors
// catalogue retombe sur le rôle marqué `is_default = true` pour ce type
// d'organisation. Idempotent : réinviter un e-mail déjà membre de la
// même organisation renvoie sa ligne existante sans dupliquer.
//
// Deploy via Supabase dashboard > Edge Functions > org-invite (redéployer
// la fonction existante avec ce fichier)
// Secrets requis : SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (déjà présents par défaut)
// Secret optionnel : CLUBPLUS_URL (origine de Club+ pour le lien de retour, sans /clubplus ;
// à défaut https://clubplus.sportvision-an.fr). CONNECT_URL n'est plus lu depuis le 10/09/2026.

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

// Recherche EXHAUSTIVE d'un compte existant par adresse (décisions Club+ du 10/09/2026, n° 3) —
// même fonction que clubplus-invite (aucun code partagé entre edge functions sur ce projet).
// L'ancien `listUsers({ page: 1, perPage: 200 })` ne regardait que les 200 premiers comptes : au-delà,
// une personne déjà inscrite devenait « déjà utilisée mais introuvable ». Filtre par adresse de
// l'API d'administration (LIKE sensible à la casse sur auth.users.email, stocké en minuscules),
// page après page jusqu'à une page vide, égalité exacte en minuscules.
async function trouverCompteParAdresse(supabaseUrl: string, serviceKey: string, adresse: string): Promise<string | null> {
  const cible = adresse.trim().toLowerCase();
  if (!cible) return null;
  const parPage = 200;
  for (let page = 1; page <= 10000; page++) {
    const r = await fetch(
      `${supabaseUrl}/auth/v1/admin/users?filter=${encodeURIComponent(cible)}&page=${page}&per_page=${parPage}`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
    );
    if (!r.ok) throw new Error(`Recherche du compte existant impossible (HTTP ${r.status}).`);
    const d = await r.json();
    const comptes: { id: string; email?: string | null }[] = Array.isArray(d?.users) ? d.users : [];
    const trouve = comptes.find((u) => (u.email || "").trim().toLowerCase() === cible);
    if (trouve) return trouve.id;
    if (comptes.length === 0) return null;
  }
  return null;
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
    // Décisions Club+ du 10/09/2026, n° 5. Le lien de l'e-mail d'invitation menait à
    // `${CONNECT_URL}/index.html` : l'ancienne app vanilla, retirée. Sur le domaine de Connect, il
    // atterrit aujourd'hui sur l'espace personnel (joueur, parent) — pas sur l'organisation qui
    // invite, qui vit dans Club+. Plus aucun écran déployé n'appelle cette fonction (seuls les
    // modules de l'ancienne app vanilla, qu'aucun site ne sert plus, le faisaient), mais elle reste
    // déployée et appelable : elle ne doit plus être un piège.
    //
    // Cible : /clubplus/auth/reset. Un lien d'invitation Supabase revient avec la session dans le
    // fragment (#access_token=…&type=invite) ; c'est le seul écran de Club+ qui la lit (setSession),
    // puis fait choisir le mot de passe et ouvre /dashboard, où l'invitation en attente se présente
    // (NoActiveSpace : Accepter / Refuser). L'adresse est déjà dans la liste blanche des
    // redirections (mot de passe oublié de Club+). CLUBPLUS_URL porte l'ORIGINE seule, sans le
    // basePath, comme dans clubplus-envoyer-invitation.
    const clubplusUrl = (Deno.env.get("CLUBPLUS_URL") || "https://clubplus.sportvision-an.fr").replace(/\/+$/, "");

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
    const organizationId: string = body.organization_id || "";

    if (!email || !organizationId) return json({ error: "E-mail et organisation sont obligatoires." }, 400);

    const admin = createClient(supabaseUrl, serviceKey);

    const rateOk = await checkRateLimit(admin, `org-invite:${caller.id}`);
    if (!rateOk) {
      return json({ error: "Trop de tentatives. Réessayez dans une heure." }, 429);
    }

    const { data: org } = await admin
      .from("organizations")
      .select("id, organization_type")
      .eq("id", organizationId)
      .maybeSingle();
    if (!org) return json({ error: "Organisation introuvable." }, 404);

    const orgType = org.organization_type as string;

    const { data: roleRows } = await admin
      .from("organization_role_catalog")
      .select("role_key, is_admin, is_default")
      .eq("organization_type", orgType);

    if (!roleRows || roleRows.length === 0) {
      return json({ error: "L'invitation en self-service n'est pas encore disponible pour ce type d'espace." }, 400);
    }

    const validRoleKeys = roleRows.map((r) => r.role_key as string);
    const adminRoleKeys = roleRows.filter((r) => r.is_admin).map((r) => r.role_key as string);
    const defaultRoleKey = roleRows.find((r) => r.is_default)?.role_key ?? validRoleKeys[0];

    if (adminRoleKeys.length === 0) {
      return json({ error: "Aucun rôle administrateur n'est configuré pour ce type d'espace." }, 400);
    }

    const role = validRoleKeys.includes(body.role) ? body.role : defaultRoleKey;

    // Vérifie que l'appelant est bien administrateur ACTIF de l'organisation ciblée
    // (jamais de confiance dans un rôle/organisation envoyé par le client).
    const { data: callerMembership } = await admin
      .from("memberships")
      .select("id")
      .eq("user_id", caller.id)
      .eq("organization_id", organizationId)
      .eq("status", "actif")
      .in("role", adminRoleKeys)
      .maybeSingle();
    if (!callerMembership) {
      return json({ error: "Seul un administrateur de cette organisation peut inviter un utilisateur." }, 403);
    }

    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${clubplusUrl}/clubplus/auth/reset`,
      data: { prenom, nom },
    });

    let invitedUserId: string | null = invited?.user?.id ?? null;

    if (inviteErr) {
      // "already been registered" : l'e-mail a déjà un compte Supabase Auth
      // (autre organisation, ou invitation précédente). On le retrouve pour
      // le rattacher à cette organisation.
      const msg = inviteErr.message || "";
      if (!/already/i.test(msg)) return json({ error: msg }, 500);
      const existant = await trouverCompteParAdresse(supabaseUrl, serviceKey, email);
      if (!existant) return json({ error: "Cet e-mail est déjà utilisé mais introuvable." }, 500);
      invitedUserId = existant;
    }

    if (!invitedUserId) return json({ error: "Échec de la création du compte invité." }, 500);

    const { data: existingMembership } = await admin
      .from("memberships")
      .select("id, status")
      .eq("user_id", invitedUserId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (existingMembership) {
      return json({ id: existingMembership.id, already_invited: true });
    }

    const { data: created, error: mErr } = await admin
      .from("memberships")
      .insert({
        user_id: invitedUserId,
        organization_id: organizationId,
        role,
        status: "invitation",
        source: "org-invite",
      })
      .select("id")
      .single();
    if (mErr) return json({ error: mErr.message }, 500);

    return json({ id: created.id, already_invited: false });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
