import type {
  Affiliation,
  FollowedClub,
  ImageRight,
  Player,
  Team,
  TeamCalendarEntry,
  TeamContentPreview,
  TeamDocument,
  TeamRequestPreview,
} from "../types/teams";

// Données fictives mais réalistes — voir README.md § Fidélité. Rattachées à FC Fontainebleau
// (org-fcf) et US Varenne (org-usv), déjà présentes dans mock-data.ts. Lucas Mendes (org-lucas)
// apparaît aussi comme joueur de l'effectif FC Fontainebleau, avec son propre espace lié via
// `playerOrganizationId` — voir DATA_MODEL.md § Organization › Joueur affilié vs indépendant.

const scopes = (overrides: Partial<ImageRight["scopes"]> = {}) => ({
  teamAndMatchPhotos: true,
  videosAndHighlights: true,
  individualPortraits: true,
  commercialUse: true,
  offClubDistribution: true,
  ...overrides,
});

const noScopes = () => ({
  teamAndMatchPhotos: false,
  videosAndHighlights: false,
  individualPortraits: false,
  commercialUse: false,
  offClubDistribution: false,
});

export const mockTeams: Team[] = [
  {
    id: "team-fcf-seniors",
    organizationId: "org-fcf",
    name: "Seniors A",
    category: "Seniors",
    season: "2026/2027",
    headCoachName: "Karim Haddad",
    assistantCoachNames: ["Sébastien Voisin"],
    playerCount: 22,
    trainingSlots: "Mardi et jeudi 19h00",
    venue: "Stade Pierre-Bardin, terrain principal",
  },
  {
    id: "team-fcf-u17",
    organizationId: "org-fcf",
    name: "U17",
    category: "U17",
    season: "2026/2027",
    headCoachName: "Sofiane Kaci",
    playerCount: 18,
    trainingSlots: "Lundi et mercredi 18h30",
    venue: "Stade Pierre-Bardin, terrain annexe",
  },
  {
    id: "team-fcf-u15",
    organizationId: "org-fcf",
    name: "U15",
    category: "U15",
    season: "2026/2027",
    headCoachName: "Élodie Fontaine",
    playerCount: 16,
    trainingSlots: "Mardi et vendredi 18h00",
    venue: "Stade Pierre-Bardin, terrain annexe",
  },
  {
    id: "team-usv-seniors",
    organizationId: "org-usv",
    name: "Seniors A",
    category: "Seniors",
    season: "2026/2027",
    headCoachName: "Julien Faure",
    playerCount: 21,
    trainingSlots: "Mardi et jeudi 19h30",
    venue: "Complexe sportif, terrain d'honneur",
  },
  {
    id: "team-usv-u19",
    organizationId: "org-usv",
    name: "U19",
    category: "U19",
    season: "2026/2027",
    headCoachName: "Camille Ferreira",
    playerCount: 17,
    trainingSlots: "Lundi et mercredi 18h30",
    venue: "Complexe sportif, terrain synthétique",
  },
];

