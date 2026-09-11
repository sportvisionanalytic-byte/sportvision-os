// Reconnaissance du visage de l'enfant : état de l'accord de la famille (migrations v159 et v161).
// La photo déposée n'est jamais relue par l'application : elle part au stockage privé et seule
// l'Administration SportVision peut y accéder, pour répondre à une demande RGPD.
import type { SupabaseClient } from "@supabase/supabase-js";

// Version du texte de consentement affiché. Elle est enregistrée avec l'accord : si le texte de
// livrables/juridique/consentement-reconnaissance-enfant.md change, cette constante change aussi,
// sinon on ne sait plus ce que les familles ont accepté.
export const VERSION_TEXTE_CONSENTEMENT = "v1-2026-09";

export const BUCKET_VISAGES = "sportvision-media-prive";

export interface EtatConsentement {
  autorise: boolean;
  statut: "aucun" | "accorde";
  consentement_id?: string;
  accorde_le?: string;
  qualite?: "parent" | "tuteur" | "joueur_majeur";
  texte_version?: string;
  photo_deposee?: boolean;
  retire_le?: string | null;
}

export async function lireEtatConsentement(
  supabase: SupabaseClient,
  playerId: string,
): Promise<EtatConsentement | null> {
  const { data } = await supabase.rpc("mon_consentement_biometrie", { p_player_id: playerId });
  return (data as EtatConsentement | null) ?? null;
}

// Une photo trop lourde ou dans un format exotique fait échouer le dépôt côté stockage sans message
// utile : on tranche ici, avec une phrase que le parent comprend.
export const TAILLE_MAX_PHOTO = 8 * 1024 * 1024;
export const FORMATS_PHOTO = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

export function refuserPhoto(fichier: File): string | null {
  if (!FORMATS_PHOTO.includes(fichier.type)) {
    return "Format non accepté. Déposez une photo au format JPEG, PNG ou HEIC.";
  }
  if (fichier.size > TAILLE_MAX_PHOTO) {
    return "Photo trop lourde (8 Mo maximum). Réduisez-la ou prenez-en une plus légère.";
  }
  return null;
}

export function extensionDe(fichier: File): string {
  const parExtension = fichier.name.includes(".") ? fichier.name.split(".").pop()!.toLowerCase() : "";
  if (parExtension && /^[a-z0-9]{2,5}$/.test(parExtension)) return parExtension;
  if (fichier.type === "image/png") return "png";
  if (fichier.type === "image/webp") return "webp";
  return "jpg";
}

// ── Les photos de mon enfant dans une galerie (v160/v162) ──────────────────
// La base ne rend que les rattachements VALIDÉS, et seulement à la famille de l'enfant : une
// suggestion de machine non tranchée n'apparaît nulle part ici.
export interface PhotoDuJoueur {
  assetId: string;
  previewPath: string | null;
  thumbPath: string | null;
}

export async function fetchPhotosDuJoueur(
  supabase: SupabaseClient,
  albumId: string,
  playerId: string,
): Promise<PhotoDuJoueur[]> {
  const { data, error } = await supabase.rpc("media_photos_du_joueur", {
    p_album_id: albumId,
    p_player_id: playerId,
  });
  if (error || !Array.isArray(data)) return [];
  return (data as { asset_id: string; preview_path: string | null; thumb_path: string | null }[]).map((r) => ({
    assetId: r.asset_id,
    previewPath: r.preview_path,
    thumbPath: r.thumb_path,
  }));
}

/** Combien de photos de cet enfant dans chaque galerie. Une galerie sans aucune photo de lui ne
 *  reçoit rien : l'écran n'affiche alors aucun compteur plutôt qu'un « 0 photo » décourageant. */
export async function fetchComptesPhotosDuJoueur(
  supabase: SupabaseClient,
  albumIds: string[],
  playerId: string,
): Promise<Map<string, number>> {
  const comptes = new Map<string, number>();
  const resultats = await Promise.all(
    albumIds.map(async (id) => {
      const { data, error } = await supabase.rpc("media_compte_photos_du_joueur", {
        p_album_id: id,
        p_player_id: playerId,
      });
      return { id, n: error ? 0 : Number(data ?? 0) };
    }),
  );
  for (const r of resultats) if (r.n > 0) comptes.set(r.id, r.n);
  return comptes;
}
