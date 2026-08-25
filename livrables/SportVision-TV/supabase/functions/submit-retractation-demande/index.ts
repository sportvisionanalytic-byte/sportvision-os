// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.
// Étape à faire à chaque édition : Supabase Dashboard → Edge Functions →
// submit-retractation-demande → coller ce code → Deploy.
// Oublier cette étape est la cause la plus fréquente de "le code est bon
// mais ça ne marche pas en prod" sur ce projet (déjà arrivé sur au moins
// 5 fonctions : clubplus-billing-portal, create-clubplus-subscription-
// checkout, dispatch-notifications, create-guest-rdv, create-guest-request).

// Supabase Edge Function — submit-retractation-demande
//
// Permet à un consommateur NON authentifié d'exercer son droit de rétractation
// (CGV Article 35) depuis la page publique livrables/SportVision/retractation.html.
// Complète la fonctionnalité déjà en place :
//  - table `retractation_demandes` (migration-portail-v12-retractation.sql), déjà
//    en production, RLS incluse — mais la policy INSERT exige un `client_users`
//    authentifié (cf. "retractation_client_insert"), donc inutilisable depuis une
//    page publique sans compte. Cette fonction, en service role, contourne cette
//    contrainte pour le SEUL cas d'un consommateur invité, en réappliquant
//    manuellement les mêmes garde-fous que la policy RLS (prestation_id/devis_id
//    doivent appartenir au client résolu par e-mail — voir plus bas).
//  - interface staff déjà complète dans SportVision-OS-Full.html (Documents →
//    Rétractations) : accepte/refuse chaque ligne. Cette fonction ne fait
//    qu'insérer la demande ; elle ne décide jamais si la rétractation est
//    recevable (même prudence que le trigger v12 : "PAS un moteur de conformité
//    automatique").
//
// Deploy via Supabase dashboard > Edge Functions > New Function
// (name: submit-retractation-demande)
// Secrets requis : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (déjà présents par
// défaut), RESEND_API_KEY, FROM_EMAIL (optionnel — mêmes secrets que
// create-guest-request / send-devis-email, réutilisés tels quels pour l'envoi
// de l'accusé de réception).
//
// Anti-abus : même mécanisme que create-guest-request (honeypot "site_web") +
// que request-password-reset (rate limit par IP ET par e-mail, table
// guest_rate_limits déjà en prod) — pertinent ici aussi car le formulaire agit
// sur le compte client désigné par un tiers e-mail, sans preuve d'identité.
//
// Anti-énumération de comptes : si aucun client ne correspond à l'e-mail fourni,
// on renvoie une erreur (le patron l'a demandé explicitement : "renvoie une
// erreur claire"), mais SANS jamais dire explicitement "cet e-mail n'existe
// pas" — le même message générique est renvoyé que la cause soit un e-mail
// inconnu, une référence qui ne correspond à rien, ou toute autre situation de
// non-identification. Différent du choix fait dans request-password-reset (qui
// renvoie un succès générique dans tous les cas) : ici, la demande de rétractation
// est un acte déclaratif du consommateur qui doit savoir si elle a bien été
// transmise, donc une vraie erreur est nécessaire — seule sa formulation est
// neutralisée.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

// Message générique unique pour toute situation de non-identification (client
// introuvable). Ne jamais faire varier ce texte selon la cause réelle.
const CLIENT_NOT_FOUND_MESSAGE =
  "Nous n'avons pas pu identifier de commande SportVision correspondant à ces informations. " +
  "Vérifiez l'adresse e-mail utilisée lors de votre commande, ou contactez-nous directement à " +
  "elkanagroup0@gmail.com (ou par courrier à ELKANA GROUP, 4 Place Pierre Semard, 77130 Montereau-Fault-Yonne) " +
  "pour que nous traitions votre rétractation manuellement.";

