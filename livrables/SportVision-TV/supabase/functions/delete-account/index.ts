// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.
// Étape à faire à chaque édition : Supabase Dashboard → Edge Functions →
// delete-account → coller ce code → Deploy.
// Oublier cette étape est la cause la plus fréquente de "le code est bon
// mais ça ne marche pas en prod" sur ce projet (déjà arrivé sur au moins
// 5 fonctions : clubplus-billing-portal, create-clubplus-subscription-
// checkout, dispatch-notifications, create-guest-rdv, create-guest-request).

// Supabase Edge Function — delete-account
// Permet à un client connecté de supprimer lui-même son compte.
//
// 10/09/2026 (décision de Fouka) — la suppression d'un compte CLIENT passe entièrement par la
// fonction SQL supprimer_compte_client (migration-decisions-connect-v1-suppression-compte-client),
// en une seule transaction :
//   • les commandes média et les droits d'accès sont CONSERVÉS, détachés du compte ;
//   • factures, avoirs, paiements, contrats, devis, prestations : la fiche client qui les porte est
//     conservée (obligation comptable, 10 ans), et anonymisée si c'est une fiche de particulier ;
//   • une fiche sans aucun document est supprimée ; une fiche partagée avec un autre compte n'est
//     pas touchée ;
//   • le compte d'authentification est supprimé EN DERNIER. Si une étape échoue, rien n'a changé.
// Avant, ce fichier supprimait le compte PUIS tentait la fiche : un client ayant une commande média
// ne pouvait pas être supprimé (clé étrangère vers auth.users, « Database error deleting user »), et
// une fiche avec facture mais sans prestation ni devis perdait le lien de sa facture et ses contrats.
//
// Aujourd'hui (10/09/2026), aucune application déployée n'appelle cette fonction : Connect n'a pas
// d'écran de suppression de compte, et l'ancien Portail qui l'appelait n'est plus en ligne. Côté
// staff, l'OS supprime un accès client par admin-delete-portal-account, qui suit la même règle.
//
// Secrets requis : SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (déjà présents par défaut)
// Prérequis : la migration ci-dessus exécutée. Sans elle, la fonction répond une erreur et ne
// supprime rien.

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

    // ── Compte CLIENT (10/09/2026) ────────────────────────────────────────────────────────────
    // Le compte supprimé est TOUJOURS celui du jeton vérifié ci-dessus, jamais un identifiant reçu
    // dans le corps de la requête. p_anonymiser : c'est la personne elle-même qui demande à partir.
    // supprimer_compte_client refuse aussi, par précaution, un compte de l'équipe SportVision
    // (mêmes critères que is_staff()) et un compte qui porte l'activité d'un club.
    const { data: bilan, error: suppressionErr } = await admin.rpc("supprimer_compte_client", {
      p_user_id: userData.user.id,
      p_anonymiser: true,
    });
    if (suppressionErr) {
      // P0001 : refus lisible écrit pour la personne (voir la fonction SQL). Tout le reste est un
      // incident : le détail reste dans les journaux, la personne sait seulement que rien n'a bougé.
      if (suppressionErr.code === "P0001") return json({ error: suppressionErr.message }, 409);
      console.error("[delete-account] supprimer_compte_client :", suppressionErr.code, suppressionErr.message);
      return json({ error: "La suppression n'a pas pu aboutir. Rien n'a été supprimé : réessayez plus tard ou écrivez-nous." }, 500);
    }

    return json({ deleted: true, client_deleted: !!(bilan as { client_deleted?: boolean } | null)?.client_deleted });
  } catch (e) {
    return json({ error: ((e as { message?: string })?.message ?? String(e)) }, 500);
  }
});
