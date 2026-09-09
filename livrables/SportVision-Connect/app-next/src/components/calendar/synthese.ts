// Hiérarchie d'affichage du calendrier — la logique est ici, et NULLE PART AILLEURS.
//
// ── Le problème que ce fichier résout ──
// Sur un gros club (SF Villemomble : 38 équipes, 445 matchs, 80 créneaux hebdomadaires), la vue
// Mois devenait illisible. Pas parce qu'elle affichait tout — elle se limitait déjà à trois
// éléments par jour — mais parce qu'elle les prenait dans l'ordre CHRONOLOGIQUE. Un mercredi
// chargé, les trois entraînements de 13h45 passaient devant le match de 20h, et la seule
// information qui comptait vraiment disparaissait derrière un « +12 de plus ».
//
// Le remède n'est donc pas de retirer des données, c'est de les ordonner.
//
// ── Pourquoi un fichier partagé plutôt que la logique dans chaque vue ──
// Quatre vues (Mois, Semaine, Jour, Liste) doivent s'accorder sur ce qui est important. Dupliquer
// l'ordre de priorité, c'est garantir qu'un jour l'une d'elles considérera qu'un match passe
// après un entraînement, sans que personne ne le remarque.

import type { CalendarEvent, CalendarEventKind } from "@/lib/types/calendar";

/**
 * Ordre de priorité visuelle, du plus important au moins important.
 *
 * Un match est ce que le club et la production regardent en premier. Une couverture SportVision
 * engage un déplacement d'équipe. Un événement (tournoi, Media Day) est ponctuel donc notable.
 * L'entraînement est récurrent : il structure la semaine mais ne s'apprend pas d'un calendrier,
 * un coach connaît ses créneaux par cœur.
 */
const RANG: Record<CalendarEventKind, number> = {
  match: 0,
  shoot: 1,
  service: 1,
  event: 2,
  camp: 2,
  meeting: 3,
  publication: 3,
  contract_deadline: 4,
  invoice_deadline: 4,
  training: 5,
};

/** Un événement que SportVision couvre, ou doit décider de couvrir. */
export function aCouverture(e: CalendarEvent): boolean {
  return Boolean(e.coverage);
}

/** Rang effectif : un match couvert par SportVision reste un match, mais un entraînement filmé
 *  remonte au niveau d'une prestation — c'est un déplacement d'équipe, pas une séance ordinaire. */
function rang(e: CalendarEvent): number {
  const base = RANG[e.kind] ?? 3;
  return aCouverture(e) ? Math.min(base, 1) : base;
}

/** Tri par importance, puis par heure. L'heure ne départage qu'à importance égale : c'est tout
 *  l'inverse du tri chronologique qui noyait les matchs. */
export function parPriorite(a: CalendarEvent, b: CalendarEvent): number {
  const d = rang(a) - rang(b);
  if (d !== 0) return d;
  return (a.startsAt || "").localeCompare(b.startsAt || "");
}

/** Libellé compact pour la vue Mois, où la largeur d'une case est d'environ 15 caractères.
 *
 *  « Entraînement U11 ESPOIR 2 » devient « U11 Espoir 2 » : le type est déjà porté par la pastille
 *  de couleur, le répéter en toutes lettres consomme la place qui devrait servir à identifier
 *  l'équipe. On ne descend PAS jusqu'à « U11 E2 » : un code que l'utilisateur doit déchiffrer ne
 *  fait pas gagner de temps, il en fait perdre. */
export function libelleCourt(e: CalendarEvent): string {
  if (e.kind === "match" && e.opponent) return e.opponent;
  const nom = e.teamName ?? e.title;
  return nom
    .replace(/^(Entra[iî]nement|Match|Événement|Evenement|Tournage|Prestation|Réunion|Reunion)\s+/i, "")
    .replace(/\bESPOIR\b/g, "Espoir")
    .replace(/\bELITE\b/g, "Élite")
    .replace(/\bFÉMININES?\b/gi, "F")
    .replace(/\bSENIORS\b/g, "Séniors")
    .trim();
}

