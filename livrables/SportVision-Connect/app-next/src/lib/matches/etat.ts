// Dans quelle file tombe un match, et lequel demande une action.
//
// ── Ce qu'on a trouvé en base avant d'écrire ce fichier (09/09/2026, SF Villemomble) ──
// 430 matchs, TOUS au statut `a_venir`, du 12/08/2026 au 30/05/2027. Dont cinquante déjà joués.
// Aucun score saisi, nulle part.
//
// Rien ne fait passer un match de `a_venir` à `a_transmettre` : ni cron, ni trigger, ni geste
// d'écran. L'onglet « À transmettre » était donc vide, et comme le bouton « Saisir un résultat »
// est désactivé quand cette liste est vide, le Match Center n'offrait AUCUN moyen de saisir un
// résultat — pour aucun des 430 matchs. Ce n'était pas un défaut d'ergonomie, c'était un écran
// sans issue.
//
// ── Pourquoi on dérive plutôt que d'écrire en base ──
// La tentation est de faire basculer `status` à `a_transmettre` la nuit venue. On s'en garde :
// `status` est aussi ce que le CLUB écrit (reporté, annulé, reçu). Un automate qui écrit dans la
// même colonne rend impossible de distinguer « personne n'a saisi » de « le club a agi », et une
// erreur de fuseau horaire y devient une écriture de masse à défaire à la main.
//
// Qu'un match joué hier attende sa feuille de match n'est pas un état stocké : c'est une lecture
// du calendrier. On la calcule, elle se corrige toute seule, et elle ne touche à rien.
//
// ── La hiérarchie ──
// Même principe que la vue Mois du calendrier (components/calendar/synthese.ts) : ce qui demande
// une action passe devant ce qui informe. Un club ouvre cet écran pour saisir un résultat, pas
// pour relire son calendrier de mai prochain.

import type { Match } from "@/lib/types/studio";

export type FileMatch =
  | "a_renseigner"
  | "cette_semaine"
  | "a_venir"
  | "joues"
  | "reportes"
  | "annules";

export const ORDRE_FILES: FileMatch[] = [
  "a_renseigner",
  "cette_semaine",
  "a_venir",
  "joues",
  "reportes",
  "annules",
];

export const LIBELLE_FILE: Record<FileMatch, string> = {
  a_renseigner: "À renseigner",
  cette_semaine: "Cette semaine",
  a_venir: "À venir",
  joues: "Résultats saisis",
  reportes: "Reportés",
  annules: "Annulés",
};

export const EXPLICATION_FILE: Record<FileMatch, string> = {
  a_renseigner: "Ces matchs sont joués et attendent leur feuille de match.",
  cette_semaine: "Les sept prochains jours.",
  a_venir: "Le reste de la saison.",
  joues: "Résultat confirmé par le club.",
  // « Reprogrammés » promettait une date que rien ne pose : la modale de report n'en demande
  // aucune (12/09/2026).
  reportes: "Reportés : la nouvelle date reste à fixer.",
  annules: "Ne seront pas joués.",
};

/** Les sept prochains jours : la fenêtre qu'un club regarde le lundi matin. */
const JOURS_SEMAINE = 7;

/**
 * Le tout se compare en jours calendaires, jamais en instants.
 *
 * `club_matches.match_date` est une DATE Postgres, sans heure ni fuseau. La convertir en Date
 * locale puis soustraire deux instants réintroduit le décalage que `parseDateOnly` existe
 * justement pour éviter, et une heure d'été suffirait à faire basculer un match d'une file à
 * l'autre. On ramène donc les deux côtés au même numéro de jour, calculé en UTC pour les deux :
 * le fuseau s'annule, et un tri par chaîne suffit partout ailleurs.
 */
function numeroDeJour(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000;
}

function ecartEnJours(match: Match, aujourdhui: Date): number | null {
  const date = match.kickoffAt ? numeroDeJour(match.kickoffAt) : null;
  if (date === null) return null;
  const ref = Date.UTC(aujourdhui.getFullYear(), aujourdhui.getMonth(), aujourdhui.getDate()) / 86_400_000;
  return date - ref;
}

export function aUnResultat(match: Match): boolean {
  return match.scoreFor !== undefined && match.scoreAgainst !== undefined;
}

/**
 * Un score officiel est arrivé, mais le club n'a encore rien confirmé.
 *
 * 10/09/2026 — L'audit de la source fédérale a montré qu'elle publie le score des rencontres
 * jouées (`home_score`/`outside_score`), et la synchro quotidienne le recopie désormais sur les
 * matchs où le club n'a rien saisi. Ce qu'elle ne publie PAS : les buteurs, les passeurs, l'homme
 * du match, le commentaire — c'est-à-dire tout ce qui sert à faire un contenu.
 *
 * Un score officiel ne clôt donc pas le sujet, il le prépare : le match reste dans la file « à
 * renseigner », son score déjà rempli, et le club n'a plus qu'à ajouter ce que la fédération
 * ignore. C'est `status` qui marque le passage d'un humain (`saveClubMatchResult` écrit « recu »),
 * jamais la seule présence d'un score.
 */
