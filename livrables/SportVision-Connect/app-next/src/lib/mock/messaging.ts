// Données fictives de la messagerie contextuelle — voir README.md § Fidélité et
// DATA_MODEL.md § Thread et Message. Chaque fil est rattaché à un objet, jamais générique.

import type { Message, Thread } from "@/lib/types/messaging";

export const mockThreads: Record<string, Thread[]> = {
  "org-fcf": [
    {
      id: "thread-1",
      organizationId: "org-fcf",
      subject: "Affiche Matchday — FC Fontainebleau vs US Varenne",
      contextType: "visual_request",
      contextLabel: "Demande VIS-2026-0341",
      contextHref: "/requests",
      sportvisionRoleLabel: "Studio",
      participants: [
        { id: "user-sophie", name: "Sophie Martin", avatarInitials: "SM", isSportvision: false },
        { id: "sv-studio", name: "Studio SportVision", avatarInitials: "SV", isSportvision: true, isOnline: true },
      ],
      lastMessagePreview: "Le sponsor a été corrigé, la nouvelle version est en ligne.",
      lastMessageAt: "2026-08-08T08:10:00.000Z",
      unreadCount: 2,
      isArchived: false,
    },
    {
      id: "thread-2",
      organizationId: "org-fcf",
      subject: "Facture SV-2026-0418",
      contextType: "billing",
      contextLabel: "Facture d'août — 690,00 € TTC",
      contextHref: "/billing",
      sportvisionRoleLabel: "Secrétariat",
      participants: [
        { id: "user-sophie", name: "Sophie Martin", avatarInitials: "SM", isSportvision: false },
        { id: "sv-secretariat", name: "Secrétariat SportVision", avatarInitials: "SV", isSportvision: true },
      ],
      lastMessagePreview: "Votre facture est échue depuis 3 jours, n'hésitez pas si besoin d'un délai.",
      lastMessageAt: "2026-08-07T15:00:00.000Z",
      unreadCount: 0,
      isArchived: false,
    },
    {
      id: "thread-3",
      organizationId: "org-fcf",
      subject: "Prestation — Coupe du Gâtinais",
      contextType: "service",
      contextLabel: "Prestation PRE-2026-0088",
      contextHref: "/services",
      sportvisionRoleLabel: "Chargé de compte",
      participants: [
        { id: "user-sophie", name: "Sophie Martin", avatarInitials: "SM", isSportvision: false },
        { id: "sv-theo", name: "Théo Marchand", avatarInitials: "TM", isSportvision: true, isOnline: true },
      ],
      lastMessagePreview: "On confirme l'équipe : un opérateur photo + un drone.",
      lastMessageAt: "2026-08-06T11:30:00.000Z",
      unreadCount: 0,
      isArchived: false,
    },
    {
      id: "thread-4",
      organizationId: "org-fcf",
      subject: "Question sur le renouvellement du contrat",
      contextType: "support",
      contextLabel: "Ticket TCK-2026-0128",
      contextHref: "/support",
      sportvisionRoleLabel: "Chargé de compte",
      participants: [
        { id: "user-marc", name: "Marc Dubreuil", avatarInitials: "MD", isSportvision: false },
        { id: "sv-theo", name: "Théo Marchand", avatarInitials: "TM", isSportvision: true },
      ],
      lastMessagePreview: "Je reviens vers vous avant vendredi avec les conditions.",
      lastMessageAt: "2026-08-04T11:00:00.000Z",
      unreadCount: 0,
      isArchived: false,
    },
  ],
  "org-usv": [
    {
      id: "thread-5",
      organizationId: "org-usv",
      subject: "Planning éditorial — semaine du 10 août",
      contextType: "communication",
      contextLabel: "Planning éditorial",
      contextHref: "/communication",
      sportvisionRoleLabel: "Community Manager",
      participants: [
        { id: "user-sophie", name: "Sophie Martin", avatarInitials: "SM", isSportvision: false },
        { id: "sv-nina", name: "Nina Berger", avatarInitials: "NB", isSportvision: true, isOnline: true },
      ],
      lastMessagePreview: "Je vous propose 3 formats pour l'annonce du partenariat.",
      lastMessageAt: "2026-08-08T09:00:00.000Z",
      unreadCount: 1,
      isArchived: false,
    },
  ],
  "org-lucas": [
    {
      id: "thread-6",
      organizationId: "org-lucas",
      subject: "Mes contenus du match du 3 août",
      contextType: "visual_request",
      contextLabel: "Galerie — FC Fontainebleau vs AS Melun",
      contextHref: "/content",
      sportvisionRoleLabel: "Studio",
      participants: [
        { id: "user-sophie", name: "Sophie Martin", avatarInitials: "SM", isSportvision: false },
        { id: "sv-studio", name: "Studio SportVision", avatarInitials: "SV", isSportvision: true },
      ],
      lastMessagePreview: "12 photos sont disponibles dans votre galerie.",
      lastMessageAt: "2026-08-04T09:00:00.000Z",
      unreadCount: 0,
      isArchived: false,
    },
  ],
};

