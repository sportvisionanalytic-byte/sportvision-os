import type { SupabaseClient } from "@supabase/supabase-js";
import type { MediaAsset, MediaAssetKind, MediaAssetStatus, MediaVisibility } from "@/lib/types/content";

// club_media (migration-clubplus-v7.sql) + club_creations (v8) — schéma réel bien plus mince que
// MediaAsset du design (pas de versions/commentaires/chapitres/dimensions réelles). Voir le plan
// Phase 1 : les champs sans équivalent réel reçoivent une valeur par défaut sûre documentée
// ci-dessous plutôt que d'être inventés. RLS : is_club_member(club_id) pour les deux tables.
//
// Visibilité Connect (Bible §17, migration-clubplus-v18/v30/v39.sql) : la présence d'une ligne
// media_access_rules pour un média donné détermine sa visibilité famille, jamais une colonne sur
// club_media/club_creations elles-mêmes. 4 états mappés sur MediaVisibility (aucune de ces
// valeurs n'était jusqu'ici lue depuis la base, seulement codée en dur) :
//   - "organization" (Privé Club+) : aucune ligne media_access_rules — jamais montré à Connect.
//   - "team"          (Affiliés du groupe) : ligne avec visibility_mode='team' (v39).
//   - "player"        (Sportifs sélectionnés) : ligne avec visibility_mode='players' (v39).
//   - "public"         (Automatique pour tous) : jamais produit ici — Bible §17 "interdit par
//     défaut" ; voir VisibilityEditor.tsx où cette option reste affichée mais désactivée.
// "private" (valeur du type MediaVisibility) n'a pas d'équivalent réel distinct
// d'"organization" dans ce schéma : jamais produit non plus.

const MEDIA_TYPE_MAP: Record<string, MediaAssetKind> = {
  photo: "photo",
  video: "video",
  document: "document",
  logo: "poster",
  creation: "poster",
};

interface ClubMediaRow {
  id: string;
  title: string;
  type: string;
  team: string | null;
  source: string;
  link: string | null;
  tags: string | null;
  author_name: string | null;
  created_at: string;
}

interface ClubCreationRow {
  id: string;
  title: string;
  type: string;
  team: string | null;
  status: string;
  sponsor: string | null;
  created_at: string;
}

const CREATION_STATUS_MAP: Record<string, MediaAssetStatus> = {
  brouillon: "to_validate",
  a_valider: "to_validate",
  valide: "validated",
  publie: "validated",
};

interface MediaAccessRuleVisibilityRow {
  media_ref_type: "club_media" | "club_creations";
  media_ref_id: string;
  visibility_mode: "team" | "players";
}

/** media_ref_type+media_ref_id -> MediaVisibility, pour tous les médias d'un club en un seul
 * aller-retour (plutôt qu'une requête par carte). Absence de ligne = "organization" (Privé
 * Club+, comportement fail-closed inchangé depuis v18 : pas de règle = pas de diffusion). */
async function fetchVisibilityByRef(supabase: SupabaseClient, organizationId: string): Promise<Map<string, MediaVisibility>> {
  const { data } = await supabase
    .from("media_access_rules")
    .select("media_ref_type, media_ref_id, visibility_mode")
    .eq("club_id", organizationId);

  const map = new Map<string, MediaVisibility>();
  for (const row of (data ?? []) as MediaAccessRuleVisibilityRow[]) {
    map.set(`${row.media_ref_type}:${row.media_ref_id}`, row.visibility_mode === "players" ? "player" : "team");
  }
  return map;
}

