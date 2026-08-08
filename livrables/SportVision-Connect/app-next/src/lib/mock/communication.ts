import type {
  AnalyticsSummary,
  CommunityManagerProfile,
  Message,
  Presence,
  Publication,
  PublicationComment,
  PublicationHistoryEntry,
  Report,
  Thread,
} from "@/lib/types/communication";

// Données fictives mais réalistes — README.md § Fidélité. Couvre les quatre organisations
// Full Communication du mock (club US Varenne, coach Chris Performance, académie Elite Academy,
// événement Elite Cup 2026) pour démontrer les variantes du périmètre Full Communication.
// "Aujourd'hui" dans cette maquette est calé sur la date système, autour du 8 août 2026.

/** Date fixe de l'événement — sert au compte à rebours dynamique du dashboard (« J-N »). */
export const ELITE_CUP_EVENT_DATE = "2026-08-26T09:00:00.000Z";

// ---------------------------------------------------------------------------------------------
// Publications
// ---------------------------------------------------------------------------------------------

export const mockPublications: Publication[] = [
  // US Varenne (club)
  {
    id: "pub-usv-1",
    organizationId: "org-usv",
    title: "Affiche Matchday — US Varenne vs Melun",
    platform: "instagram",
    format: "post",
    scheduledAt: "2026-08-09T18:00:00.000Z",
    bodyText: "Ce week-end, on reçoit Melun ! Venez nombreux nous soutenir 💪",
    hashtags: ["#USVarenne", "#Matchday"],
    mediaCount: 3,
    teamId: "team-usv-seniors",
    ownerName: "Nina Berger",
    status: "to_validate",
    objective: "Annoncer le match du week-end",
    revisionCount: 0,
  },
  {
    id: "pub-usv-2",
    organizationId: "org-usv",
    title: "Reel entraînement de la semaine",
    platform: "tiktok",
    format: "reel",
    scheduledAt: "2026-08-10T12:00:00.000Z",
    hashtags: ["#USVarenne", "#Entrainement"],
    mediaCount: 1,
    ownerName: "Nina Berger",
    status: "to_produce",
    objective: "Montrer la préparation d'avant-match",
    revisionCount: 0,
  },
  {
    id: "pub-usv-3",
    organizationId: "org-usv",
    title: "Story coulisses vestiaire",
    platform: "instagram",
    format: "story",
    scheduledAt: "2026-08-08T20:00:00.000Z",
    hashtags: ["#USVarenne"],
    mediaCount: 4,
    ownerName: "Nina Berger",
    status: "in_creation",
    revisionCount: 0,
  },
  {
    id: "pub-usv-4",
    organizationId: "org-usv",
    title: "Résultat US Varenne 3-1 Melun",
    platform: "facebook",
    format: "post",
    scheduledAt: "2026-08-03T21:00:00.000Z",
    bodyText: "Belle victoire à domicile ce week-end, 3 buts à 1 face à Melun !",
    hashtags: ["#USVarenne", "#Victoire"],
    mediaCount: 6,
    ownerName: "Nina Berger",
    status: "published",
    revisionCount: 0,
    reach: 4200,
    engagement: 380,
    views: 6100,
    externalPostId: "mtc_8a2f0c",
  },
  {
    id: "pub-usv-5",
    organizationId: "org-usv",
    title: "Portrait joueur du mois — Karim B.",
    platform: "instagram",
    format: "post",
    scheduledAt: "2026-08-14T10:00:00.000Z",
    hashtags: ["#USVarenne", "#PortraitJoueur"],
    mediaCount: 2,
    ownerName: "Nina Berger",
    status: "validated",
    revisionCount: 0,
  },
  {
    id: "pub-usv-6",
    organizationId: "org-usv",
    title: "Annonce partenariat Varenne Auto",
    platform: "instagram",
    format: "post",
    scheduledAt: "2026-08-20T09:00:00.000Z",
    hashtags: ["#USVarenne", "#Partenaire"],
    mediaCount: 1,
    sponsorId: "sponsor-varenne-auto",
    ownerName: "Nina Berger",
    status: "idea",
    revisionCount: 0,
  },
  {
    id: "pub-usv-7",
    organizationId: "org-usv",
    title: "Highlight — Youtube Shorts",
    platform: "youtube",
    format: "reel",
    scheduledAt: "2026-07-28T19:00:00.000Z",
    hashtags: ["#USVarenne"],
    mediaCount: 1,
    ownerName: "Nina Berger",
    status: "published",
    revisionCount: 0,
    reach: 2100,
    engagement: 150,
    views: 5400,
    externalPostId: "mtc_119cd4",
  },
  {
    id: "pub-usv-8",
    organizationId: "org-usv",
    title: "Story sponsor du match",
    platform: "instagram",
    format: "story",
    scheduledAt: "2026-08-09T16:00:00.000Z",
    hashtags: ["#USVarenne"],
    mediaCount: 1,
    sponsorId: "sponsor-varenne-auto",
    ownerName: "Nina Berger",
    status: "corrections",
    revisionCount: 1,
  },
  {
    id: "pub-usv-9",
    organizationId: "org-usv",
    title: "Programme du week-end",
    platform: "instagram",
    format: "post",
    scheduledAt: "2026-08-16T09:00:00.000Z",
    hashtags: ["#USVarenne", "#Programme"],
    mediaCount: 1,
    ownerName: "Nina Berger",
    status: "to_validate",
    revisionCount: 0,
  },

  // Chris Performance (coach)
  {
    id: "pub-chris-1",
    organizationId: "org-chrisperformance",
    title: "Séance explosivité — vidéo pédagogique",
    platform: "instagram",
    format: "reel",
    scheduledAt: "2026-08-11T17:00:00.000Z",
    hashtags: ["#ChrisPerformance", "#Explosivite"],
    mediaCount: 1,
    ownerName: "Nina Berger",
    status: "to_validate",
    revisionCount: 0,
  },
  {
    id: "pub-chris-2",
    organizationId: "org-chrisperformance",
    title: "Avant/après physique athlète",
    platform: "instagram",
    format: "post",
    scheduledAt: "2026-08-09T09:00:00.000Z",
    hashtags: ["#ChrisPerformance"],
    mediaCount: 2,
    ownerName: "Nina Berger",
    status: "to_validate",
    revisionCount: 0,
  },
  {
    id: "pub-chris-3",
    organizationId: "org-chrisperformance",
    title: "Citation motivation du lundi",
    platform: "instagram",
    format: "post",
    scheduledAt: "2026-08-04T08:00:00.000Z",
    hashtags: ["#ChrisPerformance", "#Motivation"],
    mediaCount: 1,
    ownerName: "Nina Berger",
    status: "published",
    revisionCount: 0,
    reach: 1200,
    engagement: 90,
    views: 1800,
    externalPostId: "mtc_552ab1",
  },
  {
    id: "pub-chris-4",
    organizationId: "org-chrisperformance",
    title: "Programme de la semaine",
    platform: "tiktok",
    format: "reel",
    scheduledAt: "2026-08-18T07:00:00.000Z",
    hashtags: ["#ChrisPerformance"],
    mediaCount: 1,
    ownerName: "Nina Berger",
    status: "idea",
    revisionCount: 0,
  },

  // Elite Academy (académie)
  {
    id: "pub-ea-1",
    organizationId: "org-eliteacademy",
    title: "Bilan stage d'été",
    platform: "instagram",
    format: "post",
    scheduledAt: "2026-08-09T11:00:00.000Z",
    hashtags: ["#EliteAcademy", "#StageEte"],
    mediaCount: 5,
    ownerName: "Nina Berger",
    status: "to_validate",
    revisionCount: 0,
  },
  {
    id: "pub-ea-2",
    organizationId: "org-eliteacademy",
    title: "Présentation nouveaux groupes 2026/2027",
    platform: "instagram",
    format: "post",
    scheduledAt: "2026-08-22T10:00:00.000Z",
    hashtags: ["#EliteAcademy"],
    mediaCount: 1,
    ownerName: "Nina Berger",
    status: "to_produce",
    revisionCount: 0,
  },
  {
    id: "pub-ea-3",
    organizationId: "org-eliteacademy",
    title: "Portes ouvertes académie",
    platform: "facebook",
    format: "post",
    scheduledAt: "2026-08-15T09:00:00.000Z",
    hashtags: ["#EliteAcademy", "#PortesOuvertes"],
    mediaCount: 2,
    ownerName: "Nina Berger",
    status: "validated",
    revisionCount: 0,
  },
  {
    id: "pub-ea-4",
    organizationId: "org-eliteacademy",
    title: "Retour sur la saison 2025/2026",
    platform: "youtube",
    format: "reel",
    scheduledAt: "2026-07-30T18:00:00.000Z",
    hashtags: ["#EliteAcademy"],
    mediaCount: 1,
    ownerName: "Nina Berger",
    status: "published",
    revisionCount: 0,
    reach: 3100,
    engagement: 210,
    views: 5000,
    externalPostId: "mtc_77af02",
  },

  // Elite Cup 2026 (événement)
  {
    id: "pub-ec-1",
    organizationId: "org-elitecup",
    title: "Teasing Elite Cup 2026",
    platform: "instagram",
    format: "reel",
    scheduledAt: "2026-08-09T12:00:00.000Z",
    hashtags: ["#EliteCup2026"],
    mediaCount: 1,
    ownerName: "Nina Berger",
    status: "to_validate",
    revisionCount: 0,
  },
  {
    id: "pub-ec-2",
    organizationId: "org-elitecup",
    title: "Présentation des équipes participantes",
    platform: "instagram",
    format: "post",
    scheduledAt: "2026-08-14T09:00:00.000Z",
    hashtags: ["#EliteCup2026"],
    mediaCount: 1,
    ownerName: "Nina Berger",
    status: "to_produce",
    revisionCount: 0,
  },
  {
    id: "pub-ec-3",
    organizationId: "org-elitecup",
    title: "Programme complet du tournoi",
    platform: "facebook",
    format: "post",
    scheduledAt: "2026-08-20T09:00:00.000Z",
    hashtags: ["#EliteCup2026"],
    mediaCount: 1,
    ownerName: "Nina Berger",
    status: "idea",
    revisionCount: 0,
  },
  {
    id: "pub-ec-4",
    organizationId: "org-elitecup",
    title: "Informations pratiques (accès, horaires)",
    platform: "instagram",
    format: "story",
    scheduledAt: "2026-08-24T09:00:00.000Z",
    hashtags: ["#EliteCup2026"],
    mediaCount: 1,
    ownerName: "Nina Berger",
    status: "idea",
    revisionCount: 0,
  },
];

