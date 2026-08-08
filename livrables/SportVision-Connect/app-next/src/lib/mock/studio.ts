import type {
  Match,
  MatchScorer,
  NewsroomItem,
  RequestAttachment,
  StudioCategory,
  StudioFieldKey,
  StudioTemplate,
  VisualFormat,
  VisualPlatform,
  VisualRequest,
  VisualRequestStatus,
  VisualRequestUrgency,
  VisualType,
} from "@/lib/types/studio";
import { STUDIO_PREFILLED_FIELDS, URGENCY_META } from "@/lib/types/studio";

// Données fictives mais réalistes — voir README.md § Fidélité. Toutes scopées sur FC
// Fontainebleau (org-fcf, Club+ Performance) : c'est l'organisation mock qui démontre l'accès à
// ce périmètre, voir consigne de la tâche. À remplacer par de vraies requêtes le jour où le
// backend est tranché (décision hors périmètre, voir app-next/README.md).

const ORG_ID = "org-fcf";

// ---------------------------------------------------------------------------------------------
// Équipes — FC Fontainebleau a 6 équipes (mock-data.ts, teamCount: 6). Aucune entité Team n'est
// encore modélisée ailleurs dans le projet : on garde ici de simples libellés d'affichage.
// ---------------------------------------------------------------------------------------------

export const FCF_TEAM_NAMES = ["Seniors A", "Seniors B", "U19", "U17", "U15", "École de foot"];

// ---------------------------------------------------------------------------------------------
// Studio — 47 modèles, 7 catégories (ACTIONS.md § 6, liste exhaustive reprise telle quelle).
// ---------------------------------------------------------------------------------------------

const CATEGORY_FIELDS: Record<StudioCategory, StudioFieldKey[]> = {
  pre_match: ["team", "opponent", "competition", "date", "venue", "sponsor", "photo", "comment"],
  match_day: ["team", "opponent", "competition", "date", "venue", "photo", "comment"],
  post_match: ["team", "opponent", "competition", "date", "venue", "photo", "comment"],
  players: ["player", "team", "date", "photo", "comment"],
  club_life: ["team", "title", "date", "venue", "photo", "comment"],
  sponsors: ["sponsor", "team", "date", "photo", "comment"],
  events: ["title", "date", "venue", "sponsor", "photo", "comment"],
};

function tpl(
  code: string,
  name: string,
  category: StudioCategory,
  creditCost: 1 | 2 | 3,
): StudioTemplate {
  const deliveryDelay = creditCost === 1 ? "24 h" : creditCost === 2 ? "48 h" : "72 h";
  return {
    code,
    name,
    category,
    creditCost,
    deliveryDelay,
    previewUrl: `placeholder://studio/${code}`,
    sampleUrls: [
      `placeholder://studio/${code}/exemple-1`,
      `placeholder://studio/${code}/exemple-2`,
      `placeholder://studio/${code}/exemple-3`,
    ],
    formFields: CATEGORY_FIELDS[category],
    prefilledFields: STUDIO_PREFILLED_FIELDS,
    minTier: 2,
  };
}

