// Données fictives mais réalistes pour Paramètres, Support, Notifications, Documents et
// Utilisateurs — voir README.md § Fidélité. Basées sur les organisations de src/lib/mock-data.ts
// (FC Fontainebleau, US Varenne, Lucas Mendes). À remplacer par de vraies requêtes plus tard.

import type {
  AppDocument,
  AppNotification,
  Integration,
  NotificationPreferences,
  OrgUser,
  SupportTicket,
  SupportTopic,
} from "@/lib/types/settings";

export const mockIntegrations: Record<string, Integration[]> = {
  "org-fcf": [
    {
      id: "int-fcf-gcal",
      organizationId: "org-fcf",
      provider: "google_calendar",
      name: "Google Calendar",
      description: "Ajoutez vos prestations et rendez-vous SportVision à votre agenda personnel.",
      status: "connected",
      accountLabel: "sophie.martin@fcfontainebleau.fr",
      scopes: [
        { label: "Lire les calendriers", granted: true },
        { label: "Créer et modifier des événements", granted: true },
        { label: "Lire le profil", granted: true },
        { label: "Supprimer des événements", granted: false },
      ],
      lastSyncedAt: "2026-08-08T07:12:00.000Z",
      calendarMapping: [{ source: "Prestations SportVision", target: "Agenda FC Fontainebleau" }],
      syncLog: [
        { id: "log-1", label: "Synchronisation réussie — 4 événements", occurredAt: "2026-08-08T07:12:00.000Z", success: true },
        { id: "log-2", label: "Synchronisation réussie — 1 événement ajouté", occurredAt: "2026-08-07T07:05:00.000Z", success: true },
      ],
    },
    {
      id: "int-fcf-instagram",
      organizationId: "org-fcf",
      provider: "instagram",
      name: "Instagram",
      description: "Compte utilisé pour prévisualiser vos publications programmées.",
      status: "connected",
      accountLabel: "@fcfontainebleau",
      scopes: [{ label: "Lire les publications", granted: true }],
      lastSyncedAt: "2026-08-08T06:40:00.000Z",
      syncLog: [{ id: "log-3", label: "Compte vérifié", occurredAt: "2026-08-01T09:00:00.000Z", success: true }],
    },
    {
      id: "int-fcf-tiktok",
      organizationId: "org-fcf",
      provider: "tiktok",
      name: "TikTok",
      description: "Diffusion des formats courts vers votre compte du club.",
      status: "disconnected",
      scopes: [{ label: "Publier des vidéos", granted: false }],
      syncLog: [],
    },
    {
      id: "int-fcf-meta",
      organizationId: "org-fcf",
      provider: "meta_business",
      name: "Meta Business",
      description: "Centralise Facebook et Instagram pour la programmation des publications.",
      status: "error",
      accountLabel: "FC Fontainebleau — Page officielle",
      scopes: [{ label: "Gérer les pages", granted: true }],
      lastSyncedAt: "2026-08-05T11:20:00.000Z",
      syncLog: [
        { id: "log-4", label: "Échec de synchronisation — jeton à renouveler", occurredAt: "2026-08-05T11:20:00.000Z", success: false },
      ],
    },
    {
      id: "int-fcf-whatsapp",
      organizationId: "org-fcf",
      provider: "whatsapp",
      name: "WhatsApp",
      description: "Recevez vos notifications critiques par WhatsApp.",
      status: "disconnected",
      scopes: [{ label: "Envoyer des messages", granted: false }],
      syncLog: [],
    },
    {
      id: "int-fcf-stripe",
      organizationId: "org-fcf",
      provider: "stripe",
      name: "Stripe",
      description: "Paiements, abonnement, factures et moyen de paiement.",
      status: "connected",
      accountLabel: "•••• 4242",
      scopes: [{ label: "Gérer les paiements", granted: true }],
      lastSyncedAt: "2026-08-08T00:00:00.000Z",
      syncLog: [{ id: "log-5", label: "Prélèvement mensuel effectué", occurredAt: "2026-08-01T08:00:00.000Z", success: true }],
    },
  ],
  "org-usv": [
    {
      id: "int-usv-gcal",
      organizationId: "org-usv",
      provider: "google_calendar",
      name: "Google Calendar",
      description: "Ajoutez vos prestations et rendez-vous SportVision à votre agenda personnel.",
      status: "disconnected",
      scopes: [
        { label: "Lire les calendriers", granted: false },
        { label: "Créer et modifier des événements", granted: false },
        { label: "Lire le profil", granted: false },
        { label: "Supprimer des événements", granted: false },
      ],
      syncLog: [],
    },
    {
      id: "int-usv-instagram",
      organizationId: "org-usv",
      provider: "instagram",
      name: "Instagram",
      description: "Compte utilisé pour la publication automatisée de votre planning éditorial.",
      status: "connected",
      accountLabel: "@usvarenne",
      scopes: [{ label: "Publier des posts et stories", granted: true }],
      lastSyncedAt: "2026-08-08T08:00:00.000Z",
      syncLog: [{ id: "log-6", label: "3 publications programmées", occurredAt: "2026-08-08T08:00:00.000Z", success: true }],
    },
  ],
  "org-lucas": [],
};

