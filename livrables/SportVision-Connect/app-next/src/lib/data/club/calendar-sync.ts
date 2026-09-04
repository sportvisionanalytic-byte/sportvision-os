import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExistingMatch, FieldChange, PreviewRow, TeamSourceMapping } from "@/lib/calendar/diff";
import type { ProviderId, SourceEvent, SportStatus } from "@/lib/calendar/types";

// Couche Supabase de la synchronisation de calendrier — la SEULE qui écrit.
//
// Tout ce qui décide (identité d'un match, diff, rapprochement d'équipe) vit dans src/lib/calendar,
// sans dépendance Supabase et testable hors navigateur. Ici on ne fait que traduire des décisions
// déjà prises en requêtes, et rendre un compte rendu exact.
//
// Tables du Lot 0 (exécuté et vérifié en base le 05/09/2026) :
//   club_matches                 + provider, external_event_id, external_competition_id,
//                                  kickoff_time, sport_status, saison_id, source_updated_at,
//                                  last_synced_at
//   club_calendar_sources        source par (club, saison, provider)
//   club_team_source_mappings    équipe source -> club_teams, avec compétition dans la clé
//   calendar_sync_runs           journal et diff
//
// Deux comportements de la base dont ce fichier dépend, et qu'il ne réimplémente donc PAS :
//   * trg_club_matches_zz_dedup : une insertion qui duplique exactement une ligne sans
//     external_event_id est annulée silencieusement (RETURN NULL). PostgREST renvoie alors 0 ligne
//     et non une erreur — c'est ce qui est compté en `unchanged` ci-dessous.
//   * trg_club_matches_sport_status : propage postponed -> status 'reportee' et cancelled ->
//     'annulee', et remplit saison_id si l'appelant ne l'a pas fait. On envoie quand même
//     saison_id explicitement : deux saisons sont actives en base et le repli du trigger
//     ("order by date_debut desc" alors que les deux dates sont nulles) serait arbitraire.

export interface SaisonRef {
  id: string;
  label: string;
  active: boolean;
}

export async function fetchSaisons(supabase: SupabaseClient): Promise<SaisonRef[]> {
  const { data } = await supabase.from("saisons").select("id, label, active").order("label", { ascending: false });
  return ((data ?? []) as { id: string; label: string; active: boolean }[]).map((row) => ({
    id: row.id,
    label: row.label,
    active: row.active,
  }));
}

/** Saison de l'import : celle du club (`clubs.saison`, un libellé texte du type "2026-2027", déjà
 * lu par fetchClubTeams/fetchClubCurrentSaison) rapprochée de `saisons.label`. À défaut, la
 * première saison active. Ne renvoie null que si la table `saisons` est vide — auquel cas l'UI
 * demande explicitement à l'utilisateur, plutôt que de laisser saison_id vide. */
export function resolveDefaultSaisonId(saisons: SaisonRef[], clubSaisonLabel: string): string | null {
  const byLabel = saisons.find((s) => s.label === clubSaisonLabel);
  if (byLabel) return byLabel.id;
  return saisons.find((s) => s.active)?.id ?? saisons[0]?.id ?? null;
}

const SPORT_STATUSES: SportStatus[] = ["scheduled", "postponed", "cancelled", "completed", "unknown"];

function toSportStatus(raw: string | null): SportStatus {
  return SPORT_STATUSES.includes(raw as SportStatus) ? (raw as SportStatus) : "scheduled";
}

const PROVIDERS: ProviderId[] = ["MANUAL", "CSV", "ICS", "FOOTCLUBS_XLSX", "FFF", "OTHER"];

function toProvider(raw: string | null): ProviderId {
  return PROVIDERS.includes(raw as ProviderId) ? (raw as ProviderId) : "MANUAL";
}

/**
 * Tous les matchs du club, sans filtre de saison — VOLONTAIREMENT.
 *
 * Les deux index d'unicité du Lot 0 ne contiennent pas saison_id : un match saisi sur une autre
 * saison entre malgré tout en collision avec une ligne importée. Filtrer par saison ici ferait
 * annoncer "nouveau" à la preview pour une ligne que la base refuserait ensuite (ou pire,
 * dupliquerait sur la clé principale). Le volume reste celui d'un club, pas d'une base entière.
 */
