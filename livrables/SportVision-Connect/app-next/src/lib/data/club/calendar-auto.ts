import type { SupabaseClient } from "@supabase/supabase-js";
import { icsProvider } from "@/lib/calendar/providers/ics";
import { fetchRemoteCalendar } from "@/lib/calendar/remote";
import { buildImportPreview } from "@/lib/calendar/diff";
import type { ProviderId } from "@/lib/calendar/types";
import {
  applyCalendarImport,
  fetchExistingMatches,
  fetchTeamSourceMappings,
  recordCalendarSyncRun,
} from "./calendar-sync";

// Synchronisation automatique d'une source distante — serveur uniquement.
//
// C'est le seul mode où PERSONNE ne regarde l'écran. La règle qui en découle est simple et elle
// gouverne tout ce fichier :
//
//   la synchronisation automatique n'écrit que ce qui ne demande aucun arbitrage.
//
// Une ligne dont l'équipe n'est pas résolue par un mapping déjà confirmé, ou dont le rapprochement
// est ambigu, n'est PAS écrite : elle est comptée en attente et listée dans le journal. Le club la
// traitera à son prochain import manuel, où il verra exactement ces lignes-là (l'écran n'affiche
// que celles qui demandent un avis). L'alternative — deviner l'équipe la nuit — reviendrait à
// rattacher des matchs à la mauvaise équipe sans que personne ne le voie passer.
//
// Aucun moteur parallèle : mêmes providers, même identité, même diff, même écriture que l'import
// manuel. Seule la décision « qu'est-ce qu'on applique sans humain » est propre à ce fichier.

export interface AutoSyncSource {
  clubId: string;
  saisonId: string;
  provider: ProviderId;
  sourceUrl: string;
  clubName?: string;
}

export interface AutoSyncOutcome {
  clubId: string;
  clubName?: string;
  status: "success" | "partial" | "error";
  created: number;
  updated: number;
  unchanged: number;
  /** Lignes lues mais volontairement pas écrites, faute d'une décision humaine. */
  pending: number;
  failed: number;
  message: string | null;
}

async function fetchTeams(supabase: SupabaseClient, clubId: string): Promise<{ id: string; name: string }[]> {
  const { data } = await supabase.from("club_teams").select("id, name").eq("club_id", clubId).order("name");
  return ((data ?? []) as { id: string; name: string }[]).map((t) => ({ id: t.id, name: t.name }));
}

export async function syncCalendarSourceOnce(supabase: SupabaseClient, source: AutoSyncSource): Promise<AutoSyncOutcome> {
  const startedAt = new Date().toISOString();
  const base: AutoSyncOutcome = {
    clubId: source.clubId,
    clubName: source.clubName,
    status: "error",
    created: 0,
    updated: 0,
    unchanged: 0,
    pending: 0,
    failed: 0,
    message: null,
  };

  const remote = await fetchRemoteCalendar(source.sourceUrl);
  if ("error" in remote) {
    // La source est injoignable ou a changé. On ne supprime rien et on ne touche à aucun match :
    // le calendrier déjà en place reste intact et consultable, seule la trace du run dit ce qui
    // s'est passé. Un calendrier qui disparaît parce qu'un serveur distant a hoqueté serait pire
    // que pas de synchronisation du tout.
    await recordCalendarSyncRun(supabase, {
      clubId: source.clubId,
      saisonId: source.saisonId,
      provider: source.provider,
      triggerKind: "scheduled",
      startedAt,
      created: 0,
      updated: 0,
      cancelled: 0,
      unchanged: 0,
      changes: [],
      errors: [{ line: 0, label: source.sourceUrl, message: remote.error }],
      sourceLabel: source.sourceUrl,
    });
    return { ...base, message: remote.error };
  }

  const parsed = await icsProvider.parse({ fileName: source.sourceUrl, text: remote.text });

  const [teams, existing, mappings] = await Promise.all([
    fetchTeams(supabase, source.clubId),
    fetchExistingMatches(supabase, source.clubId),
    fetchTeamSourceMappings(supabase, source.clubId, source.saisonId, source.provider),
  ]);

  const preview = buildImportPreview({
    provider: source.provider,
    events: parsed.events,
    issues: parsed.issues,
    existing,
    teams,
    mappings,
    // Un club d'une seule équipe n'a aucune ambiguïté possible : c'est celle-là. Au-delà, aucune
    // équipe par défaut n'est imposée sans humain — les lignes non résolues restent en attente.
    defaultTeamId: teams.length === 1 ? teams[0]!.id : null,
  });

  // Le filtre qui définit ce mode : on n'écrit que les lignes dont l'équipe est établie.
  const applicable = preview.rows.filter(
    (row) => (row.verdict === "new" || row.verdict === "updated") && row.teamId !== null,
  );
  const pendingRows = preview.rows.filter((row) => row.verdict === "needs_mapping" || row.verdict === "ambiguous");

  const applied = await applyCalendarImport(supabase, {
    clubId: source.clubId,
    saisonId: source.saisonId,
    provider: source.provider,
    rows: applicable,
  });

  const errors = [
    ...applied.failed,
    ...parsed.issues.map((i) => ({ line: i.line, label: i.raw.slice(0, 120), message: i.reason })),
    ...pendingRows.map((row) => ({
      line: row.key,
      label: `${row.source.opponent} (${row.source.matchDate})`,
      message: `En attente d'une décision : ${row.reason ?? "équipe à rattacher"}`,
    })),
  ];

  const status: AutoSyncOutcome["status"] =
    errors.length === 0 ? "success" : applied.created + applied.updated > 0 || pendingRows.length > 0 ? "partial" : "error";

  await recordCalendarSyncRun(supabase, {
    clubId: source.clubId,
    saisonId: source.saisonId,
    provider: source.provider,
    triggerKind: "scheduled",
    startedAt,
    created: applied.created,
    updated: applied.updated,
    cancelled: applied.cancelledOrPostponed,
    unchanged: applied.skipped + preview.counts.unchanged,
    changes: applied.changes,
    errors,
    sourceLabel: source.sourceUrl,
  });

  return {
    ...base,
    status,
    created: applied.created,
    updated: applied.updated,
    unchanged: applied.skipped + preview.counts.unchanged,
    pending: pendingRows.length,
    failed: applied.failed.length,
    message: null,
  };
}

/** Toutes les sources distantes actives, tous clubs confondus. Appelée par la tâche planifiée avec
 * la clé de service (donc hors RLS) : c'est le seul contexte où lire les sources de tous les clubs
 * a un sens. */
export async function fetchDueCalendarSources(supabase: SupabaseClient): Promise<AutoSyncSource[]> {
  const { data, error } = await supabase
    .from("club_calendar_sources")
    .select("club_id, saison_id, provider, source_url, clubs(nom)")
    .eq("is_enabled", true)
    .not("source_url", "is", null);
  if (error) throw error;

  return ((data ?? []) as unknown as {
    club_id: string;
    saison_id: string;
    provider: string;
    source_url: string;
    clubs: { nom: string } | null;
  }[]).map((row) => ({
    clubId: row.club_id,
    saisonId: row.saison_id,
    provider: row.provider as ProviderId,
    sourceUrl: row.source_url,
    clubName: row.clubs?.nom,
  }));
}
