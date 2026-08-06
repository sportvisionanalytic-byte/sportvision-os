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
    return new Response(`Signature invalide : ${err instanceof Error ? err.message : String(err)}`, { status: 400 });
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
      // Un projet collectif (team_project_contributions, migration-clubplus-v21.sql)
      // utilise aussi client_reference_id (même convention que paiement_id ci-dessous),
      // d'où le branchement explicite sur contribution_id AVANT le repli sur
      // client_reference_id : sans ça, une contribution serait interprétée à tort
      // comme un paiement_id Portail.
      const contributionId = (session.metadata?.contribution_id as string) || null;
      const paiementId = contributionId ? null : ((session.metadata?.paiement_id as string) || (session.client_reference_id as string) || null);

      if (contributionId) {
        const { data: contribution } = await admin
          .from("team_project_contributions")
          .select("id, project_id, montant, statut")
          .eq("id", contributionId)
          .maybeSingle();

        if (contribution && contribution.statut !== "paye") {
          await admin
            .from("team_project_contributions")
            .update({ statut: "paye", stripe_payment_intent_id: session.payment_intent as string })
            .eq("id", contributionId);
          // team_projects.montant_collecte et le passage à 'objectif_atteint' se
          // recalculent automatiquement via le trigger trg_tpc_recompute (v21).
          await admin.from("team_project_events").insert({
            project_id: contribution.project_id,
            event_type: "contribution_payee",
            note: `${contribution.montant} € reçus via Stripe`,
          });
        }
      }

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
            const { data: prestation } = await admin
              .from("prestations")
              .update(updates)
              .eq("id", paiement.prestation_id)
              .select("reference")
              .maybeSingle();

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

            // Notifie le staff (cloche de notifications de l'OS) — best-effort.
            try {
              const ref = prestation?.reference ? ` — ${prestation.reference}` : "";
              await admin.rpc("notify_staff_by_role", {
                p_roles: ["sec"],
                p_titre: `Paiement reçu${ref}`,
                p_message: "Le paiement a été confirmé via Stripe. Le dossier est financièrement à jour.",
                p_priorite: "faible",
                p_prestation_id: paiement.prestation_id,
                p_client_id: paiement.client_id,
              });
              await admin.rpc("notify_staff_by_role", {
                p_roles: ["prod"],
                p_titre: "Paiement confirmé — prestation débloquée",
                p_message:
                  (paiement.type_paiement === "acompte" ? "L'acompte est reçu." : "Le solde est réglé.") +
                  " La prestation peut être planifiée.",
                p_priorite: "normale",
                p_prestation_id: paiement.prestation_id,
                p_client_id: paiement.client_id,
              });
            } catch (_e) {
              // ignoré volontairement
            }

            // Reçu de paiement au client — best-effort, n'affecte jamais la confirmation du paiement.
            try {
              if (paiement.client_id) {
                const { data: client } = await admin.from("clients").select("email").eq("id", paiement.client_id).maybeSingle();
                if (client?.email) {
                  await sendPaymentReceiptEmail(client.email, {
                    montant: paiement.montant,
                    type_paiement: paiement.type_paiement,
                    reference: prestation?.reference || null,
                  });
                }
              }
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
      await admin.from("team_project_contributions").update({ statut: "echoue" }).eq("stripe_payment_intent_id", intent.id);
    }

    // Remboursement (manuel depuis le dashboard Stripe, ou via l'API) — jusqu'ici
    // aucun événement de remboursement n'était géré : paiements.statut,
    // prestations.statut_financier et factures.statut restaient à "payé(e)"
    // indéfiniment après un remboursement réel. Un remboursement partiel n'est
    // PAS reflété automatiquement (pas de statut intermédiaire fiable côté
    // prestation/facture) — seul le staff est notifié pour traitement manuel ;
    // un remboursement total met bien à jour tous les statuts.
    if (event.type === "charge.refunded") {
      const charge = event.data.object as Stripe.Charge;
      const intentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
      const estTotal = charge.amount_refunded >= charge.amount;

      if (intentId) {
        const { data: paiement } = await admin
          .from("paiements")
          .select("*")
          .eq("stripe_payment_intent_id", intentId)
          .maybeSingle();

        if (paiement && paiement.statut !== "rembourse") {
          if (estTotal) {
            await admin.from("paiements").update({ statut: "rembourse" }).eq("id", paiement.id);

            if (paiement.prestation_id) {
              await admin
                .from("prestations")
                .update({ statut_financier: "remboursée" })
                .eq("id", paiement.prestation_id);

              try {
                await admin
                  .from("factures")
                  .update({ statut: "remboursee" })
                  .eq("prestation_id", paiement.prestation_id)
                  .eq("type_facture", paiement.type_paiement)
                  .eq("statut", "payee");
              } catch (_e) {
                // ignoré volontairement
              }
            }
          }

          // Notifie toujours le staff, même en remboursement partiel — c'est
          // le seul filet de sécurité tant qu'il n'y a pas de reconciliation
          // automatique pour les cas partiels.
          try {
            await admin.rpc("notify_staff_by_role", {
              p_roles: ["sec", "compta"],
              p_titre: estTotal ? "Remboursement Stripe confirmé" : "Remboursement Stripe PARTIEL — vérification requise",
              p_message: estTotal
                ? `Le paiement de ${(paiement.montant || 0)} € a été intégralement remboursé. Le dossier a été mis à jour automatiquement.`
                : `Remboursement partiel détecté (${(charge.amount_refunded / 100).toFixed(2)} € sur ${(charge.amount / 100).toFixed(2)} €). Aucune mise à jour automatique du statut — à traiter manuellement.`,
              p_priorite: estTotal ? "normale" : "haute",
              p_prestation_id: paiement.prestation_id,
              p_client_id: paiement.client_id,
            });
          } catch (_e) {
            // ignoré volontairement
          }
        }
      }
    }
  } catch (e) {
    // On accuse toujours réception à Stripe (200) pour éviter des re-livraisons en boucle ;
    // l'erreur applicative reste tracée dans la réponse pour le debug via les logs Supabase.
    return new Response(JSON.stringify({ received: true, error: e instanceof Error ? e.message : String(e) }), { status: 200 });
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 });
});

