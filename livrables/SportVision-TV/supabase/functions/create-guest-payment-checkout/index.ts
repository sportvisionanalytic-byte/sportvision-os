// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.
// Étape à faire à chaque édition : Supabase Dashboard → Edge Functions →
// create-guest-payment-checkout → coller ce code → Deploy.
// Oublier cette étape est la cause la plus fréquente de "le code est bon
// mais ça ne marche pas en prod" sur ce projet.
//
// Supabase Edge Function — create-guest-payment-checkout
// Crée une session Stripe Checkout pour le règlement immédiat et TOTAL d'une
// prestation créée sans compte (create-guest-request), depuis reserver.html —
// donc SANS authentification Supabase, contrairement à create-checkout-session
// (réservé aux clients connectés dans Connect). Utilisée uniquement pour les
// 3 offres à tarif fixe (match-photo, match-video, pack-match) : sur devis, le
// prix n'est pas encore connu, donc rien à faire payer à ce stade.
//
// Règle produit (2026-08-08, décision fondateur) : au moment de réserver, le
// client choisit librement carte (paiement immédiat de la totalité, cette
// fonction) ou espèces (rien à payer en ligne, réglé sur place le jour J) —
// cette fonction n'est appelée QUE si le client a choisi carte. Dans les deux
// cas la réservation est confirmée tout de suite, sans condition ni acompte :
// pas de vérification "1ère réservation" ou "client existant" ici, contrairement
// à une version antérieure de cette fonctionnalité (acompte obligatoire),
// abandonnée avant tout déploiement.
//
// Le paiement créé ici est traité par le webhook Stripe existant
// (stripe-webhook, branche `paiementId`) sans aucune modification : il
// identifie le paiement via metadata.paiement_id, met à jour paiements +
// prestations.statut_financier + envoie le reçu, exactement comme un paiement
// depuis Connect. Rien à dupliquer côté webhook.
//
// Deploy via Supabase dashboard > Edge Functions > New Function
// (name: create-guest-payment-checkout)
// Secrets requis : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY
//
// Anti-abus : même honeypot/limite de fréquence que les autres fonctions
// invité (guest_rate_limits), espace de noms "payment:" pour ne jamais entrer
// en collision avec les autres identifiants (ex. "req:" de create-guest-request).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

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
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
    if (!stripeSecretKey) return json({ error: "STRIPE_SECRET_KEY non configurée" }, 500);
    const admin = createClient(supabaseUrl, serviceKey);

    const { prestation_id, email, success_url, cancel_url } = await req.json();
    if (!prestation_id || !email || !success_url || !cancel_url) {
      return json({ error: "prestation_id, email, success_url et cancel_url sont requis" }, 400);
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("cf-connecting-ip") || "inconnu";
    const rateOk = await checkRateLimit(admin, `payment:${ip}`);
    if (!rateOk) {
      return json({ error: "Trop de demandes envoyées récemment. Merci de réessayer plus tard." }, 429);
    }

    const { data: prestation } = await admin
      .from("prestations")
      .select("id, client_id, offre_id, reference, montant_ttc")
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
    // de déclencher un paiement sur la prestation de quelqu'un d'autre en
    // devinant un prestation_id.
    if (!client || client.email.toLowerCase() !== String(email).toLowerCase()) {
      return json({ error: "Non autorisé" }, 403);
    }

    if (!prestation.offre_id) {
      return json({ payable: false, reason: "sur_devis" });
    }
    const { data: offre } = await admin
      .from("catalogue_offres")
      .select("prix_ht, tva_pct, tarif_type, nom")
      .eq("id", prestation.offre_id)
      .maybeSingle();
    if (!offre || offre.tarif_type !== "fixe" || offre.prix_ht == null) {
      return json({ payable: false, reason: "sur_devis" });
    }

    const montant = prestation.montant_ttc != null
      ? Number(prestation.montant_ttc)
      : Math.round(Number(offre.prix_ht) * (1 + Number(offre.tva_pct ?? 20) / 100) * 100) / 100;
    if (!montant || montant <= 0) return json({ error: "Montant nul" }, 400);

    // Réutilise un paiement "en_attente" déjà créé pour cette prestation (ex.
    // le visiteur a fermé l'onglet Stripe et relance) plutôt que d'empiler des
    // lignes orphelines à chaque tentative.
    const { data: existant } = await admin
      .from("paiements")
      .select("id, statut")
      .eq("prestation_id", prestation.id)
      .eq("type_paiement", "totalite")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existant?.statut === "reussi") {
      return json({ payable: false, reason: "deja_paye" });
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
          type_paiement: "totalite",
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

    const label = `SportVision — ${offre.nom || ""} ${prestation.reference || ""}`.trim();
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

    return json({ payable: true, checkout_url: session.url, montant, reference: prestation.reference });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
