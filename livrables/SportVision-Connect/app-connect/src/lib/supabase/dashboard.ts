import type { SupabaseClient } from "@supabase/supabase-js";
import { coverFor, groupContentsByTeam } from "@/lib/contenus/groups";

// Données de l'Accueil (cartes optionnelles) — voir design-connect-personnel-12-08/README.md §
// Espace joueur → Accueil : "Cartes affichées UNIQUEMENT si pertinentes [...] Pas de raccourcis
// décoratifs, pas d'empty state empilés." Chaque fonction ci-dessous renvoie null si la donnée
// n'existe pas OU si la lecture échoue (table absente côté agent parallèle pas encore fusionné,
// RLS qui bloque, etc.) — jamais de throw qui ferait planter la page. Voir le rapport de l'agent
// pour le détail de chaque dépendance.

export interface NextClubEvent {
  id: string;
  title: string;
  day: number;
  month: string;
  date: string;
  time: string | null;
  location: string | null;
  team: string | null;
}

const MONTHS_FR = [
  "janv.", "févr.", "mars", "avr.", "mai", "juin",
  "juil.", "août", "sept.", "oct.", "nov.", "déc.",
];

// club_calendar_events, pas calendar_events — voir migration-connect-personnel-accueil-profil-
// acces.sql §3.1 pour l'investigation complète (deux tables "calendrier" existent, une seule est
// réellement utilisée par le reste de l'écosystème). Nécessite la policy RLS additive "ccal_
// player_select" de cette même migration : sans elle, cette requête renvoie toujours 0 ligne pour
// un joueur (pas une erreur, un filtrage RLS silencieux).
export async function getNextClubEvent(
  supabase: SupabaseClient,
  clubId: string,
): Promise<NextClubEvent | null> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("club_calendar_events")
    .select("id, title, event_date, event_time, location, team, type")
    .eq("club_id", clubId)
    .neq("type", "entrainement")
    .gte("event_date", today)
    .order("event_date", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  const d = new Date(`${data.event_date}T00:00:00`);
  return {
    id: data.id,
    title: data.title,
    day: d.getDate(),
    month: MONTHS_FR[d.getMonth()] || "",
    date: d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }),
    time: data.event_time ? String(data.event_time).slice(0, 5) : null,
    location: data.location || null,
    team: data.team || null,
  };
}

export interface NextPrestation {
  id: string;
  reference: string | null;
  type: string | null;
  date: string | null;
  time: string | null;
  statut: string;
}

const STATUT_BADGE: Record<string, string> = {
  demande_reçue: "En validation",
  à_qualifier: "En validation",
  devis_envoyé: "En validation",
  devis_accepté: "Confirmée",
  confirmée: "Confirmée",
  à_planifier: "Confirmée",
  planifiée: "Planifiée",
  équipe_affectée: "Planifiée",
  prête: "Planifiée",
  équipe_en_route: "En cours",
  arrivée_sur_place: "En cours",
  production_démarrée: "En production",
  production_terminée: "En production",
  médias_à_transférer: "En production",
  médias_complets: "En production",
  à_monter: "En production",
  montage_en_cours: "En production",
  prêt_validation: "En production",
  à_valider_client: "En production",
  prête_à_livrer: "Livrée",
  livrée: "Livrée",
  facturée: "Terminée",
  partiellement_payée: "Terminée",
  payée: "Terminée",
  clôturée: "Terminée",
  annulée: "Annulée",
  refusée: "Annulée",
};

export function prestationStatusLabel(statut: string): string {
  return STATUT_BADGE[statut] || "En validation";
}