export function getPublicationsByOrg(organizationId: string): Publication[] {
  return mockPublications
    .filter((p) => p.organizationId === organizationId)
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
}

export function getPublicationById(id: string): Publication | undefined {
  return mockPublications.find((p) => p.id === id);
}

// ---------------------------------------------------------------------------------------------
// Commentaires et historique — uniquement sur les deux publications utilisées comme démo de
// fiche détaillée (une en attente de validation, une en correction).
// ---------------------------------------------------------------------------------------------

export const mockPublicationComments: PublicationComment[] = [
  {
    id: "c-usv-1-1",
    publicationId: "pub-usv-1",
    authorName: "Nina Berger",
    authorSide: "sportvision",
    body: "Voici l'affiche pour le match de samedi, dites-moi si la mise en avant du sponsor vous convient.",
    createdAt: "2026-08-07T14:00:00.000Z",
  },
  {
    id: "c-usv-1-2",
    publicationId: "pub-usv-1",
    authorName: "Sophie Martin",
    authorSide: "client",
    body: "Parfait, juste le logo du sponsor à agrandir légèrement.",
    createdAt: "2026-08-07T16:30:00.000Z",
  },
  {
    id: "c-usv-8-1",
    publicationId: "pub-usv-8",
    authorName: "Sophie Martin",
    authorSide: "client",
    body: "Le logo du sponsor est coupé sur la story, peux-tu recadrer ?",
    createdAt: "2026-08-06T10:00:00.000Z",
  },
  {
    id: "c-usv-8-2",
    publicationId: "pub-usv-8",
    authorName: "Nina Berger",
    authorSide: "sportvision",
    body: "Bien reçu, je renvoie une version recadrée aujourd'hui.",
    createdAt: "2026-08-06T11:15:00.000Z",
  },
];

