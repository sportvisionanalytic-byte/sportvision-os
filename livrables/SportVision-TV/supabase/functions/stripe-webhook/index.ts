// Supabase Edge Function — stripe-webhook
// Reçoit les événements Stripe (checkout.session.completed, payment_intent.payment_failed),
// vérifie la signature, met à jour `paiements` puis `prestations`. Idempotent via `stripe_events`.
// Deploy via Supabase dashboard > Edge Functions > New Function (name: stripe-webhook)
// IMPORTANT : décocher "Verify JWT" pour cette fonction dans les settings (Stripe n'envoie pas de JWT Supabase).
// Secrets requis : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

const cryptoProvider = Stripe.createSubtleCryptoProvider();

serve(async (req) => {
  const signature = req.headers.get("Stripe-Signature");
  const body = await req.text();
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";

  let event: Stripe.Event;
  try {
    if (!signature || !webhookSecret) throw new Error("Signature ou secret manquant");
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret, undefined, cryptoProvider);
  } catch (err) {
    return new Response(`Signature invalide : ${err.message}`, { status: 400 });
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

  const { data: already } = await admin.from("stripe_events").select("id").eq("id", event.id).maybeSingle();
  if (already) {
    return new Response(JSON.stringify({ received: true, duplicate: true }), { status: 200 });
  }
  await admin.from("stripe_events").insert({ id: event.id, type: event.type });

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const paiementId = (session.metadata?.paiement_id as string) || (session.client_reference_id as string) || null;

      if (paiementId) {
        const { data: paiement } = await admin.from("paiements").select("*").eq("id", paiementId).maybeSingle();

        if (paiement && paiement.statut !== "reussi") {
          await admin
            .from("paiements")
            .update({
              statut: "reussi",
              stripe_payment_intent_id: session.payment_intent as string,
            })
            .eq("id", paiementId);

          if (paiement.prestation_id) {
            const updates: Record<string, unknown> = {};
            if (paiement.type_paiement === "acompte") {
              updates.acompte_recu = true;
              updates.acompte_date = new Date().toISOString().slice(0, 10);
              updates.statut_financier = "partiellement_payée";
            } else {
              updates.statut_financier = "payée";
            }
            await admin.from("prestations").update(updates).eq("id", paiement.prestation_id);

            // Best-effort : si une facture (générée côté OS) correspond à ce paiement,
            // la marquer payée aussi. Ne bloque jamais la confirmation du paiement en cas d'échec.
            try {
              await admin
                .from("factures")
                .update({ statut: "payee" })
                .eq("prestation_id", paiement.prestation_id)
                .eq("type_facture", paiement.type_paiement)
                .in("statut", ["brouillon", "emise"]);
            } catch (_e) {
              // ignoré volontairement
            }
          }

          await admin.from("document_events").insert({
            event_type: "paiement",
            document_ref: paiementId,
            document_type: "paiement",
            description: `Paiement ${paiement.type_paiement} de ${paiement.montant} € reçu via Stripe`,
          });
        }
      }
    }

    if (event.type === "payment_intent.payment_failed") {
      const intent = event.data.object as Stripe.PaymentIntent;
      await admin.from("paiements").update({ statut: "echoue" }).eq("stripe_payment_intent_id", intent.id);
    }
  } catch (e) {
    // On accuse toujours réception à Stripe (200) pour éviter des re-livraisons en boucle ;
    // l'erreur applicative reste tracée dans la réponse pour le debug via les logs Supabase.
    return new Response(JSON.stringify({ received: true, error: e.message }), { status: 200 });
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 });
});
