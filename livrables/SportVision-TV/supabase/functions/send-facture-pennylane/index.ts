// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.
// Étape à faire à chaque édition : Supabase Dashboard → Edge Functions →
// send-facture-pennylane → coller ce code → Deploy.
// Oublier cette étape est la cause la plus fréquente de "le code est bon
// mais ça ne marche pas en prod" sur ce projet (déjà arrivé sur au moins
// 5 fonctions : clubplus-billing-portal, create-clubplus-subscription-
// checkout, dispatch-notifications, create-guest-rdv, create-guest-request).

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

    // Réservation atomique : marque la facture "en cours d'envoi" avant tout
    // appel Pennylane. Empêche un retry (double-clic, timeout réseau côté
    // staff) de créer une SECONDE facture légale pendant qu'un premier envoi
    // est encore en vol — bug identifié le 2026-08-06 : si l'update final
    // (plus bas) échouait après une création Pennylane réussie, le garde-fou
    // ci-dessus ne protégeait plus rien puisque pennylane_invoice_id restait
    // null. En cas d'échec avant d'obtenir une vraie facture Pennylane, la
    // réservation est relâchée dans le catch ci-dessous.
    const { data: claimed, error: claimErr } = await admin
      .from("factures")
      .update({ pennylane_invoice_id: "pending" })
      .eq("id", facture_id)
      .is("pennylane_invoice_id", null)
      .select("id")
      .maybeSingle();
    if (claimErr) return json({ error: claimErr.message }, 500);
    if (!claimed) {
      return json({ error: "Cette facture a déjà été envoyée à Pennylane (ou un envoi est déjà en cours)." }, 409);
    }

    const pennylaneHeaders = {
      Authorization: `Bearer ${pennylaneApiKey}`,
      "Content-Type": "application/json",
    };

    // Relâche la réservation "pending" pour permettre un futur retry légitime,
    // utilisé sur tout chemin d'échec avant l'obtention d'une vraie facture
    // Pennylane (sans quoi la facture resterait bloquée indéfiniment).
    async function releaseClaim() {
      await admin.from("factures").update({ pennylane_invoice_id: null }).eq("id", facture_id).eq("pennylane_invoice_id", "pending");
    }

    let invoice: { id: number | string; invoice_number?: string; public_file_url?: string };
    try {
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
        if (!custRes.ok) {
          await releaseClaim();
          return json({ error: "Pennylane (client) : " + (await custRes.text()) }, 502);
        }
        const cust = await custRes.json();
        pennylaneCustomerId = String(cust.id);
        await admin.from("clients").update({ pennylane_customer_id: pennylaneCustomerId }).eq("id", client.id);
      }

      // 2. Créer la facture. Idempotency-Key : protection best-effort si
      // Pennylane la supporte (retry réseau identique ne recrée pas la
      // facture) — sans garantie documentée, la réservation atomique
      // ci-dessus reste la protection principale côté SportVision.
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
        headers: { ...pennylaneHeaders, "Idempotency-Key": `facture-${facture_id}` },
        body: JSON.stringify({
          customer_id: Number(pennylaneCustomerId),
          date: facture.date_emission || new Date().toISOString().slice(0, 10),
          deadline: facture.date_echeance || new Date().toISOString().slice(0, 10),
          invoice_lines: invoiceLines,
        }),
      });
      if (!invRes.ok) {
        await releaseClaim();
        return json({ error: "Pennylane (facture) : " + (await invRes.text()) }, 502);
      }
      invoice = await invRes.json();
    } catch (e) {
      await releaseClaim();
      return json({ error: "Pennylane : " + (e instanceof Error ? e.message : String(e)) }, 502);
    }

    // La facture existe désormais réellement chez Pennylane : on ne relâche
    // plus jamais la réservation à partir d'ici, même si l'enregistrement
    // échoue ci-dessous — un retry ne doit plus jamais recréer la facture.
    let saved = false;
    let lastErr: { message: string } | null = null;
    for (let attempt = 0; attempt < 3 && !saved; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 300 * attempt));
      const { error: updateErr } = await admin
        .from("factures")
        .update({
          pennylane_invoice_id: String(invoice.id),
          pennylane_invoice_number: invoice.invoice_number || null,
          pennylane_public_url: invoice.public_file_url || null,
        })
        .eq("id", facture_id);
      if (!updateErr) { saved = true; break; }
      lastErr = updateErr;
    }
    if (!saved) {
      // Échec d'enregistrement après succès Pennylane : on remonte les
      // identifiants réels au staff pour renseignement manuel plutôt que
      // de risquer un doublon si quelqu'un relance l'envoi plus tard.
      return json({
        error: "Facture créée chez Pennylane mais non enregistrée côté SportVision après plusieurs tentatives : " + (lastErr?.message || "erreur inconnue"),
        pennylane_invoice_id: String(invoice.id),
        pennylane_invoice_number: invoice.invoice_number || null,
        pennylane_public_url: invoice.public_file_url || null,
      }, 500);
    }

    return json({
      sent: true,
      pennylane_invoice_number: invoice.invoice_number,
      pennylane_public_url: invoice.public_file_url,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
