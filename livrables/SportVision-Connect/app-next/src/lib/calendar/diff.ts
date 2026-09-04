// Moteur commun preview / mapTeams / diff — partagé par TOUS les providers.
//
// C'est ici qu'un fichier devient une intention d'écriture sur club_matches, et nulle part
// ailleurs. Un provider ne sait que lire son format ; il ne décide jamais si une ligne est un
// nouveau match, une mise à jour ou un doublon. Cette séparation est ce qui garantit que le futur
// import Footclubs se comportera exactement comme l'import CSV d'aujourd'hui.
//
// Aucune écriture ici : ce fichier est pur et testable hors navigateur
// (src/lib/calendar/__tests__/run.ts). L'écriture vit dans lib/data/club/calendar-sync.ts.

import { externalIdentityKey, fallbackIdentityKey } from "./identity.ts";
import { opponentKey, teamMatchKey } from "./normalize.ts";
import { SPORT_STATUS_LABELS } from "./types.ts";
import type { ProviderId, SourceEvent, SourceIssue, SportStatus } from "./types.ts";

export interface ClubTeamRef {
  id: string;
  name: string;
}

/** Miroir de club_team_source_mappings. */
export interface TeamSourceMapping {
  id: string;
  teamId: string | null;
  provider: ProviderId;
  externalTeamId: string;
  externalTeamName: string | null;
  externalCompetitionId: string | null;
  status: "suggested" | "confirmed" | "ignored";
}

/** Miroir de la partie de club_matches qui participe à l'identité et au diff. */
export interface ExistingMatch {
  id: string;
  provider: ProviderId;
  externalEventId: string | null;
  teamId: string | null;
  teamName: string;
  opponent: string;
  matchDate: string | null;
  kickoffTime: string | null;
  competition: string | null;
  location: string | null;
  sportStatus: SportStatus;
  score: string | null;
}

export type RowVerdict = "new" | "updated" | "unchanged" | "needs_mapping" | "ambiguous" | "error";

export const VERDICT_LABELS: Record<RowVerdict, string> = {
  new: "Nouveau",
  updated: "Modifié",
  unchanged: "Inchangé",
  needs_mapping: "À mapper",
  ambiguous: "Ambigu",
  error: "Erreur",
};

export type ChangedField = "date" | "time" | "opponent" | "competition" | "status" | "location" | "score" | "team";

export const CHANGED_FIELD_LABELS: Record<ChangedField, string> = {
  date: "Date",
  time: "Heure",
  opponent: "Adversaire",
  competition: "Compétition",
  status: "Statut",
  location: "Lieu",
  score: "Score",
  team: "Équipe",
};

export interface FieldChange {
  field: ChangedField;
  before: string | null;
  after: string | null;
}

export interface TeamCandidate {
  id: string;
  name: string;
  confidence: number;
}

export interface PreviewRow {
  /** `sourceLine` : unique dans un fichier, stable entre deux recalculs de la preview. */
  key: number;
  source: SourceEvent;
  verdict: RowVerdict;
  reason: string | null;
  existingId: string | null;
  changes: FieldChange[];
  teamId: string | null;
  teamName: string | null;
  teamCandidates: TeamCandidate[];
  /** Mapping équipe source → équipe SportVision à enregistrer si l'import est confirmé.
   * null quand la source ne porte aucune information d'équipe (rien à mémoriser). */
  mapping: { externalTeamId: string; externalTeamName: string | null; externalCompetitionId: string | null; confidence: number } | null;
  /** L'équipe vient-elle d'un mapping déjà confirmé ? (§"ne pas recomparer le texte à chaque sync") */
  fromConfirmedMapping: boolean;
  include: boolean;
}

export interface ImportPreview {
  rows: PreviewRow[];
  issues: SourceIssue[];
  counts: Record<RowVerdict, number>;
  /** Lignes réellement écrites si l'utilisateur confirme en l'état. */
  selectedCount: number;
}