export function scoreOfficielNonConfirme(match: Match): boolean {
  return aUnResultat(match) && match.status !== "result_received" && match.status !== "content_created";
}

export function fileDuMatch(match: Match, aujourdhui: Date = new Date()): FileMatch {
  if (match.status === "cancelled") return "annules";
  if (match.status === "postponed") return "reportes";
  // « Joué » veut dire : quelqu'un du club a confirmé. Un score tombé de la fédération ne suffit
  // pas — voir scoreOfficielNonConfirme ci-dessus.
  if (match.status === "result_received" || match.status === "content_created") return "joues";

  const ecart = ecartEnJours(match, aujourdhui);
  // Un match sans date ne peut pas être classé par le temps. Le mettre « à venir » le rendrait
  // invisible au fond d'une liste de 400 ; il attend une saisie autant que les autres.
  if (ecart === null) return "a_renseigner";
  if (ecart < 0) return "a_renseigner";
  if (ecart <= JOURS_SEMAINE) return "cette_semaine";
  return "a_venir";
}

/** Depuis combien de jours un match attend sa feuille. 0 si ce n'est pas le sujet. */
export function retardEnJours(match: Match, aujourdhui: Date = new Date()): number {
  const ecart = ecartEnJours(match, aujourdhui);
  return ecart !== null && ecart < 0 ? -ecart : 0;
}

/**
 * Peut-on saisir un résultat sur ce match ?
 *
 * Avant, la réponse tenait au seul statut `a_transmettre` — que rien ne posait jamais. Elle tient
 * maintenant au fait que le match ait été joué, ce qui est la vraie condition. Un match de mai
 * prochain ne propose toujours rien : offrir la saisie sur 430 lignes reviendrait à ne la mettre
 * en évidence nulle part.
 *
 * Un match annulé est le seul cas exclu : il n'aura pas lieu.
 */
export function peutSaisirResultat(match: Match, aujourdhui: Date = new Date()): boolean {
  if (match.status === "cancelled") return false;
  const file = fileDuMatch(match, aujourdhui);
  return file === "a_renseigner" || file === "reportes" || match.status === "result_pending";
}

/** Le tri propre à chaque file : les retards du plus ancien au plus récent (on rattrape dans
 *  l'ordre), l'avenir au plus proche, le passé au plus récent. */
function comparer(file: FileMatch, a: Match, b: Match): number {
  const da = a.kickoffAt || "";
  const db = b.kickoffAt || "";
  if (file === "joues" || file === "annules") return db.localeCompare(da);
  return da.localeCompare(db);
}

export interface GroupeMatchs {
  file: FileMatch;
  matchs: Match[];
}

/** Les files non vides, dans l'ordre d'urgence. Une file vide n'est pas un onglet à cliquer pour
 *  découvrir qu'il n'y a rien : elle disparaît. */
export function grouperMatchs(matchs: Match[], aujourdhui: Date = new Date()): GroupeMatchs[] {
  const parFile = new Map<FileMatch, Match[]>();
  for (const m of matchs) {
    const file = fileDuMatch(m, aujourdhui);
    const liste = parFile.get(file);
    if (liste) liste.push(m);
    else parFile.set(file, [m]);
  }
  return ORDRE_FILES.filter((f) => (parFile.get(f)?.length ?? 0) > 0).map((file) => ({
    file,
    matchs: (parFile.get(file) ?? []).sort((a, b) => comparer(file, a, b)),
  }));
}

/**
 * Le score, dans l'ordre où l'écran nomme les deux équipes.
 *
 * `club_matches.score` s'écrit toujours « notre équipe - adversaire », et la ligne de match écrit
 * toujours notre équipe en premier (« Seniors 1 @ Ste Geneviève »). Il n'y a donc rien à
 * intervertir, jamais — pas même à l'extérieur.
 *
 * 10/09/2026 — La version précédente inversait sur les matchs à l'extérieur, en croyant afficher
 * « receveur - visiteur ». Sur le premier vrai résultat de la saison, un 2-0 gagné à
 * Sainte-Geneviève s'affichait « Seniors 1 @ Ste Geneviève  0 - 2 ». Le même défaut existait au
 * calendrier (synthese.ts § scoreDecompose), venu de la même hypothèse fausse sur ce que la base
 * stocke. `charger-saison-federale.mjs`, lui, ÉCRIVAIT dans le mauvais ordre : corrigé aussi.
 */
export function scoreAffiche(match: Match): { nous: number; eux: number } | null {
  if (!aUnResultat(match)) return null;
  return { nous: match.scoreFor as number, eux: match.scoreAgainst as number };
}

/** Gagné, perdu, nul — pour un liseré de couleur, jamais pour remplacer le score lui-même. */
export function issue(match: Match): "gagne" | "perdu" | "nul" | null {
  if (!aUnResultat(match)) return null;
  const pour = match.scoreFor as number;
  const contre = match.scoreAgainst as number;
  if (pour > contre) return "gagne";
  if (pour < contre) return "perdu";
  return "nul";
}