export const mockOrgUsers: Record<string, OrgUser[]> = {
  "org-fcf": [
    { id: "user-sophie", membershipId: "m1", firstName: "Sophie", lastName: "Martin", email: "sophie.martin@fcfontainebleau.fr", jobTitle: "Responsable communication", role: "communication_manager", teamScope: [], status: "active", lastSeenAt: "2026-08-08T09:10:00.000Z" },
    { id: "user-marc", membershipId: "m4", firstName: "Marc", lastName: "Dubreuil", email: "marc.dubreuil@fcfontainebleau.fr", jobTitle: "Président", role: "president", teamScope: [], status: "active", lastSeenAt: "2026-08-07T18:30:00.000Z" },
    { id: "user-julie", membershipId: "m5", firstName: "Julie", lastName: "Renard", email: "julie.renard@fcfontainebleau.fr", jobTitle: "Coach U15", role: "coach", teamScope: ["team-u15"], status: "active", lastSeenAt: "2026-08-06T17:00:00.000Z" },
    { id: "user-invite1", membershipId: "m6", firstName: "Nadia", lastName: "Kaci", email: "nadia.kaci@fcfontainebleau.fr", jobTitle: "Trésorière", role: "treasurer", teamScope: [], status: "invited", invitedAt: "2026-08-05T10:00:00.000Z" },
  ],
  "org-usv": [
    { id: "user-sophie", membershipId: "m2", firstName: "Sophie", lastName: "Martin", email: "sophie.martin@fcfontainebleau.fr", jobTitle: "Responsable communication", role: "communication_manager", teamScope: [], status: "active", lastSeenAt: "2026-08-08T09:10:00.000Z" },
    { id: "user-paul", membershipId: "m7", firstName: "Paul", lastName: "Verrier", email: "paul.verrier@usvarenne.fr", jobTitle: "Secrétaire général", role: "secretary", teamScope: [], status: "active", lastSeenAt: "2026-08-08T08:00:00.000Z" },
  ],
  "org-lucas": [
    { id: "user-sophie", membershipId: "m3", firstName: "Sophie", lastName: "Martin", email: "sophie.martin@fcfontainebleau.fr", jobTitle: undefined, role: "player", teamScope: [], status: "active", lastSeenAt: "2026-08-08T09:10:00.000Z" },
  ],
};

export const mockSupportTopics: SupportTopic[] = [
  { id: "topic-visuals", title: "Demandes de visuels", description: "Créer, suivre et valider une demande depuis le Studio.", articleCount: 12 },
  { id: "topic-billing", title: "Facturation et paiement", description: "Comprendre vos factures, échéances et moyens de paiement.", articleCount: 8 },
  { id: "topic-services", title: "Prestations", description: "Planifier, suivre et réceptionner une prestation SportVision.", articleCount: 10 },
  { id: "topic-account", title: "Compte et utilisateurs", description: "Inviter un membre, gérer les rôles, sécuriser votre compte.", articleCount: 6 },
  { id: "topic-integrations", title: "Intégrations", description: "Connecter Google Calendar, Instagram, TikTok, Stripe.", articleCount: 5 },
  { id: "topic-content", title: "Contenus et droits à l'image", description: "Autorisations, téléchargement, partage sécurisé.", articleCount: 9 },
];

