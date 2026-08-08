import type { SupabaseClient } from "@supabase/supabase-js";

// parental_authorizations × authorization_types (migration-clubplus-v15.sql) — 12 types réels
// (creation_compte, acces_clubplus, traitement_donnees, consultation_medias, droit_image,
// diffusion_interne, diffusion_reseaux, diffusion_sportvision, telechargement, communications,
// projet_collectif, commandes_paiements) × 10 statuts (non_transmise/en_attente/transmise/
// a_verifier/valide/incomplete/refusee/expiree/retiree/remplacee) — sans rapport avec les 5
// booléens du mock. Écriture EXCLUSIVEMENT via RPC submit_parental_authorization/
// withdraw_parental_authorization (déjà utilisées telles quelles par famille-espace.js).
// RLS : pa_parent_select (parent confirmé) / pa_player_select (le joueur lui-même, lecture seule
// — voir data/player/authorizations.ts).

export const AUTHORIZATION_STATUS_LABELS: Record<string, string> = {
  non_transmise: "Non transmise",
  en_attente: "En attente",
  transmise: "Transmise",
  a_verifier: "À vérifier",
  valide: "Validée",
  incomplete: "Incomplète",
  refusee: "Refusée",
  expiree: "Expirée",
  retiree: "Retirée",
  remplacee: "Remplacée",
};

export const AUTHORIZATION_STATUS_TONE: Record<string, "neutral" | "info" | "warning" | "success" | "danger"> = {
  non_transmise: "neutral",
  en_attente: "warning",
  transmise: "info",
  a_verifier: "info",
  valide: "success",
  incomplete: "warning",
  refusee: "danger",
  expiree: "warning",
  retiree: "neutral",
  remplacee: "neutral",
};

/** Une autorisation valide, non signable/retirable à nouveau sans repasser par une nouvelle version. */
const SIGNABLE_STATUSES = new Set(["non_transmise", "en_attente", "incomplete", "refusee", "expiree"]);
const WITHDRAWABLE_STATUSES = new Set(["transmise", "a_verifier", "valide"]);

export function isSignable(statut: string): boolean {
  return SIGNABLE_STATUSES.has(statut);
}

export function isWithdrawable(statut: string): boolean {
  return WITHDRAWABLE_STATUSES.has(statut);
}

export interface ChildAuthorization {
  id: string;
  code: string;
  label: string;
  description: string | null;
  obligatoire: boolean;
  statut: string;
}

interface AuthorizationRow {
  id: string;
  statut: string;
  authorization_types: { code: string; label: string; description: string | null; obligatoire: boolean } | null;
}

const SELECT = "id, statut, authorization_types(code, label, description, obligatoire)";

export async function fetchChildAuthorizations(supabase: SupabaseClient, playerId: string): Promise<ChildAuthorization[]> {
  const { data } = await supabase.from("parental_authorizations").select(SELECT).eq("player_id", playerId);

  return ((data ?? []) as unknown as AuthorizationRow[])
    .filter((row) => row.authorization_types)
    .map((row) => ({
      id: row.id,
      code: row.authorization_types!.code,
      label: row.authorization_types!.label,
      description: row.authorization_types!.description,
      obligatoire: row.authorization_types!.obligatoire,
      statut: row.statut,
    }));
}

export async function signChildAuthorization(supabase: SupabaseClient, authorizationId: string): Promise<void> {
  const { error } = await supabase.rpc("submit_parental_authorization", {
    p_authorization_id: authorizationId,
    p_methode: "signature_numerique",
    p_preuve: { lu_le: new Date().toISOString(), interface: "sportvision-connect" },
  });
  if (error) throw error;
}

export async function withdrawChildAuthorization(supabase: SupabaseClient, authorizationId: string, motif?: string): Promise<void> {
  const { error } = await supabase.rpc("withdraw_parental_authorization", {
    p_authorization_id: authorizationId,
    p_motif: motif ?? null,
  });
  if (error) throw error;
}
