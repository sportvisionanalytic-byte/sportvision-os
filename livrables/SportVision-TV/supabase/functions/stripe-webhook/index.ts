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
// IMPORTANT : ajouter aussi customer.subscription.created et invoice.payment_succeeded
//             (abonnement Agent, Espace particulier, migration-connect-v57, 2026-08-15) —
//             customer.subscription.updated/deleted et invoice.payment_failed sont DÉJÀ écoutés
//             depuis l'abonnement Club+ ci-dessus, aucun ajout requis pour ceux-là côté Agent.
// AJOUT 15/08/2026 (migration-connect-v63-prestation-montage-compilation.sql) : la branche
//             checkout.session.completed / paiementId consomme désormais aussi la remise
//             mensuelle Agent (-10%, palier Pro) quand create-checkout-session l'a appliquée
//             (metadata apply_monthly_discount/agent_user_id) — aucun nouvel événement Stripe à
//             ajouter côté dashboard pour ça, checkout.session.completed est déjà écouté.
// IMPORTANT : ajouter aussi checkout.session.expired (audit paiements du 16/08/2026) — sans ça,
//             un client qui abandonne la page Stripe sans jamais échouer de tentative de carte
//             (donc sans déclencher payment_intent.payment_failed) laisse sa ligne paiements/
//             team_project_contributions/funding_contributions bloquée à 'en_attente' pour
//             toujours. Voir le commentaire du handler plus bas pour le détail.
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
// 17/08/2026 — 10 (Start) / 40 (Performance), alignés sur plans.ts monthlyCredits (audit
// complet Club+ du 17/08/2026, confirmé par Fouka) — voir clubplus-activate/clubplus-onboarding.
const CLUBPLUS_PLAN_CREDITS: Record<string, number> = { club: 10, performance: 40 };

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

/* ── Abonnement Agent (Espace particulier, migration-connect-v57, 2026-08-15) ──
   Première intégration Stripe RÉCURRENTE côté Espace particulier. Suit le même principe que
   l'abonnement Club+ ci-dessus ("le webhook confirme, jamais le retour navigateur") avec UNE
   différence : les 3 Price (Starter/Growth/Pro) sont créés MANUELLEMENT par Fouka dans le
   dashboard Stripe (pas de création dynamique comme CLUBPLUS_TARIFS/ensurePrice ci-dessus) — le
   webhook ne connaît donc jamais le tarif en euros, seulement le Price ID, lu depuis 3 variables
   d'environnement partagées avec create-agent-subscription-checkout et manage-agent-subscription. */

// Palier réellement facturé : résolu en comparant l'ID du Price de la ligne d'abonnement aux 3
// variables d'environnement STRIPE_PRICE_AGENT_* — jamais depuis une metadata posée sur le Price
// lui-même (impossible à garantir sur un Price créé à la main dans le dashboard). Retourne null si
// le Price ne correspond à aucun des 3 (abonnement non-Agent sur ce même compte Stripe, ou
// variable d'environnement pas encore configurée) — auquel cas syncAgentSubscription ci-dessous
// n'écrase jamais un palier déjà connu par une valeur fausse.
function agentTierFromPriceId(priceId: string | undefined): "starter" | "growth" | "pro" | null {
  if (!priceId) return null;
  if (priceId === Deno.env.get("STRIPE_PRICE_AGENT_STARTER")) return "starter";
  if (priceId === Deno.env.get("STRIPE_PRICE_AGENT_GROWTH")) return "growth";
  if (priceId === Deno.env.get("STRIPE_PRICE_AGENT_PRO")) return "pro";
  return null;
}