export async function fetchClubMediaAssets(supabase: SupabaseClient, organizationId: string): Promise<MediaAsset[]> {
  const [mediaRes, creationsRes, visibilityByRef] = await Promise.all([
    supabase
      .from("club_media")
      .select("id, title, type, team, source, link, tags, author_name, created_at")
      .eq("club_id", organizationId)
      .order("created_at", { ascending: false }),
    supabase
      .from("club_creations")
      .select("id, title, type, team, status, sponsor, created_at")
      .eq("club_id", organizationId)
      .order("created_at", { ascending: false }),
    fetchVisibilityByRef(supabase, organizationId),
  ]);

  const fromMedia: MediaAsset[] = ((mediaRes.data ?? []) as ClubMediaRow[]).map((row) => ({
    id: `media-${row.id}`,
    organizationId,
    name: row.title,
    kind: MEDIA_TYPE_MAP[row.type] ?? "document",
    mimeType: "",
    fileUrl: row.link ?? "",
    thumbnailUrl: row.link ?? "",
    sizeBytes: 0,
    aspectRatio: "4:3",
    teamId: row.team ?? undefined,
    authorName: row.author_name ?? undefined,
    storageOrigin: row.source === "sportvision" ? "sportvision_delivered" : row.source === "interne" ? "club_storage" : "external_link",
    usageRights: "",
    visibility: visibilityByRef.get(`club_media:${row.id}`) ?? "organization",
    downloadAllowed: true,
    version: 1,
    isFinalVersion: true,
    status: "validated",
    tags: row.tags ? row.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
    createdAt: row.created_at,
    revisionCount: 0,
    chapters: [],
    comments: [],
    versions: [],
  }));

  const fromCreations: MediaAsset[] = ((creationsRes.data ?? []) as ClubCreationRow[]).map((row) => ({
    id: `creation-${row.id}`,
    organizationId,
    name: row.title,
    kind: "poster",
    mimeType: "",
    fileUrl: "",
    thumbnailUrl: "",
    sizeBytes: 0,
    aspectRatio: "4:3",
    teamId: row.team ?? undefined,
    storageOrigin: "sportvision_delivered",
    usageRights: "",
    visibility: visibilityByRef.get(`club_creations:${row.id}`) ?? "organization",
    downloadAllowed: false,
    version: 1,
    isFinalVersion: row.status === "publie",
    status: CREATION_STATUS_MAP[row.status] ?? "to_validate",
    tags: row.sponsor ? [row.sponsor] : [],
    createdAt: row.created_at,
    revisionCount: 0,
    chapters: [],
    comments: [],
    versions: [],
  }));

  return [...fromMedia, ...fromCreations];
}

// ── Édition de la visibilité (Bible §17) ────────────────────────────────────────────────────

export type ContentVisibilityMode = "organization" | "team" | "player";

export interface MediaVisibilityDetail {
  mode: ContentVisibilityMode;
  teamId: string | null;
  selectedPlayerIds: string[];
}

interface MediaAssetRef {
  refType: "club_media" | "club_creations";
  refId: string;
}

/** asset.id vient de fetchClubMediaAssets ci-dessus (`media-<uuid>` / `creation-<uuid>`) — seul
 * endroit qui connaît ce préfixe, donc seul endroit qui doit savoir le retirer. */
export function parseMediaAssetRef(assetId: string): MediaAssetRef | null {
  if (assetId.startsWith("media-")) return { refType: "club_media", refId: assetId.slice("media-".length) };
  if (assetId.startsWith("creation-")) return { refType: "club_creations", refId: assetId.slice("creation-".length) };
  return null;
}

export async function fetchMediaVisibilityDetail(supabase: SupabaseClient, assetId: string): Promise<MediaVisibilityDetail> {
  const ref = parseMediaAssetRef(assetId);
  if (!ref) return { mode: "organization", teamId: null, selectedPlayerIds: [] };

  const { data: rule } = await supabase
    .from("media_access_rules")
    .select("team_id, visibility_mode")
    .eq("media_ref_type", ref.refType)
    .eq("media_ref_id", ref.refId)
    .maybeSingle();

  if (!rule) return { mode: "organization", teamId: null, selectedPlayerIds: [] };

  const row = rule as { team_id: string | null; visibility_mode: "team" | "players" };
  if (row.visibility_mode === "players") {
    const { data: players } = await supabase
      .from("media_access_selected_players")
      .select("player_id")
      .eq("media_ref_type", ref.refType)
      .eq("media_ref_id", ref.refId);
    return {
      mode: "player",
      teamId: row.team_id,
      selectedPlayerIds: ((players ?? []) as { player_id: string }[]).map((p) => p.player_id),
    };
  }
  return { mode: "team", teamId: row.team_id, selectedPlayerIds: [] };
}

