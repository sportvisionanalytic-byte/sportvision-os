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
// Remplace, pour orgType==='club', l'ancien chemin app-next qui appelait
// clubplus-onboarding immédiatement après l'inscription (compte Supabase Auth
// créé par le visiteur lui-même, club actif + admin posés en dur à la même
// seconde, AUCUNE validation humaine — faille corrigée par ce chantier, voir
// migration-connect-v44-club-signup-requests.sql).
//
// PUBLIQUE, comme create-guest-request : appelée SANS session (le nouveau
// tunnel /signup/club-request ne crée ni compte ni mot de passe — Fouka,
// brief du 12/08/2026 : "Je ne créerais pas immédiatement un club actif...
// une inscription publique devrait créer une 'Demande d'ouverture Connect'").
// Anti-abus par IP via guest_rate_limits, même mécanisme que
// create-guest-request / create-guest-rdv / clubplus-check-activation-token.
//
// N'ÉCRIT QUE dans connect_club_signup_requests. Ne crée RIEN d'autre —
// aucune ligne clubs / club_members / clients / auth.users. Le club réel
// n'est créé qu'à l'activation (clubplus-activate), après que le staff a
// validé la demande et choisi explicitement le rôle Connect initial du
// contact (connect-club-signup-review).
//
// Deploy via Supabase dashboard > Edge Functions > New Function (name: connect-club-signup-request)
// Secrets requis : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RATE_LIMIT_MAX = 5;
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

// Listes fermées — doivent rester strictement identiques à FONCTION_OPTIONS
// / NEEDS_OPTIONS (app-next/src/app/signup/signup-context.tsx). Validées
// aussi côté serveur : jamais confiance dans une valeur arbitraire envoyée
// par le visiteur pour des champs réaffichés ensuite tels quels au staff.
const FONCTIONS = new Set([
  "Président(e)", "Vice-président(e)", "Directeur / Directrice", "Secrétaire",
  "Trésorier / Trésorière", "Responsable communication", "Community Manager",
  "Responsable sportif / Directeur sportif", "Responsable administratif",
  "Responsable partenariat / sponsoring", "Éducateur / Éducatrice",
  "Entraîneur / Entraîneuse", "Responsable d'équipe",
  "Photographe / Vidéaste du club", "Joueur / Joueuse", "Bénévole",
  "Membre du bureau", "Autre",
]);

const BESOINS = new Set([
  "Prestations photo / vidéo", "Communication du club", "Création de visuels",
  "Full Communication", "Club+", "Couverture de matchs", "Tournoi / stage",
  "Veo / captation", "Je souhaite simplement découvrir SportVision", "Autre",
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
      // Étape 1 · Votre club
      club_nom, structure_type, ville, code_postal, site_web,
      // Étape 2 · Vous
      contact_prenom, contact_nom, contact_email, contact_telephone, fonction, fonction_autre,
      // Étape 3 · Votre besoin
      besoins, besoin_autre_precision,
      // Étape 4 · Validation
      certification_acceptee,
      // Honeypot — nom distinct de "site_web" (déjà un champ légitime ici, le
      // nom du site du club), doit rester vide, un bot le remplit en général.
      hp_champ,
    } = body;

    if (hp_champ) {
      // Réponse "succès" sans rien écrire, pour ne pas révéler la détection —
      // même logique que create-guest-request / create-guest-rdv.
      return json({ request_id: null });
    }

    if (!club_nom || !String(club_nom).trim()) return json400("Le nom du club est obligatoire.");
    if (!structure_type || !String(structure_type).trim()) return json400("Le type de structure est obligatoire.");
    if (!ville || !String(ville).trim()) return json400("La ville est obligatoire.");
    if (!contact_prenom || !String(contact_prenom).trim()) return json400("Le prénom est obligatoire.");
    if (!contact_nom || !String(contact_nom).trim()) return json400("Le nom est obligatoire.");
    if (!contact_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact_email)) return json400("Adresse e-mail invalide.");
    if (!contact_telephone || !String(contact_telephone).trim()) return json400("Le téléphone est obligatoire.");
    if (!fonction || !FONCTIONS.has(fonction)) return json400("Fonction non reconnue.");
    if (fonction === "Autre" && (!fonction_autre || !String(fonction_autre).trim())) {
      return json400("Merci de préciser votre fonction.");
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
    ].some(([val, max]) => val && String(val).length > (max as number));
    if (tooLong) return json400("Un des champs dépasse la longueur autorisée.");

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("cf-connecting-ip") || "inconnu";
    const rateOk = await checkRateLimit(admin, `ccsr:${ip}`);
    if (!rateOk) {
      return json({ error: "Trop de demandes envoyées récemment. Merci de réessayer plus tard." }, 429);
    }

    const { data: created, error: insErr } = await admin
      .from("connect_club_signup_requests")
      .insert({
        club_nom: String(club_nom).trim(),
        structure_type: String(structure_type).trim(),
        ville: String(ville).trim(),
        code_postal: code_postal || null,
        site_web: site_web || null,
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

    // Notifie le staff avec un vrai lien d'action (p_club_signup_request_id) —
    // avant, aucun écran de traitement n'existait pour ce type de demande.
    // Best-effort : un échec de notification ne doit jamais faire échouer
    // une demande par ailleurs valide, mais on log pour diagnostiquer.
    try {
      await admin.rpc("notify_staff_by_role", {
        p_roles: ["admin", "sec", "com"],
        p_titre: `Nouvelle demande d'ouverture Connect — ${String(club_nom).trim()}`,
        p_message: `${String(contact_prenom).trim()} ${String(contact_nom).trim()} (${fonction === "Autre" ? fonction_autre : fonction}) demande l'ouverture de l'espace Connect de « ${String(club_nom).trim()} » (${String(ville).trim()}). Contact : ${contact_email} · ${contact_telephone}.`,
        p_priorite: "normale",
        p_prestation_id: null,
        p_client_id: null,
        p_club_signup_request_id: created.id,
      });
    } catch (_e) {
      console.error("[connect-club-signup-request] notify_staff_by_role a échoué :", _e);
    }

    return json({ request_id: created.id });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