export const STUDIO_TEMPLATES: StudioTemplate[] = [
  // Avant-match (7)
  tpl("matchday", "Matchday", "pre_match", 3),
  tpl("affiche-rencontre", "Affiche de rencontre", "pre_match", 3),
  tpl("convocation", "Convocation", "pre_match", 2),
  tpl("groupe-convoque", "Groupe convoqué", "pre_match", 2),
  tpl("programme-weekend", "Programme du week-end", "pre_match", 2),
  tpl("programme-mensuel", "Programme mensuel", "pre_match", 2),
  tpl("annonce-deplacement", "Annonce de déplacement", "pre_match", 1),

  // Jour de match (7)
  tpl("starting-xi", "Starting XI", "match_day", 2),
  tpl("composition", "Composition", "match_day", 2),
  tpl("remplacants", "Remplaçants", "match_day", 1),
  tpl("coup-envoi", "Coup d'envoi", "match_day", 1),
  tpl("score-direct", "Score en direct", "match_day", 1),
  tpl("mi-temps", "Mi-temps", "match_day", 1),
  tpl("buteur", "Buteur", "match_day", 1),

  // Après-match (7)
  tpl("resultat", "Résultat", "post_match", 1),
  tpl("victoire", "Victoire", "post_match", 1),
  tpl("defaite", "Défaite", "post_match", 1),
  tpl("match-nul", "Match nul", "post_match", 1),
  tpl("homme-du-match", "Homme du match", "post_match", 1),
  tpl("statistiques", "Statistiques", "post_match", 2),
  tpl("classement", "Classement", "post_match", 2),

  // Joueurs (8)
  tpl("joueur-anniversaire", "Anniversaire", "players", 1),
  tpl("signature", "Signature", "players", 2),
  tpl("prolongation", "Prolongation", "players", 2),
  tpl("nouvelle-recrue", "Nouvelle recrue", "players", 3),
  tpl("joueur-presentation", "Présentation", "players", 3),
  tpl("depart", "Départ", "players", 2),
  tpl("selection", "Sélection", "players", 2),
  tpl("recompense", "Récompense", "players", 2),

  // Vie du club (7)
  tpl("communique", "Communiqué", "club_life", 3),
  tpl("recrutement-joueurs", "Recrutement joueurs", "club_life", 2),
  tpl("detection", "Détection", "club_life", 2),
  tpl("stage", "Stage", "club_life", 2),
  tpl("horaires", "Horaires", "club_life", 1),
  tpl("portes-ouvertes", "Portes ouvertes", "club_life", 2),
  tpl("recrutement-educateurs", "Recrutement éducateurs", "club_life", 2),

  // Sponsors (6)
  tpl("nouveau-partenaire", "Nouveau partenaire", "sponsors", 2),
  tpl("sponsor-du-match", "Sponsor du match", "sponsors", 2),
  tpl("sponsor-presentation", "Présentation", "sponsors", 1),
  tpl("remerciement", "Remerciement", "sponsors", 1),
  tpl("offre-sponsor", "Offre", "sponsors", 2),
  tpl("anniversaire-partenariat", "Anniversaire de partenariat", "sponsors", 2),

  // Événements (5)
  tpl("tournoi", "Tournoi", "events", 3),
  tpl("loto", "Loto", "events", 2),
  tpl("soiree-du-club", "Soirée du club", "events", 3),
  tpl("soiree-partenaires", "Soirée partenaires", "events", 2),
  tpl("remise-trophees", "Remise de trophées", "events", 3),
];

export function findTemplate(code: string): StudioTemplate | undefined {
  return STUDIO_TEMPLATES.find((t) => t.code === code);
}

/** Modèle utilisé par Match Center pour « Créer le visuel » après un résultat. */
export const RESULT_TEMPLATE_CODE = "resultat";

const VISUAL_TYPE_OVERRIDES: Record<string, VisualType> = {
  "joueur-anniversaire": "birthday",
  "recrutement-joueurs": "recruitment",
  "recrutement-educateurs": "recruitment",
  detection: "recruitment",
  resultat: "match_result",
  victoire: "match_result",
  defaite: "match_result",
  "match-nul": "match_result",
  matchday: "matchday_poster",
  "affiche-rencontre": "matchday_poster",
  "starting-xi": "lineup",
  composition: "lineup",
};

const CATEGORY_DEFAULT_VISUAL_TYPE: Record<StudioCategory, VisualType> = {
  pre_match: "matchday_poster",
  match_day: "lineup",
  post_match: "match_result",
  players: "player_announcement",
  club_life: "club_announcement",
  sponsors: "sponsor_content",
  events: "event_promo",
};

/** Le mapping modèle → type de visuel n'est pas fourni par la maquette : heuristique par
 * catégorie avec quelques recouvrements explicites pour les modèles les plus évidents. */
export function inferVisualType(template: StudioTemplate): VisualType {
  return VISUAL_TYPE_OVERRIDES[template.code] ?? CATEGORY_DEFAULT_VISUAL_TYPE[template.category];
}

