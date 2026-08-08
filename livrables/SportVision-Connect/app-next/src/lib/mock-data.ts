import type { Membership, Organization, Subscription, User } from "./types";

// Données fictives mais réalistes — voir README.md § Fidélité. À remplacer par de vraies
// requêtes (Supabase ou autre, décision à prendre séparément) module par module. Ce fichier
// fait tourner l'architecture commune (sélecteur d'organisation, navigation, permissions) en
// attendant la couche de données réelle.

export const mockUser: User = {
  id: "user-sophie",
  firstName: "Sophie",
  lastName: "Martin",
  email: "sophie.martin@fcfontainebleau.fr",
  jobTitle: "Responsable communication",
  locale: "fr",
  theme: "dark",
  mfaEnabled: false,
  onboardingStep: 10,
  onboardingCompletedAt: "2026-06-12T09:00:00.000Z",
};

export const mockOrganizations: Organization[] = [
  {
    id: "org-fcf",
    type: "club",
    name: "FC Fontainebleau",
    address: "Stade Pierre-Bardin, 77300 Fontainebleau",
    siret: "812 456 789 00021",
    instagramHandle: "@fcfontainebleau",
    teamCount: 6,
    memberCount: 142,
    accountManagerId: "sv-theo-marchand",
    createdAt: "2025-08-01T00:00:00.000Z",
  },
  {
    id: "org-usv",
    type: "club",
    name: "US Varenne",
    address: "Complexe sportif, 77130 Varenne",
    teamCount: 4,
    memberCount: 96,
    accountManagerId: "sv-theo-marchand",
    communityManagerId: "sv-nina-berger",
    createdAt: "2025-11-03T00:00:00.000Z",
  },
  {
    id: "org-lucas",
    type: "player",
    name: "Lucas Mendes",
    parentOrganizationId: "org-fcf",
    accountManagerId: "sv-theo-marchand",
    createdAt: "2025-08-14T00:00:00.000Z",
  },
];

export const mockMemberships: Membership[] = [
  { id: "m1", userId: "user-sophie", organizationId: "org-fcf", role: "communication_manager", teamScope: [], capabilities: [], status: "active" },
  { id: "m2", userId: "user-sophie", organizationId: "org-usv", role: "communication_manager", teamScope: [], capabilities: [], status: "active" },
  { id: "m3", userId: "user-sophie", organizationId: "org-lucas", role: "player", teamScope: [], capabilities: [], status: "active" },
];

export const mockSubscriptions: Record<string, Subscription> = {
  "org-fcf": {
    id: "sub-fcf",
    organizationId: "org-fcf",
    planCode: "club_plus_performance",
    status: "active",
    startsAt: "2025-09-01",
    renewsAt: "2026-09-01",
    commitmentMonths: 12,
    noticeMonths: 2,
    creditsRemaining: 26,
    creditsReserved: 3,
    presencesUsed: 3,
    storageUsedBytes: 6_400_000_000,
    storageQuotaBytes: 10_000_000_000,
  },
  "org-usv": {
    id: "sub-usv",
    organizationId: "org-usv",
    planCode: "full_communication",
    status: "active",
    startsAt: "2025-11-03",
    renewsAt: "2026-11-03",
    commitmentMonths: 12,
    noticeMonths: 2,
    creditsRemaining: 0,
    creditsReserved: 0,
    presencesUsed: 3,
    storageUsedBytes: 9_800_000_000,
    storageQuotaBytes: 20_000_000_000,
  },
  "org-lucas": {
    id: "sub-lucas",
    organizationId: "org-lucas",
    planCode: "club_access",
    status: "active",
    startsAt: "2025-08-14",
    renewsAt: "2026-08-14",
    commitmentMonths: 0,
    noticeMonths: 0,
    creditsRemaining: 1,
    creditsReserved: 0,
    presencesUsed: 0,
    storageUsedBytes: 400_000_000,
    storageQuotaBytes: 2_000_000_000,
  },
};
