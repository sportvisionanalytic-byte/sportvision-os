// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.
// Étape à faire à chaque édition : Supabase Dashboard → Edge Functions →
// connect-club-signup-request → coller ce code → Deploy.
// Oublier cette étape est la cause la plus fréquente de "le code est bon
// mais ça ne marche pas en prod" sur ce projet (déjà arrivé sur au moins
// 5 fonctions : clubplus-billing-portal, create-clubplus-subscription-
// checkout, dispatch-notifications, create-guest-rdv, create-guest-request).

// Supabase Edge Function — connect-club-signup-request
//
// 17/08/2026 — généralisée à 7 types de structure (SIGNUP-UNIFIE-MASTER-
// PROMPT.md + décision d'architecture en bas du fichier) : ce n'est plus
// seulement le tunnel club, mais LE tunnel "demande d'ouverture d'un espace
// Club+" pour club/académie/coach/structure de coaching/tournoi/stage/
// association-autre structure. Le nom de la fonction n'a volontairement pas
// changé (contrat d'API stable pour le frontend) ; seul son comportement
// interne est généralisé. Écrit désormais dans connect_clubplus_signup_requests
// (migration-connect-v78-signup-unifie-clubplus.sql — connect_club_signup_
// requests, visée par l'ancienne version de ce fichier, n'a jamais existé en
// prod, vérifié par curl avant ce chantier).
//
// PUBLIQUE, comme create-guest-request : appelée SANS session (le tunnel ne
// crée ni compte ni mot de passe — Fouka : "une inscription publique
// devrait créer une 'Demande d'ouverture Club+'"). Anti-abus par IP via
// guest_rate_limits, même mécanisme que create-guest-request / create-guest-
// rdv / clubplus-check-activation-token.
//
// N'ÉCRIT QUE dans connect_clubplus_signup_requests. Ne crée RIEN d'autre —
// aucune ligne organizations / memberships / clubs / club_members / clients /
// auth.users, quel que soit le type de structure. La structure réelle n'est
// créée qu'à l'activation (clubplus-activate pour club, connect-org-activate
// pour les 6 autres types), après validation staff explicite
// (connect-club-signup-review).
//
// Deploy via Supabase dashboard > Edge Functions > New Function (name: connect-club-signup-request)
// Secrets requis : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RATE_LIMIT_MAX = 5;
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

// Type de structure — écran 1 du tunnel (master prompt §5). 'projet'
// correspond à "Association / Autre structure" (mapping déjà utilisé
// ailleurs dans ce repo pour "Autre structure sportive"/Espace Projet).
const ORG_TYPES = new Set([
  "club", "academie", "coach", "structure_coaching", "tournoi", "stage", "projet",
]);

// structure_type (sous-classification administrative française) n'a de sens
// que pour ces 3 types — voir migration-connect-v78, section 1.
const STRUCTURE_TYPE_RELEVANT = new Set(["club", "academie", "projet"]);

// Liste fermée — doit rester strictement identique à FONCTION ci-dessous côté
// frontend (le prochain agent doit aligner CLUB_FONCTION_OPTIONS/signup-
// context.tsx sur cette liste exacte). Transcrite verbatim depuis SIGNUP-
// UNIFIE-MASTER-PROMPT.md §19 (liste unique, valable pour les 7 types).
const FONCTIONS = new Set([
  "Président(e)", "Vice-président(e)", "Directeur/Directrice", "Secrétaire",
  "Trésorier/Trésorière", "Responsable communication", "Community Manager",
  "Directeur sportif", "Responsable sportif", "Responsable administratif",
  "Coach", "Éducateur", "Préparateur physique", "Responsable d'équipe",
  "Responsable partenariat/sponsoring", "Propriétaire/Gérant", "Bénévole",
  "Membre du bureau", "Autre",
]);

// Liste fermée — transcrite depuis SIGNUP-UNIFIE-MASTER-PROMPT.md §27-28
// ("version recommandée des choix"), Club+ volontairement absent (déjà le
// produit demandé par ce tunnel, doublon évité).
const BESOINS = new Set([
  "Photo / vidéo", "Communication de ma structure", "Création de visuels",
  "Full Communication", "Couverture de matchs", "Captation Veo / Drone",
  "Tournoi / stage / événement", "Découvrir les services SportVision", "Autre",
]);

// Champ conditionnel écran 2 — coach/préparateur (master prompt §12).
const ACTIVITE_TYPES = new Set([
  "Coach indépendant", "Préparateur physique", "Personal trainer", "Coach personnel", "Autre",
]);

