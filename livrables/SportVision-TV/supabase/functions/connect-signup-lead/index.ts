// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.
// Étape à faire à chaque édition : Supabase Dashboard → Edge Functions →
// connect-signup-lead → coller ce code → Deploy.
// Oublier cette étape est la cause la plus fréquente de "le code est bon
// mais ça ne marche pas en prod" sur ce projet (déjà arrivé sur au moins
// 5 fonctions : clubplus-billing-portal, create-clubplus-subscription-
// checkout, dispatch-notifications, create-guest-rdv, create-guest-request).

// Supabase Edge Function — connect-signup-lead
//
// Notifie le staff pour les inscriptions self-service (app-next) qui n'ont, à ce jour,
// AUCUNE représentation réelle possible en base — ni ligne `organizations`, ni `clients` :
//  - club/académie ayant choisi Essentiel ou Full Communication : `clubs.plan` a une
//    contrainte CHECK qui n'autorise que 'club'/'performance' (clubplus-onboarding), donc
//    aucune ligne `clubs` ne peut représenter un club Essentiel ; le créer comme client
//    Portail (`clients`, organization_type='projet') mentirait sur son vrai type auprès du
//    staff (un club affiché comme client générique).
//  - joueur qui rejoint un club existant : rattachement soumis à validation par
//    l'administrateur du club, donc aucun membership ne doit être créé maintenant.
//
// Ne crée donc RIEN d'autre qu'une notification staff — aucune écriture `organizations`,
// `clients` ou `memberships`. Le compte Supabase Auth (créé côté client juste avant
// l'appel) atterrit sur l'écran « Aucun espace disponible » (NoActiveSpace) jusqu'à ce
// qu'un conseiller le rattache manuellement — écran déjà conçu pour ce cas précis.
//
// Pourquoi une Edge Function plutôt qu'un appel direct à notify_staff_by_role() depuis le
// client : cette RPC (migration-portail-v10.sql) n'a jamais eu de `revoke execute`,
// contrairement à enqueue_notification/rpc_get_custom_quiz/... (migration-securite-
// enqueue-notification.sql, migration-audit-nocturne-securite-09-08.sql) — elle reste
// donc appelable directement par n'importe quel rôle PostgREST (authenticated, voire
// anon) avec un titre/message entièrement choisi par l'appelant. Trouvé en écrivant cette
// fonction (09/08/2026) : à corriger séparément par un `revoke execute` (même patron que
// les migrations citées), signalé à Fouka, jamais exécuté ici. Cette fonction contourne
// le problème pour ce flux précis en composant elle-même le titre/message côté serveur à
// partir d'un `reason` fermé (enum), jamais du texte libre injecté tel quel dans le titre.
//
// Deploy via Supabase dashboard > Edge Functions > New Function (name: connect-signup-lead)
// Secrets requis : SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (déjà présents par défaut)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

const REASONS = new Set(["club_plan_manuel", "player_join_club", "quote_followup"]);

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
    const reason: string = body.reason || "";
    const orgName: string = (body.org_name || "").trim();
    const planLabel: string = body.plan_label || "";
    const clubSearch: string = (body.club_search || "").trim();
    const message: string = (body.message || "").trim();
    const prenom: string = body.prenom || "";
    const nomContact: string = body.nom_contact || "";
    const telephone: string = body.telephone || "";

    if (!REASONS.has(reason)) {
      return json({ error: "Motif non pris en charge." }, 400);
    }

    const admin = createClient(supabaseUrl, serviceKey);

    const rateOk = await checkRateLimit(admin, `connect-signup-lead:${user.id}`);
    if (!rateOk) {
      return json({ error: "Trop de tentatives. Réessayez dans une heure." }, 429);
    }

    const contact = `${prenom} ${nomContact}`.trim() || user.email || "contact inconnu";
    const coords = [user.email, telephone].filter(Boolean).join(" · ");

    let titre = "";
    let texte = "";
    if (reason === "club_plan_manuel") {
      titre = `Inscription Connect à finaliser manuellement — ${orgName || "structure sans nom"}`;
      texte = `${orgName || "Une structure"} vient de créer son compte Connect pour l'offre ${planLabel || "demandée"} (${coords}, contact : ${contact}). Cette offre n'a pas de facturation automatique : à finaliser manuellement.`;
    } else if (reason === "player_join_club") {
      titre = `Demande de rattachement joueur — ${clubSearch || "club non précisé"}`;
      texte = `${contact} (${coords}) a créé son compte Connect en indiquant vouloir rejoindre « ${clubSearch || "club non précisé"} ». À vérifier et rattacher manuellement au club réel si trouvé.`;
    } else {
      titre = `Demande de devis Full Communication — ${orgName || "structure sans nom"}`;
      texte = `${orgName || "Une structure"} (${coords}, contact : ${contact}) demande une mise en relation Full Communication.${message ? " Message : " + message : ""}`;
    }

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
      console.error("[connect-signup-lead] notify_staff_by_role a échoué :", _e);
      return json({ error: "Notification impossible pour le moment." }, 500);
    }

    return json({ notified: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