export async function fetchExistingMatches(supabase: SupabaseClient, clubId: string): Promise<ExistingMatch[]> {
  const { data, error } = await supabase
    .from("club_matches")
    .select(
      "id, provider, external_event_id, team_id, team, opponent, match_date, kickoff_time, competition, lieu, sport_status, score",
    )
    .eq("club_id", clubId);
  if (error) throw error;

  return ((data ?? []) as Record<string, string | null>[]).map((row) => ({
    id: row.id as string,
    provider: toProvider(row.provider ?? null),
    externalEventId: row.external_event_id ?? null,
    teamId: row.team_id ?? null,
    teamName: row.team ?? "",
    opponent: row.opponent ?? "",
    matchDate: row.match_date ?? null,
    // La base renvoie un `time` en "HH:MM:SS" ; tout le moteur raisonne en "HH:MM". Sans cette
    // coupe, chaque comparaison d'horaire signalerait un faux changement à chaque import.
    kickoffTime: row.kickoff_time ? row.kickoff_time.slice(0, 5) : null,
    competition: row.competition ?? null,
    location: row.lieu ?? null,
    sportStatus: toSportStatus(row.sport_status ?? null),
    score: row.score ?? null,
  }));
}

export async function fetchTeamSourceMappings(
  supabase: SupabaseClient,
  clubId: string,
  saisonId: string | null,
  provider: ProviderId,
): Promise<TeamSourceMapping[]> {
  let query = supabase
    .from("club_team_source_mappings")
    .select("id, team_id, provider, external_team_id, external_team_name, external_competition_id, status")
    .eq("club_id", clubId)
    .eq("provider", provider);
  if (saisonId) query = query.eq("saison_id", saisonId);

  // Les mappings sont réservés à l'admin du club par RLS (ccs/ctsm_admin_all). Un échec de lecture
  // ne doit pas empêcher l'import : il fait juste retomber sur le rapprochement par nom.
  const { data, error } = await query;
  if (error) return [];

  return ((data ?? []) as Record<string, string | null>[]).map((row) => ({
    id: row.id as string,
    teamId: row.team_id ?? null,
    provider: toProvider(row.provider ?? null),
    externalTeamId: row.external_team_id ?? "",
    externalTeamName: row.external_team_name ?? null,
    externalCompetitionId: row.external_competition_id ?? null,
    status: (row.status === "confirmed" || row.status === "ignored" ? row.status : "suggested") as
      | "suggested"
      | "confirmed"
      | "ignored",
  }));
}

/**
 * Mémorise les correspondances équipe source → équipe SportVision validées par l'écran de preview.
 *
 * Statut 'confirmed' : l'utilisateur a vu chaque ligne et son équipe dans la preview avant de
 * cliquer « Importer ». C'est la confirmation humaine du §11. La conséquence pratique est celle
 * demandée : à la synchronisation suivante, le moteur court-circuite tout rapprochement de texte
 * pour ces équipes (voir buildImportPreview).
 */