export const mockMessages: Record<string, Message[]> = {
  "thread-1": [
    { id: "msg-1", threadId: "thread-1", authorId: "user-sophie", authorName: "Sophie Martin", authorInitials: "SM", isSportvision: false, body: "Bonjour, le nom du sponsor principal est mal orthographié sur l'affiche (« Vareñne » au lieu de « Varenne »).", attachments: [], visibility: "client_visible", seenByNames: ["Studio SportVision"], createdAt: "2026-08-07T14:22:00.000Z" },
    { id: "msg-2", threadId: "thread-1", authorId: "sv-studio", authorName: "Studio SportVision", authorInitials: "SV", isSportvision: true, body: "Merci du signalement, on corrige ça tout de suite.", attachments: [], visibility: "client_visible", seenByNames: ["Sophie Martin"], createdAt: "2026-08-07T14:45:00.000Z" },
    { id: "msg-3", threadId: "thread-1", authorId: "sv-studio", authorName: "Studio SportVision", authorInitials: "SV", isSportvision: true, body: "Le sponsor a été corrigé, la nouvelle version est en ligne. Vous pouvez la valider depuis vos demandes.", attachments: [{ id: "att-1", name: "matchday-fcf-usv-v2.jpg", sizeBytes: 2_400_000, kind: "image" }], visibility: "client_visible", seenByNames: [], createdAt: "2026-08-08T08:10:00.000Z" },
  ],
  "thread-2": [
    { id: "msg-4", threadId: "thread-2", authorId: "sv-secretariat", authorName: "Secrétariat SportVision", authorInitials: "SV", isSportvision: true, body: "Bonjour, votre facture SV-2026-0418 est échue depuis 3 jours. Un souci de trésorerie ?", attachments: [], visibility: "client_visible", seenByNames: ["Sophie Martin"], createdAt: "2026-08-07T15:00:00.000Z" },
  ],
  "thread-3": [
    { id: "msg-5", threadId: "thread-3", authorId: "sv-theo", authorName: "Théo Marchand", authorInitials: "TM", isSportvision: true, body: "On confirme l'équipe pour la Coupe du Gâtinais : un opérateur photo + un drone.", attachments: [], visibility: "client_visible", seenByNames: ["Sophie Martin"], createdAt: "2026-08-06T11:30:00.000Z" },
  ],
  "thread-4": [
    { id: "msg-6", threadId: "thread-4", authorId: "user-marc", authorName: "Marc Dubreuil", authorInitials: "MD", isSportvision: false, body: "Bonjour, nous aimerions échanger sur les conditions de renouvellement avant l'échéance de septembre.", attachments: [], visibility: "client_visible", seenByNames: ["Théo Marchand"], createdAt: "2026-08-02T09:05:00.000Z" },
    { id: "msg-7", threadId: "thread-4", authorId: "sv-theo", authorName: "Théo Marchand", authorInitials: "TM", isSportvision: true, body: "Bien reçu, je reviens vers vous avant vendredi avec les conditions.", attachments: [], visibility: "client_visible", seenByNames: ["Marc Dubreuil"], createdAt: "2026-08-04T11:00:00.000Z" },
  ],
  "thread-5": [
    { id: "msg-8", threadId: "thread-5", authorId: "sv-nina", authorName: "Nina Berger", authorInitials: "NB", isSportvision: true, body: "Je vous propose 3 formats pour l'annonce du partenariat Varenne Auto.", attachments: [{ id: "att-2", name: "planning-semaine-32.pdf", sizeBytes: 340_000, kind: "document" }], visibility: "client_visible", seenByNames: [], createdAt: "2026-08-08T09:00:00.000Z" },
  ],
  "thread-6": [
    { id: "msg-9", threadId: "thread-6", authorId: "sv-studio", authorName: "Studio SportVision", authorInitials: "SV", isSportvision: true, body: "12 photos du match du 3 août sont disponibles dans votre galerie.", attachments: [], visibility: "client_visible", seenByNames: ["Sophie Martin"], createdAt: "2026-08-04T09:00:00.000Z" },
  ],
};
