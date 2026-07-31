// Supabase Edge Function — portal-onboarding
// Appelée juste après l'inscription d'un client sur SportVision Portail (Supabase Auth signUp).
// Cherche un client existant par e-mail (prospect déjà en base côté OS), sinon en crée un,
// puis crée la ligne client_users qui lie le compte auth au client.
// Deploy via Supabase dashboard > Edge Functions > New Function (name: portal-onboarding)
// Secrets requis : SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (déjà présents par défaut sur le projet)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Authentification requise" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    // Vérifie le JWT du client (aucune confiance dans un id fourni par le body)
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Session invalide" }, 401);
    const user = userData.user;

    const { prenom, nom, telephone, profil } = await req.json();

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: existing } = await admin
      .from("client_users")
      .select("id, client_id")
      .eq("id", user.id)
      .maybeSingle();
    if (existing) {
      return json({ client_id: existing.client_id, already_onboarded: true });
    }

    let clientId: string | null = null;
    if (user.email) {
      const { data: matched } = await admin
        .from("clients")
        .select("id")
        .ilike("email", user.email)
        .limit(1)
        .maybeSingle();
      if (matched) clientId = matched.id;
    }

    if (!clientId) {
      const typeClient = TYPE_CLIENT_MAP[profil] || "particulier";
      const nomAffichage =
        typeClient === "particulier"
          ? `${prenom || ""} ${nom || ""}`.trim() || "Client Portail"
          : nom || prenom || "Client Portail";

      const { data: created, error: createErr } = await admin
        .from("clients")
        .insert({
          statut: "prospect",
          type_client: typeClient,
          nom: nomAffichage,
          nom_contact: nom || null,
          prenom_contact: prenom || null,
          email: user.email,
          telephone: telephone || null,
          origine_prospect: "portail",
        })
        .select("id")
        .single();
      if (createErr) return json({ error: createErr.message }, 500);
      clientId = created.id;
    }

    const { error: cuErr } = await admin.from("client_users").insert({
      id: user.id,
      client_id: clientId,
      prenom: prenom || null,
      nom: nom || null,
      telephone: telephone || null,
    });
    if (cuErr) return json({ error: cuErr.message }, 500);

    return json({ client_id: clientId, already_onboarded: false });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
});