export interface PreviewOverrides {
  /** Équipe imposée à la main sur une ligne (clé = SourceEvent.sourceLine). */
  teamIdByLine?: Record<number, string>;
  /** Lignes décochées à la main. */
  excludedLines?: number[];
  /** Lignes recochées à la main alors que le moteur les avait exclues par défaut. */
  includedLines?: number[];
}

export interface PreviewInput {
  provider: ProviderId;
  events: SourceEvent[];
  issues: SourceIssue[];
  existing: ExistingMatch[];
  teams: ClubTeamRef[];
  mappings: TeamSourceMapping[];
  /** Équipe choisie globalement quand la source ne dit rien de l'équipe (cas d'un CSV sans
   * colonne équipe, ou d'un ICS par équipe exporté un fichier à la fois). */
  defaultTeamId: string | null;
  overrides?: PreviewOverrides;
}

// Seuils de rapprochement de noms d'équipe. Ils ne servent qu'à PROPOSER : au-dessus de
// AUTO_ASSIGN l'équipe est pré-remplie (modifiable ligne par ligne), en dessous de MIN_CANDIDATE
// la ligne demande une décision humaine. Aucun de ces seuils n'écrit quoi que ce soit tout seul.
const AUTO_ASSIGN = 0.85;
const MIN_CANDIDATE = 0.5;
const AMBIGUITY_GAP = 0.12;

/** Score de proximité entre un libellé d'équipe côté source et une équipe du club. Dice sur les
 * mots, avec deux raccourcis : égalité stricte (1) et inclusion ("U18" dans "U18 D2", 0.85). */
export function scoreTeamName(sourceName: string, teamName: string): number {
  const a = teamMatchKey(sourceName);
  const b = teamMatchKey(teamName);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.85;
  const ta = new Set(a.split(" ").filter(Boolean));
  const tb = new Set(b.split(" ").filter(Boolean));
  let shared = 0;
  for (const token of ta) if (tb.has(token)) shared++;
  if (shared === 0) return 0;
  return ((2 * shared) / (ta.size + tb.size)) * 0.8;
}

function rankTeams(sourceName: string, teams: ClubTeamRef[]): TeamCandidate[] {
  return teams
    .map((t) => ({ id: t.id, name: t.name, confidence: Math.round(scoreTeamName(sourceName, t.name) * 100) / 100 }))
    .filter((c) => c.confidence >= MIN_CANDIDATE)
    .sort((a, b) => b.confidence - a.confidence);
}

function bestScore(sourceName: string | null, teams: ClubTeamRef[]): number {
  if (!sourceName) return 0;
  return teams.reduce((best, t) => Math.max(best, scoreTeamName(sourceName, t.name)), 0);
}

/**
 * Décide lequel des deux côtés d'un titre ("Club A - Club B") est l'adversaire.
 *
 * Le provider a mis le côté gauche dans `sourceTeamName` et le droit dans `opponent`, sans rien
 * décider. Ici on connaît les vraies équipes du club : si c'est le côté DROIT qui ressemble à une
 * équipe du club, c'est que le club joue à l'extérieur et que l'adversaire est à gauche. On
 * échange, et on en déduit `isHome`.
 *
 * Rien n'est deviné : les deux valeurs viennent du fichier, on choisit seulement laquelle est
 * l'adversaire. Si aucun côté ne ressemble à une équipe du club, on ne touche à rien.
 */
function orientSides(event: SourceEvent, teams: ClubTeamRef[]): SourceEvent {
  if (!event.sourceTeamName) return event;
  const leftScore = bestScore(event.sourceTeamName, teams);
  const rightScore = bestScore(event.opponent, teams);
  if (rightScore >= AUTO_ASSIGN && rightScore > leftScore) {
    return {
      ...event,
      sourceTeamName: event.opponent,
      opponent: event.sourceTeamName,
      isHome: event.isHome ?? false,
    };
  }
  if (leftScore >= AUTO_ASSIGN && event.isHome === null) {
    return { ...event, isHome: true };
  }
  return event;
}