/** Saison sportive en cours (bascule en août) — utilisé pour le bloc « Prérempli automatiquement ». */
export function currentSeasonLabel(referenceDate: Date = new Date()): string {
  const year = referenceDate.getFullYear();
  const startYear = referenceDate.getMonth() >= 6 ? year : year - 1; // bascule en juillet/août
  return `${startYear}/${startYear + 1}`;
}

// ---------------------------------------------------------------------------------------------
// Newsroom — remontées des équipes.
// ---------------------------------------------------------------------------------------------

export const newsroomStore: NewsroomItem[] = [
  {
    id: "news-1",
    organizationId: ORG_ID,
    title: "Belle victoire des U17 ce week-end",
    body: "Les U17 ont dominé Melun 3-0. Superbe état d'esprit, à mettre en avant sur les réseaux.",
    submittedById: "coach-u17",
    submittedByName: "Karim Belaïd",
    teamId: "team-u17",
    teamName: "U17",
    status: "received",
    createdAt: "2026-08-07T18:30:00.000Z",
  },
  {
    id: "news-2",
    organizationId: ORG_ID,
    title: "Nouveau partenaire local",
    body: "La boulangerie Aux Délices du Stade rejoint nos partenaires pour la saison. Logo à récupérer.",
    submittedById: "sec-club",
    submittedByName: "Amandine Roux",
    status: "to_process",
    createdAt: "2026-08-06T09:12:00.000Z",
  },
  {
    id: "news-3",
    organizationId: ORG_ID,
    title: "Stage de pré-saison U15",
    body: "3 jours de stage prévus fin août, besoin d'une communication pour les inscriptions.",
    submittedById: "coach-u15",
    submittedByName: "Sofiane Tadjer",
    teamId: "team-u15",
    teamName: "U15",
    status: "to_process",
    createdAt: "2026-08-05T14:00:00.000Z",
  },
  {
    id: "news-4",
    organizationId: ORG_ID,
    title: "Anniversaire du capitaine des Seniors A",
    body: "Yanis fête ses 24 ans ce vendredi, ce serait sympa de le mettre à l'honneur.",
    submittedById: "team-manager-sa",
    submittedByName: "Julien Meyer",
    teamId: "team-sa",
    teamName: "Seniors A",
    status: "info_requested",
    createdAt: "2026-08-04T11:20:00.000Z",
  },
  {
    id: "news-5",
    organizationId: ORG_ID,
    title: "Portes ouvertes école de foot",
    body: "Journée portes ouvertes le 14 septembre pour recruter les 6-9 ans, déjà transformée en visuel.",
    submittedById: "resp-ecole",
    submittedByName: "Nadia Cherif",
    teamId: "team-ecole",
    teamName: "École de foot",
    status: "transformed",
    transformedIntoType: "visual_request",
    createdAt: "2026-07-30T08:00:00.000Z",
  },
  {
    id: "news-6",
    organizationId: ORG_ID,
    title: "Retour sur le tournoi amical",
    body: "Photos prises pendant le tournoi amical, plus vraiment d'actualité maintenant.",
    submittedById: "coach-u19",
    submittedByName: "Bruno Faivre",
    teamId: "team-u19",
    teamName: "U19",
    status: "archived",
    createdAt: "2026-07-20T16:45:00.000Z",
  },
];

export function addNewsroomItem(item: NewsroomItem) {
  newsroomStore.unshift(item);
}

export function updateNewsroomItem(id: string, patch: Partial<NewsroomItem>) {
  const item = newsroomStore.find((i) => i.id === id);
  if (item) Object.assign(item, patch);
}

// ---------------------------------------------------------------------------------------------
// Match Center.
// ---------------------------------------------------------------------------------------------

