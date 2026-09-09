// Vocabulaire d'en-têtes générique français/anglais — extrait de providers/csv.ts pour être
// partagé avec la détection automatique (autodetect.ts) sans créer de cycle d'import.
//
// À lire correctement : ce sont des INDICES tirés du nom des colonnes, pas une connaissance d'un
// format particulier. Aucun de ces libellés ne vient d'un export Footclubs, qui n'a jamais été vu.
// Depuis la détection par contenu (autodetect.ts), ces noms ne sont plus la source principale : ils
// servent à confirmer une colonne, et à trancher quand deux colonnes se ressemblent autant.

import { teamMatchKey } from "./normalize.ts";
import { TABULAR_FIELDS, type TabularField } from "./types.ts";

const HEADERS: Record<TabularField, readonly string[]> = {
  externalEventId: ["id", "identifiant", "id match", "match id", "id rencontre", "numero", "no match", "n match"],
  externalTeamId: ["id equipe", "code equipe"],
  externalCompetitionId: ["id competition", "code competition", "id championnat", "code epreuve"],
  opponent: ["adversaire", "opponent", "equipe adverse", "club adverse", "contre", "rencontre", "visiteur", "recevant"],
  // « categories » et « categorie » seuls : beaucoup de plannings de club nomment ainsi la colonne
  // qui porte l'equipe — « CATEGORIES VSF » chez Villemomble (09/09/2026). Sans eux, cette colonne
  // etait prise pour le lieu et les matchs partaient tous sur la mauvaise equipe.
  team: ["equipe", "mon equipe", "notre equipe", "team", "equipe locale", "categorie equipe", "categorie", "categories"],
  competition: ["competition", "championnat", "epreuve", "poule", "coupe", "division"],
  status: ["statut", "status", "etat"],
  time: ["heure", "horaire", "time", "coup d envoi", "kickoff"],
  location: ["lieu", "location", "adresse", "terrain", "stade", "installation"],
  score: ["score", "resultat"],
  home: ["domicile", "dom ext", "domicile exterieur", "home"],
  date: ["date", "date du match", "date rencontre", "jour"],
};

// Ordre d'attribution du plus spécifique au plus générique. "date de modification" doit être
// capté avant que `date` ne le réclame (il contient "date"), et "équipe adverse" par `opponent`
// avant que `team` ne le réclame (il contient "équipe"). Un ordre déclaratif donnerait un mapping
// faux sur des fichiers parfaitement corrects.
const RESOLUTION_ORDER: TabularField[] = [
  "externalCompetitionId",
  "externalTeamId",
  "externalEventId",
  "opponent",
  "team",
  "competition",
  "status",
  "time",
  "location",
  "score",
  "home",
  "date",
];

/** Colonne "date de modification" : traitée à part car elle n'est pas un champ du match mais la
 * fraîcheur de la donnée source, et parce qu'elle doit être réservée AVANT `date`. */
export const UPDATED_AT_HEADERS = [
  "date de modification",
  "modifie le",
  "mise a jour",
  "maj",
  "last modified",
  "updated at",
];

export function normalizeHeaders(headers: string[]): string[] {
  return headers.map((h) => teamMatchKey(h));
}

/** Sélection en trois passes, de la plus stricte à la plus permissive : une égalité exacte
 * l'emporte toujours sur une correspondance partielle, quel que soit l'ordre des colonnes. */
export function pickColumn(normalizedHeaders: string[], candidates: readonly string[], taken: Set<number>): number | null {
  const free = normalizedHeaders.map((h, i) => ({ h, i })).filter(({ i }) => !taken.has(i));
  for (const candidate of candidates) {
    const exact = free.find(({ h }) => h === candidate);
    if (exact) return exact.i;
  }
  for (const candidate of candidates) {
    const prefix = free.find(({ h }) => h.startsWith(`${candidate} `) || h === candidate);
    if (prefix) return prefix.i;
  }
  for (const candidate of candidates) {
    // Passe permissive réservée aux libellés assez longs pour ne pas déclencher de faux positif :
    // chercher "id" n'importe où dans un en-tête accrocherait n'importe quelle colonne contenant
    // ces deux lettres. Les formes "id" et "id …" sont déjà couvertes par les passes précédentes.
    if (candidate.length < 4) continue;
    const loose = free.find(({ h }) => h.includes(candidate));
    if (loose) return loose.i;
  }
  return null;
}

export interface HeaderResolution {
  columns: Partial<Record<TabularField, number>>;
  updatedAt: number | null;
}

/** Rattache les colonnes à partir de leurs seuls noms. Renvoie ce qu'il a trouvé, sans exiger que
 * les champs obligatoires y soient : c'est l'appelant qui décide quoi faire des trous. */
export function resolveByHeaderNames(rawHeaders: string[]): HeaderResolution {
  const normalized = normalizeHeaders(rawHeaders);
  const taken = new Set<number>();

  const updatedAt = pickColumn(normalized, UPDATED_AT_HEADERS, taken);
  if (updatedAt !== null) taken.add(updatedAt);

  const columns: Partial<Record<TabularField, number>> = {};
  for (const field of RESOLUTION_ORDER) {
    const index = pickColumn(normalized, HEADERS[field], taken);
    if (index !== null) {
      columns[field] = index;
      taken.add(index);
    }
  }
  return { columns, updatedAt };
}

/** Le champ qu'un nom de colonne suggère, ou null. Utilisé par la détection par contenu pour
 * départager deux colonnes de même profil. */
export function fieldHintForHeader(rawHeader: string): TabularField | null {
  const normalized = teamMatchKey(rawHeader);
  if (!normalized) return null;
  if (UPDATED_AT_HEADERS.some((c) => normalized === c || normalized.startsWith(`${c} `))) return null;
  for (const field of TABULAR_FIELDS) {
    const candidates = HEADERS[field];
    if (candidates.some((c) => normalized === c)) return field;
  }
  for (const field of RESOLUTION_ORDER) {
    const candidates = HEADERS[field];
    if (candidates.some((c) => c.length >= 4 && normalized.includes(c))) return field;
  }
  return null;
}
