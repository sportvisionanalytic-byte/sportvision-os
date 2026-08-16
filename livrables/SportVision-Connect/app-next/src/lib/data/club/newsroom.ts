import type { SupabaseClient } from "@supabase/supabase-js";
import type { NewsroomItem, NewsroomStatus } from "@/lib/types/studio";

// club_newsroom_items (migration-clubplus-v3.sql) — workflow réel à 8 statuts, plus riche que
// les 5 de NewsroomStatus (design). Écriture par PATCH direct sur `status`, déjà le pattern en
// prod (club-newsroom-communication.js) — pas de RPC dédiée. RLS : is_club_member(club_id) pour
// select/insert/update, is_club_admin(club_id) pour delete (migration-clubplus-v3.sql, vérifié en
// direct par curl le 16/08/2026 — colonnes réelles : id, club_id, team, type, title, description,
// priority, media_count, sponsor, status, author_id, author_name, created_at, updated_at).
//
// 16/08/2026 (chantier Matchcenter/Newsroom) : avant ce chantier, aucune action de ce module ne
// permettait de CRÉER ni de SUPPRIMER une remontée — seuls les statuts d'une remontée déjà
// existante (créée hors Club+, ex. import externe) pouvaient être changés. Or la table supporte
// bien insert (n'importe quel membre actif, is_club_member) et delete (admin uniquement,
// is_club_admin) depuis l'origine. Ajout de createClubNewsroomItem / updateClubNewsroomItemDetails
// / deleteClubNewsroomItem pour couvrir ce cycle de vie complet. `type`/`priority` sont exposés via
// NewsroomItemDetails (défini ici, PAS dans lib/types/studio.ts pour éviter tout risque de
// collision avec l'agent qui travaille en parallèle sur le module Studio/lib/types/studio.ts) —
// NewsroomItemDetails étend NewsroomItem sans modifier ce type partagé.

const STATUS_MAP: Record<string, NewsroomStatus> = {
  recu: "received",
  a_verifier: "to_process",
  infos_manquantes: "info_requested",
  pret_a_transformer: "to_process",
  en_creation: "transformed",
  programme: "transformed",
  publie: "transformed",
  archive: "archived",
};

/** Écriture — un seul statut réel par action design, pas de round-trip exact possible (8 réels
 * vers 5 design). Voir fetchClubNewsroomItems pour la lecture. */
const WRITE_STATUS_MAP: Record<"transformed" | "info_requested" | "archived", string> = {
  transformed: "en_creation",
  info_requested: "infos_manquantes",
  archived: "archive",
};

export type NewsroomItemType = "resultat" | "actualite";
export type NewsroomItemPriority = "high" | "normal" | "low";

const TYPE_MAP: Record<string, NewsroomItemType> = { "Résultat": "resultat", "Actualité": "actualite" };
const WRITE_TYPE_MAP: Record<NewsroomItemType, string> = { resultat: "Résultat", actualite: "Actualité" };

const PRIORITY_MAP: Record<string, NewsroomItemPriority> = { haute: "high", normale: "normal", basse: "low" };
const WRITE_PRIORITY_MAP: Record<NewsroomItemPriority, string> = { high: "haute", normal: "normale", low: "basse" };

/** NewsroomItem (design, studio.ts) + les colonnes réelles supplémentaires (type/priority/
 * updatedAt) que le design ne couvrait pas encore. */
export interface NewsroomItemDetails extends NewsroomItem {
  itemType: NewsroomItemType;
  priority: NewsroomItemPriority;
  updatedAt: string;
}

interface ClubNewsroomRow {
  id: string;
  team: string | null;
  type: string;
  title: string;
  description: string | null;
  priority: string | null;
  status: string;
  author_id: string | null;
  author_name: string | null;
  created_at: string;
  updated_at: string;
}

const SELECT = "id, team, type, title, description, priority, status, author_id, author_name, created_at, updated_at";

