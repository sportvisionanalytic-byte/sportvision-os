// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.
// Étape à faire à chaque édition : Supabase Dashboard → Edge Functions →
// create-guest-deposit-checkout → coller ce code → Deploy.
// Oublier cette étape est la cause la plus fréquente de "le code est bon
// mais ça ne marche pas en prod" sur ce projet.
//
// Supabase Edge Function — create-guest-deposit-checkout
// Crée une session Stripe Checkout pour l'ACOMPTE d'une prestation créée
// sans compte (create-guest-request), depuis reserver.html — donc SANS
// authentification Supabase, contrairement à create-checkout-session (réservé
// aux clients connectés dans Connect). Utilisée uniquement pour les 3 offres
// à tarif fixe (match-photo, match-video, pack-match) : sur devis, le prix
// n'est pas encore connu, donc pas d'acompte possible à ce stade.
//
// Règle produit (2026-08-08, demande fondateur) : l'acompte (30% du prix TTC,
// même taux que create-checkout-session) est OBLIGATOIRE avant confirmation
// définitive pour un client qui réserve pour la première fois — mais devient
// facultatif si ce même e-mail a déjà un paiement "reussi" en base (client
// existant, déjà en confiance). Le solde restant peut lui être réglé par
// carte ou en espèces sur place (préférence exprimée séparément dans
// create-guest-request, colonne prestations.preference_paiement_solde) —
// mais l'acompte, lui, doit TOUJOURS être payé en ligne par carte : c'est la
// seule chose qui garantit réellement la réservation avant intervention
// humaine.
//
// Le paiement créé ici est traité par le webhook Stripe existant
// (stripe-webhook, branche `paiementId`) sans aucune modification : il
// identifie le paiement via metadata.paiement_id, met à jour paiements +
// prestations.acompte_recu + envoie le reçu, exactement comme un acompte payé
// depuis Connect. Rien à dupliquer côté webhook.
//
// Deploy via Supabase dashboard > Edge Functions > New Function
// (name: create-guest-deposit-checkout)
// Secrets requis : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY
//
// Anti-abus : même honeypot/limite de fréquence que les autres fonctions
// invité (guest_rate_limits), espace de noms "deposit:" pour ne jamais
// entrer en collision avec les autres identifiants (ex. "req:" de
// create-guest-request).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const ACOMPTE_TAUX = 0.3;

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
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
    if (!stripeSecretKey) return json({ error: "STRIPE_SECRET_KEY non configurée" }, 500);
    const admin = createClient(supabaseUrl, serviceKey);

    const { prestation_id, email, success_url, cancel_url } = await req.json();
    if (!prestation_id || !email || !success_url || !cancel_url) {
      return json({ error: "prestation_id, email, success_url et cancel_url sont requis" }, 400);
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("cf-connecting-ip") || "inconnu";
    const rateOk = await checkRateLimit(admin, `deposit:${ip}`);
    if (!rateOk) {
      return json({ error: "Trop de demandes envoyées récemment. Merci de réessayer plus tard." }, 429);
    }

    const { data: prestation } = await admin
      .from("prestations")
      .select("id, client_id, offre_id, reference, montant_ttc, acompte_montant")
      .eq("id", prestation_id)
      .maybeSingle();
    if (!prestation) return json({ error: "Prestation introuvable" }, 404);

    const { data: client } = await admin
      .from("clients")
      .select("id, email")
      .eq("id", prestation.client_id)
      .maybeSingle();
    // Vérifie que l'e-mail fourni correspond bien au client de cette prestation
    // (seule "authentification" possible dans un flux 100% anonyme) : empêche
    // de sonder/déclencher un paiement sur la prestation de quelqu'un d'autre
    // en devinant un prestation_id.
    if (!client || client.email.toLowerCase() !== String(email).toLowerCase()) {
      return json({ error: "Non autorisé" }, 403);
    }

    if (!prestation.offre_id) {
      return json({ required: false, reason: "sur_devis" });
    }
    const { data: offre } = await admin
      .from("catalogue_offres")
      .select("prix_ht, tva_pct, tarif_type, nom")
      .eq("id", prestation.offre_id)
      .maybeSingle();
    if (!offre || offre.tarif_type !== "fixe" || offre.prix_ht == null) {
      return json({ required: false, reason: "sur_devis" });
    }

    // Client déjà en confiance (a déjà réglé un paiement "reussi" par le
    // passé, tous types de prestations confondus) : acompte facultatif, on ne
    // bloque pas la confirmation.
    const { count: paiementsReussis } = await admin
      .from("paiements")
      .select("id", { count: "exact", head: true })
      .eq("client_id", client.id)
      .eq("statut", "reussi");
    if ((paiementsReussis || 0) > 0) {
      return json({ required: false, reason: "client_existant" });
    }

    const totalTtc = prestation.montant_ttc != null
      ? Number(prestation.montant_ttc)
      : Math.round(Number(offre.prix_ht) * (1 + Number(offre.tva_pct ?? 20) / 100) * 100) / 100;
    const montant = prestation.acompte_montant != null
      ? Number(prestation.acompte_montant)
      : Math.round(totalTtc * ACOMPTE_TAUX * 100) / 100;
    if (!montant || montant <= 0) return json({ error: "Montant d'acompte nul" }, 400);

    // Réutilise un acompte "en_attente" déjà créé pour cette prestation (ex.
    // le visiteur a fermé l'onglet Stripe et relance) plutôt que d'empiler des
    // lignes orphelines à chaque tentative.
    const { data: existant } = await admin
      .from("paiements")
      .select("id, statut")
      .eq("prestation_id", prestation.id)
      .eq("type_paiement", "acompte")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existant?.statut === "reussi") {
      return json({ required: false, reason: "deja_paye" });
    }

    let paiementId: string;
    if (existant) {
      paiementId = existant.id;
      await admin.from("paiements").update({ montant, statut: "en_attente" }).eq("id", paiementId);
    } else {
      const { data: paiement, error: paiementErr } = await admin
        .from("paiements")
        .insert({
          prestation_id: prestation.id,
          client_id: client.id,
          type_paiement: "acompte",
          montant,
          statut: "en_attente",
        })
        .select("id")
        .single();
      if (paiementErr) return json({ error: paiementErr.message }, 500);
      paiementId = paiement.id;
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    const label = `SportVision — acompte ${offre.nom || ""} ${prestation.reference || ""}`.trim();
    const separator = success_url.includes("?") ? "&" : "?";
    const separatorCancel = cancel_url.includes("?") ? "&" : "?";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      client_reference_id: paiementId,
      metadata: { paiement_id: paiementId },
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: { name: label },
            unit_amount: Math.round(montant * 100),
          },
          quantity: 1,
        },
      ],
      success_url: `${success_url}${separator}paiement=succes&paiement_id=${paiementId}&reference=${encodeURIComponent(prestation.reference || "")}`,
      cancel_url: `${cancel_url}${separatorCancel}paiement=annule&paiement_id=${paiementId}`,
    });

    return json({ required: true, checkout_url: session.url, montant, reference: prestation.reference });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