// N'interroge JAMAIS resolve_player_client_id() (qui provisionne un client_id à la demande) —
// seulement le client_id déjà résolu par ailleurs (Messages/Prestations, hors périmètre de
// l'Accueil). Nécessite la policy RLS additive "prestations_player_select" (migration §3.2).
export async function getNextPrestation(
  supabase: SupabaseClient,
  clientId: string,
): Promise<NextPrestation | null> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("prestations")
    .select("id, reference, type_prestation, date_prestation, heure_debut, statut")
    .eq("client_id", clientId)
    .gte("date_prestation", today)
    .not("statut", "in", "(annulée,refusée,clôturée)")
    .order("date_prestation", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: data.id,
    reference: data.reference,
    type: data.type_prestation,
    date: data.date_prestation
      ? new Date(`${data.date_prestation}T00:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })
      : null,
    time: data.heure_debut ? String(data.heure_debut).slice(0, 5) : null,
    statut: data.statut,
  };
}

// Nécessite player_has_client_access(client_id) sur messages_client (déjà en place depuis
// migration-connect-v43, aucune migration additionnelle requise ici).
export async function getUnreadMessagesCount(supabase: SupabaseClient, clientId: string): Promise<number> {
  const { count, error } = await supabase
    .from("messages_client")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .eq("auteur_type", "staff")
    .eq("lu", false);

  if (error) return 0;
  return count || 0;
}

export interface CotisationEnCours {
  id: string;
  title: string;
  collected: number;
  target: number;
  participants: number;
}

// Le module Cotisations (group_fundings/funding_contributions) a été fusionné le 14/08 par
// l'agent parallèle "équipes/cotisations" (migration-connect-v50-groupes-cotisations-
// personnelles.sql). Corrigé le 14/08 (audit) : cette fonction interrogeait encore la table
// group_fundings par un nom/schéma hypothétique (title/collected/target/participants_count/
// status="en_cours"/beneficiary_user_id) écrit avant la fusion — aucune de ces colonnes n'existe
// réellement (schéma réel : titre/montant_collecte/montant_cible/statut="ouverte", pas de colonne
// beneficiary_user_id ni participants_count sur la table). Résultat avant correctif : erreur
// Postgres "column does not exist" avalée par le catch, donc la carte "Cotisation en cours" ne
// s'affichait jamais, même quand une cotisation existait réellement. Utilise désormais la RPC
// list_my_fundings() (même source que /cotisations), qui applique déjà les bons noms de colonnes
// et le calcul de participants_count.
export async function getCotisationEnCours(
  supabase: SupabaseClient,
): Promise<CotisationEnCours | null> {
  try {
    const { data, error } = await supabase.rpc("list_my_fundings");
    if (error || !data) return null;

    const rows = data as Array<{
      id: string;
      titre: string;
      montant_collecte: number;
      montant_cible: number;
      participants_count: number;
      statut: string;
    }>;

    const active = rows.find((r) => r.statut === "ouverte");
    if (!active) return null;

    return {
      id: active.id,
      title: active.titre,
      collected: Number(active.montant_collecte) || 0,
      target: Number(active.montant_cible) || 0,
      participants: Number(active.participants_count) || 0,
    };
  } catch {
    return null;
  }
}

export interface RecentContentGroup {
  key: string;
  title: string;
  count: number;
  photoCount: number;
  videoCount: number;
  cover: string;
  hasNew: boolean;
}

// "Nouveaux contenus" (Accueil) — le commentaire d'en-tête de dashboard/page.tsx datant du 14/08
// (commit faad3744, 17:37) documentait cette carte comme volontairement absente faute de source
// réelle portée côté Connect personnel. Corrigé le 15/08 (polish design vs maquette réelle) :
// ce constat était déjà caduc 10 minutes plus tard, le même jour (commit 25c132d, 17:47, "module
// Mes contenus") — `club_media` est bien la source réelle utilisée par /contenus depuis cette
// date (voir src/app/contenus/page.tsx et ContentGallery.tsx). Réutilise donc exactement la même
// table/policy RLS et le même regroupement par équipe (src/lib/contenus/groups.ts, extrait de
// ContentGallery.tsx pour éviter de dupliquer la logique), pas de nouvelle donnée inventée.
export async function getRecentContentGroups(
  supabase: SupabaseClient,
  clubId: string,
  max = 2,
): Promise<RecentContentGroup[]> {
  const { data, error } = await supabase
    .from("club_media")
    .select("id, title, type, team, created_at")
    .eq("club_id", clubId)
    .eq("expired", false)
    .order("created_at", { ascending: false })
    .limit(60);

  if (error || !data) return [];

  const items = data.map((row) => ({
    id: row.id as string,
    title: row.title as string,
    type: row.type as string,
    team: (row.team as string | null) ?? null,
    createdAt: row.created_at as string,
  }));

  return groupContentsByTeam(items)
    .slice(0, max)
    .map((g) => ({
      key: g.key,
      title: g.title,
      count: g.items.length,
      photoCount: g.photoCount,
      videoCount: g.videoCount,
      cover: coverFor(g.key),
      hasNew: g.hasNew,
    }));
}
