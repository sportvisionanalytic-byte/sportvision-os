// Supabase Edge Function — stripe-webhook
// Reçoit les événements Stripe (checkout.session.completed, payment_intent.payment_failed,
// charge.refunded), vérifie la signature, met à jour `paiements` puis `prestations`.
// Idempotent via `stripe_events`.
// Deploy via Supabase dashboard > Edge Functions > New Function (name: stripe-webhook)
// IMPORTANT : décocher "Verify JWT" pour cette fonction dans les settings (Stripe n'envoie pas de JWT Supabase).
// IMPORTANT : ajouter charge.refunded aux événements écoutés côté dashboard Stripe (Webhooks).
// Secrets requis : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
//                  PENNYLANE_API_KEY (pour l'avoir automatique sur remboursement — optionnel : si
//                  absente, le remboursement est quand même resynchronisé, seul l'avoir Pennylane
//                  n'est pas créé et le staff est notifié pour le faire manuellement)
//
// Avoir Pennylane automatique (2026-08-06) : au moment d'écrire ce code, la documentation
// publique de l'API Pennylane (pennylane.readme.io) ne confirme PAS explicitement le mécanisme
// exact de création d'un avoir via POST /customer_invoices (aucun champ "type"/"is_credit_note"
// documenté) — seul le rapprochement via POST /customer_invoices/{id}/link_credit_note est
// clairement documenté. L'implémentation ci-dessous crée un document via le même endpoint que
// send-facture-pennylane avec des montants négatifs (convention courante sur ce type d'API), puis
// le lie à la facture originale. À VÉRIFIER avec un vrai remboursement de faible montant avant de
// faire confiance à cette automatisation sans supervision : en cas d'échec ou de résultat suspect
// côté Pennylane, ne rien confirmer côté SportVision au-delà de ce qui est déjà fiable (statuts
// resynchronisés) et notifier le staff pour vérification/création manuelle — jamais l'inverse.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

const cryptoProvider = Stripe.createSubtleCryptoProvider();

const PENNYLANE_BASE = "https://app.pennylane.com/api/external/v2";

function vatRateCode(tvaPct: number | null | undefined): string {
  const map: Record<string, string> = { "20": "FR_200", "10": "FR_100", "5.5": "FR_055", "2.1": "FR_021", "0": "FR_0" };
  return map[String(tvaPct ?? 20)] || "FR_200";
}

