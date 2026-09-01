// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.
// Étape à faire à chaque édition : Supabase Dashboard → Edge Functions →
// submit-recruitment-application → coller ce code → Deploy.

// Supabase Edge Function — submit-recruitment-application
// Reçoit les candidatures du formulaire public de recrutement (vitrine,
// recrutement-photographe-videaste.html). Visiteur anonyme, donc écriture en
// service_role (même contrainte que create-guest-request : pas de session
// possible côté client pour appliquer une RLS classique).
//
// Anti-abus : honeypot ("site_web") + rate-limit par IP (réutilise la table
// guest_rate_limits, préfixe d'identifiant dédié "recrut:" pour ne pas
// partager le quota avec les demandes de prestation).
//
// CV optionnel : envoyé en base64 (cv_base64 + cv_filename) depuis le
// formulaire, uploadé ici (service_role) dans le bucket privé
// sportvision-media-prive/recrutement-cv/<id>-<filename> — jamais dans un
// bucket public (document personnel d'un candidat). Le staff n'a pas encore
// d'écran OS dédié : notifié par e-mail à chaque candidature avec une URL
// signée du CV (30 jours), régénérable ensuite depuis le chemin stocké en
// base (recruitment_applications.cv_path) si besoin après expiration.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const STAFF_NOTIFICATION_EMAIL = "contact@sportvision-an.fr";
const MAX_CV_BYTES = 8 * 1024 * 1024; // 8 Mo

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

const POSTE_LABELS: Record<string, string> = {
  photographe: "Photographe",
  videaste: "Vidéaste",
  les_deux: "Photographe & Vidéaste",
  community_manager: "Community Manager",
};
const EXPERIENCE_LABELS: Record<string, string> = {
  debutant: "Débutant (formation possible)",
  intermediaire: "Intermédiaire",
  confirme: "Confirmé",
};
const ZONE_LABELS: Record<string, string> = {
  idf: "Île-de-France",
  cote_or: "Côte-d'Or (Dijon)",
  aube: "Aube",
  autre: "Autre",
};
// Sélecteur "sport / pôle" du formulaire public (migration-poles-v28) — slugs figés
// (mêmes que poles.slug en base), pas de lookup dynamique pour éviter d'exposer la
// table poles à anon (RLS staff-only, poles_select_staff, jamais ouverte à anon).
const POLE_SLUGS = ["football", "basket"];
const POLE_LABELS: Record<string, string> = {
  football: "Football",
  basket: "Basket",
};

function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, "_").slice(-120);
}

// deno-lint-ignore no-explicit-any
async function uploadCv(admin: any, applicationId: string, filename: string, base64: string): Promise<string | null> {
  const cleaned = base64.includes(",") ? base64.split(",").pop()! : base64;
  const bytes = Uint8Array.from(atob(cleaned), (c) => c.charCodeAt(0));
  if (bytes.byteLength > MAX_CV_BYTES) return null;
  const path = `recrutement-cv/${applicationId}-${safeFilename(filename)}`;
  const { error } = await admin.storage.from("sportvision-media-prive").upload(path, bytes, {
    contentType: filename.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream",
    upsert: false,
  });
  if (error) {
    console.error("[submit-recruitment-application] échec upload CV", error.message);
    return null;
  }
  return path;
}

// deno-lint-ignore no-explicit-any
async function sendStaffNotification(admin: any, app: Record<string, unknown>) {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) {
    console.error("[submit-recruitment-application] RESEND_API_KEY absent — notification staff non envoyée");
    return;
  }
  const fromEmail = Deno.env.get("FROM_EMAIL") || "SportVision <onboarding@resend.dev>";

  let cvLine = "Aucun CV joint.";
  if (app.cv_path) {
    const { data, error } = await admin.storage
      .from("sportvision-media-prive")
      .createSignedUrl(app.cv_path as string, 60 * 60 * 24 * 30);
    if (!error && data) {
      cvLine = `<a href="${data.signedUrl}">Télécharger le CV</a> (lien valable 30 jours)`;
    } else {
      cvLine = `CV reçu, chemin de stockage : ${app.cv_path}`;
    }
  }

  const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#06111F;font-family:Arial,sans-serif;color:#F7F9FC">
  <div style="max-width:560px;margin:32px auto;background:#10243E;border-radius:14px;overflow:hidden">
    <div style="background:#0B1B33;padding:26px 32px">
      <div style="font-size:20px;font-weight:800;color:#fff">Nouvelle candidature — ${POSTE_LABELS[app.poste as string] || app.poste}</div>
    </div>
    <div style="padding:28px 32px;font-size:14px;line-height:1.8;color:#E4EAF2">
      <p><strong>${app.prenom} ${app.nom}</strong> — ${app.email}${app.telephone ? " — " + app.telephone : ""}</p>
      <p>Sport / pôle : ${POLE_LABELS[app.pole_slug as string] || app.pole_slug}</p>
      <p>Zone : ${ZONE_LABELS[app.zone as string] || app.zone || "Non précisée"}${app.ville ? " (" + app.ville + ")" : ""}</p>
      <p>Expérience : ${EXPERIENCE_LABELS[app.experience_niveau as string] || app.experience_niveau || "Non précisée"}</p>
      <p>Matériel personnel : ${app.materiel || "Non précisé"}</p>
      <p>Permis B : ${app.permis || "Non précisé"} — Véhiculé : ${app.vehicule || "Non précisé"}</p>
      <p>Disponibilités : ${app.disponibilites || "Non précisées"}</p>
      ${app.portfolio_url ? `<p>Portfolio : <a href="${app.portfolio_url}">${app.portfolio_url}</a></p>` : ""}
      <p>${cvLine}</p>
      ${app.message ? `<div style="background:#0B1B33;border-radius:10px;padding:16px 20px;margin-top:14px"><div style="font-size:12px;color:#9DAEC3">Message</div><div style="margin-top:6px">${app.message}</div></div>` : ""}
    </div>
  </div>