export interface ResumeJournee {
  /** Ce qu'on montre en toutes lettres : les événements les plus importants du jour. */
  visibles: CalendarEvent[];
  /** Ce qui est replié derrière un compteur, par nature. */
  compteurs: { kind: CalendarEventKind; n: number }[];
  /** Combien de couvertures SportVision, visibles ou non — l'information ne doit jamais se
   *  perdre dans un « +12 », c'est elle qui déclenche un déplacement. */
  couvertures: number;
  /** Total du jour, replis compris. */
  total: number;
}

/**
 * Ce qu'une case de la vue Mois doit montrer.
 *
 * `maxVisibles` est petit à dessein : au-delà de deux ou trois lignes, une case de calendrier
 * cesse d'être lisible d'un coup d'œil et redevient la liste illisible qu'on cherche à éviter.
 * Le reste part en compteurs groupés par nature, qui disent le VOLUME sans détailler — « 8
 * entraînements » se comprend plus vite que huit lignes tronquées.
 */
export function resumerJournee(events: CalendarEvent[], maxVisibles = 2): ResumeJournee {
  const tries = [...events].sort(parPriorite);
  const visibles = tries.slice(0, maxVisibles);
  const replies = tries.slice(maxVisibles);

  const parNature = new Map<CalendarEventKind, number>();
  for (const e of replies) parNature.set(e.kind, (parNature.get(e.kind) ?? 0) + 1);

  return {
    visibles,
    // Les compteurs suivent le même ordre de priorité que les événements eux-mêmes : « 2 matchs »
    // avant « 8 entraînements », jamais l'inverse.
    compteurs: [...parNature.entries()]
      .map(([kind, n]) => ({ kind, n }))
      .sort((a, b) => (RANG[a.kind] ?? 3) - (RANG[b.kind] ?? 3)),
    couvertures: events.filter(aCouverture).length,
    total: events.length,
  };
}

/** Pluriel des compteurs. « 1 match » / « 3 matchs », « 1 entraînement » / « 8 entraînements ». */
export function libelleCompteur(kind: CalendarEventKind, n: number): string {
  const noms: Partial<Record<CalendarEventKind, [string, string]>> = {
    match: ["match", "matchs"],
    training: ["entraînement", "entraînements"],
    event: ["événement", "événements"],
    camp: ["stage", "stages"],
    shoot: ["tournage", "tournages"],
    service: ["prestation", "prestations"],
    meeting: ["réunion", "réunions"],
    publication: ["publication", "publications"],
    contract_deadline: ["échéance", "échéances"],
    invoice_deadline: ["échéance", "échéances"],
  };
  const [un, plusieurs] = noms[kind] ?? ["événement", "événements"];
  return `${n} ${n > 1 ? plusieurs : un}`;
}

/** État sportif d'un match, tel qu'on veut le montrer. `null` quand il n'y a rien à signaler :
 *  un match à venir sans particularité n'a pas besoin d'un badge « à venir », c'est le cas normal
 *  et le badger n'ajoute que du bruit. */
export function etatEvenement(e: CalendarEvent): { label: string; ton: "success" | "warning" | "danger" } | null {
  if (e.status === "annulee") return { label: "Annulé", ton: "danger" };
  if (e.status === "reportee") return { label: "Reporté", ton: "warning" };
  if (e.status === "modifiee") return { label: "Horaire exceptionnel", ton: "warning" };
  if (e.score) return { label: "Terminé", ton: "success" };
  return null;
}

/**
 * La ligne descriptive sous le titre : ce qui situe l'événement sans le répéter.
 *
 * Partagée par les vues Jour, Liste et le détail du jour, pour qu'elles disent la même chose dans
 * le même ordre. Chaque élément est omis quand il est absent plutôt que rendu vide : une suite de
 * séparateurs sans contenu se lit plus mal qu'une ligne courte.
 */
export function descriptionEvenement(e: CalendarEvent): string {
  const bouts: string[] = [];
  if (e.competition) bouts.push(e.competition);
  else if (e.teamName) bouts.push(e.teamName);
  if (e.isHome !== undefined) bouts.push(e.isHome ? "À domicile" : "À l'extérieur");
  if (e.location) bouts.push(e.location);
  return bouts.join(" · ");
}

/** L'écusson à afficher, ou `null`. Passer par une fonction plutôt que lire le champ directement
 *  donne un seul endroit où décider quoi montrer quand il manque — et il manque souvent : un
 *  amical saisi à la main, un adversaire absent de l'annuaire, un club sans écusson déposé. */
