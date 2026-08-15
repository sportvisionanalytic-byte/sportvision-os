// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.
// Étape à faire à chaque édition : Supabase Dashboard → Edge Functions →
// create-checkout-session → coller ce code → Deploy.
// Oublier cette étape est la cause la plus fréquente de "le code est bon
// mais ça ne marche pas en prod" sur ce projet (déjà arrivé sur au moins
// 5 fonctions : clubplus-billing-portal, create-clubplus-subscription-
// checkout, dispatch-notifications, create-guest-rdv, create-guest-request).

// Supabase Edge Function — create-checkout-session
// Crée une session Stripe Checkout pour un acompte, un solde ou un paiement total,
// lié à un devis et/ou une prestation. Insère la ligne `paiements` correspondante en 'en_attente'.
// Deploy via Supabase dashboard > Edge Functions > New Function (name: create-checkout-session)
// Secrets requis : SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY, CONNECT_URL
//
// AJOUT 15/08/2026 (migration-connect-v63-prestation-montage-compilation.sql) : deux nouveaux
// éléments, tous deux dans le seul chemin où le montant est calculé depuis le catalogue (offre
// pas encore chiffrée par le staff) — AUCUN changement pour une prestation déjà chiffrée
// manuellement (montant_ttc déjà renseigné) :
//   1. Tarif à palier générique (catalogue_offres.tarif_palier vs prestations.duree_rush_
//      minutes) — ex. Montage Compilation, rush > 6 min → 80 € HT au lieu du prix de base.
//   2. Remises Agent (connect_agent_discount(), migration-connect-v57 — NON MODIFIÉE) :
//      montage_pct (-5% permanent sur "Montage Compilation" slug exact) + monthly_pct (-10% une
//      fois par période, sur n'importe quelle prestation, si le body porte
//      `apply_monthly_discount: true` ET que le payeur est account_type='particulier'). Seule
//      cette fonction décide du montant réellement facturé — jamais une valeur reçue du client.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Authentification requise" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
    const connectUrl = Deno.env.get("CONNECT_URL") || "https://connect.sportvision-an.fr";

    if (!stripeSecretKey) return json({ error: "STRIPE_SECRET_KEY non configurée" }, 500);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Session invalide" }, 401);
    const user = userData.user;

    const { devis_id, prestation_id, type_paiement, apply_monthly_discount } = await req.json();
    if (!devis_id && !prestation_id) return json({ error: "devis_id ou prestation_id requis" }, 400);
    if (!["acompte", "solde", "totalite"].includes(type_paiement)) {
      return json({ error: "type_paiement invalide" }, 400);
    }
    // Choix du payeur d'appliquer sa remise mensuelle Agent (-10%, palier Pro, une fois par
    // période — migration-connect-v57 §2 + v63) à CETTE prestation précise. Une simple intention
    // côté client : n'a AUCUN effet tant que ce n'est pas revérifié plus bas via
    // connect_agent_discount() (monthly_pct > 0, jamais déjà consommée) — jamais un pourcentage
    // ou un montant transmis par le client.
    const applyMonthlyDiscount = apply_monthly_discount === true;

    const admin = createClient(supabaseUrl, serviceKey);

    // Résolution du client payeur — deux profils possibles :
    // 1. Compte "Espace Projet"/club via `client_users` (cas historique, portail).
    // 2. Compte joueur Connect (Espace joueur, 12/08/2026) : pas de ligne `client_users`, le
    //    client_id est résolu (et provisionné à la demande) via `resolve_player_client_id`,
    //    exactement comme useClientId.ts côté app-next et connect-player-prestations côté
    //    app-connect. Appelée avec le JWT utilisateur (userClient), jamais service_role : la
    //    fonction SQL est SECURITY DEFINER et vérifie elle-même auth.uid() en interne.
    let resolvedClientId: string | null = null;
    const { data: clientUser } = await admin
      .from("client_users")
      .select("client_id")
      .eq("id", user.id)
      .maybeSingle();
    if (clientUser) {
      resolvedClientId = clientUser.client_id;
    } else {
      const { data: playerProfile } = await admin
        .from("player_profiles")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (playerProfile) {
        const { data: playerClientId } = await userClient.rpc("resolve_player_client_id", { p_player_id: playerProfile.id });
        if (playerClientId) resolvedClientId = playerClientId as string;
      }
    }
    if (!resolvedClientId) return json({ error: "Compte client introuvable" }, 403);

    // Résout la prestation cible et vérifie qu'elle appartient bien au client authentifié
    let prestation: {
      id: string | null;
      client_id: string;
      montant_ttc: number | null;
      acompte_montant: number | null;
      reference: string | null;
      offre_id?: string | null;
      options_selectionnees?: string[] | null;
      duree_rush_minutes?: number | null;
    } | null = null;

    if (prestation_id) {
      const { data } = await admin
        .from("prestations")
        .select("id, client_id, montant_ttc, acompte_montant, reference, offre_id, options_selectionnees, duree_rush_minutes")
        .eq("id", prestation_id)
        .maybeSingle();
      prestation = data;
    } else {
      const { data: devis } = await admin
        .from("devis")
        .select("id, client_id, prestation_id, total_ttc, numero")
        .eq("id", devis_id)
        .maybeSingle();
      if (!devis) return json({ error: "Devis introuvable" }, 404);
      if (devis.prestation_id) {
        const { data } = await admin
          .from("prestations")
          .select("id, client_id, montant_ttc, acompte_montant, reference, offre_id, options_selectionnees, duree_rush_minutes")
          .eq("id", devis.prestation_id)
          .maybeSingle();
        prestation = data;
      } else {
        prestation = {
          id: null,
          client_id: devis.client_id,
          montant_ttc: devis.total_ttc,
          acompte_montant: null,
          reference: devis.numero,
        };
      }
    }

    if (!prestation || prestation.client_id !== resolvedClientId) {
      return json({ error: "Non autorisé" }, 403);
    }

    let totalTtc = Number(prestation.montant_ttc || 0);
    // Pourcentage de remise Agent réellement appliqué (montage_pct + éventuellement monthly_pct)
    // — recalculé ci-dessous, jamais transmis par le client. N'affecte que le libellé Stripe
    // (transparence) : le montant lui-même est déjà recalculé avec la remise incluse.
    let appliedDiscountPct = 0;
    // true seulement si la remise mensuelle Agent (-10%, palier Pro) a réellement été appliquée à
    // CE paiement — transporté jusqu'au webhook via les metadata Stripe pour que la consommation
    // (monthly_discount_used_at) ne soit écrite qu'après confirmation du paiement (jamais ici).
    let monthlyDiscountApplied = false;

    // La prestation vient d'être créée par le client et n'a pas encore été chiffrée par le staff :
    // si elle référence une offre catalogue à tarif fixe, on calcule le montant depuis le catalogue
    // (source de confiance, jamais depuis une valeur transmise par le client) plutôt que d'attendre.
    if (!totalTtc && prestation.offre_id) {
      const { data: offre } = await admin
        .from("catalogue_offres")
        .select("slug, prix_ht, tva_pct, tarif_type, options, tarif_palier")
        .eq("id", prestation.offre_id)
        .maybeSingle();
      if (offre && offre.tarif_type === "fixe" && offre.prix_ht != null) {
        const selected: string[] = prestation.options_selectionnees || [];
        const catalogOptions: Array<{ nom?: string; prix_ht?: number }> = Array.isArray(offre.options) ? offre.options : [];
        const optionsHt = catalogOptions
          .filter((o) => o.nom && selected.includes(o.nom))
          .reduce((sum, o) => sum + Number(o.prix_ht || 0), 0);

        // Tarif à palier (ex. Montage Compilation : rush > 6 min → 80 € HT, PROVISOIRE — cf.
        // migration-connect-v63). Lu depuis catalogue_offres.tarif_palier, comparé à
        // prestations.duree_rush_minutes tel que DÉCLARÉ À LA CRÉATION de la demande (jamais une
        // valeur envoyée dans CETTE requête de paiement) : ni le seuil, ni le prix au-delà, ni la
        // durée ne viennent du client à cet instant.
        let baseHt = Number(offre.prix_ht);
        const palier = offre.tarif_palier as { seuil_minutes?: number; prix_ht_au_dela?: number } | null;
        if (
          palier?.seuil_minutes != null &&
          palier?.prix_ht_au_dela != null &&
          prestation.duree_rush_minutes != null &&
          Number(prestation.duree_rush_minutes) > Number(palier.seuil_minutes)
        ) {
          baseHt = Number(palier.prix_ht_au_dela);
        }
        baseHt += optionsHt;

        // Remises Agent (Espace particulier, migration-connect-v57 + v63) — recalculées ICI
        // depuis connect_agent_discount(), jamais depuis un pourcentage transmis par le client.
        // Scope strict : uniquement pour un payeur connect_profile_settings.account_type =
        // 'particulier' (comportement strictement inchangé pour tout paiement club/Espace Projet
        // — aucune de ces requêtes n'a de ligne 'particulier', donc remisePct reste à 0).
        //   - montage_pct : -5% permanent, UNIQUEMENT sur "Montage Compilation" (slug exact).
        //   - monthly_pct : -10% une fois par période, sur N'IMPORTE QUELLE prestation, palier
        //     Pro uniquement, et seulement si le payeur a coché "Appliquer ma remise mensuelle"
        //     (apply_monthly_discount du body) — jamais appliquée automatiquement, c'est au
        //     payeur de choisir sur quelle prestation la consommer.
        let remisePct = 0;
        const { data: profileSettings } = await admin
          .from("connect_profile_settings")
          .select("account_type")
          .eq("user_id", user.id)
          .maybeSingle();
        if (profileSettings?.account_type === "particulier") {
          const { data: discount } = await userClient.rpc("connect_agent_discount", { p_user_id: user.id });
          const d = discount as { montage_pct?: number; monthly_pct?: number } | null;
          if (d) {
            if (offre.slug === "montage-compilation" && d.montage_pct) {
              remisePct += Number(d.montage_pct);
            }
            if (applyMonthlyDiscount && d.monthly_pct) {
              remisePct += Number(d.monthly_pct);
              monthlyDiscountApplied = true;
            }
          }
        }
        appliedDiscountPct = remisePct;

        const baseHtRemise = Math.round(baseHt * (1 - remisePct / 100) * 100) / 100;
        totalTtc = Math.round(baseHtRemise * (1 + Number(offre.tva_pct ?? 20) / 100) * 100) / 100;
      }
    }

    if (!totalTtc) {
      return json({ error: "Tarif non disponible pour le moment, contactez SportVision." }, 400);
    }

    let montant: number;

    if (type_paiement === "acompte") {
      montant = prestation.acompte_montant != null ? Number(prestation.acompte_montant) : Math.round(totalTtc * 0.3 * 100) / 100;
    } else if (type_paiement === "totalite") {
      montant = totalTtc;
    } else {
      const { data: paidRows } = await admin
        .from("paiements")
        .select("montant")
        .eq("prestation_id", prestation.id)
        .eq("statut", "reussi");
      const dejaRegle = (paidRows || []).reduce((sum, r) => sum + Number(r.montant), 0);
      montant = Math.max(0, Math.round((totalTtc - dejaRegle) * 100) / 100);
    }

    if (!montant || montant <= 0) return json({ error: "Montant à payer nul" }, 400);

    const { data: paiement, error: paiementErr } = await admin
      .from("paiements")
      .insert({
        prestation_id: prestation.id,
        devis_id: devis_id || null,
        client_id: resolvedClientId,
        type_paiement,
        montant,
        statut: "en_attente",
      })
      .select("id")
      .single();
    if (paiementErr) return json({ error: paiementErr.message }, 500);

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    const label = `SportVision — ${type_paiement} ${prestation.reference || ""}`.trim()
      + (appliedDiscountPct > 0 ? ` (remise Agent -${appliedDiscountPct}%)` : "");

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
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
      // SportVision Portail a été entièrement retiré (2026-08-07) — Connect
      // est désormais la seule app appelante possible, plus besoin de
      // distinguer par "caller" ni de fallback vers un domaine retiré.
      // Redirige vers /commandes (13/08/2026, module Prestations/Mes commandes) plutôt que la
      // racine : c'est la page qui affiche l'état RÉEL de la commande (jamais déduit du simple
      // retour navigateur — MASTER-CONNECT-V1.md §25 — uniquement de statut_financier/paiements
      // en base, mis à jour par stripe-webhook). Les query params ne servent qu'à afficher un
      // message d'attente ("paiement en cours de confirmation"), jamais un statut "payé" direct.
      success_url: `${connectUrl}/commandes?paiement=succes&paiement_id=${paiement.id}`,
      cancel_url: `${connectUrl}/commandes?paiement=annule&paiement_id=${paiement.id}`,
      client_reference_id: paiement.id,
      // apply_monthly_discount/agent_user_id : uniquement présents quand la remise mensuelle
      // Agent (-10%, palier Pro, une fois par période — migration-connect-v57 §2 + v63) a
      // réellement été appliquée au calcul de `montant` ci-dessus. stripe-webhook les lit sur
      // checkout.session.completed pour écrire monthly_discount_used_at APRÈS confirmation du
      // paiement uniquement (jamais ici, jamais avant) — voir son en-tête.
      metadata: {
        paiement_id: paiement.id,
        ...(monthlyDiscountApplied ? { apply_monthly_discount: "true", agent_user_id: user.id } : {}),
      },
      customer_email: user.email ?? undefined,
    });

    await admin.from("paiements").update({ stripe_checkout_session_id: session.id }).eq("id", paiement.id);

    return json({ url: session.url });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
