// Normalisation des valeurs brutes d'une source de calendrier vers les types de club_matches.
// Aucune dépendance : ce fichier est testé directement par src/lib/calendar/__tests__/run.ts.

import type { SportStatus } from "./types.ts";

/**
 * Valeur d'adversaire réellement ÉCRITE en base : trim + espaces internes compactés.
 *
 * Pourquoi normaliser à l'écriture et pas seulement à la comparaison : l'index de repli
 * `club_matches_fallback_uniq` porte sur `lower(opponent)` et rien d'autre — pas de trim, pas de
 * compactage d'espaces. Si le TypeScript comparait "FC  Melun" et "FC Melun" comme identiques mais
 * écrivait la chaîne brute, la base les verrait comme deux adversaires différents et créerait le
 * doublon que la preview annonçait comme "inchangé". En normalisant à l'écriture, la clé JS
 * (`opponentKey` ci-dessous) est exactement `lower()` de ce que la base stocke.
 *
 * Volontairement PAS de suppression d'accents : `lower()` en base ne les retire pas non plus, et
 * une divergence dans l'autre sens (JS plus permissif que l'index) recréerait le même écart.
 */
export function normalizeOpponentValue(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/** Clé de comparaison d'un adversaire — strictement `lower()` de la valeur stockée, pour rester
 * aligné sur `club_matches_fallback_uniq` et sur le trigger club_matches_ignore_source_duplicate. */
export function opponentKey(raw: string): string {
  return normalizeOpponentValue(raw).toLowerCase();
}

/** Comparaison souple de noms d'équipe, utilisée UNIQUEMENT pour proposer une correspondance à
 * l'humain (jamais pour écrire). Ici les accents et la ponctuation sont retirés : il s'agit de
 * rapprocher "U18 D2" et "u18-d2", pas de décider d'une identité en base. */
export function teamMatchKey(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30); // 30/12/1899, décalage du "bug 1900" d'Excel

/**
 * Date → "YYYY-MM-DD". Formats acceptés : ISO, JJ/MM/AAAA, JJ-MM-AAAA, JJ.MM.AAAA, JJ/MM/AA, et
 * le numéro de série Excel (une cellule de date d'un .xlsx ne contient pas de texte mais un
 * nombre de jours depuis le 30/12/1899).
 *
 * Renvoie null plutôt que de deviner : une date illisible devient une ligne en erreur affichée à
 * l'utilisateur, jamais une date inventée.
 */
export function parseFlexibleDate(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (iso) return isRealDate(+iso[1]!, +iso[2]!, +iso[3]!) ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;

  const fr = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/.exec(value);
  if (fr) {
    const day = +fr[1]!;
    const month = +fr[2]!;
    const rawYear = +fr[3]!;
    // Un export de calendrier sportif ne parle jamais du XXe siècle : "26" = 2026.
    const year = fr[3]!.length === 2 ? 2000 + rawYear : rawYear;
    if (!isRealDate(year, month, day)) return null;
    return `${year}-${pad2(month)}-${pad2(day)}`;
  }

  // Numéro de série Excel. Borne basse à 1 (01/01/1900) pour ne pas convertir un "0" parasite,
  // borne haute à 401768 (an 2999) pour ne pas convertir un identifiant numérique en date.
  const serial = /^\d+(\.\d+)?$/.test(value) ? Number(value) : NaN;
  if (Number.isFinite(serial) && serial >= 1 && serial < 401768) {
    const days = Math.floor(serial);
    const d = new Date(EXCEL_EPOCH_UTC + days * 86400000);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  }

  return null;
}

/** Heure → "HH:MM". Accepte 15:00, 15:00:00, 15h, 15h30, 15.30, et la fraction de journée d'une
 * cellule d'heure Excel (0,625 = 15:00). Null si illisible — l'heure est optionnelle partout. */
export function parseFlexibleTime(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;

  // Fraction de journée Excel (0,625 = 15:00) — testée AVANT la forme "HH:MM" : "0.625" est
  // aussi accepté par la regex ci-dessous (h=0, séparateur ".", m="62"), qui le rejetterait
  // ensuite comme minutes invalides et perdrait l'heure au lieu de la convertir.
  const decimal = value.replace(",", ".");
  const fraction = /^0?\.\d+$/.test(decimal) ? Number(decimal) : NaN;
  if (Number.isFinite(fraction) && fraction > 0 && fraction < 1) {
    const totalMinutes = Math.round(fraction * 24 * 60);
    return `${pad2(Math.floor(totalMinutes / 60) % 24)}:${pad2(totalMinutes % 60)}`;
  }

  const hm = /^(\d{1,2})\s*[:h.]\s*(\d{1,2})?/i.exec(value);
  if (hm) {
    const h = +hm[1]!;
    const m = hm[2] ? +hm[2]! : 0;
    if (h > 23 || m > 59) return null;
    return `${pad2(h)}:${pad2(m)}`;
  }

  // "1500" (certains exports collent l'heure sans séparateur).
  const compact = /^(\d{2})(\d{2})$/.exec(value);
  if (compact) {
    const h = +compact[1]!;
    const m = +compact[2]!;
    if (h > 23 || m > 59) return null;
    return `${compact[1]}:${compact[2]}`;
  }

  return null;
}

const STATUS_WORDS: { status: SportStatus; words: string[] }[] = [
  { status: "postponed", words: ["reporte", "report", "remis", "a reprogrammer", "postponed", "rescheduled"] },
  { status: "cancelled", words: ["annule", "annulation", "forfait", "cancelled", "canceled"] },
  { status: "completed", words: ["joue", "termine", "resultat", "played", "completed", "finished", "final"] },
  { status: "scheduled", words: ["prevu", "programme", "a venir", "confirme", "scheduled", "confirmed"] },
];

/** Cherche un statut dans un texte libre. `null` = rien de reconnaissable (texte vide, ou aucun
 * mot-clé) — à distinguer d'un statut reconnu, y compris quand ce texte est un titre d'événement
 * ICS qui ne parle pas de statut du tout. */
export function detectSportStatus(raw: string | null | undefined): SportStatus | null {
  if (raw === null || raw === undefined) return null;
  const value = teamMatchKey(raw);
  if (!value) return null;
  for (const entry of STATUS_WORDS) {
    if (entry.words.some((w) => value.includes(w))) return entry.status;
  }
  return null;
}

/**
 * Cellule de statut → SportStatus. Renvoie "unknown" quand la cellule est bien remplie mais
 * illisible pour nous : c'est une information réelle ("cette source dit quelque chose que nous ne
 * savons pas interpréter"), pas la même chose qu'une absence de statut. Une cellule vide renvoie
 * `fallback` (par défaut "scheduled", le cas normal d'un calendrier à venir).
 *
 * À n'appeler QUE lorsque la source porte réellement une colonne/propriété de statut. Quand elle
 * n'en a pas, l'appelant doit produire `null` (voir SourceEvent.sportStatus) et surtout pas
 * "scheduled" : ce serait affirmer à la place de la source.
 */
export function coerceSportStatus(raw: string | null | undefined, fallback: SportStatus = "scheduled"): SportStatus {
  if (raw === null || raw === undefined) return fallback;
  if (!teamMatchKey(raw)) return fallback;
  return detectSportStatus(raw) ?? "unknown";
}

/** "3-1", "3 - 1", "3:1" → "3-1". Tout le reste → null (jamais un score inventé). */
export function normalizeScore(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = /^(\d{1,3})\s*[-:]\s*(\d{1,3})$/.exec(raw.trim());
  return m ? `${+m[1]!}-${+m[2]!}` : null;
}

/**
 * Coupe un titre d'export sur les séparateurs les plus courants ("Club A - Club B", "Club A vs
 * Club B"). Renvoie les deux côtés SANS décider lequel est l'adversaire : c'est le moteur, qui
 * connaît les équipes du club, qui tranche (voir splitOpponentFromTitle dans diff.ts). Comportement
 * historique conservé : sans séparateur reconnu, le titre entier est proposé tel quel, jamais un
 * nom deviné à l'aveugle.
 */
export function splitTitleSides(title: string): { left: string; right: string } | null {
  const separators = [" vs ", " VS ", " v. ", " contre ", " - ", " – ", " — "];
  for (const sep of separators) {
    const index = title.indexOf(sep);
    if (index > 0) {
      const left = title.slice(0, index).trim();
      const right = title.slice(index + sep.length).trim();
      if (left && right) return { left, right };
    }
  }
  return null;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}