export const mockPlayers: Player[] = [
  {
    id: "player-fcf-mendes",
    organizationId: "org-fcf",
    teamId: "team-fcf-seniors",
    playerOrganizationId: "org-lucas",
    firstName: "Lucas",
    lastName: "Mendes",
    shirtNumber: 9,
    position: "Attaquant",
    licenseStatus: "valid",
    medicalCertificateAt: "2026-07-02",
    contentCount: 14,
  },
  {
    id: "player-fcf-diallo",
    organizationId: "org-fcf",
    teamId: "team-fcf-seniors",
    firstName: "Moussa",
    lastName: "Diallo",
    shirtNumber: 4,
    position: "Défenseur",
    licenseStatus: "valid",
    medicalCertificateAt: "2026-06-20",
    contentCount: 6,
  },
  {
    id: "player-fcf-petit",
    organizationId: "org-fcf",
    teamId: "team-fcf-seniors",
    firstName: "Nathan",
    lastName: "Petit",
    shirtNumber: 1,
    position: "Gardien",
    licenseStatus: "valid",
    medicalCertificateAt: "2026-05-14",
    contentCount: 3,
  },
  {
    id: "player-fcf-benali",
    organizationId: "org-fcf",
    teamId: "team-fcf-seniors",
    firstName: "Yanis",
    lastName: "Benali",
    shirtNumber: 7,
    position: "Milieu",
    licenseStatus: "pending",
    contentCount: 2,
  },
  {
    id: "player-fcf-roche",
    organizationId: "org-fcf",
    teamId: "team-fcf-seniors",
    firstName: "Enzo",
    lastName: "Roche",
    shirtNumber: 10,
    position: "Milieu offensif",
    licenseStatus: "valid",
    medicalCertificateAt: "2026-04-30",
    contentCount: 9,
  },
  {
    id: "player-fcf-simon",
    organizationId: "org-fcf",
    teamId: "team-fcf-seniors",
    firstName: "Théo",
    lastName: "Simon",
    shirtNumber: 5,
    position: "Défenseur central",
    licenseStatus: "valid",
    medicalCertificateAt: "2026-05-02",
    contentCount: 1,
  },
  {
    id: "player-fcf-u17-martin",
    organizationId: "org-fcf",
    teamId: "team-fcf-u17",
    firstName: "Léo",
    lastName: "Martin",
    shirtNumber: 11,
    position: "Ailier",
    licenseStatus: "valid",
    medicalCertificateAt: "2026-06-11",
    contentCount: 4,
  },
  {
    id: "player-fcf-u17-faye",
    organizationId: "org-fcf",
    teamId: "team-fcf-u17",
    firstName: "Ibrahima",
    lastName: "Faye",
    shirtNumber: 6,
    position: "Milieu",
    licenseStatus: "valid",
    medicalCertificateAt: "2026-06-11",
    contentCount: 0,
  },
  {
    id: "player-fcf-u15-perrin",
    organizationId: "org-fcf",
    teamId: "team-fcf-u15",
    firstName: "Nolan",
    lastName: "Perrin",
    shirtNumber: 8,
    position: "Milieu",
    licenseStatus: "valid",
    medicalCertificateAt: "2026-06-25",
    contentCount: 2,
  },
  {
    id: "player-usv-lemoine",
    organizationId: "org-usv",
    teamId: "team-usv-seniors",
    firstName: "Hugo",
    lastName: "Lemoine",
    shirtNumber: 9,
    position: "Attaquant",
    licenseStatus: "valid",
    medicalCertificateAt: "2026-06-18",
    contentCount: 11,
  },
  {
    id: "player-usv-costa",
    organizationId: "org-usv",
    teamId: "team-usv-seniors",
    firstName: "Rafael",
    lastName: "Costa",
    shirtNumber: 3,
    position: "Défenseur",
    licenseStatus: "valid",
    medicalCertificateAt: "2026-06-18",
    contentCount: 5,
  },
  {
    id: "player-usv-girard",
    organizationId: "org-usv",
    teamId: "team-usv-seniors",
    firstName: "Maxime",
    lastName: "Girard",
    shirtNumber: 1,
    position: "Gardien",
    licenseStatus: "expired",
    contentCount: 2,
  },
  {
    id: "player-usv-u19-noel",
    organizationId: "org-usv",
    teamId: "team-usv-u19",
    firstName: "Baptiste",
    lastName: "Noël",
    shirtNumber: 10,
    position: "Milieu offensif",
    licenseStatus: "valid",
    medicalCertificateAt: "2026-06-30",
    contentCount: 3,
  },
];

export const mockImageRights: ImageRight[] = [
  {
    playerId: "player-fcf-mendes",
    status: "signed",
    signedByName: "Lucas Mendes",
    signedAt: "2026-08-01",
    documentId: "doc-image-right-mendes",
    scopes: scopes({ offClubDistribution: false }),
    validUntil: "2027-08-01",
  },
  {
    playerId: "player-fcf-diallo",
    status: "signed",
    signedByName: "Amadou Diallo (représentant légal)",
    signedAt: "2026-07-15",
    documentId: "doc-image-right-diallo",
    scopes: scopes(),
    validUntil: "2027-07-15",
  },
  {
    playerId: "player-fcf-petit",
    status: "pending",
    scopes: noScopes(),
  },
  {
    playerId: "player-fcf-benali",
    status: "pending",
    scopes: noScopes(),
  },
  {
    playerId: "player-fcf-roche",
    status: "refused",
    scopes: noScopes(),
  },
  {
    playerId: "player-fcf-simon",
    status: "withdrawn",
    signedByName: "Corinne Simon (représentante légale)",
    signedAt: "2025-09-02",
    scopes: noScopes(),
  },
  {
    playerId: "player-fcf-u17-martin",
    status: "signed",
    signedByName: "Julie Martin (représentante légale)",
    signedAt: "2026-06-20",
    documentId: "doc-image-right-martin",
    scopes: scopes(),
    validUntil: "2027-06-20",
  },
  {
    playerId: "player-fcf-u17-faye",
    status: "pending",
    scopes: noScopes(),
  },
  {
    playerId: "player-fcf-u15-perrin",
    status: "signed",
    signedByName: "Marc Perrin (représentant légal)",
    signedAt: "2026-06-01",
    documentId: "doc-image-right-perrin",
    scopes: scopes({ commercialUse: false, offClubDistribution: false }),
    validUntil: "2027-06-01",
  },
  {
    playerId: "player-usv-lemoine",
    status: "signed",
    signedByName: "Hugo Lemoine",
    signedAt: "2026-01-10",
    documentId: "doc-image-right-lemoine",
    scopes: scopes(),
    validUntil: "2027-01-10",
  },
  {
    playerId: "player-usv-costa",
    status: "signed",
    signedByName: "Rafael Costa",
    signedAt: "2026-01-10",
    documentId: "doc-image-right-costa",
    scopes: scopes(),
    validUntil: "2027-01-10",
  },
  {
    playerId: "player-usv-girard",
    status: "pending",
    scopes: noScopes(),
  },
  {
    playerId: "player-usv-u19-noel",
    status: "signed",
    signedByName: "Sandrine Noël (représentante légale)",
    signedAt: "2026-02-04",
    documentId: "doc-image-right-noel",
    scopes: scopes(),
    validUntil: "2027-02-04",
  },
];

