// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.
// Étape à faire à chaque édition : Supabase Dashboard → Edge Functions →
// connect-org-signup → coller ce code → Deploy.
// Oublier cette étape est la cause la plus fréquente de "le code est bon
// mais ça ne marche pas en prod" sur ce projet (déjà arrivé sur au moins
// 5 fonctions : clubplus-billing-portal, create-clubplus-subscription-
// checkout, dispatch-notifications, create-guest-rdv, create-guest-request).

// Supabase Edge Function — connect-org-signup
//
// Complète l'inscription self-service de SportVision Connect (app-next) pour les
// deux organization_type qui n'ont NI table legacy (clubs/clients) à synchroniser,
// NI facturation Club+ réelle branchée à ce jour : 'coach' et 'academie' — quelle
// que soit l'offre choisie, y compris club_plus_start/performance.
//
// 09/08/2026 — corrige une intention initiale erronée : réutiliser clubplus-onboarding
// pour une académie choisissant Club+ "comme un club" créerait une ligne `clubs`, donc
// (migration-connect-v2, § peuplement organizations) une organisation organization_type
// ='club', pas 'academie' — l'organisation serait mal étiquetée dès sa création, et
// afficherait les modules Club (équipes/match center/...) au lieu des modules Académie
// (groupes/stages/inscriptions/campagnes). La vraie facturation Stripe Club+ est câblée
// uniquement sur la table `clubs` (create-clubplus-subscription-checkout n'accepte qu'un
// club_id réel) : aucune académie/coach ne peut donc avoir de facturation automatique
// aujourd'hui, quelle que soit l'offre affichée à l'inscription. Cette fonction crée donc
// toujours la vraie organisation 'coach'/'academie', et le staff finalise la facturation
// manuellement si l'offre choisie est payante (voir plan_label dans la notification).
//
// Pourquoi une fonction séparée plutôt que réutiliser clubplus-onboarding ou
// portal-onboarding :
//  - clubplus-onboarding crée toujours une ligne `clubs` (voir ci-dessus) — mauvais
//    organization_type, et un plan forcé à 'club'/'performance' (CREDITS_BY_PLAN ne
//    connaît que ces deux valeurs) : recevrait des crédits Club+ gratuits sans jamais
//    payer si le plan choisi n'est pas déjà club_plus_*.
//  - portal-onboarding crée un client Portail (organization_type='projet' après
//    synchronisation), ce qui masquerait le vrai type "coach"/"académie" côté OS.
//
// `organizations.id` n'a pas de valeur par défaut (voir migration-connect-v2 :
// "id = clubs.id ou clients.id, réutilisé, pas régénéré") car pour club/projet il
// est toujours copié depuis une table legacy par un trigger. Pour coach/académie,
// il n'existe aucune table legacy : un uuid frais est généré ici, exactement comme
// le ferait un membre du staff créant une organisation coach/académie à la main
// depuis l'OS (org-invite, qui suppose l'organisation déjà existante, présuppose
// cette même possibilité de création directe en amont).
//
// Rôle attribué au créateur : lu depuis `organization_role_catalog` (is_admin=true
// pour ce organization_type) plutôt que codé en dur ici, pour ne jamais désynchroniser
// ce fichier si le catalogue de rôles évolue (migration-connect-v6-org-admin.sql) :
// 'proprietaire' pour coach, 'admin' pour academie au moment de l'écriture.
//
// Deploy via Supabase dashboard > Edge Functions > New Function (name: connect-org-signup)
// Secrets requis : SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (déjà présents par défaut)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

