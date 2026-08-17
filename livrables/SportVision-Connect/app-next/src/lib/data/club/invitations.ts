import type { SupabaseClient } from "@supabase/supabase-js";

// Accepter/refuser une invitation à rejoindre un club — voir migration-clubplus-v45 (NON
// EXÉCUTÉE) pour le détail des 2 RPC et pourquoi un simple update direct sur club_members
// (comme pour le reste de ce module) ne suffit pas ici : un trigger de sécurité bloque
// volontairement l'auto-modification de role/status par quiconque n'est ni le staff OS ni déjà
// admin du club — les 2 fonctions ci-dessous sont l'unique exception, strictement bornée à
// "accepter/refuser SA PROPRE invitation en attente", jamais un autre changement.

export async function acceptClubInvitation(supabase: SupabaseClient, clubId: string): Promise<void> {
  const { error } = await supabase.rpc("accept_club_invitation", { p_club_id: clubId });
  if (error) throw error;
}

export async function declineClubInvitation(supabase: SupabaseClient, clubId: string): Promise<void> {
  const { error } = await supabase.rpc("decline_club_invitation", { p_club_id: clubId });
  if (error) throw error;
}