function json400(msg: string) {
  return json({ error: msg }, 400);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const admin = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const {
      // Écran 1
      organization_type,
      // Écran 2 · Votre structure
      club_nom, structure_type, ville, code_postal, site_web,
      activite_type, activite_type_autre, exerce_sous_propre_nom,
      nom_evenement_principal,
      // Écran 3 · Vous
      contact_prenom, contact_nom, contact_email, contact_telephone, fonction, fonction_autre,
      // Écran 4 · Votre besoin
      besoins, besoin_autre_precision,
      // Écran 5 · Validation
      certification_acceptee,
      // Honeypot — nom distinct de "site_web" (déjà un champ légitime ici, le
      // nom du site de la structure), doit rester vide, un bot le remplit en général.
      hp_champ,
    } = body;

    if (hp_champ) {
      // Réponse "succès" sans rien écrire, pour ne pas révéler la détection —
      // même logique que create-guest-request / create-guest-rdv.
      return json({ request_id: null });
    }

    // organization_type absent -> 'club' par défaut, pour ne rien casser d'un
    // appelant qui n'enverrait pas encore ce champ (compatibilité ascendante
    // avec l'ancien tunnel 4 étapes club-only).
    const orgType: string = organization_type ? String(organization_type).trim() : "club";
    if (!ORG_TYPES.has(orgType)) return json400("Type de structure non reconnu.");

    if (!club_nom || !String(club_nom).trim()) return json400("Le nom de la structure est obligatoire.");
    // structure_type : obligatoire UNIQUEMENT pour club (comportement EXACTEMENT identique à
    // avant ce chantier). Pour académie/projet, facultatif mais accepté et conservé. Pour les 4
    // autres types, non pertinent — un envoi accidentel est ignoré silencieusement plutôt que
    // rejeté (le frontend ne devrait pas l'envoyer pour ces types, voir STRUCTURE_TYPE_RELEVANT).
    if (orgType === "club" && (!structure_type || !String(structure_type).trim())) {
      return json400("Le type de structure est obligatoire.");
    }
    if (!ville || !String(ville).trim()) return json400("La ville est obligatoire.");
    if (!contact_prenom || !String(contact_prenom).trim()) return json400("Le prénom est obligatoire.");
    if (!contact_nom || !String(contact_nom).trim()) return json400("Le nom est obligatoire.");
    if (!contact_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact_email)) return json400("Adresse e-mail invalide.");
    if (!contact_telephone || !String(contact_telephone).trim()) return json400("Le téléphone est obligatoire.");
    if (!fonction || !FONCTIONS.has(fonction)) return json400("Fonction non reconnue.");
    if (fonction === "Autre" && (!fonction_autre || !String(fonction_autre).trim())) {
      return json400("Merci de préciser votre fonction.");
    }
    if (orgType === "coach" && activite_type) {
      if (!ACTIVITE_TYPES.has(activite_type)) return json400("Type d'activité non reconnu.");
      if (activite_type === "Autre" && (!activite_type_autre || !String(activite_type_autre).trim())) {
        return json400("Merci de préciser votre type d'activité.");
      }
    }
    if (!Array.isArray(besoins) || besoins.length === 0) return json400("Sélectionnez au moins un besoin.");
    if (!besoins.every((b: unknown) => typeof b === "string" && BESOINS.has(b))) {
      return json400("Un des besoins sélectionnés n'est pas reconnu.");
    }
    if (!certification_acceptee) return json400("Merci de certifier être autorisé(e) à effectuer cette demande.");

    // Bornes anti-abus (mêmes ordres de grandeur que create-guest-request) :
    // ce ne sont pas des règles métier, juste une protection contre des
    // champs anormalement longs, signe classique de bot plutôt qu'une vraie
    // demande.
    const tooLong = [
      [club_nom, 200], [ville, 120], [code_postal, 12], [site_web, 300],
      [contact_prenom, 100], [contact_nom, 100], [contact_telephone, 30],
      [fonction_autre, 200], [besoin_autre_precision, 500],
      [activite_type_autre, 200], [nom_evenement_principal, 200],
    ].some(([val, max]) => val && String(val).length > (max as number));
    if (tooLong) return json400("Un des champs dépasse la longueur autorisée.");

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("cf-connecting-ip") || "inconnu";
    const rateOk = await checkRateLimit(admin, `ccsr:${ip}`);
    if (!rateOk) {
      return json({ error: "Trop de demandes envoyées récemment. Merci de réessayer plus tard." }, 429);
    }

    // Détection de doublon (17/08/2026, audit complet Club+ — gap documenté depuis la
    // construction du tunnel unifié, master prompt §46-49 : "nécessite une vraie extension
    // serveur"). Volontairement PAS de recherche floue nom+ville (aucune définition produit
    // tranchée de "même structure") : correspondance EXACTE (insensible à la casse) sur le nom de
    // structure pour ce type d'organisation, OU sur l'e-mail de contact tous types confondus — les
    // deux cas où une nouvelle demande est presque sûrement un doublon accidentel (double clic,
    // renvoi après un premier essai) plutôt qu'une coïncidence. Bloque uniquement les demandes
    // encore "vivantes" (a_traiter/infos_demandees) ou déjà validées (valide, ce qui veut dire
    // qu'un lien d'activation existe déjà) — une demande refusée (refuse) n'empêche pas un nouvel
    // essai, une structure peut légitimement retenter après correction.
    const normalizedNom = String(club_nom).trim();
    const normalizedEmail = String(contact_email).trim();
    const LIVE_STATUTS = ["a_traiter", "infos_demandees", "valide"];
    const [byNom, byEmail] = await Promise.all([
      admin
        .from("connect_clubplus_signup_requests")
        .select("id")
        .eq("organization_type", orgType)
        .in("statut", LIVE_STATUTS)
        .ilike("club_nom", normalizedNom)
        .limit(1)
        .maybeSingle(),
      admin
        .from("connect_clubplus_signup_requests")
        .select("id")
        .in("statut", LIVE_STATUTS)
        .ilike("contact_email", normalizedEmail)
        .limit(1)
        .maybeSingle(),
    ]);
    if (byNom.data || byEmail.data) {
      return json(
        {
          error: "Une demande est déjà en cours pour cette structure ou cette adresse e-mail. SportVision reviendra vers vous prochainement.",
          duplicate: true,
        },
        409,
      );
    }

    const { data: created, error: insErr } = await admin
      .from("connect_clubplus_signup_requests")
      .insert({
        organization_type: orgType,
        club_nom: String(club_nom).trim(),
        structure_type: STRUCTURE_TYPE_RELEVANT.has(orgType) && structure_type ? String(structure_type).trim() : null,
        ville: String(ville).trim(),
        code_postal: code_postal || null,
        site_web: site_web || null,
        activite_type: orgType === "coach" && activite_type ? String(activite_type).trim() : null,
        activite_type_autre: orgType === "coach" && activite_type === "Autre" ? String(activite_type_autre).trim() : null,
        exerce_sous_propre_nom: orgType === "coach" ? !!exerce_sous_propre_nom : false,
        nom_evenement_principal: orgType === "tournoi" && nom_evenement_principal ? String(nom_evenement_principal).trim() : null,
        contact_prenom: String(contact_prenom).trim(),
        contact_nom: String(contact_nom).trim(),
        contact_email: String(contact_email).trim(),
        contact_telephone: String(contact_telephone).trim(),
        fonction,
        fonction_autre: fonction === "Autre" ? String(fonction_autre).trim() : null,
        besoins,
        besoin_autre_precision: besoin_autre_precision || null,
        certification_acceptee: true,
        certification_acceptee_le: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (insErr) return json({ error: insErr.message }, 500);

    // Notifie le staff avec un vrai lien d'action (p_clubplus_signup_request_id).
    // Best-effort : un échec de notification ne doit jamais faire échouer
    // une demande par ailleurs valide, mais on log pour diagnostiquer.
    try {
      await admin.rpc("notify_staff_by_role", {
        p_roles: ["admin", "sec", "com"],
        p_titre: `Nouvelle demande d'ouverture Club+ — ${String(club_nom).trim()}`,
        p_message: `${String(contact_prenom).trim()} ${String(contact_nom).trim()} (${fonction === "Autre" ? fonction_autre : fonction}) demande l'ouverture d'un espace Club+ (${orgType}) pour « ${String(club_nom).trim()} » (${String(ville).trim()}). Contact : ${contact_email} · ${contact_telephone}.`,
        p_priorite: "normale",
        p_prestation_id: null,
        p_client_id: null,
        p_clubplus_signup_request_id: created.id,
      });
    } catch (_e) {
      console.error("[connect-club-signup-request] notify_staff_by_role a échoué :", _e);
    }

    return json({ request_id: created.id });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