async function sendPaymentReceiptEmail(
  to: string,
  info: { montant: number; type_paiement: string; reference: string | null },
) {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) return;
  const fromEmail = Deno.env.get("FROM_EMAIL") || "SportVision <onboarding@resend.dev>";
  const portalUrl = Deno.env.get("PORTAL_URL") || "https://portail.sportvision.fr";
  const montantFmt = (info.montant || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  const typeLbl = info.type_paiement === "acompte" ? "Acompte" : info.type_paiement === "solde" ? "Solde" : "Paiement total";

  const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#06111F;font-family:Arial,sans-serif;color:#F7F9FC">
  <div style="max-width:520px;margin:32px auto;background:#10243E;border-radius:14px;overflow:hidden">
    <div style="background:#0B1B33;padding:26px 32px">
      <div style="font-size:20px;font-weight:800;color:#fff">SPORTVISION</div>
      <div style="font-size:10px;color:#32D8E6;letter-spacing:.1em;margin-top:2px">PORTAIL</div>
    </div>
    <div style="padding:28px 32px">
      <p style="font-size:15px;line-height:1.6">Bonjour,</p>
      <p style="font-size:14px;line-height:1.7;color:#9DAEC3">Nous confirmons la bonne réception de votre paiement${info.reference ? " pour la prestation " + info.reference : ""}.</p>
      <div style="background:#0B1B33;border-radius:10px;padding:16px 20px;margin:18px 0">
        <div style="font-size:12px;color:#9DAEC3">${typeLbl}</div>
        <div style="font-size:22px;font-weight:800;color:#32D8E6;margin-top:4px">${montantFmt}</div>
      </div>
      <a href="${portalUrl}" style="display:inline-block;background:#168BFF;color:#fff;text-decoration:none;padding:12px 22px;border-radius:9px;font-size:14px;font-weight:700">Voir mon espace</a>
    </div>
  </div>
</body></html>`;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: fromEmail, to: [to], subject: "Confirmation de paiement — SportVision", html }),
  });
}