// E-mail d'accusé de réception — obligation explicite de l'Article 36 des CGV
// ("l'envoi d'un accusé de réception sur support durable"). Même mécanisme que
// sendGuestRequestConfirmationEmail dans create-guest-request : Resend,
// best-effort, ne bloque jamais la réponse en cas d'échec d'envoi.
async function sendRetractationConfirmationEmail(
  to: string,
  info: { prenom: string; demandeId: string; referenceLabel: string | null },
) {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) {
    console.error("[sendRetractationConfirmationEmail] RESEND_API_KEY absent des secrets de cette fonction — e-mail non envoyé");
    return;
  }
  const fromEmail = Deno.env.get("FROM_EMAIL") || "SportVision <onboarding@resend.dev>";
  const dateFmt = new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

  const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#06111F;font-family:Arial,sans-serif;color:#F7F9FC">
  <div style="max-width:520px;margin:32px auto;background:#10243E;border-radius:14px;overflow:hidden">
    <div style="background:#0B1B33;padding:26px 32px">
      <div style="font-size:20px;font-weight:800;color:#fff">SPORTVISION</div>
    </div>
    <div style="padding:28px 32px">
      <p style="font-size:15px;line-height:1.6">Bonjour ${info.prenom},</p>
      <p style="font-size:14px;line-height:1.7;color:#9DAEC3">
        Nous avons bien reçu votre demande de rétractation, transmise le ${dateFmt}${
          info.referenceLabel ? " concernant la référence " + info.referenceLabel : ""
        }.
      </p>
      <div style="background:#0B1B33;border-radius:10px;padding:16px 20px;margin:18px 0">
        <div style="font-size:12px;color:#9DAEC3">Identifiant de votre demande</div>
        <div style="font-size:20px;font-weight:800;color:#32D8E6;margin-top:4px;word-break:break-all">${info.demandeId}</div>
      </div>
      <p style="font-size:13px;line-height:1.7;color:#9DAEC3">
        Conformément à l'article 35 des CGV, notre équipe examine votre demande et revient vers vous
        sous 48 heures ouvrées pour vous confirmer sa prise en compte.
      </p>
      <p style="font-size:12.5px;line-height:1.7;color:#6E7C93;margin-top:18px">
        Ce message constitue l'accusé de réception de votre déclaration de rétractation. Conservez-le.
        Pour toute question : elkanagroup0@gmail.com — ELKANA GROUP (SportVision), 4 Place Pierre Semard,
        77130 Montereau-Fault-Yonne.
      </p>
    </div>
  </div>
