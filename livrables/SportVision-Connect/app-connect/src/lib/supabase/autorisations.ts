import type { SupabaseClient } from "@supabase/supabase-js";

// Autorisations parentales (migration v176, 12/09/2026).
//
// Tout l'accès aux médias d'un club en dépend : un média où l'enfant est identifié reste masqué
// tant que le droit à l'image n'est pas signé. Douze types existent en base depuis longtemps,
// aucun n'était signable : l'espace Famille avait été retiré de Club+ et Connect n'avait pas
// l'écran. La signature, comme le retrait, passe par une fonction : l'écran ne pose ni la date, ni
// l'auteur, ni la version du texte acceptée.
export interface Autorisation {
  code: string;
  label: string;
  obligatoire: boolean;
  texte: string | null;
  statut: string;
  dateSignature: string | null;
  dateExpiration: string | null;
}

export const STATUT_AUTORISATION: Record<string, string> = {
  non_transmise: "À signer",
  en_attente: "En attente",
  transmise: "Transmise",
  a_verifier: "En cours de vérification",
  valide: "Accordée",
  incomplete: "Incomplète",
  refusee: "Refusée",
  expiree: "Expirée",
  retiree: "Retirée",
};

export async function fetchAutorisations(supabase: SupabaseClient, playerId: string): Promise<Autorisation[]> {
  const { data, error } = await supabase.rpc("mes_autorisations", { p_player_id: playerId });
  if (error) throw error;
  return ((data ?? []) as Array<{
    code: string;
    label: string;
    obligatoire: boolean;
    texte: string | null;
    statut: string;
    date_signature: string | null;
    date_expiration: string | null;
  }>).map((r) => ({
    code: r.code,
    label: r.label,
    obligatoire: r.obligatoire,
    texte: r.texte,
    statut: r.statut,
    dateSignature: r.date_signature,
    dateExpiration: r.date_expiration,
  }));
}

export async function signerAutorisation(
  supabase: SupabaseClient,
  playerId: string,
  code: string,
  accepte: boolean,
): Promise<void> {
  const { data, error } = await supabase.rpc("signer_autorisation", {
    p_player_id: playerId,
    p_code: code,
    p_accepte: accepte,
  });
  if (error) throw error;
  if (!data) throw new Error("Rien n'a été enregistré. Réessayez.");
}

export async function retirerAutorisation(
  supabase: SupabaseClient,
  playerId: string,
  code: string,
  motif?: string,
): Promise<void> {
  const { data, error } = await supabase.rpc("retirer_autorisation", {
    p_player_id: playerId,
    p_code: code,
    p_motif: motif ?? null,
  });
  if (error) throw error;
  if (!data) throw new Error("Rien n'a été enregistré. Réessayez.");
}
