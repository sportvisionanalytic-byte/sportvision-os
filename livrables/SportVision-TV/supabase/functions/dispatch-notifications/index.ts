// Supabase Edge Function — dispatch-notifications
// Le "worker" du Communication Hub (voir migration-communication-hub.sql).
// Remplace Redis/BullMQ par une file persistante en base (notification_outbox)
// + un appel périodique via pg_cron : suffisant pour le volume d'une TPE,
// sans coût ni service supplémentaire à opérer.
//
// Rôle : prendre les lignes PENDING/QUEUED dont next_attempt_at est passé,
// rendre le template versionné avec les variables du payload, envoyer via le
// fournisseur transactionnel (Brevo), et tracer chaque tentative.
//
// Sécurité : appelée uniquement par pg_cron, avec un header Authorization
// portant un secret partagé dédié (migration-connect-v11), vérifié ci-dessous
// contre DISPATCH_NOTIFICATIONS_SECRET — jamais depuis le navigateur. Avant
// le 2026-08-06, ce contrôle était uniquement décrit en commentaire mais
// jamais réellement vérifié par le code : n'importe quel appelant pouvait
// déclencher le traitement de la file à volonté.
//
// Secrets requis (Supabase → Edge Functions → dispatch-notifications → Secrets) :
//   BREVO_API_KEY, FROM_EMAIL (ex: "SportVision <notifications@sportvision.fr>"),
//   DISPATCH_NOTIFICATIONS_SECRET (même valeur que le secret Vault
//   "dispatch_notifications_key" créé par migration-connect-v11)
// Tant que BREVO_API_KEY n'est pas configurée, la fonction renvoie une erreur
// claire par ligne au lieu d'échouer en silence ou de deviner un comportement.
//
// Préférences (migration-clubplus-v28) : avant d'envoyer une notification de
// catégorie non obligatoire (ni mandatory=true, ni SECURITY/LEGAL/BILLING —
// ces 3 catégories restent toujours envoyées, quelle que soit la préférence
// enregistrée), on vérifie notification_preferences pour le destinataire ;
// si désactivée, la ligne est marquée SKIPPED_PREFERENCE au lieu d'être
// envoyée ou laissée PENDING indéfiniment.
//
// Heures calmes (migration-clubplus-v29) : même règle de non-désactivabilité
// que ci-dessus — s'applique uniquement aux catégories déjà soumises aux
// préférences, jamais à SECURITY/LEGAL/BILLING ni aux templates mandatory.
// Hors de la plage notification_quiet_hours.not_before/not_after (heure de
// Paris), ou le dimanche si sunday_urgent_only, la ligne n'est PAS marquée
// en échec : on repousse next_attempt_at de 30 minutes et on la laisse
// PENDING, pour qu'elle soit réévaluée au prochain passage du cron plutôt
// que de calculer précisément le prochain instant autorisé (plus simple,
// et sans piège de fuseau horaire à l'approche de minuit).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MAX_ATTEMPTS = 5;
const BACKOFF_MINUTES = [1, 5, 15, 60, 360]; // 1min,5min,15min,1h,6h — section 15.2 du cahier des charges

function renderTemplate(str: string | null | undefined, vars: Record<string, unknown>): string {
  if (!str) return "";
  return str.replace(/\{\{(\w+)\}\}/g, (_, key) => (vars[key] !== undefined && vars[key] !== null ? String(vars[key]) : ""));
}

async function sendViaBrevo(
  brevoApiKey: string,
  fromEmail: string,
  to: string,
  subject: string,
  html: string,
): Promise<{ ok: boolean; providerMessageId?: string; error?: string }> {
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": brevoApiKey,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({
      sender: parseFromHeader(fromEmail),
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: data.message || `Brevo HTTP ${res.status}` };
  }
  return { ok: true, providerMessageId: data.messageId };
}

function parseFromHeader(fromEmail: string): { email: string; name?: string } {
  // Accepte "Nom <adresse@domaine>" ou juste "adresse@domaine"
  const m = fromEmail.match(/^(.*)<(.+)>$/);
  if (m) return { name: m[1].trim(), email: m[2].trim() };
  return { email: fromEmail.trim() };
}

