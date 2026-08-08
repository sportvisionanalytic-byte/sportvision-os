import type { SupabaseClient } from "@supabase/supabase-js";
import type { MediaAsset, MediaAssetKind, MediaAssetStatus } from "@/lib/types/content";

// club_media (migration-clubplus-v7.sql) + club_creations (v8) — schéma réel bien plus mince que
// MediaAsset du design (pas de versions/commentaires/chapitres/dimensions réelles). Voir le plan
// Phase 1 : les champs sans équivalent réel reçoivent une valeur par défaut sûre documentée
// ci-dessous plutôt que d'être inventés. RLS : is_club_member(club_id) pour les deux tables.

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

export async function fetchClubMediaAssets(supabase: SupabaseClient, organizationId: string): Promise<MediaAsset[]> {
  const [mediaRes, creationsRes] = await Promise.all([
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
    visibility: "organization",
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
    visibility: "organization",
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