export const matchesStore: Match[] = [
  {
    id: "match-1",
    organizationId: ORG_ID,
    teamId: "team-sa",
    teamName: "Seniors A",
    opponent: "US Varenne",
    competition: "Championnat Régional 1",
    kickoffAt: "2026-08-16T15:00:00.000Z",
    venue: "Stade Pierre-Bardin",
    isHome: true,
    status: "upcoming",
  },
  {
    id: "match-2",
    organizationId: ORG_ID,
    teamId: "team-u19",
    teamName: "U19",
    opponent: "AS Melun",
    competition: "Coupe Départementale",
    kickoffAt: "2026-08-09T14:00:00.000Z",
    venue: "Stade Pierre-Bardin",
    isHome: true,
    status: "result_pending",
  },
  {
    id: "match-3",
    organizationId: ORG_ID,
    teamId: "team-u17",
    teamName: "U17",
    opponent: "FC Melun",
    competition: "Championnat Départemental",
    kickoffAt: "2026-08-02T10:30:00.000Z",
    venue: "Complexe sportif de Melun",
    isHome: false,
    status: "result_pending",
  },
  {
    id: "match-4",
    organizationId: ORG_ID,
    teamId: "team-sa",
    teamName: "Seniors A",
    opponent: "Racing Club Nemours",
    competition: "Championnat Régional 1",
    kickoffAt: "2026-07-26T15:00:00.000Z",
    venue: "Stade de Nemours",
    isHome: false,
    scoreFor: 2,
    scoreAgainst: 1,
    scorers: [
      { playerName: "Yanis Belkacem", minute: 23 },
      { playerName: "Rayan Fofana", minute: 71 },
    ],
    manOfTheMatch: "Yanis Belkacem",
    status: "result_received",
  },
  {
    id: "match-5",
    organizationId: ORG_ID,
    teamId: "team-u15",
    teamName: "U15",
    opponent: "ES Avon",
    competition: "Championnat Départemental",
    kickoffAt: "2026-07-19T10:00:00.000Z",
    venue: "Stade Pierre-Bardin",
    isHome: true,
    scoreFor: 3,
    scoreAgainst: 0,
    scorers: [
      { playerName: "Lucas Mendes", minute: 12 },
      { playerName: "Lucas Mendes", minute: 55 },
      { playerName: "Enzo Villanova", minute: 80 },
    ],
    manOfTheMatch: "Lucas Mendes",
    status: "content_created",
  },
];

export function addMatch(match: Match) {
  matchesStore.unshift(match);
}

export function updateMatch(id: string, patch: Partial<Match>) {
  const match = matchesStore.find((m) => m.id === id);
  if (match) Object.assign(match, patch);
}

// ---------------------------------------------------------------------------------------------
// VisualRequest — demandes de visuels.
// ---------------------------------------------------------------------------------------------

let requestCounter = 0;

export function generateRequestReference(): string {
  requestCounter += 1;
  const year = new Date().getFullYear();
  return `VIS-${year}-${String(visualRequestsStore.length + requestCounter).padStart(4, "0")}`;
}

function req(
  ref: string,
  visualType: VisualType,
  status: VisualRequestStatus,
  urgency: VisualRequestUrgency,
  publishDate: string,
  createdAt: string,
  extra: Partial<VisualRequest> = {},
): VisualRequest {
  return {
    id: `req-${ref}`,
    reference: ref,
    organizationId: ORG_ID,
    requestedById: "user-sophie",
    requestedByName: "Sophie Martin",
    visualType,
    format: "post_1_1",
    platform: "instagram",
    publishDate,
    urgency,
    creditsReserved: URGENCY_META[urgency].creditCost,
    status,
    revisionCount: 0,
    dueAt: publishDate,
    attachments: [],
    createdAt,
    ...extra,
  };
}