export function ecussonAdversaire(e: CalendarEvent): string | null {
  return e.kind === "match" && e.opponentLogoUrl ? e.opponentLogoUrl : null;
}

/**
 * Combien de lignes une case de mois peut porter, selon la charge réelle du club.
 *
 * Deux lignes conviennent à SF Villemomble (38 équipes, une trentaine d'événements les mercredis).
 * Elles seraient inutilement avares pour un club de six équipes, dont les journées tiennent
 * entièrement dans la case : y afficher « 1 match » puis « 2 entraînements » en compteurs quand
 * les trois lignes tenaient, c'est cacher pour rien.
 *
 * On mesure donc, plutôt que de demander à l'utilisateur de régler une densité : le calendrier
 * sait déjà ce qu'il contient, et un réglage de plus est un réglage que personne ne touche.
 */
export function lignesParCase(events: CalendarEvent[]): number {
  const parJour = new Map<string, number>();
  for (const e of events) {
    const jour = (e.startsAt || "").slice(0, 10);
    parJour.set(jour, (parJour.get(jour) ?? 0) + 1);
  }
  if (parJour.size === 0) return 3;
  // La MÉDIANE, pas la moyenne : un tournoi isolé à 40 événements ne doit pas faire passer tout
  // le mois en mode compact.
  const charges = [...parJour.values()].sort((a, b) => a - b);
  const mediane = charges[Math.floor(charges.length / 2)]!;
  if (mediane >= 8) return 2;
  if (mediane <= 3) return 4;
  return 3;
}

/**
 * Ce que l'utilisateur doit voir en ARRIVANT, selon son rôle.
 *
 * Un calendrier de club porte tout ce que fait le club. Ouvrir sur la totalité oblige chacun à
 * filtrer avant de travailler, tous les jours. Un éducateur vient pour ses équipes ; on
 * présélectionne la sienne quand il n'en a qu'une, jamais quand il en a plusieurs — choisir à sa
 * place entre deux équipes serait pire que de ne rien choisir.
 *
 * Rien n'est masqué : le filtre est visible et se retire d'un clic. C'est un point de départ, pas
 * une restriction de droits.
 */
export function equipeParDefaut(role: string, teamScope: string[]): string {
  const educateurs = ["coach", "sports_director", "team_manager"];
  return educateurs.includes(role) && teamScope.length === 1 ? teamScope[0]! : "";
}

/**
 * Le lieu, ramené à ce qui le distingue.
 *
 * « STADE GEORGES POMPIDOU 1 - VILLEMOMBLE » en capitales n'est pas lisible dans une case de
 * calendrier, et la ville est la même pour tous les terrains du club : ce qui distingue, c'est le
 * nom propre. On garde donc « Georges Pompidou », pas la mention administrative complète.
 */
export function lieuCourt(lieu: string | undefined | null): string | null {
  if (!lieu) return null;
  const nettoye = lieu
    .replace(/\s*[-–]\s*VILLEMOMBLE\s*$/i, "")
    .replace(/^(STADE|PARC DES SPORTS|COMPLEXE SPORTIF|PARC MUNICIPAL DES SPORTS)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!nettoye) return null;
  // Tout en capitales : on rétablit une casse lisible. Une chaîne déjà mixte est laissée telle
  // quelle — elle a été saisie par quelqu'un, pas générée.
  const enCapitales = nettoye === nettoye.toUpperCase();
  return enCapitales
    ? nettoye.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_m, sep, c) => sep + c.toUpperCase())
    : nettoye;
}

/**
 * Deux séances de la même équipe le même jour ne sont un doublon que pour qui ne voit ni l'heure
 * ni le lieu. Cette fonction dit lesquelles ont besoin d'être désambiguïsées à l'affichage.
 *
 * Constaté le 09/09/2026 : cinq équipes de Villemomble ont deux séances le même jour sur deux
 * terrains (le planning municipal réserve deux terrains à une même catégorie). Sans le lieu à
 * l'écran, elles passaient pour des doublons.
 */