// Heure et jour de la semaine à Paris, pour la comparaison aux heures calmes
// (notification_quiet_hours). Le "HH:MM" est comparable lexicographiquement
// à not_before/not_after, tous deux zéro-paddés.
function parisNow(): { hm: string; isSunday: boolean } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  return { hm: get("hour") + ":" + get("minute"), isSunday: get("weekday") === "Sun" };
}

serve(async (req) => {
  try {
    const expectedSecret = Deno.env.get("DISPATCH_NOTIFICATIONS_SECRET") ?? "";
    const authHeader = req.headers.get("Authorization") ?? "";
    const providedSecret = authHeader.replace(/^Bearer\s+/i, "");
    if (!expectedSecret || providedSecret !== expectedSecret) {
      return new Response(JSON.stringify({ error: "Non autorisé" }), { status: 401 });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const brevoApiKey = Deno.env.get("BREVO_API_KEY");
    const fromEmail = Deno.env.get("FROM_EMAIL") || "SportVision <notifications@sportvision.fr>";
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: batch, error: batchErr } = await admin
      .from("notification_outbox")
      .select("*")
      .in("status", ["PENDING", "QUEUED"])
      .lte("next_attempt_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(20);

    if (batchErr) return new Response(JSON.stringify({ error: batchErr.message }), { status: 500 });
    if (!batch || !batch.length) return new Response(JSON.stringify({ processed: 0 }), { status: 200 });

    let processed = 0;
    for (const row of batch) {
      processed++;
      const attemptNumber = (row.attempt_count || 0) + 1;

      if (row.channel !== "EMAIL") {
        // WhatsApp/IN_APP : pas encore de connecteur actif (P1) — on ne bloque pas la file,
        // on annule proprement plutôt que de retenter indéfiniment un canal non branché.
        await admin.from("notification_outbox").update({
          status: "CANCELLED", last_error: "Canal " + row.channel + " pas encore connecté (P1)", updated_at: new Date().toISOString(),
        }).eq("id", row.id);
        continue;
      }

      if (!brevoApiKey) {
        await admin.from("notification_attempts").insert({
          outbox_id: row.id, attempt_number: attemptNumber, status: "FAILED",
          error: "BREVO_API_KEY non configurée dans les secrets de la fonction dispatch-notifications.",
        });
        await admin.from("notification_outbox").update({
          status: "FAILED", attempt_count: attemptNumber,
          last_error: "BREVO_API_KEY non configurée.", updated_at: new Date().toISOString(),
        }).eq("id", row.id);
        continue;
      }

      const { data: tv } = await admin
        .from("communication_template_versions")
        .select("*, communication_templates!inner(template_key,category,mandatory)")
        .eq("communication_templates.template_key", row.template_key)
        .lte("active_from", new Date().toISOString())
        .or("active_to.is.null,active_to.gt." + new Date().toISOString())
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!tv) {
        await admin.from("notification_outbox").update({
          status: "FAILED", attempt_count: attemptNumber,
          last_error: "Aucune version active du template " + row.template_key, updated_at: new Date().toISOString(),
        }).eq("id", row.id);
        continue;
      }

      const vars = row.payload_json || {};
      const subject = renderTemplate(tv.subject_template, vars);
      const html = renderTemplate(tv.body_html_template, vars);
      const to = row.recipient_email;

      if (!to) {
        await admin.from("notification_outbox").update({
          status: "FAILED", attempt_count: attemptNumber,
          last_error: "Aucun destinataire e-mail résolu.", updated_at: new Date().toISOString(),
        }).eq("id", row.id);
        continue;
      }

      // Suppression list (bounces / désinscriptions) : ne jamais envoyer, même en retry.
      const { data: suppressed } = await admin
        .from("communication_suppressions")
        .select("id")
        .eq("channel", "EMAIL")
        .eq("address", to.toLowerCase())
        .maybeSingle();
      if (suppressed) {
        await admin.from("notification_outbox").update({
          status: "SUPPRESSED", updated_at: new Date().toISOString(),
        }).eq("id", row.id);
        continue;
      }

      // Centre de préférences (Club+, migration-clubplus-v28) : une notification de
      // catégorie non obligatoire (ni mandatory=true côté template, ni catégorie
      // SECURITY/LEGAL/BILLING — celles-là ne sont jamais désactivables, quelle que
      // soit la préférence enregistrée) est ignorée si le destinataire a coupé
      // l'e-mail pour cette catégorie. On la marque SKIPPED_PREFERENCE plutôt que de
      // la laisser PENDING indéfiniment ou de la traiter comme un échec.
      const templateMeta = tv.communication_templates;
      const category = templateMeta && templateMeta.category;
      const mandatory = !!(templateMeta && templateMeta.mandatory);
      const nonDisablableCategories = ["SECURITY", "LEGAL", "BILLING"];
      const preferenceApplies = !mandatory && !!category && !nonDisablableCategories.includes(category) && !!row.recipient_user_id;
      if (preferenceApplies) {
        const { data: pref } = await admin
          .from("notification_preferences")
          .select("email_enabled")
          .eq("user_id", row.recipient_user_id)
          .eq("category", category)
          .maybeSingle();
        if (pref && pref.email_enabled === false) {
          await admin.from("notification_outbox").update({
            status: "SKIPPED_PREFERENCE",
            last_error: "Catégorie " + category + " désactivée par le destinataire (notification_preferences).",
            updated_at: new Date().toISOString(),
          }).eq("id", row.id);
          continue;
        }

        const { data: qh } = await admin
          .from("notification_quiet_hours")
          .select("not_before,not_after,sunday_urgent_only")
          .eq("user_id", row.recipient_user_id)
          .maybeSingle();
        const notBefore = (qh?.not_before || "08:00:00").slice(0, 5);
        const notAfter = (qh?.not_after || "21:00:00").slice(0, 5);
        const sundayUrgentOnly = qh ? qh.sunday_urgent_only !== false : true;
        const { hm, isSunday } = parisNow();
        const outsideWindow = hm < notBefore || hm >= notAfter;
        const sundayBlocked = isSunday && sundayUrgentOnly;
        if (outsideWindow || sundayBlocked) {
          await admin.from("notification_outbox").update({
            next_attempt_at: new Date(Date.now() + 30 * 60000).toISOString(),
            updated_at: new Date().toISOString(),
          }).eq("id", row.id);
          continue;
        }
      }

      const result = await sendViaBrevo(brevoApiKey, fromEmail, to, subject, html);

      if (result.ok) {
        await admin.from("notification_attempts").insert({
          outbox_id: row.id, attempt_number: attemptNumber, status: "SENT",
        });
        await admin.from("notification_outbox").update({
          status: "SENT", attempt_count: attemptNumber, provider: "brevo",
          provider_message_id: result.providerMessageId || null, updated_at: new Date().toISOString(),
        }).eq("id", row.id);
        await admin.from("communication_audit_logs").insert({
          event_type: row.event_type, entity_type: row.entity_type, entity_id: row.entity_id,
          outbox_id: row.id, detail: "Envoyé via Brevo à " + to,
        });
      } else {
        const isFinal = attemptNumber >= MAX_ATTEMPTS;
        const backoffMin = BACKOFF_MINUTES[Math.min(attemptNumber - 1, BACKOFF_MINUTES.length - 1)];
        await admin.from("notification_attempts").insert({
          outbox_id: row.id, attempt_number: attemptNumber, status: isFinal ? "FAILED" : "DEFERRED", error: result.error,
        });
        await admin.from("notification_outbox").update({
          status: isFinal ? "FAILED" : "PENDING",
          attempt_count: attemptNumber,
          next_attempt_at: isFinal ? null : new Date(Date.now() + backoffMin * 60000).toISOString(),
          last_error: result.error,
          updated_at: new Date().toISOString(),
        }).eq("id", row.id);
      }
    }

    return new Response(JSON.stringify({ processed }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500 });
  }
});
