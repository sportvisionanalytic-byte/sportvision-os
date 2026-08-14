// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.
// Étape à faire à chaque édition : Supabase Dashboard → Edge Functions →
// stripe-webhook → coller ce code → Deploy.
// Oublier cette étape est la cause la plus fréquente de "le code est bon
// mais ça ne marche pas en prod" sur ce projet (déjà arrivé sur au moins
// 5 fonctions : clubplus-billing-portal, create-clubplus-subscription-
// checkout, dispatch-notifications, create-guest-rdv, create-guest-request).

// Supabase Edge Function — stripe-webhook
// Reçoit les événements Stripe (checkout.session.completed, payment_intent.payment_failed,
// charge.refunded, customer.subscription.updated/deleted, invoice.paid,
// invoice.payment_failed), vérifie la signature, met à jour `paiements` puis `prestations`,
// et pilote l'abonnement récurrent Club+ sur `clubs` (plan, engagement, crédits, statut).
// Idempotent via `stripe_events`.
// Deploy via Supabase dashboard > Edge Functions > New Function (name: stripe-webhook)
// IMPORTANT : décocher "Verify JWT" pour cette fonction dans les settings (Stripe n'envoie pas de JWT Supabase).
// IMPORTANT : ajouter charge.refunded aux événements écoutés côté dashboard Stripe (Webhooks).
// IMPORTANT : ajouter aussi customer.subscription.updated, customer.subscription.deleted,
//             invoice.paid et invoice.payment_failed (abonnement Club+, 2026-08-06) —
//             sans ça, un impayé ou une résiliation ne serait jamais reflété côté SportVision.
// Secrets requis : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
//                  PENNYLANE_API_KEY (pour l'avoir automatique sur remboursement — optionnel : si
//                  absente, le remboursement est quand même resynchronisé, seul l'avoir Pennylane
//                  n'est pas créé et le staff est notifié pour le faire manuellement),
//                  CONNECT_URL (optionnel — repli sur https://connect.sportvision-an.fr ; utilisée
//                  dans le lien "Gérer mon abonnement" de l'e-mail d'échec de paiement. Fix du
//                  08/08/2026 : pointait vers l'ancienne app Club+ séparée.)
//
// E-mails CLIENT sur le cycle de vie de l'abonnement (migration-clubplus-v27, 2026-08-06) :
// jusqu'ici, seul le STAFF SportVision était notifié (notify_staff_by_role) sur activation,
// échec de prélèvement et résiliation — le club payeur ne recevait jamais rien. Les 3 branches
// concernées appellent maintenant AUSSI enqueue_notification vers l'admin actif du club (voir
// getClubAdminContact ci-dessous), en plus — jamais à la place — de la notification staff
// existante, qui reste inchangée.
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

// URL publique de l'app Club+ — utilisée dans l'e-mail d'échec de
// prélèvement (lien vers le bouton "Gérer mon abonnement", qui ouvre le
// Portail de facturation Stripe côté clubplus-billing-portal). Même
// variable et même repli que create-clubplus-subscription-checkout.
const CLUBPLUS_CONNECT_URL = Deno.env.get("CONNECT_URL") || "https://connect.sportvision-an.fr";

/* ── Abonnement Club+ (migration-clubplus-v25) ── */

// Crédits mensuels inclus par formule. Doit rester aligné avec CLUBPLUS_TARIFS
// dans create-clubplus-subscription-checkout et avec les libellés publics du
// wizard d'inscription (SportVision-Club-Plus.html).
const CLUBPLUS_PLAN_CREDITS: Record<string, number> = { club: 5, performance: 20 };

// Statut Stripe → clubs.subscription_status ('actif' | 'impaye' | 'annule').
// `incomplete` (3-D Secure jamais confirmé) est traité comme un impayé : le
// club ne doit pas être considéré abonné tant que rien n'est encaissé.
function mapSubscriptionStatus(status: string): "actif" | "impaye" | "annule" | null {
  if (status === "active" || status === "trialing") return "actif";
  if (status === "past_due" || status === "unpaid" || status === "incomplete") return "impaye";
  if (status === "canceled" || status === "incomplete_expired") return "annule";
  return null;
}

