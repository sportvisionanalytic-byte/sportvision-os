// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.
// Étape à faire à chaque édition : Supabase Dashboard → Edge Functions →
// send-facture-email → coller ce code → Deploy.
// Oublier cette étape est la cause la plus fréquente de "le code est bon
// mais ça ne marche pas en prod" sur ce projet (déjà arrivé sur au moins
// 5 fonctions : clubplus-billing-portal, create-clubplus-subscription-
// checkout, dispatch-notifications, create-guest-rdv, create-guest-request).

// Supabase Edge Function — send-facture-email
// Fetches a real facture (table `factures`) from Supabase and sends a professional HTML email via Resend.
// Deploy via Supabase dashboard > Edge Functions > New Function (name: send-facture-email)
// Required secrets: RESEND_API_KEY, FROM_EMAIL (optional, defaults to onboarding@resend.dev)
// Même mécanisme que send-devis-email, adapté à la table factures.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Vérifie que l'appelant est un membre du staff SportVision authentifié
    // (aucune confiance dans une simple présence d'apikey : n'importe qui peut lire
    // la clé anon publique dans le code source de la page).
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Authentification requise" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Session invalide" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { facture_id, to, subject, message } = await req.json();

    if (!facture_id || !to) {
      return new Response(JSON.stringify({ error: "facture_id et to sont requis" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

    // Seul un membre du staff (ligne dans `profiles`, distinct des comptes Portail
    // client dans `client_users`) peut envoyer une facture par e-mail.
    const { data: staffProfile } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (!staffProfile) {
      return new Response(JSON.stringify({ error: "Non autorisé" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: factArr, error: factErr } = await supabase
      .from("factures")
      .select("*, clients(*), prestation:prestations(id,reference,date_prestation,lieu,description_besoin,livrables_demandes)")
      .eq("id", facture_id)
      .limit(1);

    if (factErr || !factArr?.length) {
      return new Response(JSON.stringify({ error: "Facture introuvable" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const f = factArr[0];
    const c = f.clients || {};
    const lignes: Array<{ description?: string; libelle?: string; details?: string; quantite?: number; qte?: number; prix_unitaire?: number; pu?: number }> = Array.isArray(f.lignes) ? f.lignes : [];

    const fmt = (n: number) =>
      (n || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
    const fd = (s: string) =>
      s ? new Date(s).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" }) : "—";

    const stLbl: Record<string, string> = {
      brouillon: "Brouillon", emise: "Émise", payee: "Payée",
      en_retard: "En retard", annulee: "Annulée", remboursee: "Remboursée",
    };
    const stClr: Record<string, string> = {
      brouillon: "#8891A8", emise: "#366BFF", payee: "#2ECC8A",
      en_retard: "#F0445E", annulee: "#8891A8", remboursee: "#F5A524",
    };

    const lignesHtml = lignes.length
      ? lignes.map((l) => {
          const qte = l.quantite || l.qte || 1;
          const pu = l.prix_unitaire || l.pu || 0;
          return `<tr>
            <td style="padding:10px 16px;border-bottom:1px solid #E8EBF4;vertical-align:top">
              <div style="font-weight:600;font-size:13px;color:#1a1a2e">${l.description || l.libelle || "—"}</div>
              ${l.details ? `<div style="font-size:11.5px;color:#555E73;margin-top:2px">${l.details}</div>` : ""}
            </td>
            <td style="padding:10px 16px;border-bottom:1px solid #E8EBF4;text-align:center;color:#555E73">${qte}</td>
            <td style="padding:10px 16px;border-bottom:1px solid #E8EBF4;text-align:right;color:#555E73;font-variant-numeric:tabular-nums">${fmt(pu)}</td>
            <td style="padding:10px 16px;border-bottom:1px solid #E8EBF4;text-align:right;font-weight:700;font-variant-numeric:tabular-nums;color:#1a1a2e">${fmt(qte * pu)}</td>
          </tr>`;
        }).join("")
      : `<tr><td colspan="4" style="padding:16px;color:#555E73;font-size:12.5px">
          <div style="font-weight:600">${f.prestation?.description_besoin || "Prestation SportVision"}</div>
          ${f.prestation?.livrables_demandes ? `<div style="margin-top:4px;color:#8891A8">${f.prestation.livrables_demandes}</div>` : ""}
        </td></tr>`;

    const msgHtml = (message || "")
      .split("\n")
      .map((l: string) => `<p style="margin:0 0 8px 0">${l || "&nbsp;"}</p>`)
      .join("");

    const htmlEmail = `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${subject || "Facture — SportVision"}</title></head>
<body style="margin:0;padding:0;background:#F0F2F7;font-family:'Helvetica Neue',Arial,sans-serif;font-size:13px;color:#1a1a2e">
  <div style="max-width:680px;margin:32px auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">

    <!-- Header -->
    <div style="background:#1a1a2e;padding:28px 36px;display:flex;justify-content:space-between;align-items:center">
      <div>
        <div style="font-size:22px;font-weight:800;color:#fff;letter-spacing:-.02em">SportVision</div>
        <div style="font-size:10px;color:#8891A8;text-transform:uppercase;letter-spacing:.1em;margin-top:2px">Elkana Group</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:26px;font-weight:800;color:#2ECC8A;letter-spacing:-.01em">FACTURE</div>
        <div style="font-size:12px;color:#8891A8;margin-top:2px">${f.numero || "—"}</div>
        <div style="margin-top:6px"><span style="display:inline-block;padding:2px 10px;border-radius:20px;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;background:${stClr[f.statut] || "#8891A8"}33;color:${stClr[f.statut] || "#8891A8"}">${stLbl[f.statut] || f.statut}</span></div>
      </div>
    </div>

    <!-- Message perso -->
    <div style="padding:28px 36px 0;font-size:13.5px;line-height:1.7;color:#1a1a2e">
      ${msgHtml}
    </div>

    <!-- Infos -->
    <div style="margin:24px 36px;background:#F5F7FF;border-radius:10px;padding:16px 20px;display:grid;grid-template-columns:repeat(3,1fr);gap:16px">
      <div><div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#8891A8;margin-bottom:4px">Émission</div><div style="font-size:12.5px;font-weight:600;color:#1a1a2e">${fd(f.date_emission)}</div></div>
      <div><div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#8891A8;margin-bottom:4px">Échéance</div><div style="font-size:12.5px;font-weight:600;color:#1a1a2e">${fd(f.date_echeance)}</div></div>
      <div><div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#8891A8;margin-bottom:4px">Destinataire</div><div style="font-size:12.5px;font-weight:600;color:#1a1a2e">${c.nom || "—"}</div></div>
    </div>

    <!-- Lignes facture -->
    <div style="margin:0 36px 24px">
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr>
            ${["Description", "Qté", "Prix unit. HT", "Total HT"].map((h, i) =>
              `<th style="background:#1a1a2e;color:#fff;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;padding:10px 16px;text-align:${i > 0 ? "right" : "left"}">${h}</th>`
            ).join("")}
          </tr>
        </thead>
        <tbody>${lignesHtml}</tbody>
      </table>

      <!-- Totaux -->
      <div style="display:flex;justify-content:flex-end;margin-top:4px">
        <table style="width:280px;border-collapse:collapse">
          <tr><td style="padding:6px 0;font-size:12.5px;color:#555E73;border-bottom:1px solid #E8EBF4">Total HT</td><td style="padding:6px 0;text-align:right;font-size:12.5px;color:#555E73;border-bottom:1px solid #E8EBF4;font-variant-numeric:tabular-nums">${fmt(f.montant_ht || 0)}</td></tr>
          <tr><td style="padding:6px 0;font-size:12.5px;color:#555E73;border-bottom:1px solid #E8EBF4">TVA (${f.tva_pct || 20}%)</td><td style="padding:6px 0;text-align:right;font-size:12.5px;color:#555E73;border-bottom:1px solid #E8EBF4;font-variant-numeric:tabular-nums">${fmt((f.montant_ttc || 0) - (f.montant_ht || 0))}</td></tr>
          <tr><td style="padding:12px 0;font-size:17px;font-weight:800;color:#1a1a2e;border-top:2px solid #1a1a2e">TOTAL TTC</td><td style="padding:12px 0;text-align:right;font-size:17px;font-weight:800;color:#2ECC8A;border-top:2px solid #1a1a2e;font-variant-numeric:tabular-nums">${fmt(f.montant_ttc || 0)}</td></tr>
        </table>
      </div>
    </div>

    <!-- Footer -->
    <div style="border-top:1px solid #E8EBF4;padding:20px 36px;background:#FAFBFD">
      <div style="font-size:11px;color:#8891A8;line-height:1.6;margin-bottom:14px">
        Facture à régler avant le ${fd(f.date_echeance)}. Merci de préciser la référence "${f.numero || ""}" lors du règlement.<br>
        Paiement par virement bancaire à 30 jours. Pas d'escompte pour paiement anticipé.<br>
        Pénalité de retard : taux d'intérêt légal x3. Indemnité forfaitaire pour frais de recouvrement : 40 €.
      </div>
      <div style="font-size:10.5px;color:#8891A8;line-height:1.6;border-top:1px solid #E8EBF4;padding-top:12px">
        SportVision — Elkana Group, SAS — 4 Place Pierre Sémard, 77130 Montereau-Fault-Yonne<br>
        SIREN 105 173 124 · SIRET 105 173 124 00014 · RCS Melun · APE 74.20Z<br>
        TVA intracommunautaire : FR15 105 173 124
      </div>
    </div>
  </div>
</body></html>`;

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail = Deno.env.get("FROM_EMAIL") || "SportVision <onboarding@resend.dev>";

    if (!resendApiKey) {
      return new Response(JSON.stringify({ error: "RESEND_API_KEY non configurée dans les secrets Supabase." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [to],
        subject: subject || `Facture ${f.numero || ""} — SportVision`,
        html: htmlEmail,
      }),
    });

    const resendData = await resendRes.json();

    if (!resendRes.ok) {
      return new Response(JSON.stringify({ error: resendData.message || "Erreur Resend", details: resendData }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Marquer la facture comme émise si elle était en brouillon
    if (f.statut === "brouillon") {
      await supabase.from("factures").update({ statut: "emise" }).eq("id", facture_id);
    }

    return new Response(JSON.stringify({ success: true, email_id: resendData.id }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
