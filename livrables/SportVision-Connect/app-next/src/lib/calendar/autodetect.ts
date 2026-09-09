// Détection automatique de la structure d'un tableau de matchs, PAR LE CONTENU DES CELLULES.
//
// ── Pourquoi ce fichier existe ──
// Faire désigner douze colonnes à la main était le mur de l'import .xlsx. Le supprimer sans
// enfreindre la règle « aucun nom de colonne Footclubs en dur » suppose de changer de signal : on
// ne lit plus l'en-tête, on lit les DONNÉES.
//
//   une colonne dont 8 cellules sur 10 se lisent comme des dates EST la colonne date ;
//   une colonne dont les valeurs sont les équipes du club EST l'équipe, donc l'autre colonne
//   texte est l'adversaire ;
//   une colonne à trois valeurs distinctes toutes du vocabulaire domicile/extérieur EST celle-là.
//
// Ça marchera sur un export Footclubs sans l'avoir jamais vu, sur un export anglais, et sur un
// fichier sans en-tête du tout. Le nom des colonnes ne sert plus que d'arbitre quand deux
// colonnes ont exactement le même profil (header-hints.ts).
//
// ── Ce que ça ne fait pas ──
// Ça ne décide rien tout seul. Le résultat est une PROPOSITION affichée à l'utilisateur avec le
// nom des colonnes reconnues, qu'il valide ou corrige avant le moindre écrit. La différence avec
// un mapping deviné à l'aveugle est là : ici la proposition est vérifiable d'un coup d'œil.

import { fieldHintForHeader, resolveByHeaderNames } from "./header-hints.ts";
import { detectSportStatus, normalizeScore, parseFlexibleDate, parseFlexibleTime, teamMatchKey } from "./normalize.ts";
import { TABULAR_REQUIRED_FIELDS, type TabularField, type TabularMapping } from "./types.ts";

export interface DetectedColumn {
  field: TabularField;
  index: number;
  header: string;
  /** 0 à 1. Sert à afficher les reconnaissances les moins sûres en premier à l'utilisateur. */
  confidence: number;
}

export interface DetectedLayout {
  headerRow: number;
  firstDataRow: number;
  columns: Partial<Record<TabularField, number>>;
  detected: DetectedColumn[];
  /** Colonne "date de modification" si elle existe (fraîcheur de la source, pas un champ du match). */
  updatedAtColumn: number | null;
  /** Champs obligatoires que la détection n'a pas su trouver. Vide = l'écran de mapping peut être
   * sauté entièrement. */
  missingRequired: TabularField[];
}

const HOME_WORDS = ["dom", "domicile", "d", "home", "h", "recevant", "oui", "o", "1", "x"];
const AWAY_WORDS = ["ext", "exterieur", "e", "away", "a", "visiteur", "non", "n", "0"];

/** Une date de calendrier sportif est proche d'aujourd'hui. Ce garde-fou existe pour une raison
 * précise : un identifiant numérique à 5 chiffres est un numéro de série Excel parfaitement
 * valide, donc `parseFlexibleDate` le convertit en date. Sans la fenêtre temporelle, une colonne
 * d'identifiants serait détectée comme la colonne date. */
function looksLikeDate(raw: string, now: Date): boolean {
  const parsed = parseFlexibleDate(raw);
  if (!parsed) return false;
  const year = Number(parsed.slice(0, 4));
  return Math.abs(year - now.getUTCFullYear()) <= 3;
}

/** Volontairement plus strict que `parseFlexibleTime` : la forme compacte "1500" est acceptée à la
 * lecture, mais elle ne doit pas servir à DÉTECTER une colonne d'heures, sinon n'importe quelle
 * colonne de nombres à 4 chiffres en deviendrait une. */
function looksLikeTime(raw: string): boolean {
  const value = raw.trim();
  if (!value) return false;
  if (!/[:h.,]/i.test(value)) return false;
  return parseFlexibleTime(value) !== null;
}

interface ColumnStats {
  index: number;
  header: string;
  filled: number;
  dateRatio: number;
  timeRatio: number;
  scoreRatio: number;
  statusRatio: number;
  homeRatio: number;
  teamRatio: number;
  distinctRatio: number;
  distinctCount: number;
  avgLength: number;
  idLike: boolean;
  hint: TabularField | null;
}

function ratio(count: number, total: number): number {
  return total === 0 ? 0 : count / total;
}

