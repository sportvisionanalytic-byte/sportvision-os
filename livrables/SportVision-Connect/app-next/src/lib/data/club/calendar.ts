import type { SupabaseClient } from "@supabase/supabase-js";
import type { CalendarEvent, CalendarEventKind } from "@/lib/types/calendar";
import { MATCH_STATUS_LABELS } from "@/lib/types/studio";
import { STATUS_MAP as MATCH_STATUS_MAP } from "./matches";

// Vue agrégée — voir le plan Phase 1 § Remplacement module par module. club_calendar_events
// (migration-clubplus-v4.sql) est une source parmi d'autres ; club_matches (v3) en est une
// deuxième (un match programmé est aussi un événement de calendrier). RLS : is_club_member(club_id)
// pour les deux tables.

const EVENT_TYPE_MAP: Record<string, CalendarEventKind> = {
  match: "match",
  entrainement: "training",
  tournoi: "event",
  contenu: "shoot",
  sponsor: "meeting",
  prestation: "service",
};

/**
 * club_calendar_events.type (contrainte check, migration-clubplus-v4.sql) n'accepte que ces 6
 * valeurs — les 4 autres CalendarEventKind du design (publication, contract_deadline,
 * invoice_deadline, camp) n'ont pas d'équivalent réel et ne doivent jamais être proposées à la
 * création (voir AddEventModal.tsx, qui filtre son <select> sur les clés de ce map).
 */
export const CREATABLE_EVENT_TYPE_MAP: Record<string, string> = {
  match: "match",
  training: "entrainement",
  event: "tournoi",
  shoot: "contenu",
  meeting: "sponsor",
  service: "prestation",
};

interface ClubCalendarEventRow {
  id: string;
  event_date: string;
  event_time: string | null;
  type: string;
  title: string;
  team: string | null;
  team_id: string | null;
  location: string | null;
}

// event_time/location : colonnes ajoutées par migration-clubplus-v35-calendar-event-heure-lieu.sql
// (exécutée par Fouka le 09/08/2026) — réintègre les champs retirés lors de l'audit du même jour.
//
// team_id (migration-clubplus-v54, 03/09/2026) : même patron que club_matches.team_id
// (migration-clubplus-v37) — `team` (texte) reste la source d'affichage et sert toujours aux RLS
// famille/joueur (ccal_family_select/ccal_player_select, comparaison par nom), `team_id` est la
// vraie FK utilisée par la RLS staff/coach (ccal_member_select/insert, is_team_educateur).
function toCalendarEvent(row: ClubCalendarEventRow, organizationId: string): CalendarEvent {
  const hasTime = Boolean(row.event_time);
  return {
    id: `event-${row.id}`,
    organizationId,
    kind: EVENT_TYPE_MAP[row.type] ?? "event",
    title: row.title,
    startsAt: hasTime ? `${row.event_date}T${row.event_time}` : row.event_date,
    allDay: !hasTime,
    location: row.location ?? undefined,
    teamName: row.team ?? undefined,
    teamId: row.team_id ?? undefined,
  };
}

interface ClubMatchRow {
  id: string;
  team: string;
  opponent: string;
  match_date: string | null;
  lieu: string | null;
  status: string;
}

/** teamId (optionnel) : filtre sur la fiche équipe (/teams/[id], team_id réel sur les deux
 * tables — club_calendar_events depuis migration-clubplus-v54, club_matches depuis
 * migration-clubplus-v37). Omis = comportement inchangé (tout le calendrier du club). */
