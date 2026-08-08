// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.
// Étape à faire à chaque édition : Supabase Dashboard → Edge Functions →
// admin-delete-portal-account → coller ce code → Deploy.
// Oublier cette étape est la cause la plus fréquente de "le code est bon
// mais ça ne marche pas en prod" sur ce projet (déjà arrivé sur au moins
// 5 fonctions : clubplus-billing-portal, create-clubplus-subscription-
// checkout, dispatch-notifications, create-guest-rdv, create-guest-request).

// Supabase Edge Function — admin-delete-portal-account
// Permet à un membre du staff avec le rôle 'admin' de supprimer le compte Portail
// d'un client, depuis SportVision OS. Même logique que delete-account (self-service) :
// supprime toujours l'accès, et supprime aussi la fiche client si elle n'a aucun
// historique commercial (prestations, devis...) — protégé par la contrainte de clé
// étrangère par défaut (bloquante) sur prestations.client_id / devis.client_id.
// Deploy via Supabase dashboard > Edge Functions > New Function (name: admin-delete-portal-account)
// Secrets requis : SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (déjà présents par défaut)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    const { target_user_id } = await req.json();
    if (!target_user_id) return json({ error: "target_user_id requis" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Session invalide" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: profile } = await admin
      .from("profiles")
      .select("role")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (profile?.role !== "admin") return json({ error: "Réservé aux administrateurs" }, 403);

    const { data: cu } = await admin
      .from("client_users")
      .select("client_id")
      .eq("id", target_user_id)
      .maybeSingle();

    const { error: delErr } = await admin.auth.admin.deleteUser(target_user_id);
    if (delErr) return json({ error: delErr.message }, 500);

    let clientDeleted = false;
    if (cu?.client_id) {
      const { error: clientDelErr } = await admin.from("clients").delete().eq("id", cu.client_id);
      // Échec attendu et normal si la fiche a un historique (prestations, devis...) :
      // la contrainte de clé étrangère bloque la suppression, on la laisse en place.
      clientDeleted = !clientDelErr;
    }

    return json({ deleted: true, client_deleted: clientDeleted });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
});