/** Clé d'un mapping équipe. `club_team_source_mappings.external_team_id` est NOT NULL : quand la
 * source ne fournit pas d'identifiant d'équipe (CSV, ICS), on mémorise le nom normalisé sous le
 * préfixe `name:`. C'est une identité stable pour ces sources-là, et elle ne peut pas entrer en
 * collision avec un vrai identifiant fourni par une source qui en a un. */
export function teamMappingKey(event: Pick<SourceEvent, "externalTeamId" | "sourceTeamName">): string | null {
  if (event.externalTeamId) return event.externalTeamId;
  if (event.sourceTeamName) return `name:${teamMatchKey(event.sourceTeamName)}`;
  return null;
}

function mappingMatches(mapping: TeamSourceMapping, key: string, competitionId: string | null): boolean {
  if (mapping.externalTeamId !== key) return false;
  // §13 : une même équipe joue plusieurs compétitions, la compétition fait partie de la clé. Un
  // mapping sans compétition (null) sert de repli pour toutes — c'est le cas d'un CSV qui n'en
  // porte pas.
  return mapping.externalCompetitionId === competitionId || mapping.externalCompetitionId === null;
}

function timeLabel(value: string | null): string | null {
  return value ? value.slice(0, 5) : null;
}

function computeChanges(
  event: SourceEvent,
  existing: ExistingMatch,
  teamId: string | null,
  teamName: string | null,
): FieldChange[] {
  const changes: FieldChange[] = [];

  if (event.matchDate !== existing.matchDate) {
    changes.push({ field: "date", before: existing.matchDate, after: event.matchDate });
  }
  // Les champs optionnels ne sont comparés QUE si la source les porte. Une source muette
  // n'efface jamais une information saisie côté club : un CSV sans colonne "lieu" ne doit pas
  // vider le stade renseigné par le secrétaire.
  if (event.kickoffTime && event.kickoffTime !== timeLabel(existing.kickoffTime)) {
    changes.push({ field: "time", before: timeLabel(existing.kickoffTime), after: event.kickoffTime });
  }
  if (opponentKey(event.opponent) !== opponentKey(existing.opponent)) {
    changes.push({ field: "opponent", before: existing.opponent, after: event.opponent });
  }
  if (event.competitionName && event.competitionName !== existing.competition) {
    changes.push({ field: "competition", before: existing.competition, after: event.competitionName });
  }
  if (event.location && event.location !== existing.location) {
    changes.push({ field: "location", before: existing.location, after: event.location });
  }
  if (event.score && event.score !== existing.score) {
    changes.push({ field: "score", before: existing.score, after: event.score });
  }
  if (event.sportStatus && event.sportStatus !== existing.sportStatus) {
    // Un match déjà marqué joué côté club ne redevient pas "programmé" parce qu'un export de
    // calendrier, par nature en retard, le liste encore comme à venir. Les reports et annulations,
    // eux, s'appliquent toujours : ce sont des informations que seule la source détient.
    const staleDowngrade = existing.sportStatus === "completed" && event.sportStatus === "scheduled";
    if (!staleDowngrade) {
      changes.push({
        field: "status",
        before: SPORT_STATUS_LABELS[existing.sportStatus],
        after: SPORT_STATUS_LABELS[event.sportStatus],
      });
    }
  }
  if (teamId && existing.teamId && teamId !== existing.teamId) {
    changes.push({ field: "team", before: existing.teamName, after: teamName });
  }
  return changes;
}

