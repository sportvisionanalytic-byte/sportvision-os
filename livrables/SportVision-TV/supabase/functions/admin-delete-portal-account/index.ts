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
// Depuis le 10/09/2026, tout passe par supprimer_compte_client (voir plus bas) : la migration
// migration-decisions-connect-v1-suppression-compte-client.sql doit être exécutée AVANT de déployer
// cette version, sinon la fonction répond une erreur et ne supprime rien.
// Deploy : bash livrables/SportVision-TV/scripts/deployer-fonction.sh admin-delete-portal-account
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
    // `actif` lu aussi : un Admin désactivé garde un jeton valable jusqu'à une heure, et ce
    // contrôle-ci ne passe pas par la base (clé service) — is_staff() n'y aurait rien vu.
    const { data: profile } = await admin
      .from("profiles")
      .select("role, actif")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (profile?.role !== "admin" || profile?.actif === false) {
      return json({ error: "Réservé aux administrateurs SportVision." }, 403);
    }

    // Décision du 10/09/2026 (Fouka). Cette fonction supprimait N'IMPORTE QUEL compte, y compris
    // un collaborateur de l'OS ou un autre Admin SportVision, et l'appelant lui-même : l'écran ne
    // propose que des comptes Connect, mais l'identifiant vient du navigateur. Deux refus :
    //   - soi-même : un Admin qui se supprime ferme peut-être le dernier accès administrateur ;
    //   - tout compte de l'OS (une ligne profiles = un compte collaborateur, quel que soit son
    //     rôle) : un collaborateur se retire par DÉSACTIVATION, qui garde son historique
    //     (missions, rémunérations, documents) et se défait. Une suppression ne se défait pas.
    if (target_user_id === userData.user.id) {
      return json({ error: "Vous ne pouvez pas supprimer votre propre compte." }, 403);
    }
    const { data: cible } = await admin
      .from("profiles")
      .select("id")
      .eq("id", target_user_id)
      .maybeSingle();
    if (cible) {
      return json({
        error: "Ce compte est un compte collaborateur de SportVision OS : il ne se supprime pas, il se désactive (Équipe, fiche du collaborateur, Désactiver).",
      }, 403);
    }

    // 10/09/2026 (décision de Fouka) — même règle que delete-account, par la même fonction SQL
    // supprimer_compte_client (migration-decisions-connect-v1-suppression-compte-client), en une
    // seule transaction : commandes et droits conservés et détachés, fiche portant des documents
    // (factures, contrats…) conservée, fiche vide supprimée, fiche partagée avec un autre compte
    // intacte, compte d'authentification supprimé EN DERNIER. Avant, le compte partait d'abord :
    // un client ayant une commande média ne pouvait pas être supprimé, et une fiche avec facture
    // mais sans prestation ni devis était supprimée (factures détachées, contrats effacés).
    // p_anonymiser = false : ici c'est SportVision qui retire un accès, pas la personne qui exerce
    // son droit à l'effacement — sa fiche commerciale n'est pas anonymisée pour autant.
    const { data: bilan, error: suppressionErr } = await admin.rpc("supprimer_compte_client", {
      p_user_id: target_user_id,
      p_anonymiser: false,
    });
    if (suppressionErr) {
      if (suppressionErr.code === "P0001") return json({ error: suppressionErr.message }, 409);
      if (suppressionErr.code === "P0002") return json({ error: "Compte introuvable (déjà supprimé ?)." }, 404);
      console.error("[admin-delete-portal-account] supprimer_compte_client :", suppressionErr.code, suppressionErr.message);
      return json({ error: "Suppression impossible pour le moment. Rien n'a été supprimé." }, 500);
    }

    return json({ deleted: true, client_deleted: !!(bilan as { client_deleted?: boolean } | null)?.client_deleted });
  } catch (e) {
    return json({ error: ((e as { message?: string })?.message ?? String(e)) }, 500);
  }
});