export async function saveTeamSourceMappings(
  supabase: SupabaseClient,
  params: { clubId: string; saisonId: string; provider: ProviderId; rows: PreviewRow[]; userId: string | null },
): Promise<{ saved: number; error: string | null }> {
  const seen = new Set<string>();
  const payload: Record<string, unknown>[] = [];
  for (const row of params.rows) {
    if (!row.include || !row.mapping || !row.teamId) continue;
    const key = `${row.mapping.externalTeamId}|${row.mapping.externalCompetitionId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    payload.push({
      club_id: params.clubId,
      saison_id: params.saisonId,
      provider: params.provider,
      team_id: row.teamId,
      external_team_id: row.mapping.externalTeamId,
      external_team_name: row.mapping.externalTeamName,
      external_competition_id: row.mapping.externalCompetitionId,
      confidence: row.mapping.confidence,
      status: "confirmed",
      confirmed_by: params.userId,
      confirmed_at: new Date().toISOString(),
    });
  }
  if (payload.length === 0) return { saved: 0, error: null };

  const { error } = await supabase
    .from("club_team_source_mappings")
    .upsert(payload, { onConflict: "club_id,saison_id,provider,external_team_id,external_competition_id" });
  // Un mapping non enregistré n'invalide pas l'import : les matchs sont écrits, seule
  // l'accélération de la prochaine sync est perdue. On le remonte à l'écran plutôt que de
  // l'avaler, mais sans faire échouer l'opération.
  return { saved: error ? 0 : payload.length, error: error ? error.message : null };
}

export interface ApplyFailure {
  line: number;
  label: string;
  message: string;
}

export interface SyncChangeLogEntry {
  line: number;
  kind: "created" | "updated";
  opponent: string;
  date: string;
  team: string | null;
  fields?: { field: string; before: string | null; after: string | null }[];
}

export interface ApplyResult {
  created: number;
  updated: number;
  /** Lignes qu'on voulait créer et que la base a reconnues comme des doublons (trigger de dédup). */
  skipped: number;
  /** Matchs passés à reporté ou annulé par cet import — compté à part pour le journal (§30). */
  cancelledOrPostponed: number;
  failed: ApplyFailure[];
  changes: SyncChangeLogEntry[];
}

function buildInsertPayload(
  clubId: string,
  saisonId: string | null,
  provider: ProviderId,
  event: SourceEvent,
  teamId: string | null,
  teamName: string,
  now: string,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    club_id: clubId,
    team: teamName,
    team_id: teamId,
    opponent: event.opponent,
    match_date: event.matchDate,
    kickoff_time: event.kickoffTime,
    lieu: event.location,
    competition: event.competitionName,
    provider,
    external_event_id: event.externalEventId,
    external_competition_id: event.externalCompetitionId,
    // "scheduled" seulement ici, à la création : une source muette ne dit rien du statut, mais un
    // match qui n'existait pas encore est bien un match à venir.
    sport_status: event.sportStatus ?? "scheduled",
    saison_id: saisonId,
    source_updated_at: event.sourceUpdatedAt,
    last_synced_at: now,
    status: "a_venir",
  };
  if (event.isHome !== null) payload.is_home = event.isHome;
  if (event.score) payload.score = event.score;
  return payload;
}

function buildUpdatePayload(
  event: SourceEvent,
  changes: FieldChange[],
  teamId: string | null,
  teamName: string,
  provider: ProviderId,
  now: string,
): Record<string, unknown> {
  const patch: Record<string, unknown> = { last_synced_at: now };
  for (const change of changes) {
    if (change.field === "date") patch.match_date = event.matchDate;
    else if (change.field === "time") patch.kickoff_time = event.kickoffTime;
    else if (change.field === "opponent") patch.opponent = event.opponent;
    else if (change.field === "competition") patch.competition = event.competitionName;
    else if (change.field === "location") patch.lieu = event.location;
    else if (change.field === "score") patch.score = event.score;
    else if (change.field === "status") patch.sport_status = event.sportStatus;
    else if (change.field === "team") {
      patch.team_id = teamId;
      patch.team = teamName;
    }
  }
  if (event.sourceUpdatedAt) patch.source_updated_at = event.sourceUpdatedAt;
  // Une ligne saisie à la main que la source revendique désormais par identifiant reprend cette
  // identité : les synchronisations suivantes la retrouveront par (club, provider,
  // external_event_id) au lieu de dépendre de la clé de repli, donc un futur report la mettra à
  // jour au lieu d'en créer une deuxième.
  if (event.externalEventId) {
    patch.provider = provider;
    patch.external_event_id = event.externalEventId;
    if (event.externalCompetitionId) patch.external_competition_id = event.externalCompetitionId;
  }
  return patch;
}

/**
 * Écrit la preview confirmée. Séquentiel et ligne par ligne, comme l'import d'origine : un lot
 * fait au plus une saison de matchs, et un rapport exact par ligne vaut mieux qu'un tout-ou-rien
 * (§"un import partiellement invalide ne doit pas rendre le calendrier inutilisable").
 *
 * Aucun upsert : l'identité est déjà résolue par le moteur, donc chaque ligne est soit un INSERT,
 * soit un UPDATE ciblé par id. C'est aussi ce qui permet de retirer la dépendance à
 * `club_matches_no_reimport_dup` — un upsert PostgREST ne peut nommer qu'une seule contrainte, et
 * les deux index d'unicité du Lot 0 sont PARTIELS (`where external_event_id is [not] null`), donc
 * inutilisables en ON CONFLICT depuis PostgREST.
 */
export async function applyCalendarImport(
  supabase: SupabaseClient,
  params: { clubId: string; saisonId: string | null; provider: ProviderId; rows: PreviewRow[] },
): Promise<ApplyResult> {
  const now = new Date().toISOString();
  const result: ApplyResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    cancelledOrPostponed: 0,
    failed: [],
    changes: [],
  };
  const touchedUnchangedIds: string[] = [];

  for (const row of params.rows) {
    if (!row.include) {
      if (row.verdict === "unchanged" && row.existingId) touchedUnchangedIds.push(row.existingId);
      continue;
    }
    const event = row.source;
    const label = `${event.opponent} (${event.matchDate})`;
    const teamName = row.teamName ?? "";

    try {
      if (row.verdict === "updated" && row.existingId) {
        const patch = buildUpdatePayload(event, row.changes, row.teamId, teamName, params.provider, now);
        const { data, error } = await supabase.from("club_matches").update(patch).eq("id", row.existingId).select("id");
        if (error) throw error;
        if (!data || data.length === 0) {
          result.failed.push({ line: row.key, label, message: "Mise à jour refusée (match introuvable ou accès refusé)." });
          continue;
        }
        result.updated += 1;
        if (event.sportStatus === "postponed" || event.sportStatus === "cancelled") result.cancelledOrPostponed += 1;
        result.changes.push({
          line: row.key,
          kind: "updated",
          opponent: event.opponent,
          date: event.matchDate,
          team: row.teamName,
          fields: row.changes.map((c) => ({ field: c.field, before: c.before, after: c.after })),
        });
        continue;
      }

      const payload = buildInsertPayload(params.clubId, params.saisonId, params.provider, event, row.teamId, teamName, now);
      const { data, error } = await supabase.from("club_matches").insert(payload).select("id");
      if (error) throw error;
      if (!data || data.length === 0) {
        // Le trigger de dédup a annulé l'insertion : la ligne existait déjà à l'identique. Ce
        // n'est pas un échec, c'est l'idempotence attendue d'un réimport.
        result.skipped += 1;
        continue;
      }
      result.created += 1;
      if (event.sportStatus === "postponed" || event.sportStatus === "cancelled") result.cancelledOrPostponed += 1;
      result.changes.push({
        line: row.key,
        kind: "created",
        opponent: event.opponent,
        date: event.matchDate,
        team: row.teamName,
      });
    } catch (error) {
      result.failed.push({
        line: row.key,
        label,
        message: error instanceof Error ? error.message : "Erreur inconnue lors de l'écriture.",
      });
    }
  }

  // §29 « dernière synchronisation » : une ligne inchangée a bien été revue par cette sync, même
  // si rien n'a bougé. Un seul UPDATE groupé, aucun trigger déclenché (le trigger de statut est en
  // `update of sport_status, saison_id`).
  if (touchedUnchangedIds.length > 0) {
    await supabase.from("club_matches").update({ last_synced_at: now }).in("id", touchedUnchangedIds);
  }

  return result;
}

export interface SyncRunInput {
  clubId: string;
  saisonId: string | null;
  provider: ProviderId;
  startedAt: string;
  created: number;
  updated: number;
  cancelled: number;
  unchanged: number;
  changes: SyncChangeLogEntry[];
  errors: { line: number; label: string; message: string }[];
  sourceLabel: string | null;
}

/**
 * Journalise la synchronisation (§30, §31) via la RPC `record_calendar_sync_run`
 * (migration-calendrier-sync-sources-v2-run-rpc.sql).
 *
 * Pourquoi une RPC et pas un simple insert : `calendar_sync_runs` n'a QU'UNE policy SELECT dans le
 * Lot 0, volontairement — « le journal est en lecture seule pour les humains, personne ne doit
 * pouvoir maquiller l'historique d'une synchronisation ». Un insert depuis le navigateur serait
 * donc refusé par la RLS. La RPC (SECURITY DEFINER) écrit un run complet en un seul appel après
 * avoir vérifié que l'appelant est bien admin du club, et ne permet ni update ni delete : la
 * propriété d'inaltérabilité est conservée.
 *
 * Elle met aussi à jour `club_calendar_sources` pour ce (club, saison, provider) — §28/§29
 * « dernière synchronisation » et son statut.
 *
 * Un échec de journalisation ne fait jamais échouer l'import : les matchs sont déjà écrits. Il est
 * remonté à l'appelant, qui l'affiche.
 */
export async function recordCalendarSyncRun(supabase: SupabaseClient, input: SyncRunInput): Promise<{ id: string | null; error: string | null }> {
  const status = input.errors.length === 0 ? "success" : input.created + input.updated > 0 ? "partial" : "error";
  const { data, error } = await supabase.rpc("record_calendar_sync_run", {
    p_club_id: input.clubId,
    p_saison_id: input.saisonId,
    p_provider: input.provider,
    p_trigger_kind: "import",
    p_started_at: input.startedAt,
    p_status: status,
    p_created: input.created,
    p_updated: input.updated,
    p_cancelled: input.cancelled,
    p_unchanged: input.unchanged,
    p_changes: input.changes,
    p_errors: input.errors,
    p_source_label: input.sourceLabel,
  });
  if (error) return { id: null, error: error.message };
  return { id: (data as string | null) ?? null, error: null };
}

export interface SyncRunSummary {
  id: string;
  provider: ProviderId;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  created: number;
  updated: number;
  cancelled: number;
  unchanged: number;
  errorCount: number;
}

/** Historique des synchronisations d'un club (§29 « dernière synchronisation »). */
export async function fetchCalendarSyncRuns(supabase: SupabaseClient, clubId: string, limit = 5): Promise<SyncRunSummary[]> {
  const { data, error } = await supabase
    .from("calendar_sync_runs")
    .select("id, provider, started_at, finished_at, status, events_created, events_updated, events_cancelled, events_unchanged, errors")
    .eq("club_id", clubId)
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    provider: toProvider((row.provider as string) ?? null),
    startedAt: row.started_at as string,
    finishedAt: (row.finished_at as string) ?? null,
    status: (row.status as string) ?? "",
    created: (row.events_created as number) ?? 0,
    updated: (row.events_updated as number) ?? 0,
    cancelled: (row.events_cancelled as number) ?? 0,
    unchanged: (row.events_unchanged as number) ?? 0,
    errorCount: Array.isArray(row.errors) ? row.errors.length : 0,
  }));
}
