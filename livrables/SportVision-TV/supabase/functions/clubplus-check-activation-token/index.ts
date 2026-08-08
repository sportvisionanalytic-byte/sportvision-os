// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.
// Étape à faire à chaque édition : Supabase Dashboard → Edge Functions →
// clubplus-check-activation-token → coller ce code → Deploy.
// Oublier cette étape est la cause la plus fréquente de "le code est bon
// mais ça ne marche pas en prod" sur ce projet (déjà arrivé sur au moins
// 5 fonctions : clubplus-billing-portal, create-clubplus-subscription-
// checkout, dispatch-notifications, create-guest-rdv, create-guest-request).

// Supabase Edge Function — clubplus-check-activation-token
// PUBLIQUE (appelée sans session, avec la seule clé publishable) : c'est l'écran
// d'atterrissage d'un lien d'activation Club+ (#/activation?token=…) qui l'appelle
// pour savoir quel écran afficher — formulaire d'activation, lien expiré, lien déjà
// utilisé, offre retirée, ou lien invalide.
//
// Existe uniquement parce que la table clubplus_activation_tokens n'a AUCUNE policy
// de lecture publique (cf. migration-clubplus-v26-activation-tokens.sql) : sans cette
// fonction, le front devrait interroger la table en REST direct avec la clé
// publishable, ce qui permettrait à n'importe qui de lister les tokens actifs et
// d'activer le compte Club+ d'un club à sa place.
//
// Ne renvoie donc QUE ce qui est nécessaire à l'affichage : le statut et le nom de
// club pré-rempli (choisi par le staff, pas une donnée personnelle), plus la formule
// proposée. Jamais l'e-mail, l'identité ni l'id du client Portail associé — le
// rattachement est fait plus tard côté serveur par clubplus-activate, à partir du
// token, sans que le navigateur ait besoin de connaître le client.
//
// Anti-abus : limite de fréquence par IP via la table guest_rate_limits
// (migration-portail-v11.sql), comme create-guest-request et check-disponibilite.
// Un token fait 122 bits d'aléa, donc le forçage brut est de toute façon hors de
// portée ; la limite protège surtout contre le bruit et l'énumération automatisée.
//
// Deploy via Supabase dashboard > Edge Functions > New Function (name: clubplus-check-activation-token)
// Secrets requis : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

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

const RATE_LIMIT_MAX = 30;
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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const admin = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const token: string = (body.token || "").trim();

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("cf-connecting-ip") || "inconnu";
    const rateOk = await checkRateLimit(admin, `actchk:${ip}`);
    if (!rateOk) {
      return json({ error: "Trop de vérifications récentes. Merci de réessayer plus tard." }, 429);
    }

    if (!token) return json({ status: "invalid" });

    const { data: row } = await admin
      .from("clubplus_activation_tokens")
      .select("club_nom_prefill, plan, expires_at, used_at, revoked_at")
      .eq("token", token)
      .maybeSingle();

    if (!row) return json({ status: "invalid" });
    if (row.revoked_at) return json({ status: "revoked" });
    if (row.used_at) return json({ status: "used" });
    if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
      return json({ status: "expired" });
    }

    return json({
      status: "valid",
      club_nom_prefill: row.club_nom_prefill || "",
      plan: row.plan || "club",
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