// Statut Stripe → connect_agent_subscriptions.status. `incomplete` (3-D Secure jamais confirmé)
// reste 'incomplete' plutôt qu'un repli sur 'past_due' (contrairement à mapSubscriptionStatus
// pour Club+) : un abonnement jamais confirmé ne doit ni compter comme actif (connect_agent_
// effective_tier le traite déjà comme 'gratuit', seul status='active' compte), ni s'afficher côté
// Mon abonnement comme "paiement en échec" avant même une première tentative réelle.
function agentSubscriptionStatus(status: string): "active" | "past_due" | "canceled" | "incomplete" {
  if (status === "active" || status === "trialing") return "active";
  if (status === "past_due" || status === "unpaid") return "past_due";
  if (status === "canceled" || status === "incomplete_expired") return "canceled";
  return "incomplete";
}

// Point d'entrée unique pour synchroniser connect_agent_subscriptions depuis un objet Stripe
// Subscription — appelé par customer.subscription.created ET customer.subscription.updated
// (identique dans les deux cas). Retrouve la ligne via sub.metadata.user_id (posé à la création
// par create-agent-subscription-checkout, subscription_data.metadata), jamais via
// stripe_subscription_id : ce champ n'est écrit qu'APRÈS le premier passage ici, une recherche par
// lui échouerait précisément sur le tout premier événement reçu. Ignore silencieusement tout
// abonnement sans metadata.user_id (abonnement Club+ sur ce même compte Stripe, ou tout autre
// usage futur) — même principe que le reste de ce webhook : un événement qui ne correspond à
// aucun compte Agent connu est ignoré silencieusement.
// deno-lint-ignore no-explicit-any
async function syncAgentSubscription(admin: any, sub: Stripe.Subscription) {
  const userId = sub.metadata?.user_id as string | undefined;
  if (!userId) return;

  const priceId = sub.items?.data?.[0]?.price?.id;
  const tier = agentTierFromPriceId(priceId);
  const status = agentSubscriptionStatus(sub.status);
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;

  const updates: Record<string, unknown> = {
    user_id: userId,
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    status,
    current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
    cancel_at_period_end: sub.cancel_at_period_end,
  };
  // tier a une contrainte check (starter|growth|pro) : omettre la colonne plutôt qu'écrire null
  // ou une valeur non résolue, sinon l'upsert entier échouerait (et donc même la mise à jour du
  // statut/cancel_at_period_end) — un nouvel utilisateur sans tier résolu reprend simplement le
  // défaut de la colonne ('starter').
  if (tier) updates.tier = tier;

  await admin.from("connect_agent_subscriptions").upsert(updates, { onConflict: "user_id" });
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
      // Abonnement Agent (Espace particulier, mode 'subscription', migration-connect-v57,
      // 2026-08-15) — même branchement EN PREMIER que abonnementClubId ci-dessus et pour la même
      // raison : cette session renseigne elle aussi client_reference_id (= user_id, pour le
      // retrouver depuis le dashboard Stripe), qui serait sinon interprété à tort comme un
      // paiement_id Portail par le repli de paiementId plus bas.
      const agentUserId = (session.mode === "subscription" && session.metadata?.user_id && session.metadata?.tier)
        ? (session.metadata.user_id as string)
        : null;
      const contributionId = (abonnementClubId || agentUserId) ? null : ((session.metadata?.contribution_id as string) || null);
      // Cotisation personnelle Connect (group_fundings / funding_contributions,
      // migration-connect-v50) — même principe de branchement AVANT le repli sur
      // paiementId que contributionId ci-dessus, avec une clé de metadata distincte
      // ("funding_contribution_id") pour ne jamais être confondue avec une
      // contribution à un projet collectif Club+ (contributionId, team_project_contributions).
      const fundingContributionId = (abonnementClubId || agentUserId || contributionId)
        ? null
        : ((session.metadata?.funding_contribution_id as string) || null);
      const paiementId = (abonnementClubId || agentUserId || contributionId || fundingContributionId)
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

      // Activation initiale de l'abonnement Agent — utilise DIRECTEMENT session.metadata.tier
      // (posé et validé côté serveur par create-agent-subscription-checkout, jamais une valeur
      // transmise telle quelle par le client sans passer par la résolution du Price d'abord) au
      // lieu de re-dériver le palier depuis le Price via un appel API supplémentaire — même
      // simplification que le repli sur session.metadata.plan côté Club+ ci-dessus.
      // customer.subscription.created/updated (ci-dessous) prennent ensuite le relais pour tout
      // changement ultérieur (Portail, ou manage-agent-subscription), où la résolution se fait
      // alors par comparaison de Price ID (syncAgentSubscription).
      if (agentUserId) {
        const tier = (session.metadata?.tier as string) || "";
        if (["starter", "growth", "pro"].includes(tier)) {
          const subscriptionId = typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id ?? null;
          const customerId = typeof session.customer === "string"
            ? session.customer
            : session.customer?.id ?? null;

          await admin.from("connect_agent_subscriptions").upsert(
            {
              user_id: agentUserId,
              stripe_customer_id: customerId,
              stripe_subscription_id: subscriptionId,
              tier,
              status: "active",
              cancel_at_period_end: false,
            },
            { onConflict: "user_id" },
          );

          try {
            const tierLabel = tier === "starter" ? "Starter" : tier === "growth" ? "Growth" : "Pro";
            await admin.from("member_notifications").insert({
              user_id: agentUserId,
              category: "payments",
              title: "Abonnement Agent activé",
              body: `Votre abonnement Agent ${tierLabel} est actif.`,
              target_href: "/particulier/abonnement",
            });
          } catch (_e) {
            console.error("[stripe-webhook] notification activation abonnement Agent a échoué :", _e);
          }
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

          // AJOUT (audit paiements 16/08/2026) — garde-fou dépassement objectif : create-team-
          // contribution-checkout ne vérifie le montant restant QU'AU MOMENT de la création de la
          // session Stripe, jamais revérifié ici à la confirmation. Deux contributeurs qui cliquent
          // "payer le reste" au même instant peuvent chacun créer une session valide pour tout le
          // solde restant — si les deux paient, le total dépasse montant_cible. Décision produit
          // déjà tranchée : ne JAMAIS bloquer/annuler un paiement déjà effectué côté Stripe
          // (rembourser automatiquement serait plus risqué qu'utile, refuser un paiement déjà
          // encaissé est de toute façon impossible) — seulement notifier le staff pour un
          // arbitrage au cas par cas. Purement additif, best-effort : ne fait jamais échouer le
          // traitement du webhook, et ne change aucune écriture existante ci-dessus.
          try {
            const { data: project } = await admin
              .from("team_projects")
              .select("montant_cible, montant_collecte")
              .eq("id", contribution.project_id)
              .maybeSingle();
            if (project && Number(project.montant_collecte) > Number(project.montant_cible)) {
              const depassement = Math.round((Number(project.montant_collecte) - Number(project.montant_cible)) * 100) / 100;
              await admin.rpc("notify_staff_by_role", {
                p_roles: ["sec", "compta"],
                p_titre: "Projet collectif dépassé — vérification manuelle nécessaire",
                p_message: `Le montant collecté (${project.montant_collecte} €) dépasse désormais l'objectif (${project.montant_cible} €) de ${depassement} € — probablement deux paiements simultanés reçus sur le solde restant. À traiter au cas par cas (rembourser le dernier contributeur, garder l'excédent avec son accord...).`,
                p_priorite: "haute",
                p_prestation_id: null,
                p_client_id: null,
              });
            }
          } catch (_e) {
            console.error("[stripe-webhook] vérification dépassement objectif (projet collectif) a échoué :", _e);
          }
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

          // AJOUT (audit paiements 16/08/2026) — garde-fou dépassement objectif : create-funding-
          // contribution-checkout / create-guest-funding-contribution-checkout ne vérifient le
          // montant restant QU'AU MOMENT de la création de la session Stripe, jamais revérifié ici
          // à la confirmation. Deux contributeurs qui cliquent "Payer le solde" au même instant
          // peuvent chacun créer une session valide pour tout le solde restant — si les deux
          // paient, le total dépasse montant_cible. Décision produit déjà tranchée : ne JAMAIS
          // bloquer/annuler un paiement déjà effectué côté Stripe (rembourser automatiquement
          // serait plus risqué qu'utile, refuser un paiement déjà encaissé est de toute façon
          // impossible) — seulement notifier le staff pour un arbitrage au cas par cas (rembourser
          // le dernier contributeur, garder l'excédent avec son accord, etc.). Purement additif,
          // best-effort : ne fait jamais échouer le traitement du webhook, et ne change aucune
          // écriture existante ci-dessus.
          try {
            const { data: funding } = await admin
              .from("group_fundings")
              .select("montant_cible, montant_collecte")
              .eq("id", contribution.funding_id)
              .maybeSingle();
            if (funding && Number(funding.montant_collecte) > Number(funding.montant_cible)) {
              const depassement = Math.round((Number(funding.montant_collecte) - Number(funding.montant_cible)) * 100) / 100;
              await admin.rpc("notify_staff_by_role", {
                p_roles: ["sec", "compta"],
                p_titre: "Cotisation dépassée — vérification manuelle nécessaire",
                p_message: `Le montant collecté (${funding.montant_collecte} €) dépasse désormais l'objectif (${funding.montant_cible} €) de ${depassement} € — probablement deux paiements simultanés reçus sur le solde restant. À traiter au cas par cas (rembourser le dernier contributeur, garder l'excédent avec son accord...).`,
                p_priorite: "haute",
                p_prestation_id: null,
                p_client_id: null,
              });
            }
          } catch (_e) {
            console.error("[stripe-webhook] vérification dépassement objectif (cotisation) a échoué :", _e);
          }
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
            const { data: prestation, error: prestationUpdateError } = await admin
              .from("prestations")
              .update(updates)
              .eq("id", paiement.prestation_id)
              .select("reference")
              .maybeSingle();
            if (prestationUpdateError) {
              // Écriture critique : un paiement Stripe réussi doit toujours se refléter sur la
              // prestation (voir INC-033 — cette même absence de vérification avait rendu un bug
              // de trigger totalement silencieux). Ne bloque pas l'accusé de réception à Stripe,
              // mais rend l'échec visible dans les logs Supabase au lieu de disparaître.
              console.error(
                "[stripe-webhook] échec critique : mise à jour prestations.statut_financier a échoué :",
                prestationUpdateError,
                { prestation_id: paiement.prestation_id, updates },
              );
              await sendCriticalAlertEmail(
                "paiement reçu mais prestation non mise à jour",
                `Un paiement Stripe a bien été confirmé (paiement ${paiementId}), mais l'écriture ` +
                  `sur prestations.statut_financier a échoué.\n\n` +
                  `prestation_id : ${paiement.prestation_id}\n` +
                  `updates tentés : ${JSON.stringify(updates)}\n` +
                  `erreur : ${JSON.stringify(prestationUpdateError)}\n\n` +
                  `Ce client a payé mais sa prestation peut rester affichée non facturée dans l'OS ` +
                  `— vérifier et corriger manuellement le statut_financier de cette prestation.`,
              );
            }

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

          // Remise mensuelle Agent (-10%, palier Pro, une fois par période — migration-connect-
          // v57 §2 + v63-prestation-montage-compilation.sql) : consommée ICI, uniquement
          // maintenant que Stripe a confirmé le paiement (jamais avant, jamais côté client —
          // même principe que le reste de ce fichier). create-checkout-session ne renseigne
          // apply_monthly_discount/agent_user_id sur la session que lorsque
          // connect_agent_discount() a confirmé monthly_pct > 0 pour ce payeur au moment du
          // checkout ; on ne revérifie pas ici (la garde `paiement.statut !== "reussi"`
          // ci-dessus empêche déjà toute double consommation sur un retry webhook), on écrit
          // simplement l'état "consommée pour la période en cours" — exactement le mécanisme
          // documenté dans le commentaire de connect_agent_discount() (migration-connect-v57).
          if (session.metadata?.apply_monthly_discount === "true" && session.metadata?.agent_user_id) {
            try {
              await admin
                .from("connect_agent_subscriptions")
                .update({ monthly_discount_used_at: new Date().toISOString(), updated_at: new Date().toISOString() })
                .eq("user_id", session.metadata.agent_user_id as string)
                .eq("status", "active");
            } catch (_e) {
              console.error("[stripe-webhook] consommation de la remise mensuelle Agent a échoué :", _e);
            }
          }
        }
      }
    }

    if (event.type === "payment_intent.payment_failed") {
      const intent = event.data.object as Stripe.PaymentIntent;
      await admin.from("paiements").update({ statut: "echoue" }).eq("stripe_payment_intent_id", intent.id);
      await admin.from("team_project_contributions").update({ statut: "echoue" }).eq("stripe_payment_intent_id", intent.id);
      await admin.from("funding_contributions").update({ statut: "echoue" }).eq("stripe_payment_intent_id", intent.id);
    }

    // Session Stripe Checkout expirée (24h par défaut en mode 'payment') SANS jamais avoir été
    // payée — cas jusqu'ici NON géré, distinct de payment_intent.payment_failed ci-dessus :
    // celui-ci ne se déclenche que sur une tentative de carte concrètement refusée. Un client qui
    // abandonne simplement la page Stripe (ferme l'onglet, ne saisit jamais de carte) ne déclenche
    // AUCUN des deux événements déjà écoutés — la ligne paiements/team_project_contributions/
    // funding_contributions créée en 'en_attente' au moment de create-checkout-session /
    // create-team-contribution-checkout / create-(guest-)funding-contribution-checkout restait
    // bloquée à 'en_attente' indéfiniment, sans aucun signal.
    // Réutilise le statut 'echoue' déjà existant (même sémantique côté client que payment_intent.
    // payment_failed : "ce paiement n'a pas abouti") plutôt que d'inventer un nouveau statut — pas
    // de décision produit nouvelle, seulement une résynchronisation d'un état déjà défini pour un
    // événement Stripe qui ne l'écrivait pas encore. Ne touche que les lignes encore 'en_attente'
    // (jamais une ligne déjà 'paye'/'rembourse'/'echoue') pour rester un no-op sur toute session
    // expirée après un paiement déjà confirmé par ailleurs (ordre d'arrivée des événements Stripe
    // non garanti).
    // Découvert lors de l'audit paiements du 16/08/2026 — n'a pas d'équivalent pour l'abonnement
    // Club+/Agent (mode 'subscription') : ces sessions ne pré-créent aucune ligne 'en_attente',
    // l'activation n'a lieu qu'à checkout.session.completed, donc rien n'y reste jamais bloqué.
    // IMPORTANT : ajouter checkout.session.expired aux événements écoutés côté dashboard Stripe
    // (Webhooks) — non fait automatiquement, cf. les autres IMPORTANT en tête de ce fichier.
    if (event.type === "checkout.session.expired") {
      const session = event.data.object as Stripe.Checkout.Session;
      await admin.from("paiements").update({ statut: "echoue" }).eq("stripe_checkout_session_id", session.id).eq("statut", "en_attente");
      await admin.from("team_project_contributions").update({ statut: "echoue" }).eq("stripe_checkout_session_id", session.id).eq("statut", "en_attente");
      await admin.from("funding_contributions").update({ statut: "echoue" }).eq("stripe_checkout_session_id", session.id).eq("statut", "en_attente");
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

          if (contribution && contribution.statut !== "rembourse") {
            if (estTotal) {
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

            // Notifie le staff — même filet de sécurité que la branche `paiement` ci-dessus
            // (best-effort, aucune écriture supplémentaire). Jusqu'ici AUCUNE notification n'était
            // envoyée sur un remboursement de contribution à un projet collectif Club+, ni total
            // ni partiel (le seul signal était l'entrée team_project_events sur un remboursement
            // total, jamais consultée activement) — découvert lors de l'audit paiements du
            // 16/08/2026. Purement additif : ne change aucune écriture existante.
            try {
              await admin.rpc("notify_staff_by_role", {
                p_roles: ["sec", "compta"],
                p_titre: estTotal ? "Remboursement Stripe confirmé — contribution projet collectif" : "Remboursement Stripe PARTIEL — contribution projet collectif",
                p_message: estTotal
                  ? `La contribution de ${contribution.montant} € à un projet collectif a été intégralement remboursée. Le montant collecté du projet a été recalculé automatiquement.`
                  : `Remboursement partiel détecté (${(charge.amount_refunded / 100).toFixed(2)} € sur ${(charge.amount / 100).toFixed(2)} €) sur une contribution à un projet collectif. Aucune mise à jour automatique du statut — à traiter manuellement.`,
                p_priorite: estTotal ? "normale" : "haute",
                p_prestation_id: null,
                p_client_id: null,
              });
            } catch (_e) {
              console.error("[stripe-webhook] notify_staff_by_role (remboursement contribution projet) a échoué :", _e);
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

            if (fundingContribution && fundingContribution.statut !== "rembourse") {
              if (estTotal) {
                await admin.from("funding_contributions").update({ statut: "rembourse" }).eq("id", fundingContribution.id);
                // recompute_group_funding_amount() se déclenche automatiquement
                // (trigger after update) et corrige group_fundings.montant_collecte.
              }

              // Notifie le staff — même fix de parité que team_project_contributions ci-dessus :
              // jusqu'ici un remboursement (total OU partiel) sur une participation à une
              // cotisation personnelle Connect ne déclenchait STRICTEMENT rien (ni écriture, ni
              // notification) sur un remboursement partiel — le webhook ignorait silencieusement
              // l'événement. Purement additif (best-effort), ne change aucune écriture existante.
              try {
                await admin.rpc("notify_staff_by_role", {
                  p_roles: ["sec", "compta"],
                  p_titre: estTotal ? "Remboursement Stripe confirmé — cotisation collective" : "Remboursement Stripe PARTIEL — cotisation collective",
                  p_message: estTotal
                    ? `La participation de ${fundingContribution.montant} € à une cotisation collective a été intégralement remboursée. Le montant collecté a été recalculé automatiquement.`
                    : `Remboursement partiel détecté (${(charge.amount_refunded / 100).toFixed(2)} € sur ${(charge.amount / 100).toFixed(2)} €) sur une participation à une cotisation collective. Aucune mise à jour automatique du statut — à traiter manuellement.`,
                  p_priorite: estTotal ? "normale" : "haute",
                  p_prestation_id: null,
                  p_client_id: null,
                });
              } catch (_e) {
                console.error("[stripe-webhook] notify_staff_by_role (remboursement participation cotisation) a échoué :", _e);
              }
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
    // Abonnement Agent (Espace particulier, migration-connect-v57) — événement DÉDIÉ, distinct de
    // "updated" : Stripe l'émet une seule fois, à la création de la Subscription (juste après
    // checkout.session.completed pour un premier abonnement). checkout.session.completed reste
    // l'activation AUTORITATIVE (cf. son commentaire ci-dessus), ce handler-ci est un filet de
    // sécurité idempotent (syncAgentSubscription fait un upsert) qui couvre aussi le cas où
    // l'ordre d'arrivée des deux événements serait inversé — n'a aucun équivalent côté Club+
    // (qui ne traite pas cet événement), donc purement additif, aucune branche existante touchée.
    if (event.type === "customer.subscription.created") {
      const sub = event.data.object as Stripe.Subscription;
      await syncAgentSubscription(admin, sub);
    }

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

      // Abonnement Agent — additif, indépendant du bloc `if (club)` ci-dessus (un même
      // customer.subscription.updated ne peut évidemment concerner que l'un OU l'autre, jamais
      // les deux, mais on ne le sait qu'en lisant metadata.user_id à l'intérieur de la fonction :
      // syncAgentSubscription no-op silencieusement si ce n'est pas un abonnement Agent). Couvre
      // aussi bien un changement de palier via manage-agent-subscription (API directe) qu'un
      // changement de statut Stripe (échec de paiement récupéré, etc.).
      await syncAgentSubscription(admin, sub);
    }

    // Renouvellement mensuel encaissé : le quota de crédits repart à neuf.
    // Confirmé par Fouka le 19/08/2026 : les crédits ne sont PAS reportés d'un mois sur
    // l'autre — un club qui n'a rien consommé ne démarre pas le mois suivant avec le double,
    // le solde est simplement remis au quota du plan à chaque facture payée. Le comportement
    // ci-dessous était déjà celui codé (l'ancienne "hypothèse à confirmer" est maintenant
    // tranchée) — voir aussi club-plus.html FAQ, mise à jour en conséquence le même jour.
    // credits_reserved n'est jamais touché ici : ce sont des crédits engagés sur des demandes
    // en attente d'acceptation.
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

    // Abonnement Agent — facture payée (première facture ou renouvellement) : événement DÉDIÉ
    // (invoice.payment_succeeded, distinct de invoice.paid utilisé par Club+ ci-dessus, à ajouter
    // séparément côté dashboard Stripe, cf. en-tête de ce fichier). Repart sur une période vierge
    // à CHAQUE facture payée : monthly_discount_used_at (remise -10%/mois, palier Pro) est remis à
    // NULL sans comparer de dates — plus simple et plus fiable qu'une comparaison de bornes de
    // période, cf. le commentaire de la colonne dans migration-connect-v57. current_period_end et
    // status sont aussi resynchronisés ici (une facture payée après un incident remet l'abonnement
    // au vert, même principe que invoice.paid côté Club+ ci-dessus) — indépendamment de
    // syncAgentSubscription (qui ne tourne que sur customer.subscription.*), cette écriture est
    // directe et minimale, scopée aux 3 colonnes concernées par un paiement de facture.
    if (event.type === "invoice.payment_succeeded") {
      const invoice = event.data.object as Stripe.Invoice;
      const subId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id ?? null;
      if (subId) {
        const { data: agentSub } = await admin
          .from("connect_agent_subscriptions")
          .select("id")
          .eq("stripe_subscription_id", subId)
          .maybeSingle();
        if (agentSub) {
          await admin
            .from("connect_agent_subscriptions")
            .update({
              status: "active",
              current_period_end: invoice.period_end ? new Date(invoice.period_end * 1000).toISOString() : null,
              monthly_discount_used_at: null,
            })
            .eq("stripe_subscription_id", subId);
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

      // Abonnement Agent — additif, avant la branche Club+ ci-dessous (les deux lookups sont
      // indépendants par construction : un stripe_subscription_id donné n'existe jamais dans les
      // deux tables à la fois). Statut 'past_due' immédiat : Stripe retente automatiquement selon
      // sa politique de relance, l'utilisateur voit "Paiement en échec" côté Mon abonnement en
      // attendant (jamais un blocage silencieux) — pas d'e-mail dédié en V1 (pas de gabarit
      // "clubplus.paiement_echoue" équivalent pour l'Agent, chantier futur si besoin).
      if (subId) {
        await admin.from("connect_agent_subscriptions").update({ status: "past_due" }).eq("stripe_subscription_id", subId);
      }

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

      // Abonnement Agent — additif, même raisonnement "stripe_subscription_id conservé" que
      // Club+ ci-dessous : la ligne connect_agent_subscriptions n'est jamais supprimée, seul son
      // status passe à 'canceled' (connect_agent_effective_tier() la traite alors comme
      // 'gratuit' — même effet pratique qu'une suppression, sans perdre l'historique).
      await admin.from("connect_agent_subscriptions").update({ status: "canceled" }).eq("stripe_subscription_id", sub.id);

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
    // Bug corrigé (audit paiements, 2026-08-15) : la ligne stripe_events est insérée EN TOUT DÉBUT
    // (déduplication atomique, cf. plus haut) — donc AVANT que le traitement ci-dessus ait réussi.
    // Si ce traitement lève une exception non rattrapée localement (ex. incident réseau Supabase en
    // plein milieu d'un update), l'événement était jusqu'ici marqué "déjà vu" pour toujours : ni un
    // retry automatique Stripe, ni un renvoi manuel depuis le dashboard Stripe ne le retraiteraient
    // jamais (la vérification d'idempotence en tête de fonction les aurait tous deux ignorés comme
    // doublons). Un paiement pouvait donc rester indéfiniment "en attente" — exactement ce que
    // MASTER-CONNECT-V1.md §25 interdit explicitement. On supprime donc la ligne stripe_events ici
    // pour que l'événement reste rejouable, et on logue systématiquement l'erreur (console.error)
    // pour qu'un incident soit visible dans les logs Supabase et pas seulement dans le corps de la
    // réponse HTTP, que personne ne consulte en pratique.
    console.error(`[stripe-webhook] échec du traitement de l'événement ${event.id} (${event.type}) :`, e);
    await sendCriticalAlertEmail(
      "événement Stripe non traité",
      `Le traitement de l'événement Stripe ${event.id} (${event.type}) a levé une exception ` +
        `non rattrapée.\n\nerreur : ${e instanceof Error ? e.message + "\n" + (e.stack || "") : String(e)}\n\n` +
        `L'événement a été retiré de stripe_events pour rester rejouable (renvoi manuel possible ` +
        `depuis le dashboard Stripe), mais vérifier ce qui a réellement été appliqué ou non côté base.`,
    );
    try {
      await admin.from("stripe_events").delete().eq("id", event.id);
    } catch (delErr) {
      console.error(`[stripe-webhook] échec de la suppression de stripe_events après erreur (event ${event.id}) :`, delErr);
    }
    // On accuse toujours réception à Stripe (200) pour éviter des re-livraisons en boucle sur un
    // bug permanent (par opposition à un incident transitoire) ; la ligne stripe_events supprimée
    // ci-dessus permet malgré tout un nouvel essai via renvoi manuel du webhook depuis le dashboard
    // Stripe si besoin.
    return new Response(JSON.stringify({ received: true, error: e instanceof Error ? e.message : String(e) }), { status: 200 });
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 });
});

// Alerte critique par e-mail — trouvé par l'audit pré-lancement du 21/08 (INC-048) : aucun
// monitoring/alerting n'existe sur ce projet, et c'est précisément l'absence de ce genre de
// filet qui avait rendu INC-033 (paiement Stripe jamais reflété) invisible pendant un temps
// indéterminé. Pas de Sentry (pas de compte configuré) : réutilise l'infrastructure Resend déjà
// en place dans ce même fichier (sendPaymentReceiptEmail) pour prévenir Fouka directement,
// best-effort — ne doit jamais faire échouer le traitement du webhook lui-même si l'envoi rate.
async function sendCriticalAlertEmail(subject: string, detail: string) {
  try {
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) return;
    const fromEmail = Deno.env.get("FROM_EMAIL") || "SportVision <onboarding@resend.dev>";
    const alertEmail = Deno.env.get("ALERT_EMAIL") || "elkanagroup0@gmail.com";
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: fromEmail,
        to: [alertEmail],
        subject: `⚠️ SportVision — ${subject}`,
        html: `<pre style="font-family:monospace;white-space:pre-wrap;font-size:13px">${
          detail.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] as string))
        }</pre>`,
      }),
    });
  } catch (_e) {
    console.error("[stripe-webhook] échec de l'envoi de l'alerte critique elle-même :", _e);
  }
}

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
