// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.
// Étape à faire à chaque édition : Supabase Dashboard → Edge Functions →
// connect-org-check-activation-token → coller ce code → Deploy.

// Supabase Edge Function — connect-org-check-activation-token
// PUBLIQUE (appelée sans session, avec la seule clé publishable) — variante
// générique de clubplus-check-activation-token (lire ce fichier d'abord :
// même raisonnement) pour l'écran d'atterrissage d'un lien d'activation
// `event`/`cm_agency` (#/org-activation?token=…).
//
// Existe uniquement parce que connect_org_activation_tokens n'a aucune policy
// de lecture publique (migration-connect-v20-event-cm-agency-org-types.sql) :
// sans cette fonction, le front devrait interroger la table en REST direct,
// ce qui permettrait à n'importe qui de lister les tokens actifs.
//
// Ne renvoie que ce qui est nécessaire à l'affichage : statut, type
// d'organisation, nom pré-rempli. Jamais le client_id associé.
//
// Deploy via Supabase dashboard > Edge Functions > New Function
// (name: connect-org-check-activation-token)
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
  // Fonction atomique (migration-audit-25-08-corrections-batch1.sql, 25/08/2026) : l'ancien
  // motif COUNT puis INSERT séparés laissait une fenêtre de course entre deux appels concurrents
  // (répété tel quel dans ~20 edge functions) — verrou transactionnel scopé à l'identifiant côté
  // Postgres, plus de race condition possible.
  const { data, error } = await admin.rpc("check_and_record_rate_limit", {
    p_identifiant: identifiant,
    p_max: RATE_LIMIT_MAX,
    p_window_seconds: RATE_LIMIT_WINDOW_MS / 1000,
  });
  if (error) return false;
  return data === true;
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
    const rateOk = await checkRateLimit(admin, `orgactchk:${ip}`);
    if (!rateOk) {
      return json({ error: "Trop de vérifications récentes. Merci de réessayer plus tard." }, 429);
    }

    if (!token) return json({ status: "invalid" });

    const { data: row } = await admin
      .from("connect_org_activation_tokens")
      .select("organization_type, nom_prefill, expires_at, used_at, revoked_at")
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
      organization_type: row.organization_type,
      nom_prefill: row.nom_prefill || "",
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