export function aBesoinDuLieu(event: CalendarEvent, memeJour: CalendarEvent[]): boolean {
  if (event.kind !== "training" || !event.location) return false;
  return memeJour.some(
    (autre) => autre.id !== event.id && autre.kind === "training" && autre.teamName === event.teamName,
  );
}

/**
 * Le statut sportif, en français.
 *
 * `scheduled`, `postponed`, `cancelled` sont les valeurs de la base. Elles n'ont rien à faire à
 * l'écran : « Statut : scheduled » demande à l'utilisateur de traduire lui-même une convention
 * technique qu'il n'a pas choisie.
 */
export function statutLisible(e: CalendarEvent): { label: string; ton: "success" | "warning" | "danger" | "neutral" } {
  switch (e.status) {
    case "annulee":
    case "cancelled":
      return { label: "Annulé", ton: "danger" };
    case "reportee":
    case "postponed":
      return { label: "Reporté", ton: "warning" };
    case "modifiee":
      return { label: "Horaire exceptionnel", ton: "warning" };
    case "completed":
      return { label: "Terminé", ton: "success" };
    default:
      // Un score vaut mieux qu'un statut : une feuille de match remplie dit que la rencontre a eu
      // lieu, même si la source n'a pas mis son statut à jour.
      return e.score ? { label: "Terminé", ton: "success" } : { label: "À venir", ton: "neutral" };
  }
}

/** Le score, décomposé pour être mis en page. `null` tant que la rencontre n'est pas jouée : la
 *  fiche affiche alors « vs », jamais un espace vide entre deux équipes. */
export function scoreDecompose(e: CalendarEvent): { domicile: string; exterieur: string } | null {
  const m = /^(\d+)\s*[-–]\s*(\d+)$/.exec((e.score ?? "").trim());
  if (!m) return null;
  // La base stocke toujours « score du receveur - score du visiteur ». Quand notre équipe se
  // déplace, c'est donc le second nombre qui est le sien : intervertir ici, une seule fois, évite
  // que chaque écran ait à y penser.
  return e.isHome === false
    ? { domicile: m[2]!, exterieur: m[1]! }
    : { domicile: m[1]!, exterieur: m[2]! };
}

/** Libellé du type de couverture. */
export function couvertureLisible(e: CalendarEvent): { label: string; icone: string } | null {
  if (!e.coverage) return null;
  const type = e.coverageType ?? "";
  const icone = type === "video" ? "🎥" : type === "photo_video" ? "📸🎥" : "📸";
  const quoi = type === "video" ? "Vidéo" : type === "photo_video" ? "Photo et vidéo" : "Photo";
  // `mission_creee` signifie qu'une équipe est affectée : c'est l'information qui compte pour le
  // club, plus que le nom interne de l'étape.
  const etat = e.coverage === "mission_creee" ? "Couverture confirmée" : "Couverture prévue";
  return { label: `${etat} · ${quoi}`, icone };
}

/** Vues rapides : les questions qu'on se pose vraiment en ouvrant un calendrier de club.
 *
 *  Elles ne remplacent pas les filtres équipe/type, elles évitent d'avoir à les combiner à la
 *  main pour retrouver une intention courante (« qu'est-ce qu'on doit couvrir ? »). */
export type VueRapide = "tout" | "matchs" | "entrainements" | "sportvision" | "a_couvrir" | "resultats";

export const VUES_RAPIDES: { id: VueRapide; label: string }[] = [
  { id: "tout", label: "Tout" },
  { id: "matchs", label: "Matchs" },
  { id: "entrainements", label: "Entraînements" },
  { id: "sportvision", label: "SportVision" },
  { id: "a_couvrir", label: "À couvrir" },
  { id: "resultats", label: "Résultats" },
];

export function passeVueRapide(e: CalendarEvent, vue: VueRapide): boolean {
  switch (vue) {
    case "matchs":
      return e.kind === "match";
    case "entrainements":
      return e.kind === "training";
    case "sportvision":
      return aCouverture(e);
    case "a_couvrir":
      // Un match sans décision de couverture : c'est exactement la liste de travail de la
      // production. Un entraînement non couvert n'y a pas sa place, on ne couvre pas 80 séances.
      return e.kind === "match" && !aCouverture(e);
    case "resultats":
      return Boolean(e.score);
    default:
      return true;
  }
}