export async function fetchClubCalendarEvents(
  supabase: SupabaseClient,
  organizationId: string,
  teamId?: string,
): Promise<CalendarEvent[]> {
  let eventsQuery = supabase
    .from("club_calendar_events")
    .select("id, event_date, event_time, type, title, team, team_id, location")
    .eq("club_id", organizationId);
  let matchesQuery = supabase
    .from("club_matches")
    .select("id, team, opponent, match_date, lieu, status")
    .eq("club_id", organizationId);
  if (teamId) {
    eventsQuery = eventsQuery.eq("team_id", teamId);
    matchesQuery = matchesQuery.eq("team_id", teamId);
  }
  const [eventsRes, matchesRes] = await Promise.all([eventsQuery, matchesQuery]);

  const events: CalendarEvent[] = ((eventsRes.data ?? []) as ClubCalendarEventRow[]).map((row) =>
    toCalendarEvent(row, organizationId),
  );

  const matches: CalendarEvent[] = ((matchesRes.data ?? []) as ClubMatchRow[])
    .filter((row) => row.match_date)
    .map((row) => ({
      id: `match-${row.id}`,
      organizationId,
      kind: "match",
      title: `${row.team} vs ${row.opponent}`,
      startsAt: row.match_date!,
      allDay: true,
      location: row.lieu ?? undefined,
      teamName: row.team,
      sourceHref: "/matchcenter",
      // Traduit le statut brut (a_venir/a_transmettre/recu) via le même mapping que Match Center
      // (MATCH_STATUS_LABELS) — voir EventDetailPanel.tsx, qui affiche event.status tel quel.
      status: MATCH_STATUS_LABELS[MATCH_STATUS_MAP[row.status] ?? "upcoming"],
    }));

  return [...events, ...matches];
}

/** Événement canonique (04/09/2026, audit transversal) — un match créé ici partait jusqu'ici dans
 * club_calendar_events (type='match'), une représentation totalement déconnectée de club_matches
 * (Match Center, import calendrier, résultats, contenus liés) : le même match réel pouvait exister
 * comme deux lignes indépendantes selon le point d'entrée utilisé. `kind==="match"` route donc
 * désormais vers club_matches — la même table que createClubMatch/importClubMatches (voir
 * data/club/matches.ts) — pour qu'un match ait toujours exactement UN id, quel que soit le chemin
 * de création. `input.title` porte alors le nom de l'adversaire (voir AddEventModal.tsx, qui
 * relabellise le champ). team_id est résolu automatiquement par le trigger
 * resolve_team_id_from_name() (migration-audit-transversal-fixes-batch1.sql) si le nom d'équipe
 * correspond exactement à un club_teams.name existant — jamais deviné ici. */
export async function createClubCalendarEvent(
  supabase: SupabaseClient,
  organizationId: string,
  input: { title: string; kind: CalendarEventKind; date: string; time?: string; location?: string; team?: string; teamId?: string },
): Promise<CalendarEvent> {
  if (input.kind === "match") {
    const { data: match, error: matchError } = await supabase
      .from("club_matches")
      .insert({
        club_id: organizationId,
        team: input.team || "",
        opponent: input.title,
        match_date: input.date,
        lieu: input.location || null,
        status: "a_venir",
      })
      .select("id, team, opponent, match_date, lieu, status")
      .single();
    if (matchError || !match) throw matchError ?? new Error("Création du match impossible.");
    return {
      id: `match-${match.id}`,
      organizationId,
      kind: "match",
      title: `${match.team} vs ${match.opponent}`,
      startsAt: match.match_date,
      allDay: true,
      location: match.lieu ?? undefined,
      teamName: match.team,
      sourceHref: "/matchcenter",
      status: MATCH_STATUS_LABELS[MATCH_STATUS_MAP[match.status] ?? "upcoming"],
    };
  }

  const type = CREATABLE_EVENT_TYPE_MAP[input.kind] ?? "contenu";

  const { data, error } = await supabase
    .from("club_calendar_events")
    .insert({
      club_id: organizationId,
      event_date: input.date,
      event_time: input.time || null,
      type,
      title: input.title,
      location: input.location || null,
      team: input.team || null,
      team_id: input.teamId || null,
    })
    .select("id, event_date, event_time, type, title, team, team_id, location")
    .single();
  if (error || !data) throw error ?? new Error("Création de l'événement impossible.");

  return toCalendarEvent(data as ClubCalendarEventRow, organizationId);
}
