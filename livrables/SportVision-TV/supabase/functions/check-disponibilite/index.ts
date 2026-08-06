// Supabase Edge Function — check-disponibilite
//
// Vérification INFORMATIVE de disponibilité pour le tunnel de réservation
// de la vitrine SportVision (livrables/SportVision/reserver.html). Décision
// du fondateur (2026-08-06) : cette vérification n'a JAMAIS le pouvoir de
// bloquer une demande — elle sert uniquement à afficher un message honnête
// ("équipe disponible" vs "forte demande, confirmation sous 24h") avant que
// le visiteur envoie sa demande via create-guest-request (inchangé, appelé
// séparément par le front). Se tromper ici change un message, jamais un
// refus réel ni un double-booking silencieux — le staff garde toujours la
// main lors de la qualification manuelle de la demande.
//
// Règles métier actées avec le fondateur (2026-08-06), à ajuster ici si
// elles changent — aucune de ces valeurs n'est stockée en base :
//   - Zone : liste de départements couverts par l'équipe au global (pas de
//     zone par opérateur — aucune donnée de zone individuelle n'existe).
//   - Capacité : jusqu'à 2 prestations par jour par opérateur, à condition
//     que les créneaux estimés ne se chevauchent pas.
//   - Durée sur site : aucune colonne ne stocke la durée réelle d'une
//     prestation sur place (catalogue_offres.duree_estimee = délai de
//     LIVRAISON, pas durée sur site) — estimation heuristique ci-dessous
//     par type de prestation, à corriger si elle s'avère fausse en usage
//     réel. Sans heure fournie par le visiteur, seule la capacité globale
//     du jour est vérifiée (pas de chevauchement horaire calculable).
//
// Deploy via Supabase dashboard > Edge Functions > New Function
// (name: check-disponibilite)
// Secrets requis : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

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

// Départements couverts par l'équipe (Yonne, Seine-et-Marne, reste Île-de-France),
// cohérent avec la zone déjà annoncée publiquement sur la vitrine.
const DEPARTEMENTS_COUVERTS = new Set(["89", "75", "77", "78", "91", "92", "93", "94", "95"]);

// Durée estimée SUR SITE, en heures, par slug catalogue_offres — heuristique
// métier, pas une donnée mesurée. "creation-contenu" ne nécessite pas de
// présence terrain (travail de création), donc n'occupe aucune capacité.
const DUREE_SUR_SITE_HEURES: Record<string, number> = {
  "match-photo": 2.5,
  "match-video": 2.5,
  "pack-match": 2.5,
  "shooting": 1.5,
  "couverture-tournoi": 6,
  "couverture-stage": 6,
  "creation-contenu": 0,
};
const DUREE_DEFAUT_HEURES = 3;
const MAX_PRESTATIONS_PAR_JOUR_PAR_OPERATEUR = 2;

const RATE_LIMIT_MAX = 30;
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

function heureEnMinutes(h: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(h);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function creneauxSeChevauchent(startA: number, durA: number, startB: number, durB: number): boolean {
  const endA = startA + durA * 60;
  const endB = startB + durB * 60;
  return startA < endB && startB < endA;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const admin = createClient(supabaseUrl, serviceKey);

    const { date, heure, offre_slug, cp } = await req.json();

    if (!date) return json({ error: "Date requise" }, 400);

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("cf-connecting-ip") || "inconnu";
    const rateOk = await checkRateLimit(admin, `dispo:${ip}`);
    if (!rateOk) {
      return json({ error: "Trop de vérifications récentes. Merci de réessayer plus tard." }, 429);
    }

    // ── Zone ──
    const dept = typeof cp === "string" ? cp.trim().slice(0, 2) : null;
    const zone_couverte = dept ? DEPARTEMENTS_COUVERTS.has(dept) : null; // null = non vérifiable (pas de CP fourni)

    // ── Capacité / chevauchement ──
    const dureeNouvelle = DUREE_SUR_SITE_HEURES[offre_slug as string] ?? DUREE_DEFAUT_HEURES;
    const heureNouvelleMin = typeof heure === "string" ? heureEnMinutes(heure) : null;

    const { data: operateurs } = await admin.from("profiles").select("id").eq("role", "photo");
    const totalOperateurs = (operateurs || []).length;

    if (totalOperateurs === 0) {
      // Aucun opérateur enregistré (ex. environnement de test) : on ne peut
      // rien affirmer, on reste sur le message neutre plutôt que de bloquer.
      return json({ disponible: null, zone_couverte, raison: "capacite_inconnue" });
    }

    const { data: affectations } = await admin
      .from("prestations_equipe")
      .select("collaborateur_id, heure_rdv, prestations!inner(date_prestation, heure_debut, offre_id, catalogue_offres(slug))")
      .in("statut", ["acceptée", "invitation_envoyée"])
      .eq("prestations.date_prestation", date);

    const parOperateur = new Map<string, Array<{ startMin: number | null; duree: number }>>();
    for (const a of affectations || []) {
      // deno-lint-ignore no-explicit-any
      const rowPrestation = (a as any).prestations;
      const slug = rowPrestation?.catalogue_offres?.slug as string | undefined;
      const duree = slug ? (DUREE_SUR_SITE_HEURES[slug] ?? DUREE_DEFAUT_HEURES) : DUREE_DEFAUT_HEURES;
      const heureBrute: string | null = a.heure_rdv || rowPrestation?.heure_debut || null;
      const startMin = heureBrute ? heureEnMinutes(heureBrute) : null;
      const list = parOperateur.get(a.collaborateur_id) || [];
      list.push({ startMin, duree });
      parOperateur.set(a.collaborateur_id, list);
    }

    let operateurLibreTrouve = false;
    for (const op of operateurs || []) {
      const missionsJour = parOperateur.get(op.id) || [];
      if (missionsJour.length >= MAX_PRESTATIONS_PAR_JOUR_PAR_OPERATEUR) continue;

      if (heureNouvelleMin === null || missionsJour.some((m) => m.startMin === null)) {
        // Pas d'heure exploitable des deux côtés : on ne peut vérifier que le
        // volume total du jour (déjà fait ci-dessus via .length), pas le
        // chevauchement précis. Compte comme libre si le volume le permet.
        operateurLibreTrouve = true;
        break;
      }

      const chevauche = missionsJour.some((m) =>
        m.startMin !== null && creneauxSeChevauchent(heureNouvelleMin, dureeNouvelle, m.startMin, m.duree)
      );
      if (!chevauche) {
        operateurLibreTrouve = true;
        break;
      }
    }

    return json({
      disponible: operateurLibreTrouve,
      zone_couverte,
      raison: operateurLibreTrouve ? "equipe_disponible" : "forte_demande",
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