function computeStats(
  rows: string[][],
  columnCount: number,
  headers: string[],
  teamKeys: string[],
  now: Date,
): ColumnStats[] {
  const stats: ColumnStats[] = [];
  for (let c = 0; c < columnCount; c++) {
    const values: string[] = [];
    for (const row of rows) {
      const value = (row[c] ?? "").trim();
      if (value) values.push(value);
    }
    const filled = values.length;
    const distinct = new Set(values.map((v) => v.toLowerCase())).size;
    stats.push({
      index: c,
      header: headers[c] ?? "",
      filled,
      dateRatio: ratio(values.filter((v) => looksLikeDate(v, now)).length, filled),
      timeRatio: ratio(values.filter((v) => looksLikeTime(v)).length, filled),
      scoreRatio: ratio(values.filter((v) => normalizeScore(v) !== null).length, filled),
      statusRatio: ratio(values.filter((v) => detectSportStatus(v) !== null).length, filled),
      homeRatio: ratio(
        values.filter((v) => {
          const key = teamMatchKey(v);
          return HOME_WORDS.includes(key) || AWAY_WORDS.includes(key);
        }).length,
        filled,
      ),
      teamRatio: ratio(values.filter((v) => teamKeys.some((t) => isSameTeam(teamMatchKey(v), t))).length, filled),
      distinctRatio: ratio(distinct, filled),
      distinctCount: distinct,
      avgLength: filled === 0 ? 0 : values.reduce((sum, v) => sum + v.length, 0) / filled,
      idLike: filled > 0 && values.every((v) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,31}$/.test(v)),
      hint: fieldHintForHeader(headers[c] ?? ""),
    });
  }
  return stats;
}

function isSameTeam(cellKey: string, teamKey: string): boolean {
  if (!cellKey || !teamKey) return false;
  return cellKey === teamKey || cellKey.includes(teamKey) || teamKey.includes(cellKey);
}

/**
 * Trouve la ligne d'en-tête. Un export réel commence souvent par deux ou trois lignes de titre
 * ("Calendrier des rencontres", le nom du club, une date d'édition) avant le vrai tableau.
 *
 * Règle : la première ligne qui contient une date est la première ligne de DONNÉES ; l'en-tête est
 * juste au-dessus, à condition qu'elle contienne au moins deux cellules texte qui ne sont pas des
 * dates. Sinon le fichier n'a pas d'en-tête (headerRow = -1) et les données commencent là.
 */
function findDataStart(rows: string[][], now: Date): { headerRow: number; firstDataRow: number } {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const filled = row.filter((c) => (c ?? "").trim()).length;
    if (filled < 2) continue;
    if (!row.some((c) => looksLikeDate((c ?? "").trim(), now))) continue;

    const previous = rows[r - 1] ?? [];
    const previousTextCells = previous.filter((c) => {
      const value = (c ?? "").trim();
      return value.length > 0 && !looksLikeDate(value, now);
    }).length;
    return previousTextCells >= 2 ? { headerRow: r - 1, firstDataRow: r } : { headerRow: -1, firstDataRow: r };
  }
  // Aucune date trouvée : on ne peut rien affirmer, on retombe sur la convention la plus
  // courante (première ligne = en-tête) et l'utilisateur corrigera.
  return { headerRow: 0, firstDataRow: 1 };
}

/**
 * Propose un rattachement colonne → champ à partir du contenu.
 *
 * `teams` est facultatif. Quand il est fourni, c'est le signal le plus fort du fichier : la
 * colonne qui contient les équipes du club est l'équipe, donc l'autre colonne texte est
 * l'adversaire. Sans lui, on retombe sur « la colonne texte la plus variée est l'adversaire »,
 * ce qui est vrai dans un calendrier (l'adversaire change à chaque journée, la compétition non).
 */
