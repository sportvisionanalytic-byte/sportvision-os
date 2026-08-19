// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.
// Étape à faire à chaque édition : Supabase Dashboard → Edge Functions →
// clubplus-onboarding → coller ce code → Deploy.
// Oublier cette étape est la cause la plus fréquente de "le code est bon
// mais ça ne marche pas en prod" sur ce projet (déjà arrivé sur au moins
// 5 fonctions : clubplus-billing-portal, create-clubplus-subscription-
// checkout, dispatch-notifications, create-guest-rdv, create-guest-request).

// Supabase Edge Function — clubplus-onboarding
// Appelée juste après l'inscription d'un dirigeant sur SportVision Club+ (Supabase Auth signUp).
// Idempotente : si l'utilisateur a déjà une ligne club_members, la renvoie telle quelle
// sans rien recréer (cf. handleLogin() côté client, qui rappelle cette fonction comme
// filet de sécurité au premier login si la confirmation par e-mail était activée).
//
// Portée v1 : crée toujours un NOUVEAU club avec l'appelant comme admin. La jonction
// à un club existant via lien d'invitation ou lien d'activation privé (PILOT_MODE)
// sera ajoutée dans une fonction séparée (clubplus-accept-invite / clubplus-activate)
// une fois ces flux développés côté SportVision OS.
//
// Deploy via Supabase dashboard > Edge Functions > New Function (name: clubplus-onboarding)
// Secrets requis : SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (déjà présents par défaut sur le projet)

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