function toNewsroomItem(row: ClubNewsroomRow, organizationId: string): NewsroomItemDetails {
  return {
    id: row.id,
    organizationId,
    title: row.title,
    body: row.description ?? "",
    submittedById: row.author_id ?? "",
    submittedByName: row.author_name ?? "Équipe",
    teamName: row.team ?? undefined,
    status: STATUS_MAP[row.status] ?? "received",
    itemType: TYPE_MAP[row.type] ?? "actualite",
    priority: PRIORITY_MAP[row.priority ?? "normale"] ?? "normal",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function fetchClubNewsroomItems(supabase: SupabaseClient, organizationId: string): Promise<NewsroomItemDetails[]> {
  const { data, error } = await supabase
    .from("club_newsroom_items")
    .select(SELECT)
    .eq("club_id", organizationId)
    .order("created_at", { ascending: false });
  if (error) throw error;

  return ((data ?? []) as ClubNewsroomRow[]).map((row) => toNewsroomItem(row, organizationId));
}

/** `.eq("club_id", ...)` + `.select()` : sans ça, une RLS qui bloque silencieusement (0 ligne
 * affectée) renvoie quand même `{error: null}` et l'appelant marquerait l'item comme mis à jour
 * à tort (faux succès) — voir newsroom/page.tsx. */
export async function updateClubNewsroomItemStatus(
  supabase: SupabaseClient,
  id: string,
  organizationId: string,
  status: "transformed" | "info_requested" | "archived",
): Promise<void> {
  const { data, error } = await supabase
    .from("club_newsroom_items")
    .update({ status: WRITE_STATUS_MAP[status] })
    .eq("id", id)
    .eq("club_id", organizationId)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Mise à jour refusée : remontée introuvable ou accès refusé.");
}

export interface NewsroomItemInput {
  title: string;
  body: string;
  teamName?: string;
  itemType: NewsroomItemType;
  priority: NewsroomItemPriority;
}

/** cni_member_insert : n'importe quel membre actif du club peut créer une remontée
 * (migration-clubplus-v3.sql) — pas réservé à un rôle Communication. */
export async function createClubNewsroomItem(
  supabase: SupabaseClient,
  organizationId: string,
  authorId: string,
  authorName: string,
  input: NewsroomItemInput,
): Promise<void> {
  const { error } = await supabase.from("club_newsroom_items").insert({
    club_id: organizationId,
    title: input.title,
    description: input.body || null,
    team: input.teamName || null,
    type: WRITE_TYPE_MAP[input.itemType],
    priority: WRITE_PRIORITY_MAP[input.priority],
    author_id: authorId,
    author_name: authorName,
  });
  if (error) throw error;
}

/** Édition du contenu d'une remontée (titre/description/équipe/type/priorité) — distincte du
 * statut (voir updateClubNewsroomItemStatus), pour ne jamais écraser un statut déjà avancé par
 * une simple correction de texte. */
export async function updateClubNewsroomItemDetails(
  supabase: SupabaseClient,
  id: string,
  organizationId: string,
  input: NewsroomItemInput,
): Promise<void> {
  const { data, error } = await supabase
    .from("club_newsroom_items")
    .update({
      title: input.title,
      description: input.body || null,
      team: input.teamName || null,
      type: WRITE_TYPE_MAP[input.itemType],
      priority: WRITE_PRIORITY_MAP[input.priority],
    })
    .eq("id", id)
    .eq("club_id", organizationId)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Mise à jour refusée : remontée introuvable ou accès refusé.");
}

/** cni_admin_delete : réservé à un membre role='admin' (is_club_admin) — voir newsroom/page.tsx
 * pour le masquage du bouton correspondant côté UI (le masquage n'est qu'un confort, la RLS
 * refuse déjà la suppression pour tout autre rôle). */
export async function deleteClubNewsroomItem(supabase: SupabaseClient, id: string, organizationId: string): Promise<void> {
  const { data, error } = await supabase
    .from("club_newsroom_items")
    .delete()
    .eq("id", id)
    .eq("club_id", organizationId)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Suppression refusée : remontée introuvable ou accès refusé.");
}
