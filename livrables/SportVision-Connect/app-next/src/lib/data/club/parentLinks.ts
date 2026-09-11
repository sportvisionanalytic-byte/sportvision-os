import type { SupabaseClient } from "@supabase/supabase-js";

// Rattachements de parents en attente (migration v172, 12/09/2026).
//
// Un parent qui se rattache à un enfant reste « en attente de confirmation » : c'est le club qui
// tranche (decider_lien_parent, durcissement du 10/09 après l'incident où un inconnu devenait
// parent confirmé d'un mineur). La fonction existait, la liste n'existait pas, et aucun écran
// n'appelait la décision : les familles attendaient sans fin. Voici les deux appels.
export interface LienParentADecider {
  relationId: string;
  playerId: string;
  enfant: string;
  equipe: string | null;
  parent: string;
  parentEmail: string | null;
  relation: string;
  demandeLe: string;
}

export async function fetchLiensParentsADecider(
  supabase: SupabaseClient,
  clubId: string,
): Promise<LienParentADecider[]> {
  const { data, error } = await supabase.rpc("liens_parents_a_decider", { p_club_id: clubId });
  if (error) throw error;
  return ((data ?? []) as Array<{
    relation_id: string;
    player_id: string;
    enfant: string;
    equipe: string | null;
    parent: string;
    parent_email: string | null;
    relation: string;
    demande_le: string;
  }>).map((r) => ({
    relationId: r.relation_id,
    playerId: r.player_id,
    enfant: r.enfant,
    equipe: r.equipe,
    parent: r.parent,
    parentEmail: r.parent_email,
    relation: r.relation,
    demandeLe: r.demande_le,
  }));
}

/** Confirme ou refuse un rattachement. La base vérifie qui décide ; un refus remonte tel quel. */
export async function deciderLienParent(
  supabase: SupabaseClient,
  relationId: string,
  decision: "confirme" | "refuse",
): Promise<void> {
  const { data, error } = await supabase.rpc("decider_lien_parent", {
    p_relation_id: relationId,
    p_decision: decision,
  });
  if (error) throw error;
  // Pas de faux succès : la fonction rend la ligne décidée, jamais rien.
  if (!data) throw new Error("Rien n'a été enregistré. Réessayez, et prévenez SportVision si cela se reproduit.");
}