const ALLOWED_TYPES = new Set(["coach", "academie"]);

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
    const organizationType: string = body.organization_type;
    const nom: string = (body.nom || "").trim();
    const ville: string = body.ville || "";
    const prenom: string = body.prenom || "";
    const nomContact: string = body.nom_contact || "";
    const telephone: string = body.telephone || "";
    const planLabel: string = body.plan_label || ""; // libellé de l'offre choisie, informatif uniquement (notification staff)
    const message: string = (body.message || "").trim(); // message libre (ex. Full Communication "sur devis"), informatif uniquement

    if (!ALLOWED_TYPES.has(organizationType)) {
      return json({ error: "Type d'organisation non pris en charge par cette fonction." }, 400);
    }
    if (!nom) {
      return json({ error: "Le nom de l'organisation est obligatoire." }, 400);
    }

    const admin = createClient(supabaseUrl, serviceKey);

    const rateOk = await checkRateLimit(admin, `connect-org-signup:${user.id}`);
    if (!rateOk) {
      return json({ error: "Trop de tentatives. Réessayez dans une heure." }, 429);
    }

    // Idempotence : l'utilisateur a-t-il déjà un membership quelconque ?
    const { data: existingMembership } = await admin
      .from("memberships")
      .select("id, organization_id, role")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    if (existingMembership) {
      return json({
        organization_id: existingMembership.organization_id,
        role: existingMembership.role,
        already_onboarded: true,
      });
    }

    // Rôle admin réel pour ce type, lu depuis le catalogue plutôt que codé en dur.
    const { data: roleRow } = await admin
      .from("organization_role_catalog")
      .select("role_key")
      .eq("organization_type", organizationType)
      .eq("is_admin", true)
      .limit(1)
      .maybeSingle();
    const adminRole = roleRow?.role_key ?? "admin";

    // organizations.id n'a pas de valeur par défaut côté schéma (délibéré : pour un club/
    // académie migré depuis l'ancien modèle, id = clubs.id/clients.id — voir migration-
    // connect-v2-organizations-entitlements.sql). Pour une inscription self-service coach/
    // académie, il n'existe aucune ligne clubs/clients préexistante à faire correspondre :
    // il faut donc générer explicitement un nouvel id, sous peine de violation NOT NULL
    // (bug trouvé le 10/08 en testant en conditions réelles : l'inscription échouait à
    // 100% pour ces deux types, jamais un id fourni).
    const { data: createdOrg, error: orgErr } = await admin
      .from("organizations")
      .insert({
        id: crypto.randomUUID(),
        organization_type: organizationType,
        nom,
        ville: ville || null,
      })
      .select("id")
      .single();
    if (orgErr) return json({ error: orgErr.message }, 500);

    const { error: memberErr } = await admin.from("memberships").insert({
      user_id: user.id,
      organization_id: createdOrg.id,
      role: adminRole,
      status: "actif",
      source: "connect-signup",
    });
    if (memberErr) return json({ error: memberErr.message }, 500);

    // Pont Documents ↔ Portail (best-effort, ne bloque jamais la création de l'organisation) :
    // même bloc que clubplus-onboarding (voir supabase/functions/clubplus-onboarding/index.ts,
    // section "Pont Documents ↔ Portail"), mais relie organizations.legacy_client_id au lieu de
    // clubs.portail_client_id — cette colonne existe déjà (migration-connect-v2-organizations-
    // entitlements.sql, ligne 56) mais n'était encore jamais peuplée pour 'coach'/'academie',
    // laissant ces organisations invisibles de l'OS (aucune ligne `clients`, donc absentes de
    // toute liste/KPI côté staff) et bloquant tout module client_id-scoped (Séances/Stages ici ;
    // MyCM/Accompagnement plus tard). Même garde que clubplus-onboarding : ne rapprocher/créer que
    // si Supabase a confirmé que l'appelant possède bien cette adresse (email_confirmed_at non
    // nul) — sans cette vérification, si la confirmation par e-mail était un jour désactivée côté
    // projet, n'importe qui pourrait s'inscrire avec l'e-mail de quelqu'un d'autre et hériter
    // immédiatement de ses documents financiers existants (audit du 2026-08-06).
    //
    // type_client choisi : 'entreprise'. La contrainte check réelle de clients.type_client
    // (supabase-schema-v2.sql) n'accepte que 5 valeurs : 'club','association','entreprise',
    // 'particulier','fédération' — aucune dédiée à un coach ou une académie. 'club' est écarté (ni
    // l'un ni l'autre n'est un club) et 'fédération' aussi (échelle sans rapport). Entre
    // 'association' et 'entreprise', 'entreprise' est retenu pour les deux organization_type : un
    // coach self-service est très majoritairement un professionnel indépendant (auto-entrepreneur/
    // entreprise individuelle) qui vend une prestation, pas un particulier réservant une séance
    // pour lui-même ; une académie, même parfois structurée en association loi 1901, reste ici une
    // structure professionnelle qui souscrit une offre payante (Club+/Full Communication), pas un
    // particulier. 'entreprise' est déjà le bucket utilisé ailleurs dans l'écosystème pour tout
    // profil professionnel qui n'est ni club ni organisateur associatif identifié comme tel (voir
    // TYPE_CLIENT_MAP dans supabase/functions/portal-onboarding/index.ts) — c'est le choix le plus
    // proche disponible, pas une certitude juridique. Purement informatif (alimente
    // CONTRAT_CLIENT_FORMES pour le libellé de forme juridique si un contrat est généré) : un
    // membre du staff peut le corriger à la main dans la fiche client de l'OS si besoin.
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
              type_client: "entreprise",
              nom,
              nom_contact: nomContact || null,
              prenom_contact: prenom || null,
              email: user.email,
              telephone: telephone || null,
              ville: ville || null,
              origine_prospect: "connect",
            })
            .select("id")
            .single();
          if (createClientErr) throw createClientErr;
          linkedClientId = createdClient.id;
        }

        await admin.from("organizations").update({ legacy_client_id: linkedClientId }).eq("id", createdOrg.id);
        await admin
          .from("client_users")
          .upsert(
            { id: user.id, client_id: linkedClientId, prenom: prenom || null, nom: nomContact || null, telephone: telephone || null },
            { onConflict: "id" },
          );
      } catch (_e) {
        console.error("[connect-org-signup] rattachement/création du client Portail a échoué (best-effort) :", _e);
      }
    }

    // Notifie le staff — aucune facturation réelle n'est déclenchée par cette fonction
    // (voir en-tête) : un conseiller doit reprendre la main pour toute offre payante.
    try {
      await admin.rpc("notify_staff_by_role", {
        p_roles: ["admin", "sec"],
        p_titre: `Nouvelle inscription ${organizationType === "coach" ? "coach" : "académie"} — ${nom}`,
        p_message: `${nom} (contact : ${prenom} ${nomContact}${telephone ? ", " + telephone : ""}) vient de créer son compte Connect${planLabel ? " — offre demandée : " + planLabel : ""}. Aucun paiement n'a été collecté, à finaliser manuellement si l'offre est payante.${message ? " Message : " + message : ""}`,
        p_priorite: "normale",
        p_prestation_id: null,
        p_client_id: null,
      });
    } catch (_e) {
      console.error("[connect-org-signup] notify_staff_by_role a échoué :", _e);
    }

    return json({ organization_id: createdOrg.id, role: adminRole, already_onboarded: false });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
