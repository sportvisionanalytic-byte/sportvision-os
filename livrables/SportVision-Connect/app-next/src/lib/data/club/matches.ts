import type { SupabaseClient } from "@supabase/supabase-js";
import type { Match, MatchScorer, MatchStatus } from "@/lib/types/studio";

// club_matches (migration-clubplus-v3.sql) — 5 statuts réels depuis migration-clubplus-v37.sql
// (a_venir/a_transmettre/recu/reportee/annulee), contrainte check en base : "content_created" (6e
// statut du design, purement un marqueur Connect "visuel généré") n'a PAS d'équivalent réel et ne
// doit JAMAIS être écrit dans `status` (violerait la contrainte). Voir fetchClubMatches/
// saveClubMatchResult. RLS : is_club_member(club_id) + is_team_educateur(team_id) (fonction
// existante depuis migration-clubplus-v13.sql, déjà utilisée par team_memberships/membership_
// requests) pour select/insert/update (migration-clubplus-v37.sql) — team_id reste NULL pour
// toute donnée existante ou écrite par ce fichier, aucune UI de ce repo ne le renseigne encore.
//
// competition/is_home/attendance/assists/cards/comment : colonnes ajoutées par
// migration-clubplus-v34-match-champs-complementaires.sql (exécutée par Fouka le 09/08/2026) —
// réintègre les champs du formulaire complet retirés lors de l'audit du même jour, désormais
// réellement persistés.
//
// verified_by/verified_at (migration-clubplus-v37.sql) : colonnes du futur workflow de
// vérification Directeur sportif (§8), pas encore lues/écrites par ce module.
//
// 16/08/2026 : saveClubMatchResult accepte désormais un statut cible explicite ("completed" /
// "postponed" / "cancelled") — auparavant la fonction forçait toujours status="recu", il n'existait
// aucun moyen d'écrire "reportee"/"annulee" bien que la contrainte check et le mapping de lecture
// les supportent déjà (migration-clubplus-v37.sql). Voir MatchResultModal.tsx pour l'UI.

export const STATUS_MAP: Record<string, MatchStatus> = {
  a_venir: "upcoming",
  a_transmettre: "result_pending",
  recu: "result_received",
  reportee: "postponed",
  annulee: "cancelled",
};

/** Statut cible d'une action de saisie — distinct de MatchStatus (design, 6 valeurs) : ne couvre
 * que les 3 issues qu'une action de ce module peut réellement déclencher. */
export type MatchOutcome = "completed" | "postponed" | "cancelled";

const WRITE_STATUS_MAP: Record<MatchOutcome, string> = {
  completed: "recu",
  postponed: "reportee",
  cancelled: "annulee",
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
  competition: string | null;
  is_home: boolean | null;
  attendance: number | null;
  assists: string | null;
  cards: string | null;
  comment: string | null;
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
  const hasExtended = row.attendance !== null || row.assists !== null || row.cards !== null || row.comment !== null;
  return {
    id: row.id,
    organizationId,
    teamId: "",
    teamName: row.team,
    opponent: row.opponent,
    competition: row.competition ?? "",
    kickoffAt: row.match_date ?? "",
    venue: row.lieu ?? "",
    isHome: row.is_home ?? true,
    ...parseScore(row.score),
    scorers: parseScorers(row.scorers),
    manOfTheMatch: row.man_of_match ?? undefined,
    status: STATUS_MAP[row.status] ?? "upcoming",
    extendedReport: hasExtended
      ? {
          attendance: row.attendance ?? undefined,
          assists: row.assists ?? undefined,
          cards: row.cards ?? undefined,
          comment: row.comment ?? undefined,
        }
      : undefined,
  };
}

const SELECT =
  "id, team, opponent, match_date, lieu, status, score, scorers, man_of_match, competition, is_home, attendance, assists, cards, comment";

export async function fetchClubMatches(supabase: SupabaseClient, organizationId: string): Promise<Match[]> {
  const { data } = await supabase
    .from("club_matches")
    .select(SELECT)
    .eq("club_id", organizationId)
    .order("match_date", { ascending: false });

  return ((data ?? []) as ClubMatchRow[]).map((row) => toMatch(row, organizationId));
}

/** Utilisé par le Studio pour préremplir un formulaire depuis un match réel (?matchId=uuid),
 * voir studio/[template]/page.tsx. */
export async function fetchClubMatchById(
  supabase: SupabaseClient,
  organizationId: string,
  matchId: string,
): Promise<Match | null> {
  const { data } = await supabase
    .from("club_matches")
    .select(SELECT)
    .eq("club_id", organizationId)
    .eq("id", matchId)
    .maybeSingle();

  return data ? toMatch(data as ClubMatchRow, organizationId) : null;
}

export async function saveClubMatchResult(
  supabase: SupabaseClient,
  matchId: string,
  matchStatus: MatchOutcome,
  patch: {
    scoreFor?: number;
    scoreAgainst?: number;
    scorers?: MatchScorer[];
    manOfTheMatch?: string;
    competition?: string;
    venue?: string;
    isHome?: boolean;
    attendance?: number;
    assists?: string;
    cards?: string;
    comment?: string;
  },
): Promise<void> {
  const update: Record<string, unknown> = { status: WRITE_STATUS_MAP[matchStatus] };
  if (patch.scoreFor !== undefined && patch.scoreAgainst !== undefined) {
    update.score = `${patch.scoreFor}-${patch.scoreAgainst}`;
  }
  if (patch.scorers) {
    update.scorers = patch.scorers.map((s) => s.playerName).join(", ");
  }
  if (patch.manOfTheMatch !== undefined) update.man_of_match = patch.manOfTheMatch;
  if (patch.competition !== undefined) update.competition = patch.competition || null;
  if (patch.venue !== undefined) update.lieu = patch.venue || null;
  if (patch.isHome !== undefined) update.is_home = patch.isHome;
  if (patch.attendance !== undefined) update.attendance = patch.attendance;
  if (patch.assists !== undefined) update.assists = patch.assists || null;
  if (patch.cards !== undefined) update.cards = patch.cards || null;
  if (patch.comment !== undefined) update.comment = patch.comment || null;
  // .select("id") : sans ça, une RLS qui bloque silencieusement (0 ligne affectée, hors scope
  // is_team_educateur par ex.) renvoie quand même {error: null} et l'appelant marquerait le match
  // comme mis à jour à tort (faux succès) — même garde-fou que updateClubNewsroomItemStatus.
  const { data, error } = await supabase.from("club_matches").update(update).eq("id", matchId).select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Mise à jour refusée : match introuvable ou accès refusé.");
}
