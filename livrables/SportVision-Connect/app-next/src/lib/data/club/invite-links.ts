import type { SupabaseClient } from "@supabase/supabase-js";

// Smart Links (migration-clubplus-v57, 03/09/2026) — généralise team_invite_codes existant
// (migration-clubplus-v14.sql) plutôt que d'en créer un nouveau : team_id nullable = lien club
// entier, max_uses/uses_count pour limiter le nombre d'utilisations. Un seul moteur pour les deux
// types (club/équipe), pas deux systèmes séparés — conforme à la consigne du master prompt
// Fouka "même moteur, pas six systèmes séparés".

export interface InviteLink {
  id: string;
  clubId: string;
  teamId: string | null;
  code: string;
  actif: boolean;
  expireAt: string | null;
  maxUses: number | null;
  usesCount: number;
}

interface InviteLinkRow {
  id: string;
  club_id: string;
  team_id: string | null;
  code: string;
  actif: boolean;
  expire_at: string | null;
  max_uses: number | null;
  uses_count: number;
}

function toInviteLink(row: InviteLinkRow): InviteLink {
  return {
    id: row.id,
    clubId: row.club_id,
    teamId: row.team_id,
    code: row.code,
    actif: row.actif,
    expireAt: row.expire_at,
    maxUses: row.max_uses,
    usesCount: row.uses_count,
  };
}

/** URL publique consommable par /join/[code] côté Connect — même convention que les autres liens
 * partagés du produit (ex. /book/:id dans PersonaDashboard.tsx). Aucune donnée personnelle dans
 * l'URL, uniquement le code (déjà non devinable, généré serveur). */
export function buildJoinUrl(code: string): string {
  return `https://connect.sportvision-an.fr/join/${code}`;
}

export async function createInviteLink(
  supabase: SupabaseClient,
  clubId: string,
  teamId: string | null,
  maxUses?: number,
): Promise<InviteLink> {
  const { data, error } = await supabase.rpc("create_invite_code", { p_club_id: clubId, p_team_id: teamId, p_max_uses: maxUses ?? null });
  if (error) throw error;
  return toInviteLink(data as InviteLinkRow);
}

export async function rotateInviteLink(supabase: SupabaseClient, codeId: string): Promise<InviteLink> {
  const { data, error } = await supabase.rpc("rotate_team_invite_code", { p_code_id: codeId });
  if (error) throw error;
  return toInviteLink(data as InviteLinkRow);
}

export async function deactivateInviteLink(supabase: SupabaseClient, codeId: string): Promise<InviteLink> {
  const { data, error } = await supabase.rpc("deactivate_invite_code", { p_code_id: codeId });
  if (error) throw error;
  return toInviteLink(data as InviteLinkRow);
}

/** Lien actif le plus récent pour une équipe précise, s'il existe (TeamCard.tsx) — un club peut
 * en théorie accumuler plusieurs codes désactivés/expirés pour la même équipe (rotate en génère
 * un nouveau), on ne veut que le dernier actif. */
export async function fetchClubTeamInviteLink(supabase: SupabaseClient, teamId: string): Promise<InviteLink | null> {
  const { data, error } = await supabase
    .from("team_invite_codes")
    .select("id, club_id, team_id, code, actif, expire_at, max_uses, uses_count")
    .eq("team_id", teamId)
    .eq("actif", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? toInviteLink(data as InviteLinkRow) : null;
}

export async function fetchClubInviteLinks(supabase: SupabaseClient, clubId: string): Promise<InviteLink[]> {
  const { data, error } = await supabase
    .from("team_invite_codes")
    .select("id, club_id, team_id, code, actif, expire_at, max_uses, uses_count")
    .eq("club_id", clubId)
    .is("team_id", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as InviteLinkRow[]).map(toInviteLink);
}