export const mockPublicationHistory: PublicationHistoryEntry[] = [
  { id: "h-usv-1-1", publicationId: "pub-usv-1", toStatus: "idea", actorName: "Nina Berger", at: "2026-08-01T09:00:00.000Z" },
  { id: "h-usv-1-2", publicationId: "pub-usv-1", toStatus: "to_produce", actorName: "Nina Berger", at: "2026-08-03T09:00:00.000Z" },
  { id: "h-usv-1-3", publicationId: "pub-usv-1", toStatus: "in_creation", actorName: "Nina Berger", at: "2026-08-05T10:00:00.000Z" },
  { id: "h-usv-1-4", publicationId: "pub-usv-1", toStatus: "to_validate", actorName: "Nina Berger", at: "2026-08-07T13:00:00.000Z" },

  { id: "h-usv-8-1", publicationId: "pub-usv-8", toStatus: "idea", actorName: "Nina Berger", at: "2026-07-30T09:00:00.000Z" },
  { id: "h-usv-8-2", publicationId: "pub-usv-8", toStatus: "to_produce", actorName: "Nina Berger", at: "2026-08-01T09:00:00.000Z" },
  { id: "h-usv-8-3", publicationId: "pub-usv-8", toStatus: "in_creation", actorName: "Nina Berger", at: "2026-08-03T09:00:00.000Z" },
  { id: "h-usv-8-4", publicationId: "pub-usv-8", toStatus: "to_validate", actorName: "Nina Berger", at: "2026-08-05T09:00:00.000Z" },
  { id: "h-usv-8-5", publicationId: "pub-usv-8", toStatus: "corrections", actorName: "Sophie Martin", at: "2026-08-06T10:00:00.000Z" },
];

