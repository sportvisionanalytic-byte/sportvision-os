// LES GALERIES PHOTO, VUES DE L'APPLICATION (30/09/2026).
//
// == CE QU'UN OPÉRATEUR VOIT, MESURÉ AVANT D'ÉCRIRE ===========================================
//
// La base compte 57 galeries et 7 784 photos. Un opérateur en voit ZÉRO aujourd'hui, et ce n'est
// pas un défaut de cet écran : `photographe_voit_album(id)` — la policy RESTRICTIVE
// `malbums_photographe_perimetre` — ouvre une galerie à un opérateur seulement si
//   · il l'a créée lui-même (`created_by`), ou
//   · elle est rattachée à une de ses missions (`mission_id` → `prestations_equipe`).
// Mesuré : `mission_id` est NULL sur 57 galeries sur 57, et les 57 ont été créées par un profil
// `prod` (47) ou `admin` (10). Aucune ne coche donc l'une des deux conditions.
//
// ON NE CONTOURNE PAS, ET ON NE FILTRE PAS UNE SECONDE FOIS. La même requête sert les deux
// métiers : un responsable de production reçoit les 57 galeries (mesuré), un opérateur reçoit les
// siennes. C'est la base qui trie, cet écran n'a aucune règle de périmètre. La leçon du 30/09 sur
// les galeries de Club+ est explicite : un filtre recopié côté écran s'est révélé redondant ET
// faux, parce qu'il regardait un champ de moins que la base.
//
// L'ÉCRAN DIT DONC POURQUOI IL EST VIDE, avec la vraie raison : une galerie n'appartient à un
// opérateur que si elle est rattachée à sa mission, et la chaîne qui fait ce rattachement (v154)
// n'a encore rempli aucune ligne.
//
// == LES APERÇUS : `storage_bucket` NE DIT PAS OÙ EST L'APERÇU ==================================
//
// Piège mesuré, qui aurait cassé 66 % de la grille. `media_assets.storage_bucket` vaut `r2` sur
// 5 117 photos et `sportvision-media-prive` sur 2 667 : c'est l'emplacement de l'ORIGINAL, pas
// celui de l'aperçu. Compté objet par objet dans `storage.objects` : `preview_path` et
// `thumb_path` sont dans le bucket PUBLIC `galerie-previews` pour 7 777 photos sur 7 777, quel que
// soit `storage_bucket`. Se fier à cette colonne aurait produit une grille grise pour les deux
// tiers des photos.
//
// L'aperçu NET (`preview_clair_path`, 4 921 photos sur 7 784) vit, lui, dans le bucket PRIVÉ et
// demande une adresse signée. Une signature qui échoue n'est pas une panne d'écran : on retombe
// sur l'aperçu public, filigrané. Exactement ce que fait l'application des familles.
//
// == CE QUI N'EST PAS ICI, ET POURQUOI ========================================================
//
// `media_club_galleries()` / `media_club_gallery_photos()` sont la porte du CLUB, pas la nôtre :
// leur première ligne est `if not (is_club_member(p_club_id) or p_club_id in
// (select cm_clubs_autorises())) then return;`. Un opérateur terrain n'est ni l'un ni l'autre,
// elles lui rendraient toujours zéro ligne. On lit donc les tables, que la RLS borne déjà.
import { supabase } from "./supabase";
import { SUPABASE_URL } from "./config";

/** Le bucket PUBLIC des aperçus. Vrai pour les 7 777 photos servies, cf. l'en-tête. */
const BUCKET_PUBLIC = "galerie-previews";
/** Le bucket PRIVÉ, où vit l'aperçu sans filigrane. Demande une adresse signée. */
const BUCKET_PRIVE = "sportvision-media-prive";

export interface Galerie {
  id: string;
  titre: string;
  date: string | null;
  /**
   * La catégorie, quand la galerie en porte une. Mesuré : `team_id` n'est rempli que sur 16
   * galeries sur 57, et `structure_externe` sur 27. On n'écrit donc JAMAIS « catégorie non
   * renseignée » : ce serait quarante fois de suite la même ligne inutile. La leçon du 30/09 sur
   * `club_teams.members`, à zéro sur les 55 équipes.
   */
  categorie: string | null;
  nbPhotos: number;
  archivee: boolean;
  /** La référence de la mission, quand la galerie y est rattachée. Zéro cas aujourd'hui. */
  reference: string | null;
}

/**
 * Mes galeries.
 *
 * `clubs ( nom )` N'EST PAS EMBARQUÉ, ET C'EST MESURÉ : un profil `photo` voit 0 club sur 2 (la
 * RLS de `clubs` ne l'ouvre pas au staff terrain), là où un `prod` en voit 2. Embarquer le nom du
 * club aurait donc donné un écran garni pour la production et un tiret pour l'opérateur — deux
 * écrans pour la même donnée. `club_teams`, lui, est lisible par tout le staff (`ctm_staff_select`
 * = `is_staff()`, vérifié à 73 équipes avec le jeton d'Antoine).
 */