export const visualRequestsStore: VisualRequest[] = [
  req("VIS-2026-0031", "matchday_poster", "À valider", "priority", "2026-08-15", "2026-08-06T09:00:00.000Z", {
    templateCode: "matchday",
    teamId: "team-sa",
    teamName: "Seniors A",
    bodyText: "FC Fontainebleau reçoit US Varenne — 16 août, 15h",
    format: "banner_16_9",
  }),
  req("VIS-2026-0030", "match_result", "En production", "standard", "2026-08-03", "2026-08-02T20:15:00.000Z", {
    templateCode: "resultat",
    teamId: "team-u15",
    teamName: "U15",
  }),
  req("VIS-2026-0029", "player_announcement", "En traitement", "express", "2026-08-05", "2026-08-04T08:40:00.000Z", {
    templateCode: "nouvelle-recrue",
    teamId: "team-sa",
    teamName: "Seniors A",
    creditsReserved: 3,
  }),
  req("VIS-2026-0028", "club_announcement", "Acceptée", "standard", "2026-08-10", "2026-08-01T11:00:00.000Z", {
    templateCode: "portes-ouvertes",
    teamName: "École de foot",
  }),
  req("VIS-2026-0027", "sponsor_content", "Correction", "priority", "2026-07-30", "2026-07-25T10:00:00.000Z", {
    templateCode: "nouveau-partenaire",
    sponsorName: "Auto Fontainebleau",
    revisionCount: 1,
  }),
  req("VIS-2026-0026", "match_result", "Terminée", "standard", "2026-07-20", "2026-07-19T18:00:00.000Z", {
    templateCode: "victoire",
    teamId: "team-u15",
    teamName: "U15",
  }),
  req("VIS-2026-0025", "birthday", "Terminée", "standard", "2026-07-18", "2026-07-15T09:00:00.000Z", {
    templateCode: "joueur-anniversaire",
    teamId: "team-sa",
    teamName: "Seniors A",
  }),
  req("VIS-2026-0024", "recruitment", "Terminée", "priority", "2026-07-10", "2026-07-06T14:30:00.000Z", {
    templateCode: "recrutement-educateurs",
  }),
  req("VIS-2026-0023", "event_promo", "Refusée", "standard", "2026-07-05", "2026-07-01T09:00:00.000Z", {
    templateCode: "tournoi",
  }),
  req("VIS-2026-0022", "social_story", "Annulée", "standard", "2026-06-28", "2026-06-25T09:00:00.000Z", {}),
  req("VIS-2026-0021", "lineup", "Brouillon", "standard", "2026-08-16", "2026-08-07T16:00:00.000Z", {
    templateCode: "starting-xi",
    teamId: "team-sa",
    teamName: "Seniors A",
  }),
  req("VIS-2026-0020", "sponsor_content", "Brouillon", "standard", "2026-08-20", "2026-08-07T17:10:00.000Z", {
    templateCode: "sponsor-du-match",
    sponsorName: "Varenne Auto",
  }),
];

export function addVisualRequest(request: VisualRequest) {
  visualRequestsStore.unshift(request);
}

export function updateVisualRequest(id: string, patch: Partial<VisualRequest>) {
  const request = visualRequestsStore.find((r) => r.id === id);
  if (request) Object.assign(request, patch);
}

export function buildAttachment(fileName: string, sizeBytes: number): RequestAttachment {
  return { id: `att-${Date.now()}-${Math.round(Math.random() * 1000)}`, fileName, sizeBytes };
}

export const VISUAL_TYPE_OPTIONS: VisualType[] = [
  "matchday_poster",
  "lineup",
  "match_result",
  "player_highlight",
  "player_announcement",
  "club_announcement",
  "sponsor_content",
  "event_promo",
  "birthday",
  "recruitment",
  "social_story",
  "other",
];

export const VISUAL_FORMAT_OPTIONS: VisualFormat[] = ["post_1_1", "story_9_16", "reel_9_16", "banner_16_9"];
export const VISUAL_PLATFORM_OPTIONS: VisualPlatform[] = ["instagram", "tiktok", "facebook", "website", "print"];

export function scorersToText(scorers?: MatchScorer[]): string {
  if (!scorers || scorers.length === 0) return "";
  return scorers.map((s) => (s.minute ? `${s.playerName} (${s.minute}')` : s.playerName)).join(", ");
}

export function textToScorers(text: string): MatchScorer[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const match = entry.match(/^(.*?)\s*\((\d+)'?\)$/);
      if (match) return { playerName: match[1]!.trim(), minute: Number(match[2]) };
      return { playerName: entry };
    });
}
