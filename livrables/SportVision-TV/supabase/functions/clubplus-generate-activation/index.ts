// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.
// Étape à faire à chaque édition : Supabase Dashboard → Edge Functions →
// clubplus-generate-activation → coller ce code → Deploy.
// Oublier cette étape est la cause la plus fréquente de "le code est bon
// mais ça ne marche pas en prod" sur ce projet (déjà arrivé sur au moins
// 5 fonctions : clubplus-billing-portal, create-clubplus-subscription-
// checkout, dispatch-notifications, create-guest-rdv, create-guest-request).

// Supabase Edge Function — clubplus-generate-activation
// Appelée par le STAFF SportVision depuis SportVision OS (fiche client du CRM) pour
// inviter un club déjà suivi commercialement — ligne `clients` existante, avec ses
// devis/prestations dans le Portail — à activer son espace Club+ pré-relié à cet
// historique, sans repasser par l'inscription self-service publique.
//
// Renvoie un lien privé à transmettre au dirigeant du club (e-mail, WhatsApp, de vive
// voix). Ce lien est un SECRET : quiconque le possède peut créer le compte admin du
// club et lire ses devis/factures/contrats Portail. Il n'est donc jamais envoyé
// automatiquement ici — le staff décide à qui il le transmet — et il expire au bout
// de 30 jours (défaut de la table, cf. migration-clubplus-v26-activation-tokens.sql).
//
// Sécurité : l'appelant doit avoir un `profiles.role` dans ('admin','sec','com')
// — vérifié en service role, jamais depuis un rôle envoyé dans le body. Le token est
// généré ici avec crypto.randomUUID() (122 bits d'aléa cryptographique), jamais côté
// client. La consommation du lien se fait dans clubplus-activate, sa vérification
// publique dans clubplus-check-activation-token.
//
// Deploy via Supabase dashboard > Edge Functions > New Function (name: clubplus-generate-activation)
// Secrets requis : SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (déjà présents par défaut)
// Secret optionnel : CONNECT_URL (même variable que clubplus-invite / clubplus-family-invite,
// même valeur par défaut — ne pas en créer une seconde)
//
// Fix du 08/08/2026 : générait un lien vers l'ancienne app Club+ séparée
// (SportVision-Club-Plus.html#/activation?token=…). Connect a maintenant son
// propre écran d'activation sur la même route de hash (#/activation?token=…,
// voir index.html : scr-activation / startActivation / handleActivation),
// portée depuis l'ancienne app le même jour — aucun changement de contrat
// avec clubplus-check-activation-token / clubplus-activate, qui restent
// inchangées.

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

const STAFF_ROLES = ["admin", "sec", "com"];
const VALID_PLANS = ["club", "performance"];

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
    const connectUrl = Deno.env.get("CONNECT_URL") || "https://connect.sportvision.fr";

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Session invalide" }, 401);
    const caller = userData.user;

    const admin = createClient(supabaseUrl, serviceKey);

    // Vérifie le rôle staff côté serveur (jamais de confiance dans le body).
    const { data: callerProfile } = await admin
      .from("profiles")
      .select("role")
      .eq("id", caller.id)
      .maybeSingle();
    if (!callerProfile || !STAFF_ROLES.includes(callerProfile.role)) {
      return json({ error: "Seul le staff SportVision peut générer un lien d'activation Club+." }, 403);
    }

    const body = await req.json();
    const clientId: string = body.client_id || "";
    const plan: string = VALID_PLANS.includes(body.plan) ? body.plan : "club";
    const clubNomPrefill: string = (body.club_nom_prefill || "").trim();

    if (!clientId) return json({ error: "Le client est obligatoire." }, 400);

    // Le client Portail doit exister — sinon le lien pointerait vers un
    // rattachement impossible, découvert seulement à l'activation.
    const { data: client } = await admin
      .from("clients")
      .select("id, nom")
      .eq("id", clientId)
      .maybeSingle();
    if (!client) return json({ error: "Client introuvable." }, 404);

    const token = crypto.randomUUID().replace(/-/g, "");

    const { data: created, error: insErr } = await admin
      .from("clubplus_activation_tokens")
      .insert({
        client_id: client.id,
        token,
        club_nom_prefill: clubNomPrefill || client.nom || null,
        plan,
        created_by: caller.id,
      })
      .select("id, expires_at")
      .single();
    if (insErr) return json({ error: insErr.message }, 500);

    const activationUrl = `${connectUrl}/#/activation?token=${token}`;

    return json({
      id: created.id,
      token,
      activation_url: activationUrl,
      expires_at: created.expires_at,
      plan,
      club_nom_prefill: clubNomPrefill || client.nom || null,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
