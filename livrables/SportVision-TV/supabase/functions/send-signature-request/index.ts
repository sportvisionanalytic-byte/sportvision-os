// Supabase Edge Function — send-signature-request
// Envoie un devis ou un contrat en signature électronique réelle via Youtrust
// (ex-Yousign), en remplacement du statut "signée" auto-déclaré par le client
// dans le Portail. Génère un PDF du document, crée la demande de signature,
// l'active (Youtrust envoie alors un e-mail au client avec un lien pour signer).
// Le webhook youtrust-webhook confirme automatiquement la signature une fois faite.
// Deploy via Supabase dashboard > Edge Functions > New Function (name: send-signature-request)
// Secrets requis : SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (déjà présents),
//                  YOUTRUST_API_KEY, YOUTRUST_API_URL (optionnel, défaut = sandbox)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";

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

const fmtMoney = (n: number | null | undefined) =>
  (n || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const fmtDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" }) : "—";

// Découpe un texte en lignes qui tiennent dans maxWidth, pour une police/taille donnée.
function wrapText(text: string, font: any, size: number, maxWidth: number): string[] {
  const words = (text || "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const test = current ? current + " " + w : w;
    if (font.widthOfTextAtSize(test, size) > maxWidth && current) {
      lines.push(current);
      current = w;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

async function buildPdf(docType: "devis" | "contrat", doc: any, client: any): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage([595, 842]); // A4
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const navy = rgb(0.03, 0.07, 0.12);
  const gray = rgb(0.42, 0.46, 0.52);
  const margin = 50;
  const width = 595;
  let y = 780;

  const addPageIfNeeded = (needed: number) => {
    if (y - needed < 60) {
      page = pdfDoc.addPage([595, 842]);
      y = 780;
    }
  };

  page.drawText("SPORTVISION", { x: margin, y, size: 20, font: bold, color: navy });
  page.drawText("ELKANA GROUP — 4 Place Pierre Sémard, 77130 Montereau-Fault-Yonne", {
    x: margin, y: y - 18, size: 8.5, font: regular, color: gray,
  });
  page.drawText("SIREN 105 173 124 — TVA FR15 105 173 124", {
    x: margin, y: y - 30, size: 8.5, font: regular, color: gray,
  });
  y -= 60;

  const title = docType === "devis" ? `Devis ${doc.numero || ""}` : `Contrat — ${doc.type_contrat || ""}`;
  page.drawText(title, { x: margin, y, size: 16, font: bold, color: navy });
  y -= 26;

  page.drawText("Client", { x: margin, y, size: 9, font: bold, color: gray });
  y -= 14;
  const clientLine = client?.nom || "—";
  page.drawText(clientLine, { x: margin, y, size: 11, font: regular, color: navy });
  y -= 14;
  if (client?.email) {
    page.drawText(client.email, { x: margin, y, size: 10, font: regular, color: gray });
    y -= 14;
  }
  if (client?.adresse || client?.ville) {
    page.drawText([client?.adresse, client?.code_postal, client?.ville].filter(Boolean).join(", "), {
      x: margin, y, size: 10, font: regular, color: gray,
    });
    y -= 14;
  }
  y -= 16;

  if (docType === "devis") {
    const lignes = Array.isArray(doc.lignes) ? doc.lignes : [];
    page.drawText("Description", { x: margin, y, size: 9, font: bold, color: gray });
    page.drawText("Qté", { x: 360, y, size: 9, font: bold, color: gray });
    page.drawText("PU HT", { x: 410, y, size: 9, font: bold, color: gray });
    page.drawText("Total HT", { x: 480, y, size: 9, font: bold, color: gray });
    y -= 16;
    for (const l of lignes) {
      addPageIfNeeded(30);
      const lines = wrapText(l.libelle || "", regular, 10, 300);
      for (const line of lines) {
        page.drawText(line, { x: margin, y, size: 10, font: regular, color: navy });
        y -= 13;
      }
      const qte = l.qte || 1;
      const pu = l.pu || 0;
      page.drawText(String(qte), { x: 360, y: y + 13, size: 10, font: regular, color: navy });
      page.drawText(fmtMoney(pu), { x: 410, y: y + 13, size: 10, font: regular, color: navy });
      page.drawText(fmtMoney(qte * pu), { x: 480, y: y + 13, size: 10, font: regular, color: navy });
      y -= 6;
    }
    y -= 14;
    addPageIfNeeded(100);
    const totals: [string, string][] = [
      ["Sous-total HT", fmtMoney(doc.sous_total)],
      ...(doc.remise_pct ? [["Remise (" + doc.remise_pct + "%)", "- " + fmtMoney(doc.remise_montant)] as [string, string]] : []),
      ["Total HT", fmtMoney(doc.total_ht)],
      ["TVA (" + (doc.tva_pct ?? 20) + "%)", fmtMoney((doc.total_ttc || 0) - (doc.total_ht || 0))],
      ["Total TTC", fmtMoney(doc.total_ttc)],
    ];
    for (const [label, value] of totals) {
      page.drawText(label, { x: 380, y, size: 10, font: regular, color: gray });
      page.drawText(value, { x: 480, y, size: 10, font: bold, color: navy });
      y -= 15;
    }
    y -= 10;
    if (doc.date_expiration) {
      page.drawText("Devis valable jusqu'au " + fmtDate(doc.date_expiration) + ".", {
        x: margin, y, size: 9.5, font: regular, color: gray,
      });
      y -= 16;
    }
  } else {
    const rows: [string, string][] = [
      ["Type de contrat", doc.type_contrat || "—"],
      ["Montant", fmtMoney(doc.montant_mensuel) + " / " + (doc.frequence || "mensuel")],
      ["Date de début", fmtDate(doc.date_debut)],
      ["Date de fin", doc.date_fin ? fmtDate(doc.date_fin) : "Sans date de fin"],
      ["Renouvellement automatique", doc.renouvellement_auto ? "Oui" : "Non"],
    ];
    for (const [label, value] of rows) {
      page.drawText(label, { x: margin, y, size: 10, font: bold, color: gray });
      page.drawText(value, { x: 280, y, size: 10, font: regular, color: navy });
      y -= 18;
    }
  }

  if (doc.notes) {
    y -= 10;
    addPageIfNeeded(40);
    page.drawText("Notes / conditions", { x: margin, y, size: 9, font: bold, color: gray });
    y -= 14;
    for (const line of wrapText(doc.notes, regular, 10, width - margin * 2)) {
      addPageIfNeeded(16);
      page.drawText(line, { x: margin, y, size: 10, font: regular, color: navy });
      y -= 13;
    }
  }

  addPageIfNeeded(60);
  y -= 20;
  page.drawText(
    "Ce document est proposé à la signature électronique via Youtrust, conformément au règlement eIDAS.",
    { x: margin, y, size: 8, font: regular, color: gray }
  );

  return await pdfDoc.save();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Authentification requise" }, 401);

    const { doc_type, doc_id } = await req.json();
    if (!doc_type || !doc_id || !["devis", "contrat"].includes(doc_type)) {
      return json({ error: "doc_type ('devis' ou 'contrat') et doc_id requis" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const youtrustApiKey = Deno.env.get("YOUTRUST_API_KEY") ?? "";
    const youtrustApiUrl = Deno.env.get("YOUTRUST_API_URL") || "https://api-sandbox.yousign.app/v3";
    if (!youtrustApiKey) return json({ error: "YOUTRUST_API_KEY non configurée" }, 500);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Session invalide" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: profile } = await admin.from("profiles").select("role").eq("id", userData.user.id).maybeSingle();
    if (!profile || !["admin", "sec"].includes(profile.role)) {
      return json({ error: "Réservé au staff (admin/sec)" }, 403);
    }

    const table = doc_type === "devis" ? "devis" : "contrats";
    const { data: doc, error: docErr } = await admin
      .from(table)
      .select("*, clients(id,nom,email,adresse,ville,code_postal,prenom_contact,nom_contact)")
      .eq("id", doc_id)
      .maybeSingle();
    if (docErr || !doc) return json({ error: "Document introuvable" }, 404);
    const client = doc.clients;
    if (!client?.email) return json({ error: "Le client n'a pas d'adresse e-mail renseignée" }, 400);

    if (doc.signature_statut === "demandee" || doc.signature_statut === "signee") {
      return json({ error: "Une demande de signature est déjà en cours ou terminée pour ce document." }, 409);
    }

    // Réservation atomique : passe le document à "demandee" avant tout appel
    // Youtrust. Empêche un retry (double-clic, timeout réseau côté staff) de
    // renvoyer une SECONDE demande — et donc un second e-mail réel au client
    // — pendant qu'un premier envoi est encore en vol. Bug identifié le
    // 2026-08-06 : contrairement à Pennylane, aucun garde-fou n'existait ici
    // du tout. Si l'un des appels Youtrust échoue AVANT l'activation (donc
    // avant tout e-mail envoyé), la réservation est restaurée à son état
    // d'origine dans le catch ci-dessous pour permettre un retry légitime.
    const previousStatut = doc.signature_statut || "non_demandee";
    const { data: claimed, error: claimErr } = await admin
      .from(table)
      .update({ signature_statut: "demandee" })
      .eq("id", doc_id)
      .not("signature_statut", "in", "(demandee,signee)")
      .select("id")
      .maybeSingle();
    if (claimErr) return json({ error: claimErr.message }, 500);
    if (!claimed) {
      return json({ error: "Une demande de signature est déjà en cours ou terminée pour ce document." }, 409);
    }

    const pdfBytes = await buildPdf(doc_type as "devis" | "contrat", doc, client);

    let sr: { id: string };
    let activated = false;
    try {
      // 1. Créer la demande de signature (brouillon)
      const srRes = await fetch(`${youtrustApiUrl}/signature_requests`, {
        method: "POST",
        headers: { Authorization: `Bearer ${youtrustApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${doc_type === "devis" ? "Devis" : "Contrat"} — ${client.nom}`.slice(0, 128),
          delivery_mode: "email",
        }),
      });
      if (!srRes.ok) throw new Error("Youtrust (création) : " + (await srRes.text()));
      sr = await srRes.json();

      // 2. Uploader le PDF
      const form = new FormData();
      form.append("file", new Blob([pdfBytes as unknown as BlobPart], { type: "application/pdf" }), `${doc_type}-${doc_id}.pdf`);
      form.append("nature", "signable_document");
      const docRes = await fetch(`${youtrustApiUrl}/signature_requests/${sr.id}/documents`, {
        method: "POST",
        headers: { Authorization: `Bearer ${youtrustApiKey}` },
        body: form,
      });
      if (!docRes.ok) throw new Error("Youtrust (document) : " + (await docRes.text()));
      const uploadedDoc = await docRes.json();

      // 3. Ajouter le client comme signataire
      const signerName = (client.prenom_contact || client.nom_contact)
        ? { first_name: client.prenom_contact || client.nom, last_name: client.nom_contact || "" }
        : { first_name: client.nom, last_name: "" };
      const signerRes = await fetch(`${youtrustApiUrl}/signature_requests/${sr.id}/signers`, {
        method: "POST",
        headers: { Authorization: `Bearer ${youtrustApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          info: { ...signerName, email: client.email, locale: "fr" },
          signature_level: "electronic_signature",
          signature_authentication_mode: "no_otp",
          fields: [{ document_id: uploadedDoc.id, type: "signature", page: 1, x: 350, y: 60 }],
        }),
      });
      if (!signerRes.ok) throw new Error("Youtrust (signataire) : " + (await signerRes.text()));

      // 4. Activer — Youtrust envoie l'e-mail au client. Point de non-retour :
      // dès que cet appel réussit, la réservation ne doit plus jamais être
      // restaurée, même si l'enregistrement en base échoue ensuite.
      const activateRes = await fetch(`${youtrustApiUrl}/signature_requests/${sr.id}/activate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${youtrustApiKey}` },
      });
      if (!activateRes.ok) throw new Error("Youtrust (activation) : " + (await activateRes.text()));
      activated = true;
    } catch (e) {
      if (!activated) {
        await admin.from(table).update({ signature_statut: previousStatut }).eq("id", doc_id).eq("signature_statut", "demandee");
      }
      return json({ error: e instanceof Error ? e.message : String(e) }, 502);
    }

    let saved = false;
    let lastErr: { message: string } | null = null;
    for (let attempt = 0; attempt < 3 && !saved; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 300 * attempt));
      const { error: updateErr } = await admin
        .from(table)
        .update({
          signature_statut: "demandee",
          signature_demandee_at: new Date().toISOString(),
          youtrust_signature_request_id: sr.id,
        })
        .eq("id", doc_id);
      if (!updateErr) { saved = true; break; }
      lastErr = updateErr;
    }
    if (!saved) {
      // L'e-mail de signature a bien été envoyé au client mais l'ID Youtrust
      // n'a pas pu être enregistré après plusieurs tentatives — remonté au
      // staff pour renseignement manuel plutôt que de risquer un second envoi.
      return json({
        error: "E-mail de signature envoyé mais non enregistré côté SportVision après plusieurs tentatives : " + (lastErr?.message || "erreur inconnue"),
        youtrust_signature_request_id: sr.id,
      }, 500);
    }

    return json({ sent: true, youtrust_signature_request_id: sr.id });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
