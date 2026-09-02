import type { SupabaseClient } from "@supabase/supabase-js";

// Lecture seule côté Club+ du modèle de commercialisation média (master prompt Fouka, §15-16,
// migration-media-v1-moteur-generique.sql du 02/09/2026) — le club CONSULTE sa politique et son
// catalogue, configurés uniquement depuis SportVision OS (media_staff_write, admin/sec). Aucune
// écriture depuis ce fichier, volontairement : "par défaut, Admin SportVision configure, le club
// consulte" (§15).

export interface ClubMediaPolicy {
  defaultPolicy: string;
  status: "draft" | "active" | "paused" | "ended";
  revenueSharePct: number | null;
}

export const MEDIA_POLICY_LABELS: Record<string, string> = {
  gratuit: "Gratuit",
  pass_saison: "Pass Saison",
  vente_unite: "Vente à l'unité",
  vente_pack: "Vente par pack",
  evenementiel: "Vente événementielle",
  hybride: "Hybride",
};

export interface ClubMediaProduct {
  id: string;
  name: string;
  type: string;
  priceCents: number;
  currency: string;
  status: "draft" | "active" | "paused" | "ended";
}

export const MEDIA_PRODUCT_TYPE_LABELS: Record<string, string> = {
  pass_saison: "Pass Saison",
  photo_unite: "Photo à l'unité",
  pack: "Pack",
  album_complet: "Album complet",
  evenementiel: "Produit événementiel",
  physique: "Produit physique",
  autre: "Autre",
};

/** Saison actuelle du club — clubs.saison_id, tenu à jour automatiquement par trigger dès que
 * clubs.saison (texte) est écrit ailleurs (voir migration-media-v1). */
export async function fetchClubCurrentSaisonId(supabase: SupabaseClient, clubId: string): Promise<string | null> {
  const { data, error } = await supabase.from("clubs").select("saison_id").eq("id", clubId).maybeSingle();
  if (error || !data) return null;
  return data.saison_id;
}

export async function fetchClubMediaPolicy(supabase: SupabaseClient, clubId: string, saisonId: string): Promise<ClubMediaPolicy | null> {
  const { data, error } = await supabase
    .from("media_club_policy")
    .select("default_policy, status, revenue_share_pct")
    .eq("club_id", clubId)
    .eq("saison_id", saisonId)
    .maybeSingle();
  if (error || !data) return null;
  return { defaultPolicy: data.default_policy, status: data.status, revenueSharePct: data.revenue_share_pct };
}

export async function fetchClubMediaProducts(supabase: SupabaseClient, clubId: string, saisonId: string): Promise<ClubMediaProduct[]> {
  const { data, error } = await supabase
    .from("media_products")
    .select("id, name, type, price_cents, currency, status")
    .eq("club_id", clubId)
    .eq("saison_id", saisonId)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data.map((p) => ({ id: p.id, name: p.name, type: p.type, priceCents: p.price_cents, currency: p.currency, status: p.status }));
}

export interface ClubMediaStats {
  activeEntitlements: number;
  publishedAlbums: number;
}

/** KPI réels uniquement — jamais de faux chiffre affiché (§16 : "Ne jamais afficher de faux
 * KPI"). Passe par la RPC club_media_stats (comptages agrégés) plutôt qu'un SELECT direct :
 * media_entitlements n'a volontairement aucune policy RLS pour un club_member, pour ne jamais
 * exposer "qui a acheté quoi" à l'admin du club (migration-media-v2-club-stats-rpc.sql). */
export async function fetchClubMediaStats(supabase: SupabaseClient, clubId: string, saisonId: string): Promise<ClubMediaStats> {
  const { data, error } = await supabase.rpc("club_media_stats", { p_club_id: clubId, p_saison_id: saisonId });
  if (error || !data) return { activeEntitlements: 0, publishedAlbums: 0 };
  return { activeEntitlements: data.active_entitlements ?? 0, publishedAlbums: data.published_albums ?? 0 };
}