export async function lireMesGaleries(): Promise<Galerie[]> {
  const { data, error } = await supabase
    .from("media_albums")
    .select("id, title, event_date, status, photo_count, structure_externe, club_teams ( name ), prestations ( reference )")
    // Les plus récentes d'abord : on vient vérifier ce qu'on a livré hier, pas en février.
    .order("event_date", { ascending: false, nullsFirst: false })
    // 57 galeries aujourd'hui. Le plafond est là pour que la page ne grossisse pas sans limite
    // avec la saison, pas parce qu'il serait atteint.
    .limit(200);
  if (error) throw error;

  type Ligne = {
    id: string; title: string | null; event_date: string | null; status: string | null;
    photo_count: number | null; structure_externe: string | null;
    club_teams: { name: string | null } | null;
    prestations: { reference: string | null } | null;
  };

  return ((data ?? []) as unknown as Ligne[]).map((r) => ({
    id: String(r.id),
    titre: (r.title ?? "").trim() || "Galerie",
    date: r.event_date ?? null,
    categorie: (r.club_teams?.name ?? r.structure_externe ?? "").trim() || null,
    // `photo_count` est un compteur dénormalisé, et il dérive : mesuré faux sur 1 galerie sur 57
    // (46 annoncées, 47 réelles). Il reste bon pour une liste — l'écran de la galerie, lui,
    // compte les vraies lignes.
    nbPhotos: typeof r.photo_count === "number" ? r.photo_count : 0,
    // Le statut, pas `archived_at` : mesuré, 4 galeries portent status='archived' et AUCUNE n'a
    // de `archived_at`. Les deux champs ne disent pas la même chose, seul le statut est tenu.
    archivee: r.status === "archived",
    reference: r.prestations?.reference ?? null,
  }));
}

export interface PhotoGalerie {
  id: string;
  url: string;
  /** Vrai si c'est l'aperçu sans filigrane. Sert à le DIRE, jamais à décider d'un droit. */
  net: boolean;
  /** Le rapport largeur/hauteur, pour que l'agrandissement ne déforme pas. */
  ratio: number;
}

export interface PagePhotos {
  photos: PhotoGalerie[];
  /** Le VRAI total de la galerie, compté par la base. Pas `photo_count`, qui dérive. */
  total: number;
}

/**
 * Une page de photos.
 *
 * ON PAGINE, ET CE N'EST PAS UNE PRÉCAUTION DE STYLE : les galeries réelles comptent 431, 312,
 * 282 et 233 photos. Tout charger d'un coup, au bord d'un terrain en 4G, c'est un écran blanc de
 * plusieurs secondes.
 *
 * `status = 'ready'` : mesuré, 6 photos sont en `failed` et 1 en `hidden`, et ce sont exactement
 * les 7 qui n'ont ni aperçu ni vignette. Sans ce filtre, sept cases grises qu'on peut agrandir
 * pour rien — et un compteur qui les compte.
 */
export async function lirePhotosGalerie(albumId: string, page = 0, parPage = 60): Promise<PagePhotos> {
  const debut = page * parPage;
  const { data, error, count } = await supabase
    .from("media_assets")
    .select("id, thumb_path, preview_path, preview_clair_path, width, height", { count: "exact" })
    .eq("album_id", albumId)
    .eq("status", "ready")
    // Le même ordre que la base sert au club et aux familles : la position voulue par qui a versé
    // les photos, puis l'arrivée. Un ordre différent d'un écran à l'autre, c'est la même galerie
    // qui ne se relit pas pareil.
    .order("position", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .range(debut, debut + parPage - 1);
  if (error) throw error;

  type Ligne = {
    id: string; thumb_path: string | null; preview_path: string | null;
    preview_clair_path: string | null; width: number | null; height: number | null;
  };
  const lignes = (data ?? []) as unknown as Ligne[];

  // UN SEUL APPEL DE SIGNATURE POUR TOUTE LA PAGE, jamais un par photo : soixante allers-retours
  // pour afficher une grille, c'est la grille qui n'arrive pas.
  const aSigner = lignes.map((r) => r.preview_clair_path).filter((c): c is string => !!c);
  const signees = new Map<string, string>();
  if (aSigner.length) {
    try {
      const { data: urls } = await supabase.storage.from(BUCKET_PRIVE).createSignedUrls(aSigner, 3600);
      for (const u of urls ?? []) if (u?.path && u?.signedUrl) signees.set(u.path, u.signedUrl);
    } catch { /* on retombe sur l'aperçu public, filigrané : ce n'est pas une panne d'écran */ }
  }

  const photos: PhotoGalerie[] = [];
  for (const r of lignes) {
    const net = r.preview_clair_path ? signees.get(r.preview_clair_path) ?? null : null;
    const publique = r.preview_path ?? r.thumb_path ?? null;
    // AUCUN FICHIER À MONTRER = PAS DE LIGNE. `.../galerie-previews/` sans chemin derrière est une
    // adresse valide qui ne rend rien : la case grise qu'on agrandit pour rien, et le compteur qui
    // la compte (leçon du 30/09 dans l'application des familles). Le filtre `status='ready'`
    // écarte déjà les 7 cas connus ; cette ligne est la ceinture.
    if (!net && !publique) continue;
    const l = r.width ?? 0;
    const h = r.height ?? 0;
    photos.push({
      id: String(r.id),
      url: net ?? `${SUPABASE_URL}/storage/v1/object/public/${BUCKET_PUBLIC}/${publique}`,
      net: !!net,
      // Les photos réelles sont en 4000×6000 : sans ce garde-fou, une largeur manquante donnerait
      // une division par zéro et une case de hauteur infinie.
      ratio: l > 0 && h > 0 ? l / h : 1,
    });
  }

  return { photos, total: typeof count === "number" ? count : photos.length };
}
