// LES GALERIES DU CLUB (30/09/2026).
//
// LES MÊMES ALBUMS QUE L'OS ET QUE LA GALERIE PUBLIQUE. `media_club_galleries(club)` est une vue de
// lecture sur `media_albums` : aucune copie, aucune table dédiée. Le club ne voit que les liens
// qu'on lui a explicitement confiés — le lien « équipe adverse » et les liens internes ne
// remontent pas.
//
// == LE CLUB NE DIFFUSE PLUS DE LIEN, ET ON NE LE RÉOUVRE PAS ================================
//
// Depuis la v285 (26/09/2026), le JETON d'un lien de galerie n'arrive plus jusqu'au club : sans
// lui, l'adresse est inutilisable, et c'est le but. Club+ a supprimé sa fonction `url()` et son
// bouton « copier » le même jour. Fouka l'a demandé dans ces termes : « il faut que ce lien ne
// soit pas envoyable. »
//
// Cet écran affiche donc CE QUI EXISTE, jamais une adresse partageable : pas de bouton copier, pas
// de partage système, aucune reconstruction d'URL à partir du slug. Diffuser une galerie est une
// décision de SportVision, pas un geste qu'on fait depuis un téléphone.
//
// LE FILIGRANE SUIT LA MÊME RÈGLE QUE PARTOUT. L'aperçu net vit dans un bucket privé et demande
// une adresse signée ; une signature qui échoue n'est pas une erreur d'écran, on retombe sur
// l'aperçu public, filigrané. Exactement ce que fait la page du site.
import { supabase } from "./supabase";
import { SUPABASE_URL } from "./config";
import { ErreurChargement, refermerSiPerdue } from "./donnees";

const BUCKET_PUBLIC = "galerie-previews";
const BUCKET_PRIVE = "sportvision-media-prive";

export interface GalerieClub {
  id: string;
  titre: string;
  equipe: string | null;
  date: string | null;
  couvertureUrl: string | null;
  nbPhotos: number;
  publiee: boolean;
  /** Le nombre de liens confiés au club. On les compte, on ne les rend pas diffusables. */
  nbLiens: number;
}

export async function lireGaleriesClub(clubId: string): Promise<GalerieClub[]> {
  const { data, error } = await supabase.rpc("media_club_galleries", { p_club_id: clubId });
  if (error) {
    await refermerSiPerdue(error);
    throw new ErreurChargement(error);
  }
  type Ligne = {
    album_id: string; titre: string | null; equipe: string | null; event_date: string | null;
    cover_url: string | null; cover_path: string | null; photos: number | null;
    publie: boolean | null; liens: { is_enabled?: boolean }[] | null;
  };
  return ((data ?? []) as Ligne[]).map((r) => ({
    id: String(r.album_id),
    titre: r.titre ?? "Galerie",
    equipe: r.equipe ?? null,
    date: r.event_date ?? null,
    couvertureUrl: r.cover_url ?? (r.cover_path ? `${SUPABASE_URL}/storage/v1/object/public/${BUCKET_PUBLIC}/${r.cover_path}` : null),
    nbPhotos: typeof r.photos === "number" ? r.photos : 0,
    publiee: r.publie === true,
    nbLiens: Array.isArray(r.liens) ? r.liens.filter((l) => l?.is_enabled !== false).length : 0,
  }));
}

export interface PhotoGalerie {
  id: string;
  url: string;
  /** Vrai si c'est l'aperçu sans filigrane. Sert à le DIRE, pas à décider d'un droit. */
  net: boolean;
  /** Le rapport largeur/hauteur, pour que la grille ne saute pas pendant le chargement. */
  ratio: number;
}

/**
 * Une page de photos.
 *
 * ON PAGINE, ET CE N'EST PAS UNE PRÉCAUTION DE STYLE : les galeries réelles de RCP Fontainebleau
 * comptent 85 et 134 photos, et une galerie de tournoi en compte plusieurs centaines. Tout charger
 * d'un coup, au bord d'un terrain en 4G, c'est un écran blanc de plusieurs secondes.
 */
export async function lirePhotosGalerie(albumId: string, page = 0, parPage = 60): Promise<PhotoGalerie[]> {
  const { data, error } = await supabase.rpc("media_club_gallery_photos", {
    p_album_id: albumId, p_limit: parPage, p_offset: page * parPage,
  });
  if (error) {
    await refermerSiPerdue(error);
    throw new ErreurChargement(error);
  }

  type Ligne = {
    id: string; thumb_path: string | null; preview_path: string | null;
    preview_clair_path: string | null; width: number | null; height: number | null;
  };
  const lignes = (data ?? []) as Ligne[];

  // Un seul appel de signature pour toute la page, jamais un par photo : soixante allers-retours
  // pour afficher une grille, c'est la grille qui n'arrive pas.
  const aSigner = lignes.map((r) => r.preview_clair_path).filter((c): c is string => !!c);
  const signees = new Map<string, string>();
  if (aSigner.length) {
    try {
      const { data: urls } = await supabase.storage.from(BUCKET_PRIVE).createSignedUrls(aSigner, 3600);
      for (const u of urls ?? []) if (u?.path && u?.signedUrl) signees.set(u.path, u.signedUrl);
    } catch { /* on retombe sur l'aperçu public, filigrané : ce n'est pas une panne d'écran */ }
  }

  return lignes.map((r) => {
    const net = r.preview_clair_path ? signees.get(r.preview_clair_path) ?? null : null;
    const publique = r.preview_path ?? r.thumb_path ?? "";
    const l = r.width ?? 0, h = r.height ?? 0;
    return {
      id: String(r.id),
      url: net ?? `${SUPABASE_URL}/storage/v1/object/public/${BUCKET_PUBLIC}/${publique}`,
      net: !!net,
      // Les photos réelles sont en 4000×6000 : sans ce garde-fou, une largeur ou une hauteur
      // manquante donnerait une division par zéro et une case de hauteur infinie.
      ratio: l > 0 && h > 0 ? l / h : 1,
    };
  });
}
