// Types propres aux espaces Joueur, Parent, Sponsor, CM externe, Client ponctuel et Structure
// générique — voir ACTIONS.md § 5, § 20, § 20 bis, § 20 ter, § 21 et DATA_MODEL.md § Guardianship,
// § Team, Player, ImageRight. Ne duplique rien de src/lib/types.ts.

/** Guardianship — DATA_MODEL.md § Guardianship. Un parent peut avoir plusieurs enfants. */
export interface Guardianship {
  id: string;
  guardianUserId: string;
  childId: string;
  relation: "parent" | "legal_guardian";
  canManageServices: boolean;
  canManageAuthorizations: boolean;
  canViewContent: boolean;
}

/** Profil enfant tel qu'affiché sur une carte de /children — ACTIONS.md § 20. */
export interface ChildProfile {
  id: string;
  firstName: string;
  lastName: string;
  age: number;
  clubName: string;
  teamName: string;
  shirtNumber?: string;
  position?: string;
  coachName: string;
  contentCount: number;
  imageRightStatus: "signed" | "pending" | "refused" | "withdrawn";
}

/** Les 5 périmètres indépendants du droit à l'image — DATA_MODEL.md § Team, Player, ImageRight. */
export type ImageRightScope =
  | "team_match_photos"
  | "videos_highlights"
  | "individual_portraits"
  | "commercial_use"
  | "off_club_distribution";

export const IMAGE_RIGHT_SCOPE_LABELS: Record<ImageRightScope, string> = {
  team_match_photos: "Photos d'équipe et de match",
  videos_highlights: "Vidéos et highlights",
  individual_portraits: "Portraits individuels",
  commercial_use: "Usage commercial",
  off_club_distribution: "Diffusion hors club",
};

/** Étendue du droit à l'image d'un enfant, éditable par le parent — ACTIONS.md § 20. */
export interface ChildImageRight {
  childId: string;
  scopes: Record<ImageRightScope, boolean>;
  signedByName?: string;
  signedAt?: string;
}

/** Document à traiter pour un enfant — ACTIONS.md § 20 « Autorisations ». */
export interface ChildDocument {
  id: string;
  childId: string;
  label: string;
  action: "download" | "sign" | "upload";
  status: "up_to_date" | "action_required";
}

/** Une carte d'inclusion de l'offre — ACTIONS.md § 21 « Client — 4 cartes d'inclusions ». */
export interface AccompagnementInclusion {
  title: string;
  description: string;
}

// AccompagnementContact / FollowUpPoint (mock, ACTIONS.md § 21) supprimés le 10/08/2026 — voir
// mock/persona.ts. « Qui intervient pour vous » utilise désormais directement CommunityManager
// (data/shared/community-manager.ts) ; aucune source réelle pour un « point de suivi mensuel ».

/** Le mois en cours en 4 chiffres — ACTIONS.md § 21. `value` peut être « Non disponible » quand
 * aucune source réelle n'existe pour ce type d'espace (voir accompagnement/page.tsx). */
export interface MonthlyFigure {
  label: string;
  value: string;
}

/** Accès délégué d'un CM externe à un club — ACTIONS.md § 21 « Mes accès délégués ». */
export interface DelegatedAccess {
  id: string;
  clubName: string;
  allowed: string[];
  denied: string[];
  expiresAt: string;
}

/** Une ligne de la jauge de visibilité sponsor — ACTIONS.md § 20 bis. */
export interface SponsorOperation {
  label: string;
  date: string;
  status: "planned" | "completed";
}