</body></html>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: fromEmail,
      to: [STAFF_NOTIFICATION_EMAIL],
      reply_to: app.email as string,
      subject: `Candidature ${POSTE_LABELS[app.poste as string] || app.poste} — ${app.prenom} ${app.nom}`,
      html,
    }),
  });
  if (!res.ok) {
    console.error("[submit-recruitment-application] échec Resend (staff)", res.status, await res.text());
  }
}

async function sendCandidateConfirmation(email: string, prenom: string) {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) return;
  const fromEmail = Deno.env.get("FROM_EMAIL") || "SportVision <onboarding@resend.dev>";
  const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#06111F;font-family:Arial,sans-serif;color:#F7F9FC">
  <div style="max-width:520px;margin:32px auto;background:#10243E;border-radius:14px;overflow:hidden">
    <div style="background:#0B1B33;padding:26px 32px">
      <div style="font-size:20px;font-weight:800;color:#fff">SPORTVISION</div>
    </div>
    <div style="padding:28px 32px">
      <p style="font-size:15px;line-height:1.6">Bonjour ${prenom},</p>
      <p style="font-size:14px;line-height:1.7;color:#9DAEC3">Nous avons bien reçu votre candidature. Notre équipe l'étudie et revient vers vous rapidement.</p>
    </div>
  </div>
</body></html>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: fromEmail, to: [email], subject: "Candidature reçue — SportVision", html }),
  });
  if (!res.ok) {
    console.error("[submit-recruitment-application] échec Resend (candidat)", res.status, await res.text());
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

    const {
      poste, pole_slug, prenom, nom, email, telephone, zone, ville, experience_niveau,
      materiel, permis, vehicule, disponibilites, portfolio_url, message,
      cv_base64, cv_filename, site_web,
    } = await req.json();

    // Honeypot : réponse "succès" sans rien écrire, pour ne pas révéler la détection.
    if (site_web) {
      return json({ ok: true });
    }

    if (!prenom || !nom || !email || !poste) {
      return json({ error: "Prénom, nom, e-mail et poste visé sont requis" }, 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: "Adresse e-mail invalide" }, 400);
    }
    if (prenom.length > 100 || nom.length > 100) {
      return json({ error: "Prénom ou nom trop long" }, 400);
    }
    if (telephone && telephone.length > 30) {
      return json({ error: "Numéro de téléphone invalide" }, 400);
    }
    if (message && message.length > 3000) {
      return json({ error: "Message trop long (3000 caractères maximum)" }, 400);
    }
    if (portfolio_url && portfolio_url.length > 500) {
      return json({ error: "Lien portfolio trop long" }, 400);
    }
    if (!["photographe", "videaste", "les_deux", "community_manager"].includes(poste)) {
      return json({ error: "Poste visé invalide" }, 400);
    }
    if (!pole_slug || !POLE_SLUGS.includes(pole_slug)) {
      return json({ error: "Sport / pôle visé invalide" }, 400);
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("cf-connecting-ip") || "inconnu";
    const rateOk = await checkRateLimit(admin, `recrut:${ip}`);
    if (!rateOk) {
      return json({ error: "Trop de candidatures envoyées récemment. Merci de réessayer plus tard." }, 429);
    }

    // "source" reflète la page d'origine, déduite du poste visé — corrigé lors de la
    // campagne QA recrutement/rétractation/cookies/légal du 30/08 : la valeur était
    // codée en dur sur "photographe_videaste" pour TOUTE candidature (y compris celles
    // envoyées depuis recrutement-community-manager.html), rendant la colonne trompeuse
    // pour le staff. `poste` restait correct (donc les candidatures étaient toujours
    // identifiables), mais `source` ne l'était pas.
    const source = poste === "community_manager" ? "community_manager" : "photographe_videaste";

    const { data: pole, error: poleErr } = await admin
      .from("poles")
      .select("id")
      .eq("slug", pole_slug)
      .maybeSingle();
    if (poleErr) return json({ error: poleErr.message }, 500);
    if (!pole) return json({ error: "Sport / pôle visé invalide" }, 400);

    const { data: created, error: createErr } = await admin
      .from("recruitment_applications")
      .insert({
        source,
        poste,
        pole_id: pole.id,
        prenom,
        nom,
        email,
        telephone: telephone || null,
        zone: zone || null,
        ville: ville || null,
        experience_niveau: experience_niveau || null,
        materiel: materiel || null,
        permis: permis || null,
        vehicule: vehicule || null,
        disponibilites: disponibilites || null,
        portfolio_url: portfolio_url || null,
        message: message || null,
      })
      .select("id")
      .single();
    if (createErr) return json({ error: createErr.message }, 500);

    let cvPath: string | null = null;
    if (cv_base64 && cv_filename) {
      cvPath = await uploadCv(admin, created.id, cv_filename, cv_base64);
      if (cvPath) {
        await admin.from("recruitment_applications").update({ cv_path: cvPath }).eq("id", created.id);
      }
    }

    try {
      await sendStaffNotification(admin, {
        poste, pole_slug, prenom, nom, email, telephone, zone, ville, experience_niveau,
        materiel, permis, vehicule, disponibilites, portfolio_url, message, cv_path: cvPath,
      });
      await sendCandidateConfirmation(email, prenom);
    } catch (e) {
      console.error("[submit-recruitment-application] exception envoi e-mail", e instanceof Error ? e.message : String(e));
    }

    return json({ ok: true, id: created.id });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
