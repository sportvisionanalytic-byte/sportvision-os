// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.
// Étape à faire à chaque édition : Supabase Dashboard → Edge Functions →
// create-guest-request → coller ce code → Deploy.
// Oublier cette étape est la cause la plus fréquente de "le code est bon
// mais ça ne marche pas en prod" sur ce projet (déjà arrivé sur au moins
// 5 fonctions : clubplus-billing-portal, create-clubplus-subscription-
// checkout, dispatch-notifications, create-guest-rdv, create-guest-request).

// Supabase Edge Function — create-guest-request
// Permet à un visiteur d'envoyer une demande depuis le configurateur SANS créer de compte
// (TESTING.md scénario 1 : "envoi sans compte → création de compte → demande rattachée").
// Trouve-ou-crée le client par e-mail (même logique que portal-onboarding) et insère la
// prestation directement en service role (l'anonyme n'a pas de session, donc pas de RLS possible ici).
// Quand ce même visiteur crée un compte plus tard avec le même e-mail, portal-onboarding le
// rattache automatiquement au même `clients.id` : la demande apparaît alors dans son espace,
// sans logique de "réclamation" séparée à écrire.
// Deploy via Supabase dashboard > Edge Functions > New Function (name: create-guest-request)
// Secrets requis : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Anti-abus : champ honeypot ("site_web", doit rester vide, un bot le remplit
// généralement) + limite de fréquence par IP (5 demandes / heure max), via la
// table guest_rate_limits (migration-portail-v11.sql).
//
// Tarification (2026-08-06, vitrine SportVision) : le corps accepte un
// `offre_slug` optionnel (ex. "match-photo") résolu ici en `offre_id` par
// lookup côté serveur dans `catalogue_offres` — jamais un `offre_id` brut
// envoyé par le client, pour ne jamais laisser un visiteur choisir librement
// à quelle offre (donc quel tarif) sa prestation est rattachée. Sans
// correspondance, la prestation est créée sans offre catalogue, comme avant.
// Ce `offre_id` est ensuite ce que create-checkout-session utilise pour
// calculer automatiquement le montant à payer une fois le client authentifié.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TYPE_CLIENT_MAP: Record<string, string> = {
  club: "club",
  organisateur: "association",
  entreprise: "entreprise",
};

