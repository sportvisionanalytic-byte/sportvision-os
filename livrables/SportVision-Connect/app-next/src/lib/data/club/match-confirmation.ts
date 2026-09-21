// La confirmation d'un match par le club (v241, 21/09/2026).
//
// Fouka : « il y a eu pas mal d'erreurs sur les calendriers, des matchs qui n'étaient pas bons.
// Les coachs doivent pouvoir confirmer si c'est la bonne horaire, le bon lieu, modifier ou ajouter
// un match, comme ça moi sur le calendrier je vois le match exact. »
//
// Un calendrier de club vient de la fédération, d'un import Excel ou d'une saisie, et aucune de ces
// sources ne sait qu'un match a été décalé d'une heure par un coup de fil entre deux coachs le
// jeudi soir. SportVision envoie pourtant un opérateur sur la foi de cette ligne.
//
// Tout le contrôle est en base : qui a le droit de confirmer (peut_confirmer_match), ce que ça
// écrit (match_confirmer), et le fait qu'une confirmation tombe si la fédération redéplace le match
// ensuite. Ce fichier ne fait que relayer — il ne décide rien, et surtout ne re-décide rien.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface EtatConfirmation {
  /** Absent tant que personne n'a confirmé. */
  confirmeLe?: string;
  /** Nom de la personne du club qui a confirmé. Absent si elle n'est plus membre. */
  confirmePar?: string;
  /** Est-ce que CELUI QUI REGARDE peut confirmer ce match. Calculé en base, jamais déduit du rôle
   *  côté React : un bouton affiché puis refusé par le serveur est pire que pas de bouton. */
  confirmable: boolean;
}

export interface CorrectionMatch {
  date?: string;
  heure?: string;
  lieu?: string;
  adversaire?: string;
}

/** Un match du calendrier porte la référence « match:<uuid> » ; la base, elle, ne connaît que
 *  l'uuid. Renvoie undefined pour un entraînement ou un événement, qui ne se confirment pas. */
export function idMatchDepuisRef(ref: string): string | undefined {
  return ref.startsWith("match:") ? ref.slice("match:".length) : undefined;
}

export async function fetchEtatConfirmation(
  supabase: SupabaseClient,
  matchId: string,
): Promise<EtatConfirmation> {
  const { data, error } = await supabase.rpc("match_confirmation", { p_match_id: matchId });
  if (error) throw error;
  const ligne = (data ?? [])[0] as
    | { confirme_le: string | null; confirme_par: string | null; confirmable: boolean }
    | undefined;
  return {
    confirmeLe: ligne?.confirme_le ?? undefined,
    confirmePar: ligne?.confirme_par ?? undefined,
    confirmable: ligne?.confirmable ?? false,
  };
}

/** Confirme le match, en corrigeant au passage ce qui doit l'être. Confirmer « tel quel » et
 *  confirmer « mais c'est à 15h30 » sont le même geste pour un coach : dire ce qui est vrai.
 *  Les champs laissés vides ne sont pas touchés. */
export async function confirmerMatch(
  supabase: SupabaseClient,
  matchId: string,
  correction: CorrectionMatch = {},
): Promise<void> {
  const { error } = await supabase.rpc("match_confirmer", {
    p_match_id: matchId,
    p_date: correction.date || null,
    p_heure: correction.heure || null,
    p_lieu: correction.lieu || null,
    p_adversaire: correction.adversaire || null,
  });
  if (error) throw error;
}

export async function retirerConfirmation(supabase: SupabaseClient, matchId: string): Promise<void> {
  const { error } = await supabase.rpc("match_confirmation_retirer", { p_match_id: matchId });
  if (error) throw error;
}

export interface MatchAConfirmer {
  id: string;
  team: string | null;
  teamId: string | null;
  opponent: string | null;
  date: string | null;
  heure: string | null;
  lieu: string | null;
  confirmable: boolean;
}

/** Les matchs à venir que personne n'a encore confirmés. Sert la pastille du calendrier et le
 *  rappel du tableau de bord. Une seule requête pour tout l'écran : interroger chaque match
 *  séparément ferait une requête par carte, soit des centaines sur un mois de calendrier. */
export async function fetchMatchsAConfirmer(
  supabase: SupabaseClient,
  clubId: string,
  jours = 21,
): Promise<MatchAConfirmer[]> {
  const { data, error } = await supabase.rpc("matchs_a_confirmer", { p_club_id: clubId, p_jours: jours });
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).map((l) => ({
    id: String(l.id),
    team: (l.team as string) ?? null,
    teamId: (l.team_id as string) ?? null,
    opponent: (l.opponent as string) ?? null,
    date: (l.match_date as string) ?? null,
    heure: (l.kickoff_time as string) ?? null,
    lieu: (l.lieu as string) ?? null,
    confirmable: Boolean(l.confirmable),
  }));
}