export const mockSupportTickets: Record<string, SupportTicket[]> = {
  "org-fcf": [
    {
      id: "tck-1",
      reference: "TCK-2026-0142",
      organizationId: "org-fcf",
      createdById: "user-sophie",
      subject: "Erreur sur l'affiche Matchday de samedi",
      category: "content",
      module: "Studio",
      priority: "high",
      description: "Le nom du sponsor principal est mal orthographié sur l'affiche générée hier soir.",
      status: "in_progress",
      assigneeName: "Théo Marchand",
      createdAt: "2026-08-07T14:20:00.000Z",
      updatedAt: "2026-08-08T08:05:00.000Z",
    },
    {
      id: "tck-2",
      reference: "TCK-2026-0128",
      organizationId: "org-fcf",
      createdById: "user-marc",
      subject: "Question sur le renouvellement du contrat",
      category: "contract",
      priority: "normal",
      description: "Nous aimerions échanger sur les conditions de renouvellement avant l'échéance de septembre.",
      status: "waiting_client",
      assigneeName: "Théo Marchand",
      createdAt: "2026-08-02T09:00:00.000Z",
      updatedAt: "2026-08-04T11:00:00.000Z",
    },
    {
      id: "tck-3",
      reference: "TCK-2026-0095",
      organizationId: "org-fcf",
      createdById: "user-sophie",
      subject: "Export de l'effectif U15 impossible",
      category: "technical",
      priority: "low",
      description: "Le bouton « Exporter l'effectif » ne déclenche aucun téléchargement.",
      status: "resolved",
      assigneeName: "Support technique",
      createdAt: "2026-07-20T10:00:00.000Z",
      updatedAt: "2026-07-21T16:00:00.000Z",
    },
  ],
  "org-usv": [],
  "org-lucas": [],
};

export const mockDocuments: Record<string, AppDocument[]> = {
  "org-fcf": [
    { id: "doc-1", organizationId: "org-fcf", name: "Contrat Club+ Performance 2025-2026", kind: "contract", mimeType: "application/pdf", sizeBytes: 482_000, uploadedByName: "SportVision", uploadedAt: "2025-09-01T10:00:00.000Z", status: "valid" },
    { id: "doc-2", organizationId: "org-fcf", name: "Facture SV-2026-0418", kind: "invoice", mimeType: "application/pdf", sizeBytes: 118_000, uploadedByName: "SportVision", uploadedAt: "2026-08-01T09:00:00.000Z", status: "to_review" },
    { id: "doc-3", organizationId: "org-fcf", name: "Autorisation droit à l'image — Lucas Mendes", kind: "image_right", mimeType: "application/pdf", sizeBytes: 96_000, uploadedByName: "Sophie Martin", uploadedAt: "2025-08-20T09:00:00.000Z", playerName: "Lucas Mendes", status: "valid" },
    { id: "doc-4", organizationId: "org-fcf", name: "Autorisation droit à l'image — Amine Kaci", kind: "image_right", mimeType: "application/pdf", sizeBytes: 0, uploadedByName: "—", uploadedAt: "2026-08-01T00:00:00.000Z", playerName: "Amine Kaci", status: "to_sign", completionRatio: 0 },
    { id: "doc-5", organizationId: "org-fcf", name: "Charte graphique FC Fontainebleau", kind: "brand_guidelines", mimeType: "application/pdf", sizeBytes: 3_400_000, uploadedByName: "SportVision", uploadedAt: "2025-09-05T09:00:00.000Z", status: "valid" },
    { id: "doc-6", organizationId: "org-fcf", name: "Pack logo — formats web et print", kind: "logo_pack", mimeType: "application/zip", sizeBytes: 8_200_000, uploadedByName: "SportVision", uploadedAt: "2025-09-05T09:00:00.000Z", status: "valid" },
    { id: "doc-7", organizationId: "org-fcf", name: "Attestation d'assurance saison 2025-2026", kind: "insurance", mimeType: "application/pdf", sizeBytes: 210_000, uploadedByName: "Marc Dubreuil", uploadedAt: "2025-08-15T09:00:00.000Z", status: "valid", expiresAt: "2026-08-31" },
    { id: "doc-8", organizationId: "org-fcf", name: "Effectif U15 — saison 2025-2026", kind: "roster", mimeType: "application/pdf", sizeBytes: 145_000, uploadedByName: "Julie Renard", uploadedAt: "2025-08-25T09:00:00.000Z", teamName: "U15", status: "valid" },
    { id: "doc-9", organizationId: "org-fcf", name: "Rapport mensuel — juillet 2026", kind: "report", mimeType: "application/pdf", sizeBytes: 1_900_000, uploadedByName: "SportVision", uploadedAt: "2026-08-02T09:00:00.000Z", status: "valid" },
    { id: "doc-10", organizationId: "org-fcf", name: "Devis prestation Coupe du Gâtinais", kind: "quote", mimeType: "application/pdf", sizeBytes: 88_000, uploadedByName: "SportVision", uploadedAt: "2026-08-06T09:00:00.000Z", status: "to_review" },
  ],
  "org-usv": [
    { id: "doc-11", organizationId: "org-usv", name: "Contrat Full Communication 2025-2026", kind: "contract", mimeType: "application/pdf", sizeBytes: 512_000, uploadedByName: "SportVision", uploadedAt: "2025-11-03T09:00:00.000Z", status: "valid" },
    { id: "doc-12", organizationId: "org-usv", name: "Rapport mensuel — juillet 2026", kind: "report", mimeType: "application/pdf", sizeBytes: 2_100_000, uploadedByName: "SportVision", uploadedAt: "2026-08-02T09:00:00.000Z", status: "valid" },
  ],
  "org-lucas": [
    { id: "doc-13", organizationId: "org-lucas", name: "Autorisation droit à l'image — Lucas Mendes", kind: "image_right", mimeType: "application/pdf", sizeBytes: 96_000, uploadedByName: "Sophie Martin", uploadedAt: "2025-08-20T09:00:00.000Z", status: "valid" },
  ],
};

