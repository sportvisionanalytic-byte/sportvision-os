// Socle commun de l'import/synchronisation de calendrier — phase TypeScript du chantier
// "Synchronisation automatique des calendriers" (Lot 0 SQL exécuté le 05/09/2026, vérifié en base :
// club_matches.provider/external_event_id/external_competition_id/kickoff_time/sport_status/
// saison_id/source_updated_at/last_synced_at + club_calendar_sources + club_team_source_mappings +
// calendar_sync_runs).
//
// Règle de ce chantier : le SQL est la source de vérité. Aucun modèle parallèle n'est défini ici,
// chaque type ci-dessous est le miroir strict d'une colonne réelle. Les valeurs de `ProviderId` et
// `SportStatus` répliquent mot pour mot les contraintes check posées en base
// (club_matches_provider_check, club_matches_sport_status_check) : ajouter une valeur ici sans
// l'ajouter à la contrainte produirait un échec d'insertion en production.
//
// Imports relatifs (et non `@/lib/...`) à l'intérieur de src/lib/calendar/ : ce dossier est du
// TypeScript pur, sans React ni Supabase, et il est exécuté tel quel par le harnais de tests
// (src/lib/calendar/__tests__/run.ts, `node --experimental-strip-types`) qui ne connaît pas les
// alias de chemin de tsconfig. Le reste de l'app continue d'importer ce dossier via `@/`.

/** Miroir de club_matches_provider_check / club_calendar_sources_provider_check. */
export type ProviderId = "MANUAL" | "CSV" | "ICS" | "FOOTCLUBS_XLSX" | "FFF" | "OTHER";

/** Miroir de club_matches_sport_status_check. Statut SPORTIF du match, distinct de
 * `club_matches.status` qui décrit l'avancement de la PRODUCTION de contenu (a_venir /
 * a_transmettre / recu / reportee / annulee). Le trigger trg_club_matches_sport_status propage
 * postponed→reportee et cancelled→annulee, jamais l'inverse. */
export type SportStatus = "scheduled" | "postponed" | "cancelled" | "completed" | "unknown";

/** §"L'UI doit afficher un libellé humain" — jamais la valeur brute de la colonne à l'écran. */
export const SPORT_STATUS_LABELS: Record<SportStatus, string> = {
  scheduled: "Programmé",
  postponed: "Reporté",
  cancelled: "Annulé",
  completed: "Joué",
  unknown: "Statut inconnu",
};

/**
 * Un événement tel que la source le décrit, une fois normalisé — la sortie de tout provider.
 *
 * Volontairement PAS un `club_matches` partiel : un provider ne connaît ni le club, ni la saison,
 * ni l'équipe SportVision. Il ne connaît que ce que son fichier contient. La résolution
 * équipe/saison/club est faite ensuite par le moteur (diff.ts), avec les mappings confirmés et le
 * contexte choisi par l'humain.
 */
export interface SourceEvent {
  /** Numéro de ligne (CSV/XLSX) ou index d'événement (ICS), 1-based — sert uniquement à pointer
   * précisément la ligne fautive dans le rapport d'erreurs (§"Afficher précisément les lignes en
   * erreur"). */
  sourceLine: number;
  /** Libellé brut d'origine, conservé pour que l'humain reconnaisse sa ligne dans la preview. */
  rawLabel: string;

  /** Identifiant du match chez la source → club_matches.external_event_id. NULL quand la source
   * n'en fournit pas : l'identité retombe alors sur la clé de repli (voir identity.ts). */
  externalEventId: string | null;
  externalCompetitionId: string | null;
  competitionName: string | null;

  /** Identité de MON équipe côté source (pas de l'adversaire) — clé de club_team_source_mappings. */
  externalTeamId: string | null;
  sourceTeamName: string | null;

