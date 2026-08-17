// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.
// Étape à faire à chaque édition : Supabase Dashboard → Edge Functions →
// connect-org-signup → coller ce code → Deploy.

// Supabase Edge Function — connect-org-signup
//
// ⚠️  DÉPRÉCIÉE ET DÉSACTIVÉE (17/08/2026). SIGNUP-UNIFIE-MASTER-PROMPT.md
// (+ décision d'architecture en bas du fichier) : "aucune structure ne doit
// être créée sans vérification SportVision". Cette fonction créait une
// organisation ACTIVE + un membership admin immédiatement après un simple
// auth.signUp() côté client, pour 'coach'/'academie', sans aucune validation
// staff — exactement le comportement que ce chantier élimine (voir
// migration-connect-v78-signup-unifie-clubplus.sql).
//
// Remplacée par le tunnel unifié `/signup/club-request/*` :
// connect-club-signup-request (dépôt de la demande, aucune création) →
// validation staff via connect-club-signup-review → connect-org-activate
// crée réellement organizations+memberships, mais SEULEMENT à l'activation
// du lien envoyé par le staff après validation, jamais avant.
//
// L'implémentation d'origine (résolution du rôle admin depuis
// organization_role_catalog, création directe de `organizations` avec un id
// généré, pont best-effort vers `clients`/client_users pour Séances/Stages)
// est conservée dans l'historique git de ce fichier — retirée d'ici plutôt
// que laissée en code mort inatteignable, pour ne pas fausser la vérification
// `deno check`/le typage de ce fichier avec du code jamais exécuté. Retour
// 410 systématique ci-dessous, quel que soit le body envoyé.
//
// Laissée en place (plutôt que supprimée du repo) pour ne pas casser un
// déploiement Supabase existant qui pointerait encore vers cette fonction le
// temps que le frontend retire ses derniers appels
// (src/lib/signup/pending-onboarding.ts, périmètre du prochain agent —
// signup/checkout/page.tsx est le seul appelant réel).
//
// Deploy via Supabase dashboard > Edge Functions > connect-org-signup > coller ce code > Deploy

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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

serve((req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  return json({
    error: "L'inscription en libre-service n'est plus disponible. Toute ouverture d'espace Club+ passe désormais par une demande transmise à SportVision — voir /signup/club-request.",
    redirect: "/signup/club-request",
  }, 410);
});