// Recalcul serveur des frais de déplacement — même logique que
// cfgComputeFraisDeplacement() côté Portail (SportVision-Portail.html),
// dupliquée ici car auparavant distance_km/frais_deplacement_ht étaient
// acceptés tels quels depuis le body JSON du visiteur (contrairement à
// offre_id, déjà résolu côté serveur) : un visiteur pouvait faire
// apparaître un trajet à 0 km dans la fiche que le staff consulte pour
// chiffrer manuellement. Découvert lors de l'audit du 2026-08-06. Utilise
// l'API Adresse du gouvernement (api-adresse.data.gouv.fr), publique et
// sans clé, comme le fait déjà le Portail.
const SIEGE_LAT = 48.380247;
const SIEGE_LON = 2.943271;
const TARIF_KM_TTC = 0.5; // €/km, aller-retour, hors Île-de-France uniquement

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}
async function computeFraisDeplacement(adresse: string, cp: string, ville: string): Promise<{ distance_km: number | null; frais_deplacement_ht: number | null }> {
  const query = [adresse, cp, ville].filter(Boolean).join(" ");
  if (!query) return { distance_km: null, frais_deplacement_ht: null };
  try {
    const url = "https://api-adresse.data.gouv.fr/search/?q=" + encodeURIComponent(query) + "&limit=1";
    const r = await fetch(url).then((res) => res.json());
    const f = r.features && r.features[0];
    if (!f) return { distance_km: null, frais_deplacement_ht: null };
    const context: string = f.properties?.context || "";
    if (context.includes("Île-de-France")) return { distance_km: null, frais_deplacement_ht: null };
    const [lon, lat] = f.geometry.coordinates;
    const distanceAllerRetour = haversineKm(SIEGE_LAT, SIEGE_LON, lat, lon) * 2;
    const distance_km = Math.round(distanceAllerRetour * 10) / 10;
    const fraisTtc = distanceAllerRetour * TARIF_KM_TTC;
    const frais_deplacement_ht = Math.round((fraisTtc / 1.2) * 100) / 100;
    return { distance_km, frais_deplacement_ht };
  } catch (_e) {
    // Best-effort, comme côté Portail : en cas d'échec de géolocalisation,
    // aucun frais plutôt que de bloquer l'envoi de la demande.
    return { distance_km: null, frais_deplacement_ht: null };
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// E-mail de confirmation envoyé à CHAQUE demande créée depuis la vitrine
// publique (réservation ou devis), quel que soit le mode de paiement choisi.
// Avant ceci, seul un paiement carte réussi (stripe-webhook) déclenchait un
// e-mail : un visiteur payant en espèces ou demandant un devis n'avait
// aucune trace écrite de sa demande une fois l'onglet fermé, seule la
// référence affichée à l'écran une fois. Même pattern que
// sendPaymentReceiptEmail dans stripe-webhook (Resend, best-effort, jamais
// bloquant pour la création de la prestation).
async function sendGuestRequestConfirmationEmail(
  to: string,
  info: { prenom: string; reference: string; label: string | null; date: string | null },
) {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) return;
  const fromEmail = Deno.env.get("FROM_EMAIL") || "SportVision <onboarding@resend.dev>";
  const dateFmt = info.date
    ? new Date(info.date).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
    : null;

  const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#06111F;font-family:Arial,sans-serif;color:#F7F9FC">
  <div style="max-width:520px;margin:32px auto;background:#10243E;border-radius:14px;overflow:hidden">
    <div style="background:#0B1B33;padding:26px 32px">
      <div style="font-size:20px;font-weight:800;color:#fff">SPORTVISION</div>
    </div>
    <div style="padding:28px 32px">
      <p style="font-size:15px;line-height:1.6">Bonjour ${info.prenom},</p>
      <p style="font-size:14px;line-height:1.7;color:#9DAEC3">Nous avons bien reçu votre demande${info.label ? " — " + info.label : ""}. Notre équipe revient vers vous rapidement.</p>
      <div style="background:#0B1B33;border-radius:10px;padding:16px 20px;margin:18px 0">
        <div style="font-size:12px;color:#9DAEC3">Référence</div>
        <div style="font-size:22px;font-weight:800;color:#32D8E6;margin-top:4px">${info.reference}</div>
        ${dateFmt ? `<div style="font-size:13px;color:#9DAEC3;margin-top:10px">Date souhaitée : ${dateFmt}</div>` : ""}
      </div>
      <p style="font-size:13px;line-height:1.6;color:#9DAEC3">Conservez cette référence, elle permet à notre équipe de retrouver votre demande immédiatement.</p>
    </div>
  </div>
</body></html>`;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: fromEmail, to: [to], subject: `Demande reçue — Référence ${info.reference}`, html }),
  });
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
      prenom, nom, email, telephone, profil, origine,
      offre_slug, options, date, heure, lieu, ville, adresse, cp, commentaire, sport, equipes,
      retractation_renoncee, site_web, mode_paiement_choisi,
      // distance_km / frais_deplacement_ht ne sont plus lus depuis le body :
      // recalculés côté serveur plus bas, jamais depuis une valeur visiteur.
    } = await req.json();

    // Honeypot : champ invisible pour un humain, rempli seulement par des bots.
    // On répond succès (sans rien écrire) pour ne pas révéler la détection.
    if (site_web) {
      return json({ reference: null, prestation_id: null, client_email: email || null });
    }

    if (!email || !prenom || !nom) {
      return json({ error: "Prénom, nom et e-mail sont requis" }, 400);
    }

    // Validation minimale au-delà du honeypot : un format d'e-mail invalide
    // créerait un client fantôme (et ferait échouer silencieusement l'envoi
    // de l'e-mail de confirmation) ; des champs anormalement longs sont un
    // signe classique de bot/abus plutôt qu'une vraie demande.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: "Adresse e-mail invalide" }, 400);
    }
    if (prenom.length > 100 || nom.length > 100) {
      return json({ error: "Prénom ou nom trop long" }, 400);
    }
    if (telephone && telephone.length > 30) {
      return json({ error: "Numéro de téléphone invalide" }, 400);
    }
    if (commentaire && commentaire.length > 3000) {
      return json({ error: "Commentaire trop long (3000 caractères maximum)" }, 400);
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("cf-connecting-ip") || "inconnu";
    const rateOk = await checkRateLimit(admin, `req:${ip}`);
    if (!rateOk) {
      return json({ error: "Trop de demandes envoyées récemment. Merci de réessayer plus tard." }, 429);
    }

    let clientId: string | null = null;
    const { data: matched } = await admin.from("clients").select("id").ilike("email", email).limit(1).maybeSingle();
    if (matched) {
      clientId = matched.id;
    } else {
      const typeClient = TYPE_CLIENT_MAP[profil] || "particulier";
      const nomAffichage = typeClient === "particulier" ? `${prenom} ${nom}`.trim() : nom;
      const { data: created, error: createErr } = await admin
        .from("clients")
        .insert({
          statut: "prospect",
          type_client: typeClient,
          nom: nomAffichage,
          nom_contact: nom,
          prenom_contact: prenom,
          email,
          telephone: telephone || null,
          origine_prospect: origine === "vitrine" ? "vitrine" : "connect",
        })
        .select("id")
        .single();
      if (createErr) return json({ error: createErr.message }, 500);
      clientId = created.id;
    }

    const adresseComplete = [adresse, cp, ville].filter(Boolean).join(", ") || null;

    let offreId: string | null = null;
    if (offre_slug) {
      const { data: offre } = await admin
        .from("catalogue_offres")
        .select("id")
        .eq("slug", offre_slug)
        .maybeSingle();
      if (offre) offreId = offre.id;
    }

    const { distance_km, frais_deplacement_ht } = await computeFraisDeplacement(adresse, cp, ville);

    const { data: prestation, error: prestationErr } = await admin
      .from("prestations")
      .insert({
        statut: "demande_reçue",
        client_id: clientId,
        offre_id: offreId,
        options_selectionnees: options || [],
        date_prestation: date || null,
        heure_debut: heure || null,
        lieu: ville || null,
        adresse_complete: adresseComplete,
        sport: sport || null,
        equipes: equipes || null,
        description_besoin: commentaire || null,
        retractation_renoncee: !!retractation_renoncee,
        retractation_renoncee_at: retractation_renoncee ? new Date().toISOString() : null,
        distance_km: distance_km ?? null,
        frais_deplacement_ht: frais_deplacement_ht ?? null,
        mode_paiement_choisi: ["carte", "especes"].includes(mode_paiement_choisi) ? mode_paiement_choisi : null,
      })
      .select("id, reference")
      .single();
    if (prestationErr) return json({ error: prestationErr.message }, 500);

    try {
      await sendGuestRequestConfirmationEmail(email, {
        prenom,
        reference: prestation.reference,
        label: commentaire || null,
        date: date || null,
      });
    } catch (_e) {
      // Best-effort, comme sendPaymentReceiptEmail : un échec d'envoi ne doit
      // jamais faire échouer une demande par ailleurs valide.
    }

    return json({ reference: prestation.reference, prestation_id: prestation.id, client_email: email });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