// 17/08/2026 — 10 (Start) / 40 (Performance), alignés sur plans.ts monthlyCredits (audit
// complet Club+ du 17/08/2026, confirmé par Fouka) — voir clubplus-activate.
// 19/08/2026 — ajout de "free" (Club+ Gratuit, 0 crédit inclus, décision Fouka) : c'est
// désormais le plan par défaut de ce parcours self-service (voir plus bas). Start/
// Performance restent accessibles uniquement via create-clubplus-subscription-checkout
// (abonnement Stripe payant), jamais directement ici.
const CREDITS_BY_PLAN: Record<string, number> = { free: 0, club: 10, performance: 40 };

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
    const prenom: string = body.prenom || "";
    const nom: string = body.nom || "";
    const telephone: string = body.telephone || "";
    const club = body.club || {};
    // Parcours self-service : le plan par défaut est désormais "free" (Club+ Gratuit),
    // pas "club" (Start) — Start/Performance ne s'obtiennent que via un abonnement Stripe
    // payant (create-clubplus-subscription-checkout), jamais à l'inscription. Vérifie la
    // présence de la clé (pas sa valeur) car CREDITS_BY_PLAN.free vaut 0, qui est falsy.
    const plan: string = Object.prototype.hasOwnProperty.call(CREDITS_BY_PLAN, body.plan) ? body.plan : "free";

    const admin = createClient(supabaseUrl, serviceKey);

    const rateOk = await checkRateLimit(admin, `clubplus-onboarding:${user.id}`);
    if (!rateOk) {
      return json({ error: "Trop de tentatives. Réessayez dans une heure." }, 429);
    }

    // Idempotence : déjà onboardé (quel que soit le club) → ne rien recréer.
    const { data: existing } = await admin
      .from("club_members")
      .select("id, club_id, role")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    if (existing) {
      return json({ club_id: existing.club_id, role: existing.role, already_onboarded: true });
    }

    if (!club.nom || !String(club.nom).trim()) {
      return json({ error: "Le nom du club est obligatoire." }, 400);
    }

    const { data: createdClub, error: clubErr } = await admin
      .from("clubs")
      .insert({
        nom: String(club.nom).trim(),
        ville: club.ville || null,
        discipline: club.discipline || null,
        plan,
        engagement: body.engagement === "sans" ? "sans" : "12mois",
        credits_monthly: CREDITS_BY_PLAN[plan],
        credits_balance: CREDITS_BY_PLAN[plan],
      })
      .select("id")
      .single();
    if (clubErr) return json({ error: clubErr.message }, 500);

    const { error: cmErr } = await admin.from("club_members").insert({
      user_id: user.id,
      club_id: createdClub.id,
      role: "admin",
      prenom: prenom || null,
      nom: nom || null,
      telephone: telephone || null,
      status: "actif",
    });
    if (cmErr) return json({ error: cmErr.message }, 500);

    // Pont Documents ↔ Portail (best-effort, ne bloque jamais la création du club) : relie
    // clubs.portail_client_id à un `clients` Portail et fait de l'admin un client_users pour ce
    // client — il peut alors lire ses vrais devis/factures/contrats via les vues
    // client_devis/client_factures/client_contrats (migration-portail-v1.sql), sans aucune
    // donnée dupliquée ni nouvelle policy Portail. Ne le faire (rapprocher OU créer) que si
    // Supabase a confirmé que l'appelant possède bien cette adresse (email_confirmed_at non
    // nul) — sans cette vérification, si la confirmation par e-mail était un jour désactivée
    // côté projet, n'importe qui pourrait s'inscrire avec l'e-mail de quelqu'un d'autre et
    // hériter immédiatement de ses documents financiers existants. Découvert lors de l'audit
    // du 2026-08-06.
    //
    // 10/08/2026 — avant ce correctif, l'absence de `clients` correspondant (le cas normal
    // pour un club acquis en self-service, qui n'a par définition jamais eu de fiche Portail
    // avant de s'inscrire) laissait `portail_client_id` null POUR TOUJOURS : aucun autre code
    // du repo ne l'écrit ailleurs, et l'OS n'a aucune UI pour le faire à la main (vérifié par
    // audit). Résultat räel mesuré : Facturation/Contrats/Documents/Messages/Communication/
    // Publications/Validations (tous branchés sur ce lien le 09/08/2026) restaient vides pour
    // la quasi-totalité des clubs, et le club lui-même était invisible dans l'OS (n'apparaît
    // dans aucune liste, aucun KPI, tous basés sur `clients`). Fix : si aucune correspondance
    // n'existe, CRÉER la fiche `clients` plutôt que de laisser le lien vide — aucun risque
    // d'hériter des données de quelqu'un d'autre (rien n'existait avant), et le club devient
    // enfin visible et gérable côté staff dès son inscription.
    if (user.email && user.email_confirmed_at) {
      try {
        const { data: matchedClient } = await admin
          .from("clients")
          .select("id")
          .ilike("email", user.email)
          .limit(1)
          .maybeSingle();

        let linkedClientId: string | null = matchedClient?.id ?? null;

        if (!linkedClientId) {
          const { data: createdClient, error: createClientErr } = await admin
            .from("clients")
            .insert({
              statut: "prospect",
              type_client: "club",
              nom: String(club.nom).trim(),
              nom_contact: nom || null,
              prenom_contact: prenom || null,
              email: user.email,
              telephone: telephone || null,
              ville: club.ville || null,
              origine_prospect: "connect",
            })
            .select("id")
            .single();
          if (createClientErr) throw createClientErr;
          linkedClientId = createdClient.id;
        }

        await admin.from("clubs").update({ portail_client_id: linkedClientId }).eq("id", createdClub.id);
        await admin
          .from("client_users")
          .upsert({ id: user.id, client_id: linkedClientId, prenom: prenom || null, nom: nom || null, telephone: telephone || null }, { onConflict: "id" });
      } catch (_e) {
        console.error("[clubplus-onboarding] rattachement/création du client Portail a échoué (best-effort) :", _e);
      }
    }

    // Notifie le staff — avant, un club pouvait s'auto-inscrire en self-service
    // sans que personne chez SportVision ne le sache (aucune alerte nulle
    // part). Best-effort, ne bloque jamais la création du club.
    try {
      await admin.rpc("notify_staff_by_role", {
        p_roles: ["admin", "sec"],
        p_titre: "Nouveau club Club+ auto-inscrit",
        p_message: `${String(club.nom).trim()} vient de créer son compte Club+ (formule ${plan}).`,
        p_priorite: "normale",
        p_prestation_id: null,
        p_client_id: null,
      });
    } catch (_e) {
      console.error("[clubplus-onboarding] notify_staff_by_role (nouveau club auto-inscrit) a échoué :", _e);
    }

    return json({ club_id: createdClub.id, role: "admin", already_onboarded: false });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
