// Types de la messagerie contextuelle — voir DATA_MODEL.md § Thread et Message.
// « Il n'y a pas de messagerie générale. Chaque fil est rattaché à un objet. » Fichier dédié,
// voir README.md § Conventions pour construire un nouveau module.

export type ThreadContextType =
  | "communication"
  | "service"
  | "visual_request"
  | "billing"
  | "support"
  | "general_account";

export const THREAD_CONTEXT_LABELS: Record<ThreadContextType, string> = {
  communication: "Communication",
  service: "Prestation",
  visual_request: "Demande",
  billing: "Facturation",
  support: "Support",
  general_account: "Compte",
};

/** Voir DATA_MODEL.md — le rôle SportVision affiché sur le fil, jamais un intitulé interne brut. */
export type SportvisionRoleLabel =
  | "Community Manager"
  | "Chargé de compte"
  | "Secrétariat"
  | "Studio"
  | "Support";

export interface ThreadParticipant {
  id: string;
  name: string;
  avatarInitials: string;
  isSportvision: boolean;
  isOnline?: boolean;
}

export interface Thread {
  id: string;
  organizationId: string;
  subject: string;
  contextType: ThreadContextType;
  contextLabel: string;
  contextHref?: string;
  sportvisionRoleLabel?: SportvisionRoleLabel;
  participants: ThreadParticipant[];
  lastMessagePreview: string;
  lastMessageAt: string;
  unreadCount: number;
  isArchived: boolean;
}

export type MessageVisibility = "client_visible" | "internal_only";

export interface MessageAttachment {
  id: string;
  name: string;
  sizeBytes: number;
  kind: "image" | "video" | "document";
}

export interface Message {
  id: string;
  threadId: string;
  authorId: string;
  authorName: string;
  authorInitials: string;
  isSportvision: boolean;
  body: string;
  attachments: MessageAttachment[];
  /** Toujours `client_visible` côté Connect — voir la règle absolue de DATA_MODEL.md. */
  visibility: MessageVisibility;
  seenByNames: string[];
  createdAt: string;
}
