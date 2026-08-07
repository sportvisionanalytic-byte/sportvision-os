// Supabase Edge Function — create-guest-rdv
// Permet à un visiteur de prendre rendez-vous SANS créer de compte, comme dans le
// parcours de la maquette de référence (prendre rendez-vous est une étape avant
// engagement, ne doit pas obliger à créer un compte). Même logique de recherche/
// création du client par e-mail que create-guest-request.
// Deploy via Supabase dashboard > Edge Functions > New Function (name: create-guest-rdv)
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

    const { prenom, nom, email, telephone, profil, type_rdv, objet, date_demandee, heure_demandee, site_web } = await req.json();

    // Honeypot : champ invisible pour un humain, rempli seulement par des bots.
    // On répond succès (sans rien écrire) pour ne pas révéler la détection.
    if (site_web) {
      return json({ rdv_id: null, client_email: email || null });
    }

    if (!email || !prenom || !nom || !date_demandee) {
      return json({ error: "Prénom, nom, e-mail et date sont requis" }, 400);
    }
    if (!["appel", "physique"].includes(type_rdv)) {
      return json({ error: "Type de rendez-vous invalide" }, 400);
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("cf-connecting-ip") || "inconnu";
    const rateOk = await checkRateLimit(admin, `rdv:${ip}`);
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
          origine_prospect: "connect",
        })
        .select("id")
        .single();
      if (createErr) return json({ error: createErr.message }, 500);
      clientId = created.id;
    }

    const { data: rdv, error: rdvErr } = await admin
      .from("rendez_vous")
      .insert({
        client_id: clientId,
        type_rdv,
        objet: objet || null,
        date_demandee,
        heure_demandee: heure_demandee || null,
        statut: "a_confirmer",
      })
      .select("id")
      .single();
    if (rdvErr) return json({ error: rdvErr.message }, 500);

    return json({ rdv_id: rdv.id, client_email: email });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
});
