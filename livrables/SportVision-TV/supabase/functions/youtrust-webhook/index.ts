// Supabase Edge Function — youtrust-webhook
// Reçoit les événements Youtrust (signature_request.done / declined / expired),
// vérifie la signature HMAC-SHA256, et met à jour devis/contrats en conséquence.
// C'est ce webhook qui remplace le "je confirme avoir signé" auto-déclaré par
// le client : la confirmation vient directement de Youtrust.
// Deploy via Supabase dashboard > Edge Functions > New Function (name: youtrust-webhook)
// IMPORTANT : décocher "Verify JWT" pour cette fonction (Youtrust n'envoie pas de JWT Supabase).
// Secrets requis : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, YOUTRUST_WEBHOOK_SECRET
//
// Configuration côté Youtrust : Dashboard > Webhooks > New webhook subscription,
// URL = <SUPABASE_URL>/functions/v1/youtrust-webhook, événements à cocher :
// signature_request.done, signature_request.declined, signature_request.expired.
// Le secret affiché à la création du webhook est celui à mettre dans YOUTRUST_WEBHOOK_SECRET.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifySignature(rawBody: string, secret: string, header: string | null): Promise<boolean> {
  if (!header || !secret) return false;
  const expected = header.startsWith("sha256=") ? header.slice(7) : header;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const computed = toHex(sig);
  if (computed.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

serve(async (req) => {
  const rawBody = await req.text();
  const secret = Deno.env.get("YOUTRUST_WEBHOOK_SECRET") ?? "";
  const signatureHeader = req.headers.get("x-yousign-signature-256");

  const valid = await verifySignature(rawBody, secret, signatureHeader).catch(() => false);
  if (!valid) {
    return new Response(JSON.stringify({ error: "Signature invalide" }), { status: 401 });
  }

  try {
    const event = JSON.parse(rawBody);
    const eventType: string = event.event_name || event.type || "";
    const signatureRequestId: string | undefined =
      event.data?.signature_request?.id || event.data?.id;

    if (!signatureRequestId) {
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Idempotence : Youtrust ne garantit pas une livraison unique (retries en
    // cas de timeout). Certains événements n'ont pas d'`id` de niveau événement
    // distinct du signature_request — on retombe alors sur une clé composée
    // stable, qui reste unique par (type d'événement, demande de signature).
    const eventId: string = event.id || event.event_id || `${eventType}:${signatureRequestId}`;
    const { data: already } = await admin.from("youtrust_events").select("id").eq("id", eventId).maybeSingle();
    if (already) {
      return new Response(JSON.stringify({ received: true, duplicate: true }), { status: 200 });
    }
    await admin.from("youtrust_events").insert({ id: eventId, type: eventType });

    const statutMap: Record<string, string> = {
      "signature_request.done": "signee",
      "signature_request.declined": "refusee",
      "signature_request.expired": "refusee",
    };
    const nouveauStatut = statutMap[eventType];
    if (!nouveauStatut) {
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }

    for (const table of ["devis", "contrats"] as const) {
      const { data: rows } = await admin
        .from(table)
        .select("id")
        .eq("youtrust_signature_request_id", signatureRequestId)
        .limit(1);
      if (rows && rows[0]) {
        const patch: Record<string, unknown> = { signature_statut: nouveauStatut };
        if (nouveauStatut === "signee") {
          patch.signature_confirmee_at = new Date().toISOString();
          patch.statut = table === "devis" ? "accepté" : "actif";
        }
        await admin.from(table).update(patch).eq("id", rows[0].id);
        break;
      }
    }

    return new Response(JSON.stringify({ received: true }), { status: 200 });
  } catch (e) {
    // On accuse toujours réception pour éviter les re-livraisons en boucle ;
    // l'erreur reste tracée dans la réponse pour le debug via les logs Supabase.
    return new Response(JSON.stringify({ received: true, error: e.message }), { status: 200 });
  }
});
