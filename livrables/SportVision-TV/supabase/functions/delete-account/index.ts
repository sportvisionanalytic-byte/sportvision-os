// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.
// Étape à faire à chaque édition : Supabase Dashboard → Edge Functions →
// delete-account → coller ce code → Deploy.
// Oublier cette étape est la cause la plus fréquente de "le code est bon
// mais ça ne marche pas en prod" sur ce projet (déjà arrivé sur au moins
// 5 fonctions : clubplus-billing-portal, create-clubplus-subscription-
// checkout, dispatch-notifications, create-guest-rdv, create-guest-request).

// Supabase Edge Function — delete-account
// Permet à un client connecté de supprimer lui-même son compte Portail.
// Supprime toujours l'accès (connexion) ; supprime aussi la fiche client si, et
// seulement si, elle n'a aucun historique commercial (prestations, devis...).
// prestations.client_id et devis.client_id n'ont pas de "on delete cascade" (contrainte
// par défaut = bloquante), donc la suppression de la fiche échoue automatiquement et
// sans risque s'il existe le moindre historique — pas besoin de vérifier nous-mêmes
// chaque table liée. C'est cette contrainte SQL qui protège les obligations comptables
// (10 ans), pas une logique applicative qu'on pourrait oublier de mettre à jour.
// Deploy via Supabase dashboard > Edge Functions > New Function (name: delete-account)
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

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Session invalide" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: cu } = await admin
      .from("client_users")
      .select("client_id")
      .eq("id", userData.user.id)
      .maybeSingle();

    const { error: delErr } = await admin.auth.admin.deleteUser(userData.user.id);
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