</body></html>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: fromEmail,
      to: [to],
      subject: "Accusé de réception — votre demande de rétractation SportVision",
      html,
    }),
  });
  if (!res.ok) {
    console.error("[sendRetractationConfirmationEmail] échec Resend", res.status, await res.text());
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const admin = createClient(supabaseUrl, serviceKey);

    const { prenom, nom, email, reference, motif, site_web } = await req.json();

    // Honeypot : champ invisible pour un humain, rempli seulement par des bots.
    // On répond succès (sans rien écrire) pour ne pas révéler la détection —
    // même choix que create-guest-request.
    if (site_web) {
      return json({ success: true, demande_id: null });
    }

    if (!email || !prenom || !nom) {
      return json({ error: "Prénom, nom et e-mail sont requis." }, 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: "Adresse e-mail invalide." }, 400);
    }
    if (prenom.length > 100 || nom.length > 100) {
      return json({ error: "Prénom ou nom trop long." }, 400);
    }
    if (reference && String(reference).length > 60) {
      return json({ error: "Référence trop longue." }, 400);
    }
    if (motif && String(motif).length > 3000) {
      return json({ error: "Motif trop long (3000 caractères maximum)." }, 400);
    }

    // Rate limit par IP ET par e-mail (même logique que request-password-reset) :
    // le formulaire agit sur un compte désigné par un simple e-mail non prouvé,
    // donc une IP seule ne suffit pas à empêcher le harcèlement d'un e-mail
    // précis depuis des IP différentes.
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("cf-connecting-ip") || "inconnu";
    const okIp = await checkRateLimit(admin, "retract:ip:" + ip);
    const okEmail = await checkRateLimit(admin, "retract:email:" + String(email).toLowerCase());
    if (!okIp || !okEmail) {
      return json({ error: "Trop de demandes envoyées récemment. Merci de réessayer plus tard." }, 429);
    }

    // Résolution du client par e-mail. Contrairement à create-guest-request, on
    // ne crée JAMAIS de client ici : une rétractation ne peut porter que sur une
    // commande déjà existante.
    const { data: client } = await admin
      .from("clients")
      .select("id")
      .ilike("email", email)
      .limit(1)
      .maybeSingle();

    if (!client) {
      return json({ error: CLIENT_NOT_FOUND_MESSAGE }, 404);
    }
    const clientId = client.id;

    // Résolution de la référence (prestation OU devis), et UNIQUEMENT si elle
    // appartient à ce client — même garde que la policy RLS
    // "retractation_client_insert" (migration-portail-v12), reproduite ici à la
    // main car le service role bypass la RLS.
    let prestationId: string | null = null;
    let devisId: string | null = null;
    let referenceLabel: string | null = null;

    if (reference) {
      const refTrim = String(reference).trim();
      const { data: prest } = await admin
        .from("prestations")
        .select("id, reference")
        .eq("client_id", clientId)
        .ilike("reference", refTrim)
        .maybeSingle();
      if (prest) {
        prestationId = prest.id;
        referenceLabel = prest.reference;
      } else {
        const { data: dev } = await admin
          .from("devis")
          .select("id, numero")
          .eq("client_id", clientId)
          .ilike("numero", refTrim)
          .maybeSingle();
        if (dev) {
          devisId = dev.id;
          referenceLabel = dev.numero;
        }
      }
    }

    // Le motif stocké inclut toujours le déclarant (nom/prénom saisis dans le
    // formulaire, potentiellement différents du contact enregistré sur la fiche
    // client) pour que le staff dispose du contexte complet dans l'OS — la
    // table n'a pas de colonne dédiée pour ça, donc on l'ajoute en texte plutôt
    // que de proposer une migration pour un besoin aussi mineur.
    const motifParts: string[] = [`Déclarant du formulaire public : ${prenom} ${nom}`];
    if (reference && !referenceLabel) {
      motifParts.push(`Référence indiquée par le client, non retrouvée automatiquement parmi ses commandes : "${String(reference).trim()}"`);
    }
    if (motif) motifParts.push(String(motif).trim());
    const motifFinal = motifParts.join(" — ");

    const { data: demande, error: insertErr } = await admin
      .from("retractation_demandes")
      .insert({
        client_id: clientId,
        prestation_id: prestationId,
        devis_id: devisId,
        motif: motifFinal,
        ip,
        // statut reste sur son défaut 'en_attente' — jamais décidé ici.
      })
      .select("id")
      .single();

    if (insertErr) {
      console.error("[submit-retractation-demande] échec insertion", insertErr.message);
      return json({ error: "Votre demande n'a pas pu être enregistrée. Merci de réessayer, ou de nous écrire directement à elkanagroup0@gmail.com." }, 500);
    }

    try {
      await sendRetractationConfirmationEmail(email, {
        prenom,
        demandeId: demande.id,
        referenceLabel,
      });
    } catch (e) {
      // Best-effort, comme sendGuestRequestConfirmationEmail : un échec d'envoi
      // ne doit jamais faire échouer une demande par ailleurs valide, mais on
      // log pour diagnostic (Supabase Dashboard → Edge Functions →
      // submit-retractation-demande → Logs).
      console.error("[submit-retractation-demande] exception envoi e-mail", e instanceof Error ? e.message : String(e));
    }

    return json({ success: true, demande_id: demande.id, reference_resolue: referenceLabel });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
