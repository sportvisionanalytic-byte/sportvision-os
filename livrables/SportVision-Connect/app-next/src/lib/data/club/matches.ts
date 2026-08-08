import type { SupabaseClient } from "@supabase/supabase-js";
import type { Match, MatchScorer, MatchStatus } from "@/lib/types/studio";

// club_matches (migration-clubplus-v3.sql) — 3 statuts réels (a_venir/a_transmettre/recu),
// contrainte check en base : "content_created" (4e statut du design, purement un marqueur
// Connect "visuel créé") n'a PAS d'équivalent réel et ne doit JAMAIS être écrit dans `status`
// (violerait la contrainte). Voir fetchClubMatches/saveClubMatchResult. RLS :
// is_club_member(club_id) pour select/insert/update.

const STATUS_MAP: Record<string, MatchStatus> = {
  a_venir: "upcoming",
  a_transmettre: "result_pending",
  recu: "result_received",
};

interface ClubMatchRow {
  id: string;
  team: string;
  opponent: string;
  match_date: string | null;
  lieu: string | null;
  status: string;
  score: string | null;
  scorers: string | null;
  man_of_match: string | null;
}

function parseScorers(raw: string | null): MatchScorer[] | undefined {
  if (!raw) return undefined;
  const names = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return names.length ? names.map((playerName) => ({ playerName })) : undefined;
}

function parseScore(raw: string | null): { scoreFor?: number; scoreAgainst?: number } {
  const match = raw?.match(/^(\d+)\s*-\s*(\d+)$/);
  if (!match) return {};
  return { scoreFor: Number(match[1]), scoreAgainst: Number(match[2]) };
}

function toMatch(row: ClubMatchRow, organizationId: string): Match {
  return {
    id: row.id,
    organizationId,
    teamId: "",
    teamName: row.team,
    opponent: row.opponent,
    competition: "",
    kickoffAt: row.match_date ?? "",
    venue: row.lieu ?? "",
    // Non tracké en base — voir le plan Phase 1 § permissions.ts (champs sans équivalent réel).
    isHome: true,
    ...parseScore(row.score),
    scorers: parseScorers(row.scorers),
    manOfTheMatch: row.man_of_match ?? undefined,
    status: STATUS_MAP[row.status] ?? "upcoming",
  };
}

const SELECT = "id, team, opponent, match_date, lieu, status, score, scorers, man_of_match";

export async function fetchClubMatches(supabase: SupabaseClient, organizationId: string): Promise<Match[]> {
  const { data } = await supabase
    .from("club_matches")
    .select(SELECT)
    .eq("club_id", organizationId)
    .order("match_date", { ascending: false });

  return ((data ?? []) as ClubMatchRow[]).map((row) => toMatch(row, organizationId));
}

export async function saveClubMatchResult(
  supabase: SupabaseClient,
  matchId: string,
  patch: { scoreFor?: number; scoreAgainst?: number; scorers?: MatchScorer[]; manOfTheMatch?: string },
): Promise<void> {
  const update: Record<string, unknown> = { status: "recu" };
  if (patch.scoreFor !== undefined && patch.scoreAgainst !== undefined) {
    update.score = `${patch.scoreFor}-${patch.scoreAgainst}`;
  }
  if (patch.scorers) {
    update.scorers = patch.scorers.map((s) => s.playerName).join(", ");
  }
  if (patch.manOfTheMatch !== undefined) {
    update.man_of_match = patch.manOfTheMatch;
  }
  const { error } = await supabase.from("club_matches").update(update).eq("id", matchId);
  if (error) throw error;
}