// deno-lint-ignore no-explicit-any
async function createPennylaneAvoir(admin: any, facture: any): Promise<{ ok: boolean; reason?: string }> {
  const pennylaneApiKey = Deno.env.get("PENNYLANE_API_KEY") ?? "";
  if (!pennylaneApiKey) return { ok: false, reason: "PENNYLANE_API_KEY non configurée" };
  if (!facture?.pennylane_invoice_id) return { ok: false, reason: "Facture non liée à Pennylane" };

  const { data: client } = await admin.from("clients").select("pennylane_customer_id").eq("id", facture.client_id).maybeSingle();
  const pennylaneCustomerId = client?.pennylane_customer_id;
  if (!pennylaneCustomerId) return { ok: false, reason: "Client sans identifiant Pennylane" };

  const pennylaneHeaders = { Authorization: `Bearer ${pennylaneApiKey}`, "Content-Type": "application/json" };

  const lignes = Array.isArray(facture.lignes) ? facture.lignes : [];
  const invoiceLines = (lignes.length ? lignes : [{ description: facture.type_facture || "Prestation SportVision", quantite: 1, prix_unitaire: facture.montant_ht }])
    .map((l: { description?: string; libelle?: string; quantite?: number; qte?: number; prix_unitaire?: number; pu?: number }) => ({
      label: "Avoir — " + (l.description || l.libelle || "Prestation SportVision"),
      quantity: l.quantite ?? l.qte ?? 1,
      unit: "unit",
      raw_currency_unit_price: String(-Math.abs(Number(l.prix_unitaire ?? l.pu ?? 0))),
      vat_rate: vatRateCode(facture.tva_pct),
    }));

  try {
    const creRes = await fetch(`${PENNYLANE_BASE}/customer_invoices`, {
      method: "POST",
      headers: pennylaneHeaders,
      body: JSON.stringify({
        customer_id: Number(pennylaneCustomerId),
        date: new Date().toISOString().slice(0, 10),
        deadline: new Date().toISOString().slice(0, 10),
        invoice_lines: invoiceLines,
      }),
    });
    if (!creRes.ok) return { ok: false, reason: "Pennylane (création avoir) : " + (await creRes.text()) };
    const credit = await creRes.json();

    const linkRes = await fetch(`${PENNYLANE_BASE}/customer_invoices/${facture.pennylane_invoice_id}/link_credit_note`, {
      method: "POST",
      headers: pennylaneHeaders,
      body: JSON.stringify({ credit_note_id: credit.id }),
    });
    if (!linkRes.ok) return { ok: false, reason: "Pennylane (liaison avoir) : " + (await linkRes.text()) };

    await admin.from("factures").update({ pennylane_credit_note_id: String(credit.id) }).eq("id", facture.id);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

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

  // Dédoublonnage atomique : on tente directement l'insert (id = clé primaire)
  // plutôt qu'un select-puis-insert, qui laissait une fenêtre de course en cas
  // de vraie concurrence sur le même event.id (Stripe peut renvoyer le même
  // événement deux fois quasi simultanément après un timeout). Une violation
  // de clé primaire (23505) signifie "déjà en cours de traitement ou traité" —
  // on s'arrête proprement dans les deux cas plutôt que de retraiter.
  const { error: insertEventErr } = await admin.from("stripe_events").insert({ id: event.id, type: event.type });
  if (insertEventErr) {
    if (insertEventErr.code === "23505") {
      return new Response(JSON.stringify({ received: true, duplicate: true }), { status: 200 });
    }
    // Erreur inattendue (pas un doublon) : on continue quand même le
    // traitement plutôt que de perdre un paiement pour un souci de traçabilité.
  }

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
          let avoirResult: { ok: boolean; reason?: string } | null = null;

          if (estTotal) {
            await admin.from("paiements").update({ statut: "rembourse" }).eq("id", paiement.id);

            if (paiement.prestation_id) {
              await admin
                .from("prestations")
                .update({ statut_financier: "remboursée" })
                .eq("id", paiement.prestation_id);

              try {
                const { data: facture } = await admin
                  .from("factures")
                  .select("*")
                  .eq("prestation_id", paiement.prestation_id)
                  .eq("type_facture", paiement.type_paiement)
                  .eq("statut", "payee")
                  .maybeSingle();
                if (facture) {
                  await admin.from("factures").update({ statut: "remboursee" }).eq("id", facture.id);
                  if (facture.pennylane_invoice_id) {
                    avoirResult = await createPennylaneAvoir(admin, facture);
                  }
                }
              } catch (_e) {
                // ignoré volontairement
              }
            }
          }

          // Notifie toujours le staff, même en remboursement partiel — c'est
          // le seul filet de sécurité tant qu'il n'y a pas de reconciliation
          // automatique pour les cas partiels, et le rattrapage nécessaire si
          // l'avoir Pennylane n'a pas pu être créé automatiquement.
          try {
            const avoirMsg = avoirResult
              ? (avoirResult.ok
                ? " Un avoir a été créé automatiquement chez Pennylane."
                : ` ATTENTION : l'avoir Pennylane n'a pas pu être créé automatiquement (${avoirResult.reason}) — à créer manuellement.`)
              : "";
            await admin.rpc("notify_staff_by_role", {
              p_roles: ["sec", "compta"],
              p_titre: estTotal
                ? (avoirResult && !avoirResult.ok ? "Remboursement Stripe confirmé — avoir Pennylane à créer manuellement" : "Remboursement Stripe confirmé")
                : "Remboursement Stripe PARTIEL — vérification requise",
              p_message: estTotal
                ? `Le paiement de ${(paiement.montant || 0)} € a été intégralement remboursé. Le dossier a été mis à jour automatiquement.${avoirMsg}`
                : `Remboursement partiel détecté (${(charge.amount_refunded / 100).toFixed(2)} € sur ${(charge.amount / 100).toFixed(2)} €). Aucune mise à jour automatique du statut — à traiter manuellement.`,
              p_priorite: estTotal && (!avoirResult || avoirResult.ok) ? "normale" : "haute",
              p_prestation_id: paiement.prestation_id,
              p_client_id: paiement.client_id,
            });
          } catch (_e) {
            // ignoré volontairement
          }
        } else if (!paiement) {
          // Pas un paiement Portail/Connect classique : peut être une
          // contribution à un projet collectif Club+ (team_project_contributions,
          // migration-clubplus-v21.sql), qui utilise aussi stripe_payment_intent_id
          // mais n'était jusqu'ici jamais vérifiée sur remboursement — la ligne
          // restait 'paye' indéfiniment et montant_collecte ne se recalculait
          // jamais (recompute_team_project_amount ne compte que statut='paye').
          // Découvert lors de l'audit du 2026-08-06.
          const { data: contribution } = await admin
            .from("team_project_contributions")
            .select("*")
            .eq("stripe_payment_intent_id", intentId)
            .maybeSingle();

          if (contribution && contribution.statut !== "rembourse" && estTotal) {
            await admin.from("team_project_contributions").update({ statut: "rembourse" }).eq("id", contribution.id);
            // recompute_team_project_amount() se déclenche automatiquement
            // (trigger after update) et corrige team_projects.montant_collecte.
            try {
              await admin.from("team_project_events").insert({
                project_id: contribution.project_id,
                event_type: "contribution_remboursee",
                note: `${contribution.montant} € remboursés via Stripe`,
              });
            } catch (_e) {
              // ignoré volontairement
            }
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
