// Supabase Edge Function — create-checkout-session
// Crée une session Stripe Checkout pour un acompte, un solde ou un paiement total,
// lié à un devis et/ou une prestation. Insère la ligne `paiements` correspondante en 'en_attente'.
// Deploy via Supabase dashboard > Edge Functions > New Function (name: create-checkout-session)
// Secrets requis : SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY, PORTAL_URL

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
    const portalUrl = Deno.env.get("PORTAL_URL") ?? "https://portail.sportvision.fr";
    const connectUrl = Deno.env.get("CONNECT_URL") || "https://connect.sportvision.fr";

    if (!stripeSecretKey) return json({ error: "STRIPE_SECRET_KEY non configurée" }, 500);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Session invalide" }, 401);
    const user = userData.user;

    const { devis_id, prestation_id, type_paiement, caller } = await req.json();
    if (!devis_id && !prestation_id) return json({ error: "devis_id ou prestation_id requis" }, 400);
    if (!["acompte", "solde", "totalite"].includes(type_paiement)) {
      return json({ error: "type_paiement invalide" }, 400);
    }

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: clientUser } = await admin
      .from("client_users")
      .select("client_id")
      .eq("id", user.id)
      .maybeSingle();
    if (!clientUser) return json({ error: "Compte client introuvable" }, 403);

    // Résout la prestation cible et vérifie qu'elle appartient bien au client authentifié
    let prestation: {
      id: string | null;
      client_id: string;
      montant_ttc: number | null;
      acompte_montant: number | null;
      reference: string | null;
      offre_id?: string | null;
      options_selectionnees?: string[] | null;
    } | null = null;

    if (prestation_id) {
      const { data } = await admin
        .from("prestations")
        .select("id, client_id, montant_ttc, acompte_montant, reference, offre_id, options_selectionnees")
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
          .select("id, client_id, montant_ttc, acompte_montant, reference, offre_id, options_selectionnees")
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

    if (!prestation || prestation.client_id !== clientUser.client_id) {
      return json({ error: "Non autorisé" }, 403);
    }

    let totalTtc = Number(prestation.montant_ttc || 0);

    // La prestation vient d'être créée par le client et n'a pas encore été chiffrée par le staff :
    // si elle référence une offre catalogue à tarif fixe, on calcule le montant depuis le catalogue
    // (source de confiance, jamais depuis une valeur transmise par le client) plutôt que d'attendre.
    if (!totalTtc && prestation.offre_id) {
      const { data: offre } = await admin
        .from("catalogue_offres")
        .select("prix_ht, tva_pct, tarif_type, options")
        .eq("id", prestation.offre_id)
        .maybeSingle();
      if (offre && offre.tarif_type === "fixe" && offre.prix_ht != null) {
        const selected: string[] = prestation.options_selectionnees || [];
        const catalogOptions: Array<{ nom?: string; prix_ht?: number }> = Array.isArray(offre.options) ? offre.options : [];
        const optionsHt = catalogOptions
          .filter((o) => o.nom && selected.includes(o.nom))
          .reduce((sum, o) => sum + Number(o.prix_ht || 0), 0);
        const baseHt = Number(offre.prix_ht) + optionsHt;
        totalTtc = Math.round(baseHt * (1 + Number(offre.tva_pct ?? 20) / 100) * 100) / 100;
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
        client_id: clientUser.client_id,
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

    const label = `SportVision — ${type_paiement} ${prestation.reference || ""}`.trim();

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
      // Avant le 2026-08-06, cette fonction renvoyait TOUJOURS vers PORTAL_URL
      // après paiement, même pour un paiement initié depuis SportVision Connect
      // — le client était donc redirigé vers le Portail au lieu de revenir dans
      // l'app d'où il venait. "caller" est un enum fermé (pas une URL fournie
      // par le client) pour ne jamais introduire de risque de redirection ouverte.
      success_url: `${(caller === "connect" ? connectUrl : portalUrl)}/?paiement=succes&paiement_id=${paiement.id}`,
      cancel_url: `${(caller === "connect" ? connectUrl : portalUrl)}/?paiement=annule&paiement_id=${paiement.id}`,
      client_reference_id: paiement.id,
      metadata: { paiement_id: paiement.id },
      customer_email: user.email ?? undefined,
    });

    await admin.from("paiements").update({ stripe_checkout_session_id: session.id }).eq("id", paiement.id);

    return json({ url: session.url });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
