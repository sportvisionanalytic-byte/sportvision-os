import type { SupabaseClient } from "@supabase/supabase-js";

// Invitation nominative par e-mail d'un joueur ou d'un parent — edge function
// clubplus-family-invite (SportVision-TV/supabase/functions/clubplus-family-invite), déjà en
// production, appelée jusqu'ici uniquement depuis l'ancienne app vanilla (club-gestion-joueurs-
// familles.js). Portage 22/08/2026 : demande explicite de Fouka pour que le club (self-service)
// et le CM délégué (cm_agency_club_access, même fonction déjà étendue pour le reconnaître comme
// équivalent admin) puissent tous deux envoyer ces invitations depuis la nouvelle Club+.
//
// Ce que l'edge function NE fait PAS : elle ne crée ni player_profiles, ni parent_profiles, ni
// membership_requests — seulement le compte auth.users (ou réutilise l'existant) et une ligne
// player_invitations/parent_invitations. C'est l'invité qui, une fois son mot de passe défini,
// crée sa fiche côté SportVision Connect (accept_player_invitation/accept_parent_invitation).

export type FamilyInviteTargetType = "joueur" | "parent";

interface InviteFamilyMemberInput {
  targetType: FamilyInviteTargetType;
  email: string;
  firstName: string;
  lastName: string;
  clubId: string;
  teamId?: string;
  dateNaissance?: string;
}

export async function inviteFamilyMember(
  supabase: SupabaseClient,
  input: InviteFamilyMemberInput,
): Promise<{ alreadyInvited: boolean }> {
  const { data, error } = await supabase.functions.invoke("clubplus-family-invite", {
    body: {
      target_type: input.targetType,
      email: input.email,
      prenom: input.firstName,
      nom: input.lastName,
      club_id: input.clubId,
      team_id: input.targetType === "joueur" ? input.teamId : null,
      date_naissance: input.targetType === "joueur" ? input.dateNaissance : null,
    },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return { alreadyInvited: Boolean(data?.already_invited) };
}
