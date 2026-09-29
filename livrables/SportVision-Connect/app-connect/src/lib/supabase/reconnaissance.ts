// Reconnaissance du visage de l'enfant : état de l'accord de la famille (migrations v159 et v161).
// La photo déposée n'est jamais relue par l'application : elle part au stockage privé et seule
// l'Administration SportVision peut y accéder, pour répondre à une demande RGPD.
import type { SupabaseClient } from "@supabase/supabase-js";

// Version du texte de consentement affiché. Elle est enregistrée avec l'accord : si le texte de
// livrables/juridique/consentement-reconnaissance-enfant.md change, cette constante change aussi,
// sinon on ne sait plus ce que les familles ont accepté.
// v2 (28/09/2026) — LE TEXTE A CHANGE, DONC LE NUMERO AUSSI.
//
// Decision de Fouka : une photo que la famille confirme (« oui c'est bien moi ») sert desormais a
// mieux retrouver le sportif ensuite, et son empreinte est conservee. C'est un changement
// SUBSTANTIEL du traitement — des donnees biometriques, souvent de mineurs — et l'ancien texte
// disait l'inverse : « la photo que vous deposez et son empreinte. Rien d'autre. »
//
// Un accord donne sur v1 ne couvre donc pas ce traitement, et la base le verifie : la v334 ne
// conserve rien tant que l'accord n'est pas en v2. Les familles deja inscrites gardent l'ancien
// comportement jusqu'a ce qu'elles redonnent leur accord, en connaissance de cause. Ne jamais
// modifier ce texte sans changer ce numero : c'est lui qui dit ce que chacun a accepte.
export const VERSION_TEXTE_CONSENTEMENT = "v2-2026-09";

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

export interface PhotoReference {
  id: string;
  storage_path: string | null;
  created_at: string;
  a_une_empreinte: boolean;
}

/** Les photos de référence déjà déposées. Tant qu'il n'y en avait qu'une, un booléen suffisait ;
 *  depuis la v332 il peut y en avoir plusieurs, et l'écran doit pouvoir les montrer et en retirer
 *  une. `player_face_refs` n'étant lisible que d'un administrateur, la v333 a posé cette fonction. */
export async function listerPhotosReference(
  supabase: SupabaseClient,
  playerId: string,
): Promise<PhotoReference[]> {
  const { data } = await supabase.rpc("photos_de_reference_du_sportif", { p_player_id: playerId });
  return Array.isArray(data) ? (data as PhotoReference[]) : [];
}

/** Retirer une photo ratée. Sans ce geste, la limite de cinq deviendrait un mur.
 *
 *  Rend `null` quand c'est fait, et sinon l'erreur telle quelle : c'est l'écran qui décide ce qu'il
 *  en montre (voir messageErreurBase ci-dessous). La base explique par exemple qu'on ne retire pas
 *  la photo d'un sportif qui n'est pas le sien — une phrase que « réessayez » faisait disparaître. */
export async function retirerPhotoReference(
  supabase: SupabaseClient,
  faceRefId: string,
): Promise<{ message?: string } | null> {
  const { error } = await supabase.rpc("retirer_photo_reference", { p_face_ref_id: faceRefId });
  return error ?? null;
}

// Les refus de ces fonctions se lisent tels quels : voir messageErreurBase dans
// lib/supabase/erreurs-serveur.ts, et l'écran ReconnaissanceView qui l'emploie.

export const PHOTOS_REFERENCE_MAX = 5;

export async function lireEtatConsentement(
  supabase: SupabaseClient,
  playerId: string,
): Promise<EtatConsentement | null> {
  const { data } = await supabase.rpc("mon_consentement_biometrie", { p_player_id: playerId });
  return (data as EtatConsentement | null) ?? null;
}

// Une photo trop lourde ou dans un format exotique fait échouer le dépôt côté stockage sans message
// utile : on tranche ici, avec une phrase que le parent comprend.
//
// 25 Mo DEPUIS LE 29/09/2026. La limite était à 8, et Fouka s'est fait refuser ses propres photos :
// un iPhone récent sort des clichés de 5 à 12 Mo, et une photo prise en gros plan ou en ProRAW
// dépasse allègrement. Refuser la photo qu'on vient de demander à quelqu'un, c'est perdre le
// dépôt — et sans dépôt, aucune reconnaissance.
// Le seau de stockage accepte 50 Mo : on reste donc sous sa limite, avec de la marge des deux côtés.
export const TAILLE_MAX_PHOTO = 25 * 1024 * 1024;
export const FORMATS_PHOTO = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

export function refuserPhoto(fichier: File): string | null {
  if (!FORMATS_PHOTO.includes(fichier.type)) {
    return "Format non accepté. Déposez une photo au format JPEG, PNG ou HEIC.";
  }
  if (fichier.size > TAILLE_MAX_PHOTO) {
    return "Photo trop lourde (25 Mo maximum). Réduisez-la ou prenez-en une plus légère.";
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
  /**
   * 27/09/2026 (v299) — Ce ne sont PAS les photos de ce sportif, mais quatre photos de la galerie,
   * filigranées, que la base rend tant que la famille n'a ni Pass ni photo marquée. L'écran doit le
   * dire : en production il y avait 3 399 photos en ligne et ZÉRO marquage, donc l'écran restait
   * vide et ne donnait aucune raison d'acheter. Annoncer « ses photos » devant ces quatre-là ferait
   * chercher son enfant dans des photos d'ambiance.
   */
  apercuGalerie: boolean;
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
  if (error || !Array.isArray(data)) return { photos: [], total: 0, apercuGalerie: false };
  type Ligne = {
    asset_id: string; preview_path: string | null; thumb_path: string | null;
    preview_clair_path: string | null; total: number | null; apercu_galerie: boolean | null;
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
    apercuGalerie: lignes.some((r) => r.apercu_galerie === true),
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