// Formule réellement facturée : lue sur le Price de la ligne d'abonnement
// (metadata posées à la création du Price par create-clubplus-subscription-
// checkout), et NON sur subscription.metadata — ces dernières datent de la
// souscription initiale et deviendraient fausses si le club change de formule
// depuis le Portail de facturation Stripe. Repli sur le lookup_key si les
// metadata manquent (Price créé à la main dans le dashboard, par exemple).
function planFromSubscription(sub: Stripe.Subscription): { plan: string | null; engagement: string | null } {
  const price = sub.items?.data?.[0]?.price;
  const meta = price?.metadata || {};
  let plan: string | null = meta.plan || null;
  let engagement: string | null = meta.engagement || null;
  if ((!plan || !engagement) && price?.lookup_key) {
    const m = /^sportvision_clubplus_(club|performance)_(12mois|sans)$/.exec(price.lookup_key);
    if (m) {
      plan = plan || m[1];
      engagement = engagement || m[2];
    }
  }
  // `clubs.plan` et `clubs.engagement` ont des contraintes check en base : une
  // valeur inattendue (Price bricolé à la main) est ignorée plutôt qu'écrite,
  // sinon l'update entier échouerait et le statut ne serait pas mis à jour.
  if (plan && !CLUBPLUS_PLAN_CREDITS[plan]) plan = null;
  if (engagement !== "12mois" && engagement !== "sans") engagement = null;
  return { plan, engagement };
}

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