export const mockNotifications: Record<string, AppNotification[]> = {
  "org-fcf": [
    { id: "notif-1", userId: "user-sophie", organizationId: "org-fcf", category: "content", title: "Votre affiche Matchday est prête à être validée", body: "Studio SportVision a livré la création demandée pour FC Fontainebleau vs US Varenne.", targetHref: "/content", isPinned: true, isCritical: false, createdAt: "2026-08-08T07:30:00.000Z" },
    { id: "notif-2", userId: "user-sophie", organizationId: "org-fcf", category: "payments", title: "Facture SV-2026-0418 en retard", body: "Votre facture d'août est échue depuis 3 jours.", targetHref: "/billing", isPinned: true, isCritical: true, createdAt: "2026-08-08T06:00:00.000Z" },
    { id: "notif-3", userId: "user-sophie", organizationId: "org-fcf", category: "contracts", title: "Avenant Club+ Performance à signer", body: "Votre avenant 2026-2027 attend votre signature Yousign.", targetHref: "/contracts", isPinned: false, isCritical: false, createdAt: "2026-08-07T16:00:00.000Z" },
    { id: "notif-4", userId: "user-sophie", organizationId: "org-fcf", category: "requests", title: "Correction demandée sur « Composition — U15 »", body: "Julie Renard a demandé une correction sur le visuel.", targetHref: "/requests", isPinned: false, isCritical: false, readAt: "2026-08-07T09:00:00.000Z", createdAt: "2026-08-06T18:20:00.000Z" },
    { id: "notif-5", userId: "user-sophie", organizationId: "org-fcf", category: "calendar", title: "Prestation confirmée — samedi 10h", body: "Votre prochaine présence SportVision est prévue samedi.", targetHref: "/calendar", isPinned: false, isCritical: false, readAt: "2026-08-05T09:00:00.000Z", createdAt: "2026-08-05T08:00:00.000Z" },
    { id: "notif-6", userId: "user-sophie", organizationId: "org-fcf", category: "users", title: "Nadia Kaci a rejoint FC Fontainebleau", body: "L'invitation envoyée le 5 août a été acceptée.", targetHref: "/users", isPinned: false, isCritical: false, readAt: "2026-08-05T09:00:00.000Z", createdAt: "2026-08-05T07:40:00.000Z" },
  ],
  "org-usv": [
    { id: "notif-7", userId: "user-sophie", organizationId: "org-usv", category: "content", title: "3 publications à valider", body: "Le planning éditorial de la semaine attend votre validation.", targetHref: "/validations", isPinned: true, isCritical: false, createdAt: "2026-08-08T08:00:00.000Z" },
  ],
  "org-lucas": [
    { id: "notif-8", userId: "user-sophie", organizationId: "org-lucas", category: "content", title: "12 nouvelles photos disponibles", body: "Match du 3 août — FC Fontainebleau vs AS Melun.", targetHref: "/content", isPinned: false, isCritical: false, createdAt: "2026-08-04T09:00:00.000Z" },
  ],
};

export const defaultNotificationPreferences: NotificationPreferences = {
  content: { email: true, inApp: true, frequency: "immediate" },
  services: { email: true, inApp: true, frequency: "immediate" },
  contracts: { email: true, inApp: true, frequency: "immediate" },
  payments: { email: true, inApp: true, frequency: "immediate" },
  requests: { email: false, inApp: true, frequency: "daily_digest" },
  users: { email: false, inApp: true, frequency: "weekly_digest" },
  calendar: { email: false, inApp: true, frequency: "daily_digest" },
  system: { email: false, inApp: false, frequency: "monthly" },
  quietHours: { notBefore: "08:00", notAfter: "21:00", sundayUrgentOnly: true },
};