export function getCommentsForPublication(publicationId: string): PublicationComment[] {
  return mockPublicationComments
    .filter((c) => c.publicationId === publicationId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export function getHistoryForPublication(publicationId: string): PublicationHistoryEntry[] {
  return mockPublicationHistory
    .filter((h) => h.publicationId === publicationId)
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

// ---------------------------------------------------------------------------------------------
// Présences terrain
// ---------------------------------------------------------------------------------------------

export const mockPresences: Presence[] = [
  { id: "pr-usv-1", organizationId: "org-usv", date: "2026-08-02", eventLabel: "US Varenne vs Melun (aller)", kind: "match", operatorName: "Julien Faure", status: "completed" },
  { id: "pr-usv-2", organizationId: "org-usv", date: "2026-08-08", eventLabel: "Entraînement U17 — captation image", kind: "training", operatorName: "Julien Faure", status: "completed" },
  { id: "pr-usv-3", organizationId: "org-usv", date: "2026-08-09", eventLabel: "US Varenne vs Melun (retour)", kind: "match", operatorName: "Julien Faure", status: "scheduled" },
  { id: "pr-usv-4", organizationId: "org-usv", date: "2026-08-16", eventLabel: "Tournage portraits joueurs", kind: "shooting", operatorName: "Nina Berger", status: "scheduled" },
  { id: "pr-usv-5", organizationId: "org-usv", date: "2026-07-19", eventLabel: "Fête du club", kind: "event", operatorName: "Julien Faure", status: "completed" },
  { id: "pr-usv-6", organizationId: "org-usv", date: "2026-08-23", eventLabel: "Entraînement équipe première", kind: "training", status: "scheduled" },

  { id: "pr-chris-1", organizationId: "org-chrisperformance", date: "2026-08-05", eventLabel: "Séance individuelle — captation", kind: "training", operatorName: "Nina Berger", status: "completed" },
  { id: "pr-chris-2", organizationId: "org-chrisperformance", date: "2026-08-12", eventLabel: "Séance groupe — captation", kind: "training", status: "scheduled" },

  { id: "pr-ea-1", organizationId: "org-eliteacademy", date: "2026-08-07", eventLabel: "Stage d'été — dernier jour", kind: "event", operatorName: "Julien Faure", status: "completed" },
  { id: "pr-ea-2", organizationId: "org-eliteacademy", date: "2026-08-21", eventLabel: "Rentrée académie — captation", kind: "event", status: "scheduled" },

  { id: "pr-ec-1", organizationId: "org-elitecup", date: "2026-08-26", eventLabel: "Elite Cup 2026 — Jour J", kind: "event", operatorName: "Nina Berger", status: "scheduled" },
];

export function getPresencesByOrg(organizationId: string): Presence[] {
  return mockPresences
    .filter((p) => p.organizationId === organizationId)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

// ---------------------------------------------------------------------------------------------
// Statistiques — /analytics
// ---------------------------------------------------------------------------------------------

const ANALYTICS_SUMMARIES: Record<string, AnalyticsSummary> = {
  "org-usv": { organizationId: "org-usv", reach: 22600, reachDeltaPct: 14, views: 41600, viewsDeltaPct: 23, engagement: 2810, engagementDeltaPct: 9, followers: 3420, followersDeltaPct: 4 },
  "org-chrisperformance": { organizationId: "org-chrisperformance", reach: 11400, reachDeltaPct: 31, views: 26700, viewsDeltaPct: 52, engagement: 1240, engagementDeltaPct: 38, followers: 1860, followersDeltaPct: 12 },
  "org-eliteacademy": { organizationId: "org-eliteacademy", reach: 31200, reachDeltaPct: 18, views: 48900, viewsDeltaPct: 25, engagement: 3610, engagementDeltaPct: 13, followers: 5240, followersDeltaPct: 6 },
  "org-elitecup": { organizationId: "org-elitecup", reach: 4800, reachDeltaPct: 62, views: 9100, viewsDeltaPct: 74, engagement: 520, engagementDeltaPct: 58, followers: 640, followersDeltaPct: 21 },
};

export function getAnalyticsSummary(organizationId: string): AnalyticsSummary | undefined {
  return ANALYTICS_SUMMARIES[organizationId];
}

// ---------------------------------------------------------------------------------------------
// Rapports mensuels
// ---------------------------------------------------------------------------------------------

export const mockReports: Report[] = [
  {
    id: "rep-usv-2026-07",
    organizationId: "org-usv",
    period: "2026-07",
    status: "available",
    summary:
      "En juillet, l'accent a été mis sur la préparation de la nouvelle saison : reprise des entraînements, présentation de l'effectif et lancement de la campagne d'abonnement.",
    objectives: ["Développer la notoriété avant la reprise", "Engager les familles autour des abonnements"],
    contentsProduced: [
      { label: "Posts", count: 9 },
      { label: "Stories", count: 14 },
      { label: "Reels", count: 5 },
    ],
    performance: { reach: 18400, reachDeltaPct: 12, engagement: 2150, engagementDeltaPct: 8, views: 31200, viewsDeltaPct: 21, followersGained: 96 },
    bestPublicationTitle: "Annonce du nouveau maillot 2026/2027",
    bestPublicationStats: "6 800 vues · 540 interactions",
    servicesCompleted: 2,
    recommendations: [
      "Publier plus tôt dans la semaine pour capter le pic d'audience du jeudi",
      "Accentuer les formats vidéo courts, en nette progression",
    ],
    nextMonthPlan: ["Couverture des matchs de reprise", "Lancement de la série « Portraits de saison »", "Mise en avant des sponsors du club"],
  },
  {
    id: "rep-usv-2026-06",
    organizationId: "org-usv",
    period: "2026-06",
    status: "read",
    summary: "Fin de saison : bilan de l'année et premiers contenus de recrutement pour la saison prochaine.",
    objectives: ["Clôturer la saison en beauté", "Amorcer le recrutement de licenciés"],
    contentsProduced: [
      { label: "Posts", count: 7 },
      { label: "Stories", count: 10 },
      { label: "Reels", count: 3 },
    ],
    performance: { reach: 15100, reachDeltaPct: 4, engagement: 1780, engagementDeltaPct: -3, views: 24000, viewsDeltaPct: 6, followersGained: 58 },
    bestPublicationTitle: "Bilan de la saison 2025/2026",
    bestPublicationStats: "5 200 vues · 410 interactions",
    servicesCompleted: 1,
    recommendations: ["Prévoir une relance recrutement dès la mi-juillet"],
    nextMonthPlan: ["Reprise des entraînements", "Présentation de l'effectif"],
  },
  {
    id: "rep-chris-2026-07",
    organizationId: "org-chrisperformance",
    period: "2026-07",
    status: "available",
    summary: "Premier mois complet d'accompagnement : mise en place de l'identité de contenu et régularité de publication trouvée.",
    objectives: ["Poser une ligne éditoriale claire", "Publier 3 fois par semaine minimum"],
    contentsProduced: [
      { label: "Posts", count: 6 },
      { label: "Reels", count: 8 },
      { label: "Stories", count: 10 },
    ],
    performance: { reach: 9200, reachDeltaPct: 34, engagement: 980, engagementDeltaPct: 41, views: 22300, viewsDeltaPct: 58, followersGained: 210 },
    bestPublicationTitle: "Séance explosivité — avant/après",
    bestPublicationStats: "12 400 vues · 890 interactions",
    servicesCompleted: 1,
    recommendations: ["Les vidéos pédagogiques courtes surperforment largement : à prioriser deux fois par semaine"],
    nextMonthPlan: ["Série « Programme de la semaine »", "Portrait de deux athlètes suivis"],
  },
  {
    id: "rep-ea-2026-07",
    organizationId: "org-eliteacademy",
    period: "2026-07",
    status: "available",
    summary: "Mois marqué par le stage d'été : forte production de contenus terrain et belle dynamique sur les Reels.",
    objectives: ["Valoriser le stage d'été", "Préparer la communication de rentrée"],
    contentsProduced: [
      { label: "Posts", count: 11 },
      { label: "Reels", count: 9 },
      { label: "Stories", count: 22 },
    ],
    performance: { reach: 26700, reachDeltaPct: 19, engagement: 3020, engagementDeltaPct: 15, views: 41800, viewsDeltaPct: 27, followersGained: 143 },
    bestPublicationTitle: "Aftermovie du stage d'été",
    bestPublicationStats: "15 100 vues · 1 240 interactions",
    servicesCompleted: 3,
    recommendations: ["Le format aftermovie a très bien fonctionné : à reproduire pour la communication de rentrée"],
    nextMonthPlan: ["Présentation des groupes 2026/2027", "Portes ouvertes académie"],
  },
  // Elite Cup 2026 n'a pas encore eu lieu (26 août) : aucun rapport disponible pour l'instant,
  // volontairement laissé vide pour illustrer l'état vide de l'écran /reports.
];

export function getReportsByOrg(organizationId: string): Report[] {
  return mockReports
    .filter((r) => r.organizationId === organizationId)
    .sort((a, b) => (a.period < b.period ? 1 : -1));
}

// ---------------------------------------------------------------------------------------------
// Fil avec le Community Manager
// ---------------------------------------------------------------------------------------------

export const mockThreads: Thread[] = [
  {
    id: "thread-usv-cm",
    organizationId: "org-usv",
    subject: "Communication US Varenne",
    contextType: "communication",
    sportvisionRoleLabel: "Community Manager",
    participantNames: ["Sophie Martin", "Nina Berger"],
    lastMessageAt: "2026-08-08T11:20:00.000Z",
    unreadCount: 1,
  },
  {
    id: "thread-chris-cm",
    organizationId: "org-chrisperformance",
    subject: "Communication Chris Performance",
    contextType: "communication",
    sportvisionRoleLabel: "Community Manager",
    participantNames: ["Sophie Martin", "Nina Berger"],
    lastMessageAt: "2026-08-07T09:10:00.000Z",
    unreadCount: 0,
  },
  {
    id: "thread-ea-cm",
    organizationId: "org-eliteacademy",
    subject: "Communication Elite Academy",
    contextType: "communication",
    sportvisionRoleLabel: "Community Manager",
    participantNames: ["Sophie Martin", "Nina Berger"],
    lastMessageAt: "2026-08-06T15:45:00.000Z",
    unreadCount: 2,
  },
  {
    id: "thread-ec-cm",
    organizationId: "org-elitecup",
    subject: "Communication Elite Cup 2026",
    contextType: "communication",
    sportvisionRoleLabel: "Community Manager",
    participantNames: ["Sophie Martin", "Nina Berger"],
    lastMessageAt: "2026-08-08T08:05:00.000Z",
    unreadCount: 0,
  },
];

export const mockMessages: Message[] = [
  { id: "msg-usv-1", threadId: "thread-usv-cm", authorName: "Nina Berger", body: "Bonjour Sophie, l'affiche du match de samedi est prête à être validée !", visibility: "client_visible", createdAt: "2026-08-07T14:00:00.000Z" },
  { id: "msg-usv-2", threadId: "thread-usv-cm", authorName: "Sophie Martin", body: "Merci, je regarde ça aujourd'hui.", visibility: "client_visible", createdAt: "2026-08-07T16:32:00.000Z" },
  // Note interne — ne doit jamais être affichée côté client (DATA_MODEL.md § Thread et Message).
  { id: "msg-usv-3", threadId: "thread-usv-cm", authorName: "Théo Marchand", body: "[NOTE INTERNE] Sophie a un délai de paiement en cours, éviter de relancer sur les extras cette semaine.", visibility: "internal_only", createdAt: "2026-08-08T09:00:00.000Z" },
  { id: "msg-usv-4", threadId: "thread-usv-cm", authorName: "Nina Berger", body: "Parfait, n'hésitez pas si vous avez des retours avant demain midi.", visibility: "client_visible", createdAt: "2026-08-08T11:20:00.000Z" },

  { id: "msg-chris-1", threadId: "thread-chris-cm", authorName: "Nina Berger", body: "Le reel de la séance explosivité est en ligne demain matin.", visibility: "client_visible", createdAt: "2026-08-07T09:10:00.000Z" },

  { id: "msg-ea-1", threadId: "thread-ea-cm", authorName: "Nina Berger", body: "L'aftermovie du stage est prêt, je vous l'envoie pour validation.", visibility: "client_visible", createdAt: "2026-08-06T15:45:00.000Z" },

  { id: "msg-ec-1", threadId: "thread-ec-cm", authorName: "Nina Berger", body: "Le teasing de l'Elite Cup part en validation aujourd'hui.", visibility: "client_visible", createdAt: "2026-08-08T08:05:00.000Z" },
];

export function getThreadForOrg(organizationId: string): Thread | undefined {
  return mockThreads.find((t) => t.organizationId === organizationId);
}

/** Ne renvoie jamais les messages `internal_only` — voir DATA_MODEL.md § Thread et Message. */
export function getClientVisibleMessages(threadId: string): Message[] {
  return mockMessages
    .filter((m) => m.threadId === threadId && m.visibility === "client_visible")
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

// ---------------------------------------------------------------------------------------------
// Fiche Community Manager — même personne (Nina Berger) sur les quatre espaces de démonstration,
// avec des indicateurs propres à chaque relation client.
// ---------------------------------------------------------------------------------------------

const CM_PROFILES_BY_ORG: Record<string, CommunityManagerProfile> = {
  "org-usv": {
    id: "sv-nina-berger",
    name: "Nina Berger",
    role: "Community Manager SportVision",
    avatarInitials: "NB",
    availability: "available",
    contentsProducedThisMonth: 9,
    responseTime: "moins de 2 h",
    nextMeetingAt: "2026-08-12T10:00:00.000Z",
    workingTogether: [
      "Transmettez vos informations dès que possible : résultats, événements, actualités du club.",
      "Nina vous propose un contenu à valider sous 24 à 48 h selon l'urgence choisie.",
      "Un point d'avancement mensuel fait le bilan et prépare le mois suivant.",
    ],
  },
  "org-chrisperformance": {
    id: "sv-nina-berger",
    name: "Nina Berger",
    role: "Community Manager SportVision",
    avatarInitials: "NB",
    availability: "filming",
    contentsProducedThisMonth: 6,
    responseTime: "moins de 4 h",
    nextMeetingAt: "2026-08-14T14:00:00.000Z",
    workingTogether: [
      "Partagez vos séances et objectifs de la semaine pour nourrir le planning éditorial.",
      "Nina prépare des formats courts et pédagogiques adaptés à votre image professionnelle.",
      "Un point d'avancement mensuel ajuste la ligne éditoriale selon vos retours.",
    ],
  },
  "org-eliteacademy": {
    id: "sv-nina-berger",
    name: "Nina Berger",
    role: "Community Manager SportVision",
    avatarInitials: "NB",
    availability: "available",
    contentsProducedThisMonth: 15,
    responseTime: "moins de 2 h",
    nextMeetingAt: "2026-08-13T09:30:00.000Z",
    workingTogether: [
      "Transmettez le calendrier des groupes, stages et événements dès leur confirmation.",
      "Nina couvre les temps forts terrain et prépare les contenus de rentrée.",
      "Un point mensuel fait le bilan des groupes et des campagnes en cours.",
    ],
  },
  "org-elitecup": {
    id: "sv-nina-berger",
    name: "Nina Berger",
    role: "Community Manager SportVision",
    avatarInitials: "NB",
    availability: "available",
    contentsProducedThisMonth: 4,
    responseTime: "moins de 1 h",
    nextMeetingAt: "2026-08-11T16:00:00.000Z",
    workingTogether: [
      "À l'approche de l'événement, les échanges s'intensifient : Nina reste joignable en priorité.",
      "Le jour J, la couverture est assurée en direct (stories, résultats, temps forts).",
      "Un rapport dédié est produit après l'événement.",
    ],
  },
};

export function getCommunityManagerProfile(organizationId: string): CommunityManagerProfile | undefined {
  return CM_PROFILES_BY_ORG[organizationId];
}
