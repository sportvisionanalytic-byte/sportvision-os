import type { SupabaseClient } from "@supabase/supabase-js";
import type { MediaAsset, MediaAssetKind } from "@/lib/types/content";

// client_media_livrables (vue, migration-portail-v5.sql) — fail-closed : ne montre que les
// livrables au statut 'livre'/'consulte' (jointure media_livrables + prestations + media_liens).
// Lecture seule, aucune écriture côté client sur ce module. RLS : filtrée via client_users
// (organization_id = clients.id pour un espace projet).

const KIND_KEYWORDS: [string, MediaAssetKind][] = [
  ["vidéo", "video"],
  ["video", "video"],
  ["photo", "photo"],
  ["document", "document"],
  ["pdf", "document"],
];

function guessKind(typeLivrable: string | null): MediaAssetKind {
  const lower = (typeLivrable ?? "").toLowerCase();
  for (const [keyword, kind] of KIND_KEYWORDS) {
    if (lower.includes(keyword)) return kind;
  }
  return "document";
}

interface LivrableRow {
  id: string;
  prestation_id: string;
  nom: string;
  type_livrable: string | null;
  format: string | null;
  date_validation: string | null;
  date_expiration: string | null;
  statut: string;
  created_at: string;
  lien_url: string | null;
}

export async function fetchClientLivrables(supabase: SupabaseClient, organizationId: string): Promise<MediaAsset[]> {
  const { data } = await supabase
    .from("client_media_livrables")
    .select("id, prestation_id, nom, type_livrable, format, date_validation, date_expiration, statut, created_at, lien_url")
    .order("created_at", { ascending: false });

  return ((data ?? []) as LivrableRow[]).map((row) => ({
    id: row.id,
    organizationId,
    name: row.nom,
    kind: guessKind(row.type_livrable),
    mimeType: "",
    fileUrl: row.lien_url ?? "",
    thumbnailUrl: row.lien_url ?? "",
    sizeBytes: 0,
    aspectRatio: row.format ?? "4:3",
    serviceId: row.prestation_id,
    storageOrigin: "sportvision_delivered",
    usageRights: "",
    visibility: "organization",
    downloadAllowed: true,
    availableUntil: row.date_expiration ?? undefined,
    version: 1,
    isFinalVersion: true,
    status: "validated",
    tags: [],
    createdAt: row.created_at,
    revisionCount: 0,
    chapters: [],
    comments: [],
    versions: [],
  }));
}
