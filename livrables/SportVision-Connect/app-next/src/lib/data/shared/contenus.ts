import type { SupabaseClient } from "@supabase/supabase-js";

// `contenus` (migration-contenus.sql) — vraie table de planning éditorial CM, exposée aux
// clients/clubs par contenus_client_select (étendue aux clubs par migration-clubplus-v34-club-
// messages-contenus-access.sql). Statuts réels : brouillon/a_valider_interne (jamais visibles
// côté client, filtrés par la policy elle-même) puis a_valider_client/corrections/valide/
// programme/publie/archive. Aucune colonne de portée/engagement n'existe (voir l'audit du
// 09/08) — jamais affiché de chiffre inventé à la place.

export type ContenuStatut = "a_valider_client" | "corrections" | "valide" | "programme" | "publie" | "archive";

export interface Contenu {
  id: string;
  titre: string;
  description: string | null;
  plateforme: string | null;
  typeContenu: string | null;
  statut: ContenuStatut;
  sponsor: string | null;
  datePrevue: string | null;
  datePublication: string | null;
  createdAt: string;
}

interface ContenuRow {
  id: string;
  titre: string;
  description: string | null;
  plateforme: string | null;
  type_contenu: string | null;
  statut: string;
  sponsor: string | null;
  date_prevue: string | null;
  date_publication: string | null;
  created_at: string;
}

const SELECT = "id, titre, description, plateforme, type_contenu, statut, sponsor, date_prevue, date_publication, created_at";

function toContenu(row: ContenuRow): Contenu {
  return {
    id: row.id,
    titre: row.titre,
    description: row.description,
    plateforme: row.plateforme,
    typeContenu: row.type_contenu,
    statut: row.statut as ContenuStatut,
    sponsor: row.sponsor,
    datePrevue: row.date_prevue,
    datePublication: row.date_publication,
    createdAt: row.created_at,
  };
}

export async function fetchContenus(supabase: SupabaseClient, clientId: string): Promise<Contenu[]> {
  const { data, error } = await supabase.from("contenus").select(SELECT).eq("client_id", clientId);
  if (error) throw error;
  const rows = ((data ?? []) as ContenuRow[]).map(toContenu);
  // Tri côté client sur une date "effective" plutôt que sur la seule date_prevue : un contenu
  // publié n'a jamais de date_prevue (seulement date_publication, posée à la publication), donc
  // trier uniquement sur date_prevue faisait retomber tous les contenus déjà publiés en ordre
  // d'insertion arbitraire, mélangés avec ceux encore en attente de validation.
  return rows.sort((a, b) => {
    const dateA = a.datePrevue ?? a.datePublication ?? a.createdAt;
    const dateB = b.datePrevue ?? b.datePublication ?? b.createdAt;
    return dateA < dateB ? 1 : dateA > dateB ? -1 : 0;
  });
}

/** Nombre de contenus publiés ce mois-ci pour ce client, tous CM confondus — /accompagnement
 * « Le mois en cours » (Tier C Phase 3, 10/08/2026). Même principe que
 * data/shared/community-manager.ts:fetchContentsProducedThisMonth (compte `statut='publie'` sur
 * la même fenêtre calendaire), mais sans filtrer par `cm_id` : cette page affiche un chiffre
 * global côté client, pas la contribution d'un CM en particulier. */
export async function fetchContenusPublishedThisMonth(supabase: SupabaseClient, clientId: string): Promise<number> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toISOString().slice(0, 10);
  const { count, error } = await supabase
    .from("contenus")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .eq("statut", "publie")
    .gte("date_publication", monthStart);
  if (error) throw error;
  return count ?? 0;
}

/** Accepter ou demander une correction sur un contenu `a_valider_client` — RPC client_valider_contenu
 * (migration-connect-validation-contenus.sql, autorisation club étendue par v34). */
export async function decideContenu(
  supabase: SupabaseClient,
  contenuId: string,
  decision: "valide" | "corrections",
  commentaire?: string,
): Promise<void> {
  const { error } = await supabase.rpc("client_valider_contenu", {
    p_contenu_id: contenuId,
    p_decision: decision,
    p_commentaire: commentaire ?? null,
  });
  if (error) throw error;
}