  opponent: string;
  /** YYYY-MM-DD. */
  matchDate: string;
  /** HH:MM, ou null quand la source ne donne pas d'heure (fréquent en CSV). */
  kickoffTime: string | null;
  location: string | null;
  isHome: boolean | null;
  /**
   * Statut sportif TEL QUE LA SOURCE LE DIT, ou `null` quand elle ne dit rien.
   *
   * La distinction est indispensable : un CSV sans colonne "statut" est silencieux, il n'affirme
   * pas que le match est "scheduled". Sans ce `null`, un réimport de calendrier repasserait à
   * "programmé" un match que le coach a déjà marqué joué — et le trigger de base repasserait
   * `status` de 'recu' à 'a_venir' dans la foulée. Un statut absent ne modifie donc jamais
   * l'existant ; il vaut "scheduled" uniquement à la création d'une nouvelle ligne.
   */
  sportStatus: SportStatus | null;
  /** "N-N" quand la source porte un score (§"score si supporté"), sinon null. */
  score: string | null;
  /** Horodatage de la donnée chez la source (ICS LAST-MODIFIED, colonne "modifié le"...) →
   * club_matches.source_updated_at. Sert à ne pas écraser une info plus récente par une réponse
   * de sync plus ancienne. */
  sourceUpdatedAt: string | null;
}

/** Ligne que le provider n'a pas pu lire. Ne bloque JAMAIS le reste de l'import
 * (§"Un import partiellement invalide ne doit pas rendre le calendrier inutilisable"). */
export interface SourceIssue {
  line: number;
  raw: string;
  reason: string;
}

export interface ParseResult {
  events: SourceEvent[];
  issues: SourceIssue[];
}

/** Ce qu'un provider reçoit. `text` pour les formats texte (CSV/ICS), `bytes` pour les formats
 * binaires (XLSX). `options` porte le mapping de colonnes des providers qui en exigent un. */
export interface ProviderInput {
  fileName: string;
  text?: string;
  bytes?: ArrayBuffer;
  options?: unknown;
}

/** Résultat d'`inspect()` : ce qu'on peut montrer à l'humain AVANT de savoir lire le fichier —
 * feuilles, en-têtes, quelques lignes. C'est ce qui permet un mapping manuel sans rien deviner. */
export interface SheetInspection {
  index: number;
  name: string;
  /** Contenu brut des premières lignes, en-tête comprise, telles quelles. */
  rows: string[][];
  rowCount: number;
}

export interface SourceInspection {
  sheets: SheetInspection[];
}

/**
 * Abstraction d'une source de calendrier.
 *
 * Les capacités du chantier se répartissent en deux familles, et c'est délibéré :
 *  - **spécifiques au provider** : `fetch` (récupérer la donnée) et `parse` (+ normalisation) —
 *    seul le provider sait lire son format ;
 *  - **communes à tous** : `preview`, `mapTeams`, `diff`, `sync` — elles ne dépendent que de
 *    `SourceEvent` et du contenu de club_matches, donc elles vivent une seule fois dans le moteur
 *    (diff.ts + data/club/calendar-sync.ts) plutôt que d'être réimplémentées par chaque provider.
 *    Les dupliquer par provider serait exactement le "deuxième moteur d'import" que le cadre
 *    interdit, et garantirait des divergences de comportement entre CSV et Footclubs.
 */
export interface CalendarProvider {
  readonly id: ProviderId;
  readonly label: string;
  /** Valeur pour l'attribut `accept` d'un <input type="file">. */
  readonly accept: string;
  /** Le provider a besoin que l'humain désigne ses colonnes avant de pouvoir parser. */
  readonly needsColumnMapping: boolean;
  readonly reads: "text" | "binary";
  /** Le provider est-il utilisable en production aujourd'hui ? FOOTCLUBS_XLSX est `false` : sa
   * lecture technique fonctionne, mais aucun mapping de colonnes réel n'est connu. */
  readonly isReady: boolean;

  /** Reconnaît un fichier à son nom et à ses premiers octets/caractères. */
  detect(fileName: string, head: string): boolean;

  /** Formats à structure libre uniquement (XLSX) : donne à voir avant de parser. */
  inspect?(input: ProviderInput): Promise<SourceInspection>;

  parse(input: ProviderInput): Promise<ParseResult>;

  /** Sources "pull" (une API qu'on interroge, un .ics distant). Aucun provider ne l'implémente
   * aujourd'hui : l'audit du 04/09 a conclu qu'aucune API FFF n'est ouverte aux tiers, et le
   * modèle retenu est l'export de fichier par le club (aucune credential ne transite par
   * SportVision). Déclaré ici pour que le jour où une source pull existe, elle entre par cette
   * porte et non par un second moteur. */
  fetchRemote?(source: { url: string; externalClubId?: string | null }): Promise<ProviderInput>;
}
