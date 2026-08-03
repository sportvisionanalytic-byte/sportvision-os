// Supabase Edge Function — send-facture-pennylane
// Envoie une facture SportVision vers Pennylane (Plateforme de Dématérialisation
// Partenaire) pour se conformer à la réforme de la facturation électronique
// (réception obligatoire pour toutes les entreprises dès le 1er septembre 2026).
// Crée le client Pennylane s'il n'existe pas encore (mémorisé sur clients.
// pennylane_customer_id pour ne le créer qu'une fois), puis crée la facture.
// Deploy via Supabase dashboard > Edge Functions > New Function (name: send-facture-pennylane)
// Secrets requis : SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (déjà présents),
//                  PENNYLANE_API_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

const PENNYLANE_BASE = "https://app.pennylane.com/api/external/v2";

// Pennylane attend un taux de TVA sous forme de code (pas un simple pourcentage).
// Les taux français courants sont mappés ici ; on retombe sur 20% si le taux
// utilisé chez nous ne correspond à aucun taux légal français connu.
function vatRateCode(tvaPct: number | null | undefined): string {
  const map: Record<string, string> = { "20": "FR_200", "10": "FR_100", "5.5": "FR_055", "2.1": "FR_021", "0": "FR_0" };
  return map[String(tvaPct ?? 20)] || "FR_200";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Authentification requise" }, 401);

    const { facture_id } = await req.json();
    if (!facture_id) return json({ error: "facture_id requis" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const pennylaneApiKey = Deno.env.get("PENNYLANE_API_KEY") ?? "";
    if (!pennylaneApiKey) return json({ error: "PENNYLANE_API_KEY non configurée" }, 500);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Session invalide" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: profile } = await admin.from("profiles").select("role").eq("id", userData.user.id).maybeSingle();
    if (!profile || !["admin", "sec", "compta"].includes(profile.role)) {
      return json({ error: "Réservé au staff (admin/sec/compta)" }, 403);
    }

    const { data: facture, error: factureErr } = await admin
      .from("factures")
      .select("*, clients(id,nom,email,adresse,ville,code_postal,pennylane_customer_id)")
      .eq("id", facture_id)
      .maybeSingle();
    if (factureErr || !facture) return json({ error: "Facture introuvable" }, 404);
    const client = facture.clients;
    if (!client) return json({ error: "Facture sans client associé" }, 400);
    if (facture.pennylane_invoice_id) {
      return json({ error: "Cette facture a déjà été envoyée à Pennylane" }, 409);
    }

    const pennylaneHeaders = {
      Authorization: `Bearer ${pennylaneApiKey}`,
      "Content-Type": "application/json",
    };

    // 1. Trouver ou créer le client Pennylane (une seule fois par client SportVision)
    let pennylaneCustomerId = client.pennylane_customer_id;
    if (!pennylaneCustomerId) {
      const custRes = await fetch(`${PENNYLANE_BASE}/company_customers`, {
        method: "POST",
        headers: pennylaneHeaders,
        body: JSON.stringify({
          name: client.nom,
          emails: client.email ? [client.email] : [],
          billing_address: {
            address: client.adresse || "Non renseignée",
            postal_code: client.code_postal || "00000",
            city: client.ville || "Non renseignée",
            country_alpha2: "FR",
          },
        }),
      });
      if (!custRes.ok) return json({ error: "Pennylane (client) : " + (await custRes.text()) }, 502);
      const cust = await custRes.json();
      pennylaneCustomerId = String(cust.id);
      await admin.from("clients").update({ pennylane_customer_id: pennylaneCustomerId }).eq("id", client.id);
    }

    // 2. Créer la facture
    const lignes = Array.isArray(facture.lignes) ? facture.lignes : [];
    const invoiceLines = (lignes.length ? lignes : [{ description: facture.type_facture || "Prestation SportVision", quantite: 1, prix_unitaire: facture.montant_ht }])
      .map((l: any) => ({
        label: l.description || l.libelle || "Prestation SportVision",
        quantity: l.quantite ?? l.qte ?? 1,
        unit: "unit",
        raw_currency_unit_price: String(l.prix_unitaire ?? l.pu ?? 0),
        vat_rate: vatRateCode(facture.tva_pct),
      }));

    const invRes = await fetch(`${PENNYLANE_BASE}/customer_invoices`, {
      method: "POST",
      headers: pennylaneHeaders,
      body: JSON.stringify({
        customer_id: Number(pennylaneCustomerId),
        date: facture.date_emission || new Date().toISOString().slice(0, 10),
        deadline: facture.date_echeance || new Date().toISOString().slice(0, 10),
        invoice_lines: invoiceLines,
      }),
    });
    if (!invRes.ok) return json({ error: "Pennylane (facture) : " + (await invRes.text()) }, 502);
    const invoice = await invRes.json();

    const { error: updateErr } = await admin
      .from("factures")
      .update({
        pennylane_invoice_id: String(invoice.id),
        pennylane_invoice_number: invoice.invoice_number || null,
        pennylane_public_url: invoice.public_file_url || null,
      })
      .eq("id", facture_id);
    if (updateErr) return json({ error: updateErr.message }, 500);

    return json({
      sent: true,
      pennylane_invoice_number: invoice.invoice_number,
      pennylane_public_url: invoice.public_file_url,
    });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
});