export function detectTabularLayout(
  rows: string[][],
  options: { teams?: { name: string }[]; sheetIndex?: number; now?: Date } = {},
): DetectedLayout {
  const now = options.now ?? new Date();
  const teamKeys = (options.teams ?? []).map((t) => teamMatchKey(t.name)).filter(Boolean);
  const { headerRow, firstDataRow } = findDataStart(rows, now);
  const headers = headerRow >= 0 ? (rows[headerRow] ?? []).map((c) => (c ?? "").trim()) : [];
  const dataRows = rows.slice(firstDataRow);
  const columnCount = Math.max(headers.length, ...rows.map((r) => r.length), 0);

  const stats = computeStats(dataRows, columnCount, headers, teamKeys, now);
  const taken = new Set<number>();
  const columns: Partial<Record<TabularField, number>> = {};
  const detected: DetectedColumn[] = [];

  const assign = (field: TabularField, stat: ColumnStats | undefined, confidence: number) => {
    if (!stat || taken.has(stat.index)) return;
    taken.add(stat.index);
    columns[field] = stat.index;
    detected.push({ field, index: stat.index, header: stat.header, confidence: Math.round(confidence * 100) / 100 });
  };

  const free = () => stats.filter((s) => !taken.has(s.index) && s.filled > 0);
  const best = (score: (s: ColumnStats) => number, minimum: number): ColumnStats | undefined => {
    const ranked = free()
      .map((s) => ({ s, value: score(s) }))
      .filter((entry) => entry.value >= minimum)
      .sort((a, b) => b.value - a.value);
    return ranked[0]?.s;
  };

  // Ordre : du signal le plus discriminant au plus flou. Chaque champ retire sa colonne du jeu,
  // ce qui rend les décisions suivantes plus faciles.
  const bonus = (s: ColumnStats, field: TabularField) => (s.hint === field ? 0.15 : 0);

  const dateCol = best((s) => s.dateRatio + bonus(s, "date"), 0.6);
  assign("date", dateCol, dateCol ? dateCol.dateRatio : 0);

  const timeCol = best((s) => s.timeRatio + bonus(s, "time"), 0.6);
  assign("time", timeCol, timeCol ? timeCol.timeRatio : 0);

  const scoreCol = best((s) => s.scoreRatio + bonus(s, "score"), 0.5);
  assign("score", scoreCol, scoreCol ? scoreCol.scoreRatio : 0);

  // Domicile/extérieur et statut : peu de valeurs DISTINCTES, et toutes du même petit
  // vocabulaire. Le critère porte sur un nombre absolu et non sur une proportion : sur un
  // échantillon de 4 lignes, trois statuts différents font déjà 75% de valeurs distinctes, ce qui
  // rejetterait une colonne de statut parfaitement valide.
  const homeCol = best((s) => (s.distinctCount <= 3 ? s.homeRatio : 0) + bonus(s, "home"), 0.8);
  assign("home", homeCol, homeCol ? homeCol.homeRatio : 0);

  const statusCol = best((s) => (s.distinctCount <= 6 ? s.statusRatio : 0) + bonus(s, "status"), 0.5);
  assign("status", statusCol, statusCol ? statusCol.statusRatio : 0);

  // Équipe du club : le signal le plus fiable quand on connaît les équipes.
  if (teamKeys.length > 0) {
    const teamCol = best((s) => s.teamRatio + bonus(s, "team"), 0.5);
    assign("team", teamCol, teamCol ? teamCol.teamRatio : 0);
  }

  // Adversaire : parmi les colonnes texte restantes, la plus variée. Dans un calendrier
  // l'adversaire change à chaque journée, la compétition et le lieu se répètent.
  const textColumns = free().filter((s) => s.dateRatio < 0.3 && s.timeRatio < 0.3 && s.avgLength >= 2);
  const opponentCandidates = textColumns
    .map((s) => ({ s, value: s.distinctRatio - s.teamRatio * 0.5 + bonus(s, "opponent") }))
    .sort((a, b) => b.value - a.value);
  const opponentCol = opponentCandidates[0]?.s;
  assign("opponent", opponentCol, opponentCol ? Math.min(1, opponentCol.distinctRatio + 0.2) : 0);

  // Compétition : colonne texte qui se répète beaucoup (une équipe joue quelques compétitions).
  const competitionCol = best(
    (s) =>
      (s.dateRatio < 0.3 && s.timeRatio < 0.3 && s.avgLength >= 3 && (s.distinctRatio <= 0.5 || s.distinctCount <= 8)
        ? 1 - s.distinctRatio
        : 0) + bonus(s, "competition"),
    0.3,
  );
  assign("competition", competitionCol, competitionCol ? 1 - competitionCol.distinctRatio : 0);

  // Lieu : ce qui reste de long et de varié (une adresse ou un nom de stade).
  const locationCol = best(
    (s) => (s.dateRatio < 0.3 && s.timeRatio < 0.3 && s.avgLength >= 8 ? 0.6 : 0) + bonus(s, "location"),
    0.6,
  );
  assign("location", locationCol, 0.6);

  // Identifiant : 100% distinct, court, sans espace, et surtout pas une date.
  const idCol = best((s) => (s.idLike && s.distinctRatio >= 0.95 && s.dateRatio < 0.2 ? s.distinctRatio : 0) + bonus(s, "externalEventId"), 0.95);
  assign("externalEventId", idCol, idCol ? idCol.distinctRatio : 0);

  // Dernier recours pour les champs obligatoires encore absents : le nom des colonnes. Le contenu
  // n'a rien donné (fichier trop court, colonnes vides sur l'échantillon), l'en-tête peut sauver.
  const byName = headers.length > 0 ? resolveByHeaderNames(headers) : { columns: {}, updatedAt: null };
  // Le repli par intitules ne servait qu'aux champs OBLIGATOIRES. `team` n'en fait pas partie, il
  // n'etait donc jamais rattrape — alors que c'est lui qui repartit les matchs par equipe, et
  // qu'un planning de club le nomme tres clairement (« CATEGORIES VSF », constate le 09/09/2026 :
  // la colonne etait la, lisible, et restait ignoree). On complete desormais TOUT champ laisse
  // vide par le contenu, sans jamais ecraser ce que le contenu a trouve.
  for (const field of Object.keys(byName.columns) as TabularField[]) {
    if (columns[field] !== undefined) continue;
    const index = byName.columns[field];
    if (index !== undefined && !taken.has(index)) {
      assign(field, stats[index], 0.4);
    }
  }

  return {
    headerRow,
    firstDataRow,
    columns,
    detected: detected.sort((a, b) => a.confidence - b.confidence),
    updatedAtColumn: byName.updatedAt ?? null,
    missingRequired: TABULAR_REQUIRED_FIELDS.filter((f) => columns[f] === undefined),
  };
}

/** Confort : la détection sous la forme attendue par les providers. */
export function layoutToMapping(layout: DetectedLayout, sheetIndex = 0): TabularMapping {
  return {
    sheetIndex,
    headerRow: layout.headerRow,
    firstDataRow: layout.firstDataRow,
    columns: layout.columns,
  };
}