// Résout le contact à notifier côté club pour les e-mails d'abonnement
// (migration-clubplus-v27) : le membre role='admin' status='actif' le plus
// ancien (généralement celui qui a souscrit/gère l'abonnement au quotidien —
// même filtre que create-clubplus-subscription-checkout pour autoriser un
// admin à agir sur l'abonnement). club_members ne stocke pas d'e-mail
// (seulement user_id → auth.users) : on le résout via l'API Admin Auth,
// jamais exposée au navigateur. Retourne null si aucun admin actif n'est
// trouvé ou si l'e-mail est indisponible — appelant toujours en best-effort,
// ne doit jamais faire échouer le traitement de l'événement Stripe.
// deno-lint-ignore no-explicit-any
async function getClubAdminContact(admin: any, clubId: string): Promise<{ email: string; userId: string; prenom: string } | null> {
  try {
    const { data: member } = await admin
      .from("club_members")
      .select("user_id, prenom")
      .eq("club_id", clubId)
      .eq("role", "admin")
      .eq("status", "actif")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!member?.user_id) return null;

    const { data: userRes } = await admin.auth.admin.getUserById(member.user_id);
    const email = userRes?.user?.email;
    if (!email) return null;

    return { email, userId: member.user_id, prenom: member.prenom || "" };
  } catch (_e) {
    console.error("[stripe-webhook] getClubAdminContact a échoué (best-effort, e-mail club non envoyé) :", _e);
    return null;
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
      // L'abonnement Club+ (mode 'subscription', 2026-08-06) passe par le même
      // événement et renseigne lui aussi client_reference_id (= club_id, pour
      // le retrouver depuis le dashboard Stripe). Il est donc testé EN PREMIER,
      // exactement pour la même raison que le branchement contribution_id →
      // paiement_id ci-dessous : sans ça, le club_id serait interprété comme un
      // paiement_id Portail et on chercherait un paiement qui n'existe pas.
      const abonnementClubId = (session.mode === "subscription" && session.metadata?.club_id)
        ? (session.metadata.club_id as string)
        : null;
      const contributionId = abonnementClubId ? null : ((session.metadata?.contribution_id as string) || null);
      // Cotisation personnelle Connect (group_fundings / funding_contributions,
      // migration-connect-v50) — même principe de branchement AVANT le repli sur
      // paiementId que contributionId ci-dessus, avec une clé de metadata distincte
      // ("funding_contribution_id") pour ne jamais être confondue avec une
      // contribution à un projet collectif Club+ (contributionId, team_project_contributions).
      const fundingContributionId = (abonnementClubId || contributionId)
        ? null
        : ((session.metadata?.funding_contribution_id as string) || null);
      const paiementId = (abonnementClubId || contributionId || fundingContributionId)
        ? null
        : ((session.metadata?.paiement_id as string) || (session.client_reference_id as string) || null);

      if (abonnementClubId) {
        // Normalisés avant écriture : `clubs.plan` et `clubs.engagement` ont des
        // contraintes check en base, une valeur inattendue ferait échouer TOUT
        // l'update (et donc l'activation de l'abonnement déjà encaissé).
        const rawPlan = (session.metadata?.plan as string) || "";
        const plan = CLUBPLUS_PLAN_CREDITS[rawPlan] ? rawPlan : "club";
        const engagement = session.metadata?.engagement === "sans" ? "sans" : "12mois";
        const creditsMonthly = CLUBPLUS_PLAN_CREDITS[plan];
        const subscriptionId = typeof session.subscription === "string"
          ? session.subscription
          : session.subscription?.id ?? null;
        const customerId = typeof session.customer === "string"
          ? session.customer
          : session.customer?.id ?? null;

        // Seul le service_role écrit ces colonnes : elles sont verrouillées pour
        // les admins de club par trg_protect_sensitive_club_fields (v24 + v25).
        // credits_balance est remis au niveau du quota de la formule (le club
        // démarre son premier mois avec la totalité de ses crédits) — même règle
        // qu'à chaque renouvellement, cf. handler invoice.paid.
        await admin
          .from("clubs")
          .update({
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
            plan,
            engagement,
            subscription_status: "actif",
            credits_monthly: creditsMonthly,
            credits_balance: creditsMonthly,
          })
          .eq("id", abonnementClubId);

        try {
          const { data: club } = await admin.from("clubs").select("nom").eq("id", abonnementClubId).maybeSingle();
          await admin.rpc("notify_staff_by_role", {
            p_roles: ["admin", "compta"],
            p_titre: "Nouvel abonnement Club+ activé",
            p_message: `${club?.nom || "Un club"} vient d'activer son abonnement ${plan === "performance" ? "Club+ Performance" : "Club+"} (${engagement === "sans" ? "sans engagement" : "engagement 12 mois"}).`,
            p_priorite: "normale",
            p_prestation_id: null,
            p_client_id: null,
          });
        } catch (_e) {
          console.error("[stripe-webhook] notify_staff_by_role (activation Club+) a échoué :", _e);
        }

        // E-mail au club lui-même (le payeur) — jusqu'ici seul le staff était
        // notifié, cf. commentaire d'en-tête (migration-clubplus-v27). Best-effort :
        // ne bloque jamais l'activation, déjà encaissée et déjà écrite ci-dessus.
        try {
          const contact = await getClubAdminContact(admin, abonnementClubId);
          if (contact) {
            const montantFmt = ((session.amount_total ?? 0) / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
            await admin.rpc("enqueue_notification", {
              p_event_type: "clubplus.abonnement_active",
              p_template_key: "clubplus.abonnement_active",
              p_channel: "EMAIL",
              p_idempotency_key: "clubplus.abonnement_active:v1:" + (subscriptionId || session.id),
              p_recipient_email: contact.email,
              p_recipient_user_id: contact.userId,
              p_entity_type: "club",
              p_entity_id: abonnementClubId,
              p_payload: {
                first_name: contact.prenom,
                plan_label: plan === "performance" ? "Club+ Performance" : "Club+",
                montant: montantFmt,
              },
            });
          }
        } catch (_e) {
          console.error("[stripe-webhook] enqueue_notification (e-mail activation Club+) a échoué :", _e);
        }
      }

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

      // Cotisation personnelle Connect (group_fundings / funding_contributions,
      // migration-connect-v50) — même logique que la branche contributionId
      // ci-dessus : group_fundings.montant_collecte et le passage à
      // 'objectif_atteint' se recalculent automatiquement via le trigger
      // trg_fc_recompute, jamais écrits ici directement.
      if (fundingContributionId) {
        const { data: contribution } = await admin
          .from("funding_contributions")
          .select("id, funding_id, montant, statut")
          .eq("id", fundingContributionId)
          .maybeSingle();

        if (contribution && contribution.statut !== "paye") {
          await admin
            .from("funding_contributions")
            .update({ statut: "paye", stripe_payment_intent_id: session.payment_intent as string })
            .eq("id", fundingContributionId);
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
              console.error("[stripe-webhook] mise à jour facture liée au paiement a échoué :", _e);
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
              console.error("[stripe-webhook] notify_staff_by_role (paiement reçu) a échoué :", _e);
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
              console.error("[stripe-webhook] envoi du reçu de paiement client a échoué :", _e);
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
      await admin.from("funding_contributions").update({ statut: "echoue" }).eq("stripe_payment_intent_id", intent.id);
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
                console.error("[stripe-webhook] création avoir Pennylane (remboursement) a échoué :", _e);
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
            console.error("[stripe-webhook] notify_staff_by_role (remboursement) a échoué :", _e);
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
              console.error("[stripe-webhook] journalisation team_project_events (remboursement contribution) a échoué :", _e);
            }
          }

          // Toujours pas trouvé : peut être une participation à une cotisation
          // personnelle Connect (funding_contributions, migration-connect-v50).
          // Même principe que ci-dessus — reflète passivement un remboursement
          // déjà décidé côté dashboard Stripe, n'invente aucune politique de
          // remboursement (le master doc et le README design laissent
          // explicitement cette décision produit à trancher avant toute
          // automatisation plus poussée).
          if (!contribution) {
            const { data: fundingContribution } = await admin
              .from("funding_contributions")
              .select("*")
              .eq("stripe_payment_intent_id", intentId)
              .maybeSingle();

            if (fundingContribution && fundingContribution.statut !== "rembourse" && estTotal) {
              await admin.from("funding_contributions").update({ statut: "rembourse" }).eq("id", fundingContribution.id);
              // recompute_group_funding_amount() se déclenche automatiquement
              // (trigger after update) et corrige group_fundings.montant_collecte.
            }
          }
        }
      }
    }

    /* ══════════════ ABONNEMENT CLUB+ (récurrent) ══════════════
       Tous les handlers ci-dessous retrouvent le club par
       clubs.stripe_subscription_id (posé au premier paiement, cf. la branche
       "abonnement" de checkout.session.completed). Un événement qui ne
       correspond à aucun club est ignoré silencieusement : le même compte
       Stripe sert aussi aux paiements ponctuels du Portail/Connect. */

    // Changement d'état de l'abonnement : statut de paiement, mais aussi
    // changement de formule effectué par le club depuis le Portail de
    // facturation Stripe (la formule est relue sur le Price réel de
    // l'abonnement — cf. planFromSubscription).
    // LIMITE CONNUE : le changement de formule n'apparaît dans le Portail que si
    // "Customers can switch plans" est activé dans la configuration du Portail
    // côté dashboard Stripe, avec les 2 produits Club+ et leurs 4 prix. Sans ça,
    // le Portail se limite aux factures / moyen de paiement / résiliation, ce
    // qui reste cohérent (rien de cassé silencieusement) — cf. le commentaire
    // d'en-tête de clubplus-billing-portal.
    // Les crédits déjà consommés du mois en cours ne sont PAS recalculés lors
    // d'un changement de formule en cours de période : Stripe proratise la
    // facturation, et credits_balance se réaligne sur la nouvelle formule au
    // renouvellement suivant (invoice.paid). Seul credits_monthly change tout
    // de suite, pour que le quota affiché corresponde à la formule payée.
    if (event.type === "customer.subscription.updated") {
      const sub = event.data.object as Stripe.Subscription;
      const { data: club } = await admin
        .from("clubs")
        .select("id, nom, plan, engagement, subscription_status, credits_monthly")
        .eq("stripe_subscription_id", sub.id)
        .maybeSingle();

      if (club) {
        const updates: Record<string, unknown> = {};
        const statut = mapSubscriptionStatus(sub.status);
        if (statut && statut !== club.subscription_status) updates.subscription_status = statut;

        const { plan, engagement } = planFromSubscription(sub);
        if (plan && plan !== club.plan) {
          updates.plan = plan;
          updates.credits_monthly = CLUBPLUS_PLAN_CREDITS[plan];
        }
        if (engagement && engagement !== club.engagement) updates.engagement = engagement;

        if (Object.keys(updates).length) {
          await admin.from("clubs").update(updates).eq("id", club.id);

          if (updates.plan) {
            try {
              await admin.rpc("notify_staff_by_role", {
                p_roles: ["admin", "compta"],
                p_titre: "Changement de formule Club+",
                p_message: `${club.nom || "Un club"} est passé de ${club.plan === "performance" ? "Club+ Performance" : "Club+"} à ${plan === "performance" ? "Club+ Performance" : "Club+"} depuis le Portail de facturation Stripe.`,
                p_priorite: "normale",
                p_prestation_id: null,
                p_client_id: null,
              });
            } catch (_e) {
              console.error("[stripe-webhook] notify_staff_by_role (changement de formule Club+) a échoué :", _e);
            }
          }
        }
      }
    }

    // Renouvellement mensuel encaissé : le quota de crédits repart à neuf.
    // HYPOTHÈSE PRODUIT (à confirmer) : les crédits ne sont PAS cumulatifs d'un
    // mois sur l'autre — un club qui n'a rien consommé ne démarre pas le mois
    // suivant avec le double. C'est ce que laisse entendre l'affichage de l'app
    // ("X / Y crédits ce mois") et le libellé "crédits mensuels" du site public,
    // mais ce n'est écrit dans aucun document contractuel. Si la règle voulue
    // est le report, remplacer par credits_balance = credits_balance +
    // credits_monthly (et prévoir un plafond, sinon un club inactif accumule
    // indéfiniment). credits_reserved n'est jamais touché ici : ce sont des
    // crédits engagés sur des demandes en attente d'acceptation.
    if (event.type === "invoice.paid") {
      const invoice = event.data.object as Stripe.Invoice;
      const subId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id ?? null;
      if (subId) {
        const { data: club } = await admin
          .from("clubs")
          .select("id, credits_monthly")
          .eq("stripe_subscription_id", subId)
          .maybeSingle();
        if (club) {
          await admin
            .from("clubs")
            .update({
              credits_balance: club.credits_monthly ?? 0,
              // Une facture payée après un incident remet aussi l'abonnement au vert.
              subscription_status: "actif",
            })
            .eq("id", club.id);
        }
      }
    }

    // Échec de prélèvement sur un abonnement : le club reste utilisable (Stripe
    // va retenter selon sa politique de relance) mais l'état est visible dans
    // l'app et le staff est alerté pour relancer le club avant la résiliation
    // automatique — même patron de notification que les remboursements.
    if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object as Stripe.Invoice;
      const subId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id ?? null;
      if (subId) {
        const { data: club } = await admin
          .from("clubs")
          .select("id, nom")
          .eq("stripe_subscription_id", subId)
          .maybeSingle();
        if (club) {
          await admin.from("clubs").update({ subscription_status: "impaye" }).eq("id", club.id);
          try {
            await admin.rpc("notify_staff_by_role", {
              p_roles: ["admin", "compta"],
              p_titre: "Abonnement Club+ impayé",
              p_message: `Le prélèvement de l'abonnement de ${club.nom || "un club"} a échoué (${((invoice.amount_due || 0) / 100).toFixed(2)} €). Stripe va retenter automatiquement — à relancer si l'échec persiste.`,
              p_priorite: "haute",
              p_prestation_id: null,
              p_client_id: null,
            });
          } catch (_e) {
            console.error("[stripe-webhook] notify_staff_by_role (abonnement Club+ impayé) a échoué :", _e);
          }

          // E-mail au club : un impayé nécessite une action du payeur (mettre à
          // jour son moyen de paiement) — cf. commentaire d'en-tête, migration-
          // clubplus-v27. Idempotency key sur l'ID de facture Stripe : un même
          // abonnement peut échouer plusieurs fois (relances Stripe), chaque
          // facture ne doit générer qu'un seul e-mail. Best-effort.
          try {
            const contact = await getClubAdminContact(admin, club.id);
            if (contact) {
              const montantFmt = ((invoice.amount_due || 0) / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
              await admin.rpc("enqueue_notification", {
                p_event_type: "clubplus.paiement_echoue",
                p_template_key: "clubplus.paiement_echoue",
                p_channel: "EMAIL",
                p_idempotency_key: "clubplus.paiement_echoue:v1:" + invoice.id,
                p_recipient_email: contact.email,
                p_recipient_user_id: contact.userId,
                p_entity_type: "club",
                p_entity_id: club.id,
                p_payload: {
                  first_name: contact.prenom,
                  montant: montantFmt,
                  lien_gestion: CLUBPLUS_CONNECT_URL + "/",
                },
              });
            }
          } catch (_e) {
            console.error("[stripe-webhook] enqueue_notification (e-mail impayé Club+) a échoué :", _e);
          }
        }
      }
    }

    // Résiliation effective (fin d'engagement, résiliation depuis le Portail,
    // ou abandon après échecs de paiement répétés). stripe_subscription_id est
    // volontairement CONSERVÉ : il reste la trace de l'abonnement résilié et
    // permet de rattacher d'éventuels événements tardifs (avoir, litige). Une
    // nouvelle souscription écrasera l'ancien identifiant.
    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object as Stripe.Subscription;
      const { data: club } = await admin
        .from("clubs")
        .select("id, nom")
        .eq("stripe_subscription_id", sub.id)
        .maybeSingle();
      if (club) {
        await admin.from("clubs").update({ subscription_status: "annule" }).eq("id", club.id);
        try {
          await admin.rpc("notify_staff_by_role", {
            p_roles: ["admin", "compta"],
            p_titre: "Abonnement Club+ résilié",
            p_message: `L'abonnement de ${club.nom || "un club"} a été résilié chez Stripe. Le club n'est plus prélevé — vérifier l'accès à l'espace Club+ et le solde de crédits.`,
            p_priorite: "haute",
            p_prestation_id: null,
            p_client_id: null,
          });
        } catch (_e) {
          console.error("[stripe-webhook] notify_staff_by_role (résiliation Club+) a échoué :", _e);
        }

        // E-mail au club : confirmation de résiliation, cf. commentaire d'en-tête
        // (migration-clubplus-v27). date_effet = date de traitement de l'événement
        // (sub.ended_at n'est pas toujours renseigné selon la cause de la
        // résiliation ; à ce stade l'abonnement est de toute façon déjà terminé
        // côté Stripe). Best-effort.
        try {
          const contact = await getClubAdminContact(admin, club.id);
          if (contact) {
            const dateEffet = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
            await admin.rpc("enqueue_notification", {
              p_event_type: "clubplus.abonnement_resilie",
              p_template_key: "clubplus.abonnement_resilie",
              p_channel: "EMAIL",
              p_idempotency_key: "clubplus.abonnement_resilie:v1:" + sub.id,
              p_recipient_email: contact.email,
              p_recipient_user_id: contact.userId,
              p_entity_type: "club",
              p_entity_id: club.id,
              p_payload: {
                first_name: contact.prenom,
                date_effet: dateEffet,
              },
            });
          }
        } catch (_e) {
          console.error("[stripe-webhook] enqueue_notification (e-mail résiliation Club+) a échoué :", _e);
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
  const connectUrl = Deno.env.get("CONNECT_URL") || "https://connect.sportvision-an.fr";
  const montantFmt = (info.montant || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  const typeLbl = info.type_paiement === "acompte" ? "Acompte" : info.type_paiement === "solde" ? "Solde" : "Paiement total";

  const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#06111F;font-family:Arial,sans-serif;color:#F7F9FC">
  <div style="max-width:520px;margin:32px auto;background:#10243E;border-radius:14px;overflow:hidden">
    <div style="background:#0B1B33;padding:26px 32px">
      <div style="font-size:20px;font-weight:800;color:#fff">SPORTVISION</div>
      <div style="font-size:10px;color:#32D8E6;letter-spacing:.1em;margin-top:2px">CONNECT</div>
    </div>
    <div style="padding:28px 32px">
      <p style="font-size:15px;line-height:1.6">Bonjour,</p>
      <p style="font-size:14px;line-height:1.7;color:#9DAEC3">Nous confirmons la bonne réception de votre paiement${info.reference ? " pour la prestation " + info.reference : ""}.</p>
      <div style="background:#0B1B33;border-radius:10px;padding:16px 20px;margin:18px 0">
        <div style="font-size:12px;color:#9DAEC3">${typeLbl}</div>
        <div style="font-size:22px;font-weight:800;color:#32D8E6;margin-top:4px">${montantFmt}</div>
      </div>
      <a href="${connectUrl}" style="display:inline-block;background:#168BFF;color:#fff;text-decoration:none;padding:12px 22px;border-radius:9px;font-size:14px;font-weight:700">Voir mon espace</a>
    </div>
  </div>
</body></html>`;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: fromEmail, to: [to], subject: "Confirmation de paiement — SportVision", html }),
  });
}
