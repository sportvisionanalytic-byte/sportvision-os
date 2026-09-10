import type { SupabaseClient } from "@supabase/supabase-js";
import type { CalendarEvent, CalendarEventKind } from "@/lib/types/calendar";
import { MATCH_STATUS_LABELS } from "@/lib/types/studio";
import { STATUS_MAP as MATCH_STATUS_MAP } from "./matches";

// Vue agrégée — voir le plan Phase 1 § Remplacement module par module. club_calendar_events
// (migration-clubplus-v4.sql) est une source parmi d'autres ; club_matches (v3) en est une
// deuxième (un match programmé est aussi un événement de calendrier). RLS : is_club_member(club_id)
// pour les deux tables.

/** Libellés humains des statuts SPORTIFS qui doivent supplanter le statut de production à
 * l'affichage. 'scheduled' et 'completed' n'y sont volontairement pas : ils ne contredisent pas le
 * cycle de production (un match joué reste « résultat à transmettre » tant qu'il ne l'est pas). */
const SPORT_STATUS_OVERRIDE_LABELS: Record<string, string | undefined> = {
  postponed: "Reporté",
  cancelled: "Annulé",
};

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
  // Colonnes du Lot 0 calendrier (migration-calendrier-sync-sources-v1.sql, exécutée le
  // 05/09/2026). kickoff_time : jusqu'ici un match apparaissait toujours en « journée entière »
  // dans le calendrier faute de colonne heure — deux matchs du même jour étaient donc
  // indistinguables à l'écran. sport_status : statut SPORTIF (reporté/annulé/joué), distinct de
  // `status` qui décrit l'avancement de la production de contenu ; c'est lui qu'il faut montrer
  // quand il dit autre chose que « programmé ».
  kickoff_time: string | null;
  sport_status: string | null;
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
    .select("id, team, opponent, match_date, lieu, status, kickoff_time, sport_status")
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
    .map((row) => {
      const time = row.kickoff_time ? row.kickoff_time.slice(0, 5) : null;
      return {
        id: `match-${row.id}`,
        organizationId,
        kind: "match" as const,
        title: `${row.team} vs ${row.opponent}`,
        // Un match avec heure de coup d'envoi n'est plus un événement « journée entière » : il se
        // place à la bonne heure et deux matchs du même jour ne se confondent plus.
        startsAt: time ? `${row.match_date}T${time}` : row.match_date!,
        allDay: !time,
        location: row.lieu ?? undefined,
        teamName: row.team,
        sourceHref: "/matchcenter",
        // Le statut sportif prime quand il dit autre chose que « programmé » : un match reporté ou
        // annulé doit se lire comme tel dans le calendrier, pas comme « à venir ». Sinon on garde
        // le statut de production (a_venir/a_transmettre/recu), traduit par le même mapping que
        // Match Center — voir EventDetailPanel.tsx, qui affiche event.status tel quel.
        status:
          SPORT_STATUS_OVERRIDE_LABELS[row.sport_status ?? ""] ??
          MATCH_STATUS_LABELS[MATCH_STATUS_MAP[row.status] ?? "upcoming"],
      };
    });

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
    // `kickoff_time` (Lot 0 calendrier, 05/09/2026) : la saisie manuelle porte désormais l'heure,
    // comme l'import. Ce n'est pas cosmétique — l'heure fait partie de la clé d'unicité de repli
    // (club_matches_fallback_uniq), donc c'est elle qui permet de créer à la main deux matchs de
    // la même équipe contre le même adversaire le même jour, cas d'un tournoi.
    const { data: match, error: matchError } = await supabase
      .from("club_matches")
      .insert({
        club_id: organizationId,
        team: input.team || "",
        opponent: input.title,
        match_date: input.date,
        kickoff_time: input.time || null,
        lieu: input.location || null,
        status: "a_venir",
      })
      .select("id, team, opponent, match_date, kickoff_time, lieu, status")
      .maybeSingle();
    if (matchError) throw matchError;
    // 0 ligne sans erreur : le trigger club_matches_ignore_source_duplicate (Lot 0) a annulé
    // l'insertion parce qu'un match strictement identique existe déjà. `.single()` remontait ça
    // comme une erreur PostgREST opaque ("JSON object requested, multiple (or no) rows returned").
    if (!match) throw new Error("Ce match existe déjà dans le calendrier (même équipe, adversaire, date et heure).");
    const time = match.kickoff_time ? String(match.kickoff_time).slice(0, 5) : null;
    return {
      id: `match-${match.id}`,
      organizationId,
      kind: "match",
      title: `${match.team} vs ${match.opponent}`,
      startsAt: time ? `${match.match_date}T${time}` : match.match_date,
      allDay: !time,
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

// ── Le calendrier unifié (vague B, 08/09/2026) ───────────────────────────────
//
// Remplace la fusion matchs + événements qui se faisait ici même, côté navigateur. Elle ignorait
// les entraînements, et surtout elle constituait une projection de plus : le tableau de bord avait
// la sienne, cet écran la sienne. Une seule fonction en base fait désormais foi.
//
// Les entraînements arrivent sous forme d'occurrences virtuelles, projetées depuis les créneaux
// hebdomadaires pour la période demandée. Leur identifiant est stable — « entrainement:<slot>:<date> » —
// afin qu'on puisse plus tard désigner UNE séance précise.

interface LigneCalendrier {
  ref: string;
  genre: "match" | "entrainement" | "evenement";
  date_evenement: string;
  heure_debut: string | null;
  heure_fin: string | null;
  titre: string | null;
  equipe: string | null;
  team_id: string | null;
  adversaire: string | null;
  domicile: boolean | null;
  lieu: string | null;
  competition: string | null;
  score: string | null;
  statut: string | null;
  couverture: string | null;
  adversaire_logo: string | null;
  type_couverture: string | null;
  buteurs: string | null;
  passeurs: string | null;
  homme_du_match: string | null;
  cartons: string | null;
}

const GENRE_VERS_KIND: Record<LigneCalendrier["genre"], CalendarEventKind> = {
  match: "match",
  entrainement: "training",
  evenement: "event",
};

export async function fetchClubCalendrier(
  supabase: SupabaseClient,
  clubId: string,
  du: string,
  au: string,
): Promise<CalendarEvent[]> {
  // ── Pagination obligatoire ──
  // PostgREST plafonne une réponse à 1 000 lignes. Sur la fenêtre que le calendrier charge
  // (quatre mois), SF Villemomble en produit 1 553 : 553 événements disparaissaient SANS ERREUR.
  // Rien ne le signalait — ni exception, ni tableau vide, juste un calendrier incomplet, et le
  // compteur de l'écran qui affichait « 1000 / 1000 événements » sans que ce soit un total.
  // Découvert le 09/09/2026 en regardant enfin l'écran dans un navigateur.
  const TAILLE_PAGE = 1000;
  const lignes: LigneCalendrier[] = [];
  for (let page = 0; ; page++) {
    const debut = page * TAILLE_PAGE;
    const { data, error } = await supabase
      .rpc("club_calendrier", { p_club_id: clubId, p_du: du, p_au: au })
      .range(debut, debut + TAILLE_PAGE - 1);
    if (error) throw error;
    const lot = (data ?? []) as LigneCalendrier[];
    lignes.push(...lot);
    // Une page incomplète est la dernière. Le garde à 20 pages évite qu'une anomalie de la source
    // fasse tourner cette boucle indéfiniment : 20 000 événements sur quatre mois n'existent pas.
    if (lot.length < TAILLE_PAGE || page >= 19) break;
  }

  return lignes.map((l) => ({
    id: l.ref,
    organizationId: clubId,
    kind: GENRE_VERS_KIND[l.genre] ?? "event",
    title: l.titre ?? "Événement",
    // Sans heure, l'événement est « toute la journée » : mieux vaut le dire que d'inventer minuit.
    startsAt: l.heure_debut ? `${l.date_evenement}T${l.heure_debut}` : `${l.date_evenement}T00:00:00`,
    endsAt: l.heure_fin ? `${l.date_evenement}T${l.heure_fin}` : undefined,
    allDay: !l.heure_debut,
    location: l.lieu ?? undefined,
    teamName: l.equipe ?? undefined,
    teamId: l.team_id ?? undefined,
    status: l.statut ?? undefined,
    // Portées jusqu'à l'écran pour les cartes match : adversaire, domicile, couverture.
    opponent: l.adversaire ?? undefined,
    isHome: l.domicile ?? undefined,
    competition: l.competition ?? undefined,
    score: l.score ?? undefined,
    coverage: l.couverture ?? undefined,
    // L'écusson de l'adversaire, résolu en base depuis l'annuaire (migration v17) : il n'est pas
    // stocké sur le match, donc remplacer un écusson met à jour tous ses matchs d'un coup.
    opponentLogoUrl: l.adversaire_logo ?? undefined,
    coverageType: l.type_couverture ?? undefined,
    // Éléments de feuille de match. Vides tant que personne n'a saisi le résultat — la fiche les
    // masque alors, plutôt que d'afficher des sections creuses.
    scorers: l.buteurs ?? undefined,
    assists: l.passeurs ?? undefined,
    manOfMatch: l.homme_du_match ?? undefined,
    cards: l.cartons ?? undefined,
  }));
}

/**
 * Qui couvre cet événement — chargé À LA DEMANDE, quand une fiche s'ouvre.
 *
 * Volontairement hors de `fetchClubCalendrier` : remonter l'opérateur dans le calendrier
 * obligerait à joindre présence → prestation → équipe → profil pour CHACUN des mille événements
 * d'un mois, afin d'afficher un prénom qu'on lit de temps en temps. Une requête de plus à
 * l'ouverture d'un match couvert coûte infiniment moins.
 *
 * La fonction en base ne répond qu'aux rôles internes SportVision, et à un CM pour ses clubs
 * seulement. Pour tous les autres elle renvoie une liste vide — pas une erreur : l'écran affiche
 * alors l'état générique « Équipe SportVision affectée », sans avoir à traiter un refus.
 */
export interface OperateurAffecte {
  prenom: string | null;
  nom: string | null;
  fonction: string | null;
  responsable: boolean;
  reponse: string | null;
}

export async function fetchCouvertureOperateurs(
  supabase: SupabaseClient,
  ref: string,
): Promise<OperateurAffecte[]> {
  const { data, error } = await supabase.rpc("couverture_operateurs", { p_ref: ref });
  // Une erreur ici ne doit jamais casser la fiche : l'information est un complément, pas son objet.
  if (error) return [];
  return (data ?? []) as OperateurAffecte[];
}

// ── La couverture SportVision (vague C, 08/09/2026) ──────────────────────────
//
// Un seul appel : le CM désigne un événement par sa référence de calendrier et choisit un type.
// Le plan mensuel de production, son identifiant et le mois technique ne remontent jamais ici —
// le backend les résout. L'idempotence est garantie en base par des index uniques partiels, pas
// par un bouton désactivé : deux clics rapides ne peuvent pas créer deux couvertures.

export type TypeCouverture = "photo" | "video" | "photo_video";

export const TYPE_COUVERTURE_LABELS: Record<TypeCouverture, string> = {
  photo: "Photo",
  video: "Vidéo",
  photo_video: "Photo + vidéo",
};

export async function definirCouverture(
  supabase: SupabaseClient,
  refEvenement: string,
  type: TypeCouverture,
): Promise<void> {
  const { error } = await supabase.rpc("cm_definir_couverture", { p_ref: refEvenement, p_type: type });
  if (error) throw new Error(error.message);
}

export async function annulerCouverture(supabase: SupabaseClient, refEvenement: string): Promise<void> {
  const { error } = await supabase.rpc("cm_annuler_couverture", { p_ref: refEvenement });
  if (error) throw new Error(error.message);
}

// ── « À couvrir » et publications prévues (v124, v125) ──────────────────────────────────────

/** Les demandes de couverture en cours, rangées par référence d'événement du calendrier
 *  (`match:<id>`, `evenement:<id>`), pour les poser sur les événements déjà chargés. */
export async function fetchSouhaitsParEvenement(
  supabase: SupabaseClient,
  clubId: string,
): Promise<Map<string, NonNullable<CalendarEvent["wish"]>>> {
  const { data, error } = await supabase.rpc("club_souhaits_couverture", { p_club_id: clubId });
  if (error) throw error;
  const carte = new Map<string, NonNullable<CalendarEvent["wish"]>>();
  for (const w of (data ?? []) as {
    id: string; match_id: string | null; calendar_event_id: string | null; status: string; requested_coverage_type: string; source: string | null;
  }[]) {
    if (["completed"].includes(w.status)) continue;
    const ref = w.match_id ? `match:${w.match_id}` : w.calendar_event_id ? `evenement:${w.calendar_event_id}` : null;
    if (ref) carte.set(ref, { id: w.id, status: w.status, type: w.requested_coverage_type, source: w.source });
  }
  return carte;
}

/** Les publications prévues du club, comme événements « Publication » du calendrier. Réservé à
 *  qui opère le club : pour les autres, la base refuse et le calendrier n'en affiche aucune. */
export async function fetchPublicationsCalendrier(
  supabase: SupabaseClient,
  clubId: string,
  du: string,
  au: string,
): Promise<CalendarEvent[]> {
  const { data, error } = await supabase.rpc("club_contenus_calendrier", { p_club_id: clubId, p_du: du, p_au: au });
  if (error) throw error;
  return ((data ?? []) as { id: string; titre: string; date_prevue: string; statut: string; plateforme: string | null; equipe: string | null }[]).map(
    (c) => ({
      id: `publication:${c.id}`,
      organizationId: clubId,
      kind: "publication" as const,
      title: c.titre,
      startsAt: `${c.date_prevue}T00:00:00`,
      allDay: true,
      teamName: c.equipe ?? undefined,
      status: c.statut,
      location: c.plateforme ?? undefined,
    }),
  );
}
