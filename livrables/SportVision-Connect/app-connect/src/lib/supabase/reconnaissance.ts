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
  /** L'aperçu SANS filigrane, dans le bucket privé. Rendu par la base UNIQUEMENT à qui y a droit :
   *  le staff, le coach et le community manager du club, et les familles qui ont pris le Pass
   *  (v281). `null` ailleurs, et l'écran sert alors l'aperçu public, filigrané. */
  previewNetPath: string | null;
  /** L'adresse signée de cet aperçu net, prête pour une balise image. `null` quand il n'y a pas
   *  d'aperçu net, ou quand la signature a échoué : l'écran sert alors le public. */
  previewNetUrl: string | null;
}

/** 26/09/2026 — La base rend au plus QUATRE photos à qui n'a pas pris le Pass (v282), et le vrai
 *  total à côté. Les deux comptent : sans le total, l'écran dirait « 0 autre photo » et laisserait
 *  croire qu'il n'y en a pas plus, ce qui est l'inverse de l'effet voulu. */
export interface PhotosDuJoueur {
  photos: PhotoDuJoueur[];
  total: number;
}

export async function fetchPhotosDuJoueur(
  supabase: SupabaseClient,
  albumId: string,
  playerId: string,
): Promise<PhotosDuJoueur> {
  const { data, error } = await supabase.rpc("media_photos_du_joueur", {
    p_album_id: albumId,
    p_player_id: playerId,
  });
  if (error || !Array.isArray(data)) return { photos: [], total: 0 };
  type Ligne = {
    asset_id: string; preview_path: string | null; thumb_path: string | null;
    preview_clair_path: string | null; total: number | null;
  };
  const lignes = data as Ligne[];

  // POURQUOI SIGNER ICI. L'aperçu net vit dans un bucket privé : une balise <img> n'y a pas accès,
  // le point d'accès authentifié veut un en-tête que le navigateur n'envoie pas sur une image. On
  // demande donc des adresses signées, et la signature elle-même passe par la politique de lecture
  // (v281) : un compte sans droit n'obtient rien, même en connaissant le chemin.
  //
  // Un seul appel pour toute la galerie. Et si la signature échoue, ce n'est pas une erreur d'écran :
  // on retombe sur l'aperçu public, filigrané. Mieux vaut une photo barrée qu'une case vide.
  const aSigner = lignes.map((r) => r.preview_clair_path).filter((c): c is string => !!c);
  const signees = new Map<string, string>();
  if (aSigner.length) {
    const { data: urls } = await supabase.storage
      .from("sportvision-media-prive")
      .createSignedUrls(aSigner, 60 * 60);
    for (const u of urls ?? []) {
      if (u?.path && u?.signedUrl) signees.set(u.path, u.signedUrl);
    }
  }

  return {
    photos: lignes.map((r) => ({
      assetId: r.asset_id,
      previewPath: r.preview_path,
      thumbPath: r.thumb_path,
      previewNetPath: r.preview_clair_path,
      previewNetUrl: (r.preview_clair_path && signees.get(r.preview_clair_path)) || null,
    })),
    // Le total vient de la base, jamais de la longueur de la liste.
    total: Number(lignes[0]?.total ?? lignes.length),
  };
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