export type MediaVisibilityWrite =
  | { mode: "organization" }
  | { mode: "team"; teamId: string }
  | { mode: "player"; playerIds: string[] };

/**
 * Écrit directement sur media_access_rules / media_access_selected_players — pas de RPC dédiée :
 * les policies mar_manager_insert/update/delete (migration-clubplus-v18.sql, jamais utilisées
 * depuis un client faute d'UI jusqu'ici) autorisent déjà is_club_admin(club_id) ou
 * is_team_educateur(team_id) à écrire cette table directement, exactement le mécanisme prévu
 * côté joueur/famille. Un utilisateur non autorisé reçoit une erreur RLS normale (voir l'appelant
 * pour le toast) — jamais un faux succès local.
 */
export async function setMediaVisibility(
  supabase: SupabaseClient,
  organizationId: string,
  assetId: string,
  next: MediaVisibilityWrite,
): Promise<void> {
  const ref = parseMediaAssetRef(assetId);
  if (!ref) throw new Error("Contenu invalide.");

  if (next.mode === "organization") {
    const { error } = await supabase
      .from("media_access_rules")
      .delete()
      .eq("media_ref_type", ref.refType)
      .eq("media_ref_id", ref.refId);
    if (error) throw error;
    return;
  }

  const { error: upsertError } = await supabase.from("media_access_rules").upsert(
    {
      club_id: organizationId,
      media_ref_type: ref.refType,
      media_ref_id: ref.refId,
      visibility_mode: next.mode === "team" ? "team" : "players",
      team_id: next.mode === "team" ? next.teamId : null,
      visible_joueur: true,
      visible_parent: true,
    },
    { onConflict: "media_ref_type,media_ref_id" },
  );
  if (upsertError) throw upsertError;

  // Toujours repartir d'une liste propre : passer de "players" à "team" (ou l'inverse) ne doit
  // jamais laisser une sélection de sportifs orpheline et invisible dans l'UI.
  const { error: deleteError } = await supabase
    .from("media_access_selected_players")
    .delete()
    .eq("media_ref_type", ref.refType)
    .eq("media_ref_id", ref.refId);
  if (deleteError) throw deleteError;

  if (next.mode === "player" && next.playerIds.length > 0) {
    const { error: insertError } = await supabase
      .from("media_access_selected_players")
      .insert(next.playerIds.map((playerId) => ({ media_ref_type: ref.refType, media_ref_id: ref.refId, player_id: playerId })));
    if (insertError) throw insertError;
  }
}

export interface ClubPlayerOption {
  id: string;
  name: string;
  teamName: string | null;
}

/** Sportifs actifs du club, pour le picker "Sportifs sélectionnés" — team_memberships (statut
 * actif) porte déjà club_id directement (migration-clubplus-v13.sql), pas besoin de passer par
 * club_teams pour scoper. is_club_admin(club_id) lit tout le club (pp_admin_select/tm_admin_select,
 * v13) ; un éducateur ne verrait que ses propres équipes (tm_educateur_select) — c'est le même
 * garde-fou naturel qu'ailleurs dans l'app, pas quelque chose à reproduire ici. */
export async function fetchClubPlayersForVisibility(supabase: SupabaseClient, organizationId: string): Promise<ClubPlayerOption[]> {
  const { data } = await supabase
    .from("team_memberships")
    .select("player_id, club_teams(name), player_profiles(id, prenom, nom)")
    .eq("club_id", organizationId)
    .eq("statut", "active");

  type Row = { player_id: string; club_teams: { name: string } | null; player_profiles: { id: string; prenom: string; nom: string } | null };
  const byPlayer = new Map<string, ClubPlayerOption>();
  for (const row of ((data ?? []) as unknown as Row[])) {
    if (!row.player_profiles) continue;
    if (byPlayer.has(row.player_id)) continue; // un sportif peut être dans plusieurs équipes
    byPlayer.set(row.player_id, {
      id: row.player_profiles.id,
      name: `${row.player_profiles.prenom} ${row.player_profiles.nom}`.trim(),
      teamName: row.club_teams?.name ?? null,
    });
  }
  return Array.from(byPlayer.values()).sort((a, b) => a.name.localeCompare(b.name, "fr"));
}
