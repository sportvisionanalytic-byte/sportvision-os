import type { SupabaseClient } from "@supabase/supabase-js";

// 19/08/2026 (audit pré-lancement) : settings/organization/page.tsx était intégralement en
// lecture seule faute de colonnes réelles (clubs.adresse/instagram_handle/siret/couleur_primaire/
// couleur_secondaire, migration-clubplus-v46-organisation-editable.sql) et de bucket Storage pour
// le logo (clubs.logo_url existait déjà depuis migration-clubplus-v10.sql mais n'était utilisé
// nulle part — migration-clubplus-v47-club-logo-storage.sql crée le bucket `club-logos`). Le droit
// d'écriture existait déjà côté RLS (clubs_admin_update, USING is_club_admin(id)) : c'est
// uniquement l'absence de colonnes/bucket qui bloquait, pas un manque de policy.

export interface UpdateClubOrganizationInput {
  adresse?: string;
  instagramHandle?: string;
  siret?: string;
  couleurPrimaire?: string;
  couleurSecondaire?: string;
}

export async function updateClubOrganization(
  supabase: SupabaseClient,
  clubId: string,
  input: UpdateClubOrganizationInput,
): Promise<void> {
  const { error } = await supabase
    .from("clubs")
    .update({
      adresse: input.adresse?.trim() || null,
      instagram_handle: input.instagramHandle?.trim() || null,
      siret: input.siret?.trim() || null,
      couleur_primaire: input.couleurPrimaire || null,
      couleur_secondaire: input.couleurSecondaire || null,
    })
    .eq("id", clubId);
  if (error) throw error;
}

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const ACCEPTED_LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

/**
 * Chemin fixe `{clubId}/logo.{ext}` (voir migration-clubplus-v47) : un seul logo par club,
 * écrasé à chaque nouvel upload — jamais accumulé, jamais à nettoyer séparément.
 */
export async function uploadClubLogo(supabase: SupabaseClient, clubId: string, file: File): Promise<string> {
  if (!ACCEPTED_LOGO_TYPES.includes(file.type)) {
    throw new Error("Format non accepté (PNG, JPEG, WebP ou SVG uniquement).");
  }
  if (file.size > MAX_LOGO_BYTES) {
    throw new Error("Fichier trop volumineux (2 Mo maximum).");
  }

  const ext = file.type === "image/svg+xml" ? "svg" : file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${clubId}/logo.${ext}`;

  const { error: uploadError } = await supabase.storage.from("club-logos").upload(path, file, {
    upsert: true,
    contentType: file.type,
  });
  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from("club-logos").getPublicUrl(path);
  // Cache-bust : le chemin est fixe (toujours logo.<ext>), sans ce paramètre le navigateur
  // continuerait d'afficher l'ancien logo en cache après un remplacement.
  const publicUrl = `${data.publicUrl}?v=${Date.now()}`;

  const { error: updateError } = await supabase.from("clubs").update({ logo_url: publicUrl }).eq("id", clubId);
  if (updateError) throw updateError;

  return publicUrl;
}