export function buildImportPreview(input: PreviewInput): ImportPreview {
  const { provider, events, issues, existing, teams, mappings, defaultTeamId } = input;
  const teamIdByLine = input.overrides?.teamIdByLine ?? {};
  const excluded = new Set(input.overrides?.excludedLines ?? []);
  const forcedIncluded = new Set(input.overrides?.includedLines ?? []);
  const teamsById = new Map(teams.map((t) => [t.id, t]));

  // Index des matchs déjà en base, calqués sur les deux index uniques du Lot 0.
  const byExternal = new Map<string, ExistingMatch>();
  const byFallback = new Map<string, ExistingMatch>();
  const byLoose = new Map<string, ExistingMatch[]>();
  for (const match of existing) {
    const external = externalIdentityKey(match);
    if (external) {
      byExternal.set(external, match);
      continue;
    }
    byFallback.set(fallbackIdentityKey(match), match);
    const loose = `${match.teamId ?? ""}|${opponentKey(match.opponent)}|${match.matchDate ?? ""}`;
    byLoose.set(loose, [...(byLoose.get(loose) ?? []), match]);
  }

  const usedExistingIds = new Set<string>();
  const seenIdentities = new Map<string, number>();
  const rows: PreviewRow[] = [];

  for (const rawEvent of events) {
    const event = orientSides(rawEvent, teams);
    const line = event.sourceLine;

    // ── 1. Équipe ────────────────────────────────────────────────────────────────────────────
    const mappingKey = teamMappingKey(event);
    const confirmed = mappingKey
      ? mappings.find((m) => m.status === "confirmed" && mappingMatches(m, mappingKey, event.externalCompetitionId))
      : undefined;
    const ignored = mappingKey
      ? mappings.find((m) => m.status === "ignored" && mappingMatches(m, mappingKey, event.externalCompetitionId))
      : undefined;

    let teamId: string | null = null;
    let teamCandidates: TeamCandidate[] = [];
    let fromConfirmedMapping = false;
    let mappingReason: string | null = null;
    let mappingVerdict: "ok" | "needs_mapping" | "ambiguous" = "ok";

    const override = teamIdByLine[line];
    if (override) {
      // Décision humaine : elle prime sur tout, y compris sur un mapping confirmé.
      teamId = override;
    } else if (confirmed) {
      // §"Ne pas comparer le texte équipe à chaque nouvelle synchronisation si un mapping confirmé
      // existe déjà" : on court-circuite entièrement le rapprochement de noms.
      fromConfirmedMapping = true;
      teamId = confirmed.teamId;
      if (!teamId) {
        mappingVerdict = "needs_mapping";
        mappingReason = "Équipe connue chez la source mais pas encore créée dans SportVision.";
      }
    } else if (ignored) {
      mappingVerdict = "needs_mapping";
      mappingReason = "Équipe source précédemment ignorée pour ce club.";
    } else if (event.sourceTeamName) {
      teamCandidates = rankTeams(event.sourceTeamName, teams);
      const best = teamCandidates[0];
      const second = teamCandidates[1];
      if (best && second && best.confidence < 1 && best.confidence - second.confidence < AMBIGUITY_GAP) {
        mappingVerdict = "ambiguous";
        mappingReason = `« ${event.sourceTeamName} » ressemble autant à ${best.name} qu'à ${second.name}.`;
      } else if (best && best.confidence >= AUTO_ASSIGN) {
        teamId = best.id;
      } else if (defaultTeamId) {
        teamId = defaultTeamId;
      } else {
        mappingVerdict = "needs_mapping";
        mappingReason = `Aucune équipe du club ne correspond à « ${event.sourceTeamName} ».`;
      }
    } else if (defaultTeamId) {
      teamId = defaultTeamId;
    } else {
      mappingVerdict = "needs_mapping";
      mappingReason = "Le fichier ne dit pas de quelle équipe il s'agit : choisissez-la.";
    }

    const teamName = teamId ? teamsById.get(teamId)?.name ?? null : null;

    // ── 2. Identité ──────────────────────────────────────────────────────────────────────────
    let existingMatch: ExistingMatch | undefined;
    let identityKey: string | null = null;

    const external = externalIdentityKey({ provider, externalEventId: event.externalEventId });
    if (external) {
      identityKey = external;
      const candidate = byExternal.get(external);
      if (candidate && !usedExistingIds.has(candidate.id)) existingMatch = candidate;
    } else if (mappingVerdict === "ok") {
      const fallback = fallbackIdentityKey({
        teamId,
        opponent: event.opponent,
        matchDate: event.matchDate,
        kickoffTime: event.kickoffTime,
      });
      identityKey = fallback;
      const exact = byFallback.get(fallback);
      if (exact && !usedExistingIds.has(exact.id)) {
        existingMatch = exact;
      } else {
        // Repli tolérant à l'heure : le même match, jour et adversaire identiques, dont seule
        // l'heure diffère (ou manque d'un côté). Sans ce rattrapage, un CSV sans colonne heure
        // réimporté après qu'un secrétaire a saisi l'horaire créerait un doublon. On ne l'accepte
        // que s'il n'y a qu'UN seul candidat : à plusieurs, ce sont de vrais matchs distincts
        // (tournoi) et il ne faut surtout pas en écraser un.
        const loose = (byLoose.get(`${teamId ?? ""}|${opponentKey(event.opponent)}|${event.matchDate}`) ?? []).filter(
          (m) => !usedExistingIds.has(m.id),
        );
        if (loose.length === 1) existingMatch = loose[0];
      }
    }

    // ── 3. Doublon interne au fichier ────────────────────────────────────────────────────────
    if (identityKey && seenIdentities.has(identityKey)) {
      rows.push({
        key: line,
        source: event,
        verdict: "unchanged",
        reason: `Doublon dans le fichier (déjà vu ligne ${seenIdentities.get(identityKey)}).`,
        existingId: null,
        changes: [],
        teamId,
        teamName,
        teamCandidates,
        mapping: null,
        fromConfirmedMapping,
        include: false,
      });
      continue;
    }
    if (identityKey) seenIdentities.set(identityKey, line);

    // ── 4. Verdict ───────────────────────────────────────────────────────────────────────────
    let verdict: RowVerdict;
    let reason: string | null = mappingReason;
    let changes: FieldChange[] = [];

    if (mappingVerdict === "ambiguous") {
      verdict = "ambiguous";
    } else if (mappingVerdict === "needs_mapping") {
      verdict = "needs_mapping";
    } else if (existingMatch) {
      changes = computeChanges(event, existingMatch, teamId, teamName);
      verdict = changes.length > 0 ? "updated" : "unchanged";
      if (verdict === "unchanged") reason = "Déjà à jour dans le calendrier.";
      usedExistingIds.add(existingMatch.id);
    } else {
      verdict = "new";
    }

    const defaultInclude = verdict === "new" || verdict === "updated";
    rows.push({
      key: line,
      source: event,
      verdict,
      reason,
      existingId: existingMatch?.id ?? null,
      changes,
      teamId,
      teamName,
      teamCandidates,
      mapping:
        mappingKey && teamId
          ? {
              externalTeamId: mappingKey,
              externalTeamName: event.sourceTeamName,
              externalCompetitionId: event.externalCompetitionId,
              // 1 quand la décision vient d'un humain (mapping déjà confirmé, ou équipe choisie
              // à la main sur cette ligne) ; sinon le score du rapprochement automatique, conservé
              // tel quel pour que club_team_source_mappings.confidence dise la vérité sur l'origine
              // du mapping.
              confidence: override || fromConfirmedMapping ? 1 : teamCandidates[0]?.confidence ?? 0,
            }
          : null,
      fromConfirmedMapping,
      include: excluded.has(line) ? false : forcedIncluded.has(line) ? true : defaultInclude,
    });
  }

  const counts: Record<RowVerdict, number> = {
    new: 0,
    updated: 0,
    unchanged: 0,
    needs_mapping: 0,
    ambiguous: 0,
    error: issues.length,
  };
  for (const row of rows) counts[row.verdict] += 1;

  return { rows, issues, counts, selectedCount: rows.filter((r) => r.include).length };
}
