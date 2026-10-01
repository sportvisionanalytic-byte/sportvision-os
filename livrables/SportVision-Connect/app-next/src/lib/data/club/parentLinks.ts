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

// ── Revendications de fiche (migration v387, 01/10/2026) ───────────────────
//
// Fouka a pré-créé la fiche de Saiden. Saiden crée son compte, se reconnaît dans la liste de son
// équipe et déclare « c'est moi ». RIEN N'EST RATTACHÉ À CE MOMENT-LÀ : `player_profiles.user_id`
// reste vide jusqu'à ce que le club tranche ici.
//
// C'est la même règle que pour un lien parental, et pour la même raison : avant le 10/09, un inconnu
// devenait parent confirmé d'un mineur avec le code d'équipe, le nom et la date de naissance. Un nom
// plus une date de naissance ne prouvent pas une identité. La confirmation coûte un clic au coach,
// qui connaît ses joueurs.
//
// Le parent, lui, n'a pas de file à part : sa revendication alimente `liens_parents_a_decider`
// ci-dessus. Un seul mécanisme de décision par nature de lien.

export interface RevendicationADecider {
  id: string;
  playerId: string;
  sportif: string;
  equipe: string | null;
  demandeurEmail: string | null;
  /** Une photo de référence attend déjà sur cette fiche : la confirmer la rend utile tout de suite. */
  aUnePhoto: boolean;
  demandeLe: string;
}

export async function fetchRevendicationsADecider(
  supabase: SupabaseClient,
  clubId: string,
): Promise<RevendicationADecider[]> {
  const { data, error } = await supabase.rpc("revendications_a_decider", { p_club_id: clubId });
  if (error) throw error;
  return ((data ?? []) as Array<{
    id: string; player_id: string; sportif: string; equipe: string | null;
    demandeur_email: string | null; a_une_photo: boolean; demande_le: string;
  }>).map((r) => ({
    id: r.id,
    playerId: r.player_id,
    sportif: r.sportif,
    equipe: r.equipe,
    demandeurEmail: r.demandeur_email,
    aUnePhoto: r.a_une_photo,
    demandeLe: r.demande_le,
  }));
}

export async function deciderRevendication(
  supabase: SupabaseClient,
  id: string,
  decision: "confirme" | "refuse",
  motif?: string,
): Promise<void> {
  const { data, error } = await supabase.rpc("decider_revendication", {
    p_id: id,
    p_decision: decision,
    p_motif: motif ?? null,
  });
  if (error) throw error;
  // PAS DE FAUX SUCCÈS. La fonction rend un objet qui dit ce qu'elle a fait, et elle relit
  // elle-même `user_id` après l'écriture avant de l'annoncer. Une réponse vide n'est pas un succès.
  const r = data as { confirme?: boolean; deja_traitee?: boolean } | null;
  if (!r) throw new Error("Rien n'a été enregistré. Réessayez, et prévenez SportVision si cela se reproduit.");
  if (decision === "confirme" && !r.confirme && !r.deja_traitee) {
    throw new Error("Le rattachement n'a pas abouti. La fiche a peut-être été prise entre-temps.");
  }
}
