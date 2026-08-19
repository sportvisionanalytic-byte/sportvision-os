import type { SupabaseClient } from "@supabase/supabase-js";

// membership_requests × club_teams × player_profiles (migration-clubplus-v14/v15.sql, complétée
// par migration-connect-v26 côté parent d'un enfant déjà affilié) — demandes d'adhésion à une
// équipe, avec double validation éducateur→dirigeant quand clubs.membership_validation_mode =
// 'double' (voir deriveStage ci-dessous pour la logique exacte, qui reproduit celle de
// validate_team_membership côté serveur).
//
// RLS fait tout le travail de périmètre ici : un éducateur (club_members.role in coach/
// resp_equipe) qui interroge cette table ne reçoit QUE les demandes des équipes où il est
// habilité (is_team_educateur, teams jsonb) ; un admin (role='admin') reçoit toutes les demandes
// du club (is_club_admin). Aucun filtrage de rôle côté client n'est donc nécessaire pour la
// lecture — seul l'affichage des actions (confirmer/valider/refuser) dépend du rôle courant, via
// ctx.membership.role (mappers.ts : coach/team_manager = éducateur, admin = dirigeant).

export type MembershipRequestStatut =
  | "a_verifier"
  | "autorisation_manquante"
  | "en_attente_parent"
  | "pret_a_valider"
  | "validee"
  | "refusee"
  | "doublon_signale"
  | "transferee_admin";

export type ValidationMode = "standard" | "controle" | "double";

export interface TeamJoinRequest {
  id: string;
  clubId: string;
  teamId: string | null;
  teamName: string | null;
  playerId: string | null;
  playerFirstName: string | null;
  playerLastName: string | null;
  source: string;
  statut: MembershipRequestStatut;
  validationMode: ValidationMode | null;
  educateurConfirmeAt: string | null;
  adminValideAt: string | null;
  refusMotif: string | null;
  createdAt: string;
}

interface RequestRow {
  id: string;
  club_id: string;
  team_id: string | null;
  player_id: string | null;
  source: string;
  statut: MembershipRequestStatut;
  validation_mode: ValidationMode | null;
  educateur_confirme_at: string | null;
  admin_valide_at: string | null;
  refus_motif: string | null;
  created_at: string;
  club_teams: { name: string } | null;
  player_profiles: { prenom: string; nom: string } | null;
}

const SELECT =
  "id, club_id, team_id, player_id, source, statut, validation_mode, educateur_confirme_at, admin_valide_at, refus_motif, created_at, club_teams(name), player_profiles(prenom, nom)";

export async function fetchClubJoinRequests(supabase: SupabaseClient, clubId: string): Promise<TeamJoinRequest[]> {
  const { data, error } = await supabase
    .from("membership_requests")
    .select(SELECT)
    .eq("club_id", clubId)
    .order("created_at", { ascending: false });
  if (error) throw error;

  return ((data ?? []) as unknown as RequestRow[]).map((row) => ({
    id: row.id,
    clubId: row.club_id,
    teamId: row.team_id,
    teamName: row.club_teams?.name ?? null,
    playerId: row.player_id,
    playerFirstName: row.player_profiles?.prenom ?? null,
    playerLastName: row.player_profiles?.nom ?? null,
    source: row.source,
    statut: row.statut,
    validationMode: row.validation_mode,
    educateurConfirmeAt: row.educateur_confirme_at,
    adminValideAt: row.admin_valide_at,
    refusMotif: row.refus_motif,
    createdAt: row.created_at,
  }));
}

/** Étape 1 (mode double) : l'éducateur confirme l'identité/l'équipe. */
export async function confirmRequestEducateur(supabase: SupabaseClient, requestId: string): Promise<void> {
  const { error } = await supabase.rpc("confirm_request_educateur", { p_request_id: requestId });
  if (error) throw error;
}

/** Validation finale — admin (mode double/controle), ou admin/éducateur (mode standard). */
export async function validateTeamMembership(supabase: SupabaseClient, requestId: string): Promise<void> {
  const { error } = await supabase.rpc("validate_team_membership", { p_request_id: requestId });
  if (error) throw error;
}

export async function rejectTeamMembership(supabase: SupabaseClient, requestId: string, motif?: string): Promise<void> {
  const { error } = await supabase.rpc("reject_team_membership", { p_request_id: requestId, p_motif: motif ?? null });
  if (error) throw error;
}

/** "Demander une information" (migration-clubplus-v46) — ne change pas le statut de la demande,
 * journalise juste ce qui manque (membership_request_events, event_type='info_demandee'). */
export async function requestMembershipInfo(supabase: SupabaseClient, requestId: string, note: string): Promise<void> {
  const { error } = await supabase.rpc("request_membership_info", { p_request_id: requestId, p_note: note });
  if (error) throw error;
}

export type RequestStage = "attente_educateur" | "attente_dirigeant" | "validee" | "refusee";

/**
 * Reproduit côté client la logique d'autorisation exacte de validate_team_membership
 * (migration-clubplus-v15.sql) — jamais une resimplification qui diverge du serveur, seulement un
 * miroir d'affichage : le serveur reste la seule source de vérité, cette fonction ne décide de
 * rien, elle explique juste où en est la demande.
 */
export function deriveStage(req: TeamJoinRequest): RequestStage {
  if (req.statut === "validee") return "validee";
  if (req.statut === "refusee") return "refusee";
  if (req.validationMode === "double" && !req.educateurConfirmeAt) return "attente_educateur";
  return "attente_dirigeant";
}

export const STAGE_LABEL: Record<RequestStage, string> = {
  attente_educateur: "En attente de l'éducateur",
  attente_dirigeant: "En attente du dirigeant",
  validee: "Validée",
  refusee: "Refusée",
};

export const STAGE_TONE: Record<RequestStage, "info" | "warning" | "success" | "danger"> = {
  attente_educateur: "warning",
  attente_dirigeant: "info",
  validee: "success",
  refusee: "danger",
};
