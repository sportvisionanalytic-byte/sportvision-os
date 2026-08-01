// Supabase Edge Function — create-guest-request
// Permet à un visiteur d'envoyer une demande depuis le configurateur SANS créer de compte
// (TESTING.md scénario 1 : "envoi sans compte → création de compte → demande rattachée").
// Trouve-ou-crée le client par e-mail (même logique que portal-onboarding) et insère la
// prestation directement en service role (l'anonyme n'a pas de session, donc pas de RLS possible ici).
// Quand ce même visiteur crée un compte plus tard avec le même e-mail, portal-onboarding le
// rattache automatiquement au même `clients.id` : la demande apparaît alors dans son espace,
// sans logique de "réclamation" séparée à écrire.
// Deploy via Supabase dashboard > Edge Functions > New Function (name: create-guest-request)
// Secrets requis : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Anti-abus : champ honeypot ("site_web", doit rester vide, un bot le remplit
// généralement) + limite de fréquence par IP (5 demandes / heure max), via la
// table guest_rate_limits (migration-portail-v11.sql).

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

const TYPE_CLIENT_MAP: Record<string, string> = {
  club: "club",
  organisateur: "association",
  entreprise: "entreprise",
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
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const admin = createClient(supabaseUrl, serviceKey);

    const {
      prenom, nom, email, telephone, profil,
      offre_id, options, date, heure, lieu, ville, adresse, cp, commentaire, sport, equipes,
      retractation_renoncee, site_web,
    } = await req.json();

    // Honeypot : champ invisible pour un humain, rempli seulement par des bots.
    // On répond succès (sans rien écrire) pour ne pas révéler la détection.
    if (site_web) {
      return json({ reference: null, prestation_id: null, client_email: email || null });
    }

    if (!email || !prenom || !nom) {
      return json({ error: "Prénom, nom et e-mail sont requis" }, 400);
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("cf-connecting-ip") || "inconnu";
    const rateOk = await checkRateLimit(admin, `req:${ip}`);
    if (!rateOk) {
      return json({ error: "Trop de demandes envoyées récemment. Merci de réessayer plus tard." }, 429);
    }

    let clientId: string | null = null;
    const { data: matched } = await admin.from("clients").select("id").ilike("email", email).limit(1).maybeSingle();
    if (matched) {
      clientId = matched.id;
    } else {
      const typeClient = TYPE_CLIENT_MAP[profil] || "particulier";
      const nomAffichage = typeClient === "particulier" ? `${prenom} ${nom}`.trim() : nom;
      const { data: created, error: createErr } = await admin
        .from("clients")
        .insert({
          statut: "prospect",
          type_client: typeClient,
          nom: nomAffichage,
          nom_contact: nom,
          prenom_contact: prenom,
          email,
          telephone: telephone || null,
          origine_prospect: "portail",
        })
        .select("id")
        .single();
      if (createErr) return json({ error: createErr.message }, 500);
      clientId = created.id;
    }

    const adresseComplete = [adresse, cp, ville].filter(Boolean).join(", ") || null;

    const { data: prestation, error: prestationErr } = await admin
      .from("prestations")
      .insert({
        statut: "demande_reçue",
        client_id: clientId,
        offre_id: offre_id || null,
        options_selectionnees: options || [],
        date_prestation: date || null,
        heure_debut: heure || null,
        lieu: ville || null,
        adresse_complete: adresseComplete,
        sport: sport || null,
        equipes: equipes || null,
        description_besoin: commentaire || null,
        retractation_renoncee: !!retractation_renoncee,
        retractation_renoncee_at: retractation_renoncee ? new Date().toISOString() : null,
      })
      .select("id, reference")
      .single();
    if (prestationErr) return json({ error: prestationErr.message }, 500);

    return json({ reference: prestation.reference, prestation_id: prestation.id, client_email: email });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
});