export const mockAffiliations: Affiliation[] = [
  {
    playerId: "player-fcf-mendes",
    organizationId: "org-fcf",
    teamId: "team-fcf-seniors",
    season: "2026/2027",
    startsAt: "2025-08-14",
    status: "active",
  },
];

export const mockTeamCalendar: TeamCalendarEntry[] = [
  { id: "tcal-1", teamId: "team-fcf-seniors", label: "FC Fontainebleau vs US Varenne", kind: "match", date: "2026-08-16T15:00:00.000Z", location: "Stade Pierre-Bardin", opponent: "US Varenne" },
  { id: "tcal-2", teamId: "team-fcf-seniors", label: "Séance d'entraînement filmée", kind: "shooting", date: "2026-08-11T19:00:00.000Z", location: "Stade Pierre-Bardin" },
  { id: "tcal-3", teamId: "team-fcf-seniors", label: "Entraînement", kind: "training", date: "2026-08-13T19:00:00.000Z", location: "Stade Pierre-Bardin" },
  { id: "tcal-4", teamId: "team-fcf-u17", label: "U17 vs Elite Academy", kind: "match", date: "2026-08-17T11:00:00.000Z", location: "Stade Pierre-Bardin", opponent: "Elite Academy" },
  { id: "tcal-5", teamId: "team-usv-seniors", label: "US Varenne vs FC Fontainebleau", kind: "match", date: "2026-08-16T15:00:00.000Z", location: "Complexe sportif", opponent: "FC Fontainebleau" },
];

export const mockTeamContent: TeamContentPreview[] = [
  { id: "tc-1", teamId: "team-fcf-seniors", label: "Affiche Matchday — vs US Varenne", kind: "photo", createdAt: "2026-08-05" },
  { id: "tc-2", teamId: "team-fcf-seniors", label: "Highlight — victoire amicale", kind: "video", createdAt: "2026-07-28" },
  { id: "tc-3", teamId: "team-fcf-seniors", label: "Portraits de rentrée", kind: "photo", createdAt: "2026-07-20" },
  { id: "tc-4", teamId: "team-usv-seniors", label: "Reportage reprise", kind: "video", createdAt: "2026-08-02" },
];

export const mockTeamRequests: TeamRequestPreview[] = [
  { id: "tr-1", teamId: "team-fcf-seniors", label: "Affiche Matchday — J1", status: "a_valider", requestedAt: "2026-08-06" },
  { id: "tr-2", teamId: "team-fcf-seniors", label: "Portrait Enzo Roche", status: "en_creation", requestedAt: "2026-08-04" },
  { id: "tr-3", teamId: "team-usv-seniors", label: "Composition d'équipe", status: "envoyee", requestedAt: "2026-08-07" },
];

export const mockTeamDocuments: TeamDocument[] = [
  { id: "td-1", teamId: "team-fcf-seniors", name: "Effectif Seniors A — 2026/2027", kind: "roster", status: "a_jour", updatedAt: "2026-08-01" },
  { id: "td-2", teamId: "team-fcf-seniors", name: "Attestation d'assurance", kind: "insurance", status: "a_jour", updatedAt: "2026-06-15" },
  { id: "td-3", teamId: "team-fcf-seniors", name: "Autorisations droit à l'image — synthèse", kind: "image_right", status: "a_completer", updatedAt: "2026-08-06" },
  { id: "td-4", teamId: "team-usv-seniors", name: "Effectif Seniors A — 2026/2027", kind: "roster", status: "a_jour", updatedAt: "2026-07-20" },
];

/** ACTIONS.md § 16 — pour un CM externe, /teams devient « Clubs suivis ». */
export const mockFollowedClubs: Record<string, FollowedClub[]> = {
  "org-nina-berger": [
    { organizationId: "org-fcf", clubName: "FC Fontainebleau", publicationsCount: 18, toValidateCount: 3, progressPct: 72, accessStatus: "active" },
    { organizationId: "org-usv", clubName: "US Varenne", publicationsCount: 26, toValidateCount: 1, progressPct: 91, accessStatus: "active" },
    { organizationId: "org-elite-academy", clubName: "Elite Academy", publicationsCount: 9, toValidateCount: 0, progressPct: 48, accessStatus: "restreint" },
  ],
};

export function teamsForOrganization(organizationId: string): Team[] {
  return mockTeams.filter((t) => t.organizationId === organizationId);
}

export function playersForTeam(teamId: string): Player[] {
  return mockPlayers.filter((p) => p.teamId === teamId);
}

export function imageRightForPlayer(playerId: string): ImageRight | undefined {
  return mockImageRights.find((r) => r.playerId === playerId);
}
