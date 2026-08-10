// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.
// Étape à faire à chaque édition : Supabase Dashboard → Edge Functions →
// connect-org-activate → coller ce code → Deploy.

// Supabase Edge Function — connect-org-activate
// Variante générique de clubplus-activate (lire ce fichier d'abord : mêmes
// conventions, même idempotence, même garanties atomiques) pour le flux
// d'activation PRIVÉ d'une organisation de type `event` ou `cm_agency`,
// générée par connect-staff-create-org. Appelée juste après que la personne
// invitée a créé son compte Supabase Auth depuis l'écran
// #/org-activation?token=… de SportVision Connect.
//
// Différence avec connect-org-signup (self-service coach/académie) : le type
// d'organisation et le rattachement éventuel à une fiche `clients` Portail
// (legacy_client_id) ne sont pas choisis par l'invité ni devinés par
// correspondance d'e-mail — ils sont PORTÉS PAR LE TOKEN, donc explicitement
// décidés par le staff au moment de la génération du lien. C'est pourquoi la
// vérification email_confirmed_at (indispensable à connect-org-signup /
// clubplus-onboarding) n'a pas d'équivalent ici : l'e-mail saisi par l'invité
// n'entre à aucun moment dans la décision de rattachement — même raisonnement
// de sécurité que clubplus-activate vs clubplus-onboarding.
//
// Deploy via Supabase dashboard > Edge Functions > New Function
// (name: connect-org-activate)
// Secrets requis : SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Anti-abus : même mécanisme que clubplus-activate/create-guest-request
// (table guest_rate_limits, migration-portail-v11.sql).
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

const STATUS_MESSAGES: Record<string, string> = {
  invalid: "Ce lien d'activation n'est pas valide.",
  expired: "Ce lien d'activation a expiré. Demandez-en un nouveau à SportVision.",
  used: "Ce lien d'activation a déjà été utilisé.",
  revoked: "Ce lien d'activation a été retiré par SportVision.",
};

// role_key admin par type d'organisation, cohérent avec le peuplement de
// organization_role_catalog (migration-connect-v20). Lu en base plutôt que
// codé en dur en dur uniquement pour rester source-unique-de-vérité — ici
// codé en dur volontairement car ces deux types n'ont que 2 rôles fixes
// chacun (contrairement à coach/académie qui ont un vrai catalogue étoffé) ;
// si le catalogue change, ce mapping devra suivre.
const ADMIN_ROLE_BY_TYPE: Record<string, string> = {
  event: "responsable",
  cm_agency: "proprietaire",
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

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Session invalide" }, 401);
    const user = userData.user;

    const body = await req.json();
    const token: string = (body.token || "").trim();
    const nomSaisi: string = (body.nom || "").trim();

    if (!token) return json({ error: STATUS_MESSAGES.invalid, status: "invalid" }, 400);

    const admin = createClient(supabaseUrl, serviceKey);

    const rateOk = await checkRateLimit(admin, `connect-org-activate:${user.id}`);
    if (!rateOk) {
      return json({ error: "Trop de tentatives. Réessayez dans une heure." }, 429);
    }

    // Idempotence : déjà onboardé (quel que soit le chemin) → ne rien recréer,
    // et surtout ne pas consommer le token pour rien.
    const { data: existing } = await admin
      .from("memberships")
      .select("id, organization_id, role")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    if (existing) {
      return json({ organization_id: existing.organization_id, role: existing.role, already_activated: true });
    }

    const { data: tokenRow } = await admin
      .from("connect_org_activation_tokens")
      .select("id, organization_type, nom_prefill, client_id, expires_at, used_at, revoked_at")
      .eq("token", token)
      .maybeSingle();

    if (!tokenRow) return json({ error: STATUS_MESSAGES.invalid, status: "invalid" }, 403);
    if (tokenRow.revoked_at) return json({ error: STATUS_MESSAGES.revoked, status: "revoked" }, 403);
    if (tokenRow.used_at) return json({ error: STATUS_MESSAGES.used, status: "used" }, 403);
    if (tokenRow.expires_at && new Date(tokenRow.expires_at).getTime() <= Date.now()) {
      return json({ error: STATUS_MESSAGES.expired, status: "expired" }, 403);
    }

    // Consommation ATOMIQUE : seul le premier appel voit une ligne revenir.
    const nowIso = new Date().toISOString();
    const { data: claimed } = await admin
      .from("connect_org_activation_tokens")
      .update({ used_at: nowIso })
      .eq("id", tokenRow.id)
      .is("used_at", null)
      .is("revoked_at", null)
      .gt("expires_at", nowIso)
      .select("id")
      .maybeSingle();
    if (!claimed) return json({ error: STATUS_MESSAGES.used, status: "used" }, 409);

    const releaseToken = async () => {
      await admin.from("connect_org_activation_tokens").update({ used_at: null }).eq("id", tokenRow.id);
    };

    const nom = nomSaisi || (tokenRow.nom_prefill || "").trim();
    if (!nom) {
      await releaseToken();
      return json({ error: "Le nom de l'organisation est obligatoire." }, 400);
    }

    const adminRole = ADMIN_ROLE_BY_TYPE[tokenRow.organization_type];
    if (!adminRole) {
      await releaseToken();
      return json({ error: "Type d'organisation invalide sur ce lien." }, 500);
    }

    const { data: createdOrg, error: orgErr } = await admin
      .from("organizations")
      .insert({
        id: crypto.randomUUID(),
        organization_type: tokenRow.organization_type,
        nom,
        legacy_client_id: tokenRow.client_id,
      })
      .select("id")
      .single();
    if (orgErr) {
      await releaseToken();
      return json({ error: orgErr.message }, 500);
    }

    const { error: memberErr } = await admin.from("memberships").insert({
      user_id: user.id,
      organization_id: createdOrg.id,
      role: adminRole,
      status: "actif",
      source: "connect-org-activate",
    });
    if (memberErr) {
      await admin.from("organizations").delete().eq("id", createdOrg.id);
      await releaseToken();
      return json({ error: memberErr.message }, 500);
    }

    // Pont Documents ↔ Portail (best-effort) : si le staff a choisi un client_id
    // à la génération, l'appelant devient client_users de ce client — même
    // mécanisme que clubplus-activate, pour bénéficier des vues client_devis/
    // client_factures/client_contrats si applicable.
    let portailLie = false;
    if (tokenRow.client_id) {
      try {
        const { error: cuErr } = await admin
          .from("client_users")
          .upsert({ id: user.id, client_id: tokenRow.client_id }, { onConflict: "id" });
        portailLie = !cuErr;
      } catch (_e) {
        console.error("[connect-org-activate] rattachement client_users a échoué :", _e);
      }
    }

    try {
      await admin.rpc("notify_staff_by_role", {
        p_roles: ["admin", "sec"],
        p_titre: `Organisation ${tokenRow.organization_type === "event" ? "événement" : "agence CM"} activée`,
        p_message:
          `${nom} vient d'activer son espace Connect (${tokenRow.organization_type}).` +
          (tokenRow.client_id ? (portailLie ? " Son historique Portail est rattaché." : " Le rattachement Portail a échoué, à vérifier.") : ""),
        p_priorite: "normale",
        p_prestation_id: null,
        p_client_id: tokenRow.client_id,
      });
    } catch (_e) {
      console.error("[connect-org-activate] notify_staff_by_role a échoué :", _e);
    }

    return json({
      organization_id: createdOrg.id,
      role: adminRole,
      already_activated: false,
      portail_lie: portailLie,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
