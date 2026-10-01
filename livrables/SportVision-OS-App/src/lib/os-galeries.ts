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
// == CE QUE LE 01/10/2026 A AJOUTE : LA GALERIE SE CREE DEPUIS LE TELEPHONE =====================
//
// La chaine existe en base depuis la v154 et elle a un nom : `creer_galeries_mission(prestation)`.
// On l'appelle, on ne la refait pas. Ce qu'elle fait, verifie sur les dix prestations reelles avec
// le jeton de Mikael (role prod), en transaction annulee :
//   · une galerie PAR EQUIPE de la mission, jamais deux pour la meme equipe (9 missions sur 10 ont
//     des equipes identifiables : 1, 1, 1, 1, 2, 3, 3, 4, 6) ;
//   · une galerie de la prestation quand aucune equipe ne sort (SV-2026-5455, client_id NULL) ;
//   · titre, club, equipe, mission, date, saison, pole et mode d'acces remplis par la base ;
//   · idempotente : rappelee, elle rend les memes lignes avec `cree = false`.
//
// ET C'EST LA QUE LE TROU DE 57 GALERIES SE FERME. Mesure faite deux fois, dans une transaction
// annulee : quand la production cree les galeries de SV-2026-3843, Antoine — affecte a cette
// mission — passe de 0 galerie visible a 6, et Erwan, non affecte, reste a 0. C'est
// `photographe_voit_album` qui le fait, pas l'ecran. L'OS le dit dans ses propres mots :
// « La prestation liee donne l'acces au photographe de la mission ».
//
// == QUI PEUT CREER, ET POURQUOI ON NE REDEMANDE PAS LE POLE ====================================
//
// `creer_galeries_mission` leve 42501 si l'appelant n'est ni `admin` ni `prod` de ce pole. Mesure
// par le chemin reel : Antoine (photo) recoit « Seules l'Administration et la Production du pole
// creent les galeries d'une mission. », Mikael (prod) recoit les lignes.
//
// On ne rappelle donc PAS `prestation_pole_scope_ok` avant d'afficher le bouton, et ce n'est pas
// un oubli : `v_production_missions` se termine par `WHERE is_staff() AND pole_scope_ok(p.pole_id)`.
// Une mission lue dans cette vue est deja dans le pole du lecteur. Le seul reste a verifier est le
// role, et la session le porte. Demander deux fois la meme chose, c'est la redondance que la regle
// 3 du contrat interdit.
//
// == ECRIRE SUR UNE GALERIE : PROD ET ADMIN, ET PERSONNE D'AUTRE ================================
//
// `malbums_prod_update` demande `profiles.role in ('admin','prod')`, et la policy RESTRICTIVE
// `malbums_photographe_perimetre` porte `with_check (NOT est_operateur_terrain())` : un operateur
// ne peut RIEN ecrire sur une galerie, meme celle de sa mission, meme celle qu'il verrait.
//
// Mesure par le chemin reel, et c'est exactement le faux succes de la regle 4 : l'UPDATE d'Antoine
// rend ZERO LIGNE ET AUCUNE ERREUR. Le DELETE aussi. Seul l'INSERT crie (42501). D'ou le
// `.select("id")` sur les deux ecritures de ce fichier, et le bouton qui n'existe pas pour lui.
//
// == LE COMPTEUR REEL, EN UNE SEULE REQUETE ====================================================
//
// `photo_count` est denormalise et il derive : mesure, 46 annoncees contre 47 reelles sur la
// galerie « Olympique du Loing plateau ». Le trigger qui l'entretient
// (`media_album_refresh_photo_count`) ne met a jour QUE si le nouveau compte est > 0 : une galerie
// videe de sa derniere photo garde donc son ancien chiffre pour toujours. C'est un defaut de base,
// signale, pas corrige ici (gel fonctionnel).
//
// On ne le contourne pas a coups de 57 requetes de comptage : PostgREST sait agreger un embarque.
// `prets:media_assets!media_assets_album_id_fkey(count)` avec `prets.status=eq.ready` rend le VRAI
// compte de chaque galerie dans la MEME reponse. Verifie sur les deux cas qui pouvaient mentir :
// la galerie qui derive rend 47, et celle qui porte 4 photos `failed` rend 311 sur 315.
//
// == CE QU'ON NE CONSTRUIT PAS : LE VERSEMENT DEPUIS LE TELEPHONE ===============================
//
// Mesure, et la conclusion est nette. La chaine de l'OS fabrique TROIS derives par photo avant
// d'ecrire quoi que ce soit : vignette 480 px filigranee, apercu 1600 px filigrane, apercu 1600 px
// CLAIR. Les trois sont dessines dans un canvas de navigateur par `_galFiligrane`, avec la police
// `system-ui` et les metriques de texte du moteur de rendu. React Native n'a ni `createImageBitmap`
// ni canvas ni `toBlob` : il faudrait redessiner ce filigrane ailleurs, et le script
// `regenerer-apercus.mjs` a deja paye la lecon — « le reecrire cote serveur produirait un marquage
// DIFFERENT de tous les autres, et deux filigranes dans la meme galerie se verraient ».
//
// Et sans l'apercu CLAIR, la reconnaissance n'a rien a lire : `moteur.mjs` charge
// `preview_clair_path` et rien d'autre. Le chiffre qui tranche, croise sur les 7 784 photos : les
// 4 921 qui ont un apercu clair portent 2 247 lectures de dossard, soit 45,7 % ; les 2 863 qui n'en
// ont pas en portent ZERO. Pas « peu » : zero. Une photo versee sans ses derives n'est pas une photo
// en retard, c'est une photo que personne ne retrouvera jamais.
//
// Le poids acheve le dossier : 12,94 Mo de moyenne par original, 36 Mo au maximum, 98,39 Go pour
// 7 784 photos. Un match, c'est 100 a 431 photos, soit 1,3 a 5,6 Go a pousser en 4G au bord d'un
// terrain — et les photos sont sur la carte du reflex, pas dans le telephone.
//
// LE TELEPHONE S'ARRETE DONC A LA GALERIE. Il la cree, la nomme, la rattache. Les photos montent
// depuis le Mac, et l'ecran le dit au lieu de le laisser deviner.
// == CE QUE LE 01/10/2026 (APRES-MIDI) A AJOUTE : LE CLUB, L'EQUIPE, ET LES ORIGINAUX ===========
//
// Fouka, ce matin : « Dans galerie photo, c'est encore trop brouillon. C'est pas trie par equipe,
// par club. Je peux pas voir les statistiques, les galeries vendues sur l'app. Je peux meme pas
// telecharger les photos. »
//
// LE NOM DU CLUB EST DESORMAIS DEMANDE, ET LE COMMENTAIRE CI-DESSUS QUI DISAIT LE CONTRAIRE ETAIT
// JUSTE POUR SA RAISON, PAS POUR SA CONCLUSION. Mesure refaite : un profil `photo` voit 0 club sur
// 2, un `prod` en voit 2. Ne pas embarquer `clubs(nom)` evitait bien « un ecran garni pour la
// production et un tiret pour l'operateur » — mais sans club, il n'y a AUCUN tri par club, et c'est
// le premier reproche de Fouka. On embarque donc, et on donne a l'operateur une source qu'il a le
// droit de lire :
//
//   1. `clubs(nom)` quand la RLS l'ouvre (production, administration) ;
//   2. sinon `prestations.clients(nom)`, par la mission. Mesure par le chemin reel : Antoine (photo)
//      lit 2 lignes de `clients`, « RCP Fontainebleau » et « SF Villemomble » — les MEMES noms que
//      `clubs.nom`. Et ses galeries sont, par construction, celles de ses missions : le nom est donc
//      la ou il peut le lire ;
//   3. sinon `structure_externe`, qui nomme une structure non cliente (un tournoi, un club adverse) ;
//   4. sinon rien, et le groupe s'appelle « Sans club » — le mot de l'OS, pas une invention.
//
// Un embarquement que la RLS refuse rend NULL, il ne leve pas : verifie en HTTP avec un vrai jeton,
// 57 lignes, 21 avec `clubs.nom`, 16 avec `club_teams.name`, 0 avec `prestations` (mission_id NULL
// partout). C'est ce qui rend ce repli en cascade possible sans deuxieme requete.
//
// LE TAUX DE REMPLISSAGE COMMANDE LE DESSIN, et il est mesure : sur 57 galeries, 21 ont un club
// (15 RCP Fontainebleau, 6 SF Villemomble) et 36 n'en ont pas ; 16 ont une equipe, 27 une structure
// externe, et 24 n'ont NI club NI structure. Un tri par club qui laisserait 36 galeries hors des
// groupes ne trierait rien : « Sans club » est donc un groupe a part entiere, le plus gros.
//
// L'ORIGINAL N'EST PAS DANS LA MEME COLONNE QUE L'APERCU, et il n'est meme pas toujours chez
// Supabase : 5 117 originaux sur 7 784 sont sur Cloudflare R2. `lirePhotosGalerie` rend donc
// desormais, en plus de l'apercu, de quoi aller chercher le fichier source. La mecanique vit dans
// `os-telechargement.ts` ; ici on ne fait que rapporter ce que la base dit.
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
  /**
   * Le compteur VRAI, compté par la base dans la même réponse (`count` embarqué, photos `ready`).
   * Plus `photo_count`, qui dérive : 46 annoncées contre 47 réelles sur une galerie sur 57, et un
   * trigger qui ne redescend jamais à zéro. Cf. l'en-tête.
   */
  nbPhotos: number;
  /** Ce que la base annonce, gardé pour pouvoir DIRE qu'il ne colle pas. */
  nbPhotosAnnonce: number;
  /** `draft`, `published`, `archived`. Les libellés de l'OS sont dans l'écran. */
  statut: string;
  archivee: boolean;
  /** La référence de la mission, quand la galerie y est rattachée. Zéro cas aujourd'hui. */
  reference: string | null;
  /** La mission, pour savoir si la galerie est celle d'une prestation ou une galerie à la main. */
  missionId: string | null;
  /** Le club, sans lequel aucune équipe ne peut être proposée : une équipe appartient à un club. */
  clubId: string | null;
  /**
   * Le nom du club, ou du client de la mission, ou de la structure externe. `null` quand la galerie
   * n'est rattachée à rien : 24 galeries sur 57 sont dans ce cas, et c'est un cas NORMAL (un
   * tournoi, une académie). Cf. la cascade décrite en tête de fichier.
   */
  clubNom: string | null;
  /** Le nom de l'équipe rattachée (`club_teams.name`). 16 galeries sur 57 en portent une. */
  equipeNom: string | null;
  /** L'équipe principale, celle que `creer_galeries_mission` écrit. */
  equipeId: string | null;
  /**
   * Les catégories SUPPLÉMENTAIRES (`team_ids`), qu'on affiche et qu'on ne touche jamais.
   * Mesuré : 6 galeries sur 57 en portent, et l'OS avertit dans son propre code qu'un simple
   * changement de titre les effaçait silencieusement avant le 12/09. On ne refait pas ce défaut.
   */
  equipesEnPlus: string[];
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
    // `prets` EST UN COMPTAGE, PAS UN EMBARQUEMENT DE LIGNES : PostgREST agrège côté serveur et
    // renvoie un seul nombre par galerie. Le nom de la relation est explicite parce que
    // `media_albums` et `media_assets` sont liées DEUX FOIS (album_id, et cover_asset_id) : sans
    // lui, PostgREST répond 300 et demande de choisir.
    .select(`id, title, event_date, status, photo_count, structure_externe, mission_id, club_id,
             team_id, team_ids, club_teams ( name ), clubs ( nom ),
             prestations ( reference, clients ( nom ) ),
             prets:media_assets!media_assets_album_id_fkey ( count )`)
    // Le même filtre que l'écran d'une galerie : 6 photos sont en `failed` et 1 en `hidden`, et ce
    // sont exactement les 7 qui n'ont ni aperçu ni vignette. Vérifié : sur la galerie qui porte 4
    // `failed`, le compte passe de 315 à 311.
    .eq("prets.status", "ready")
    // Les plus récentes d'abord : on vient vérifier ce qu'on a livré hier, pas en février.
    .order("event_date", { ascending: false, nullsFirst: false })
    // 57 galeries aujourd'hui. Le plafond est là pour que la page ne grossisse pas sans limite
    // avec la saison, pas parce qu'il serait atteint.
    .limit(200);
  if (error) throw error;

  type Ligne = {
    id: string; title: string | null; event_date: string | null; status: string | null;
    photo_count: number | null; structure_externe: string | null;
    mission_id: string | null; club_id: string | null; team_id: string | null;
    team_ids: string[] | null;
    club_teams: { name: string | null } | null;
    clubs: { nom: string | null } | null;
    prestations: { reference: string | null; clients: { nom: string | null } | null } | null;
    /** PostgREST rend l'agrégat dans un tableau d'un seul objet, même pour un `count`. */
    prets: { count: number }[] | null;
  };

  return ((data ?? []) as unknown as Ligne[]).map((r) => ({
    id: String(r.id),
    titre: (r.title ?? "").trim() || "Galerie",
    date: r.event_date ?? null,
    categorie: (r.club_teams?.name ?? r.structure_externe ?? "").trim() || null,
    // Le compte de la base d'abord. `photo_count` n'est plus qu'un repli, pour le cas où
    // l'agrégat manquerait : un zéro affiché à la place d'un vrai chiffre se lit « galerie vide ».
    nbPhotos: r.prets?.[0]?.count ?? (typeof r.photo_count === "number" ? r.photo_count : 0),
    nbPhotosAnnonce: typeof r.photo_count === "number" ? r.photo_count : 0,
    // Le statut, pas `archived_at` : mesuré, 4 galeries portent status='archived' et AUCUNE n'a
    // de `archived_at`. Les deux champs ne disent pas la même chose, seul le statut est tenu.
    statut: r.status ?? "",
    archivee: r.status === "archived",
    reference: r.prestations?.reference ?? null,
    missionId: r.mission_id ?? null,
    clubId: r.club_id ?? null,
    // DEUX SOURCES, ET PAS TROIS. `clubs.nom` d'abord, le nom officiel du club partenaire ; le
    // client de la mission ensuite, parce que c'est le seul nom qu'un opérateur a le droit de lire.
    // `structure_externe` N'ENTRE PAS ICI : mesuré, elle vaut « RCPF U16A », « U14 A RCPF »,
    // « Melun Sénior » — c'est un nom d'ÉQUIPE ou de sélection, pas un nom de club, et 4 galeries
    // la portent EN MÊME TEMPS qu'un club SportVision. La mettre dans le nom du club aurait
    // fabriqué des groupes « RCPF U16A » et « RCP Fontainebleau » côte à côte pour le même club.
    // Elle reste dans `categorie`, qui est justement le champ de l'équipe ou de la structure.
    clubNom: (r.clubs?.nom ?? r.prestations?.clients?.nom ?? "").trim() || null,
    equipeNom: (r.club_teams?.name ?? "").trim() || null,
    equipeId: r.team_id ?? null,
    equipesEnPlus: Array.isArray(r.team_ids) ? r.team_ids.map(String) : [],
  }));
}

export interface PhotoGalerie {
  id: string;
  url: string;
  /** Vrai si c'est l'aperçu sans filigrane. Sert à le DIRE, jamais à décider d'un droit. */
  net: boolean;
  /** Le rapport largeur/hauteur, pour que l'agrandissement ne déforme pas. */
  ratio: number;
  /**
   * OÙ VIT L'ORIGINAL, ET SOUS QUEL NOM (01/10/2026).
   *
   * `storage_bucket` vaut « r2 » sur 5 117 photos et « sportvision-media-prive » sur 2 667 : ce
   * n'est PAS l'emplacement de l'aperçu (qui est toujours public, cf. l'en-tête), c'est celui de
   * l'ORIGINAL, et les deux ne se signent pas de la même façon. `os-telechargement.ts` tranche.
   */
  seau: string | null;
  chemin: string | null;
  /** Le nom du fichier du reflex. C'est celui que l'opérateur reconnaît : « 114-DSC09819.jpg ». */
  nomFichier: string | null;
  /** Le poids réel de l'original, pour annoncer un lot avant de le lancer. */
  octets: number | null;
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
    .select(
      `id, thumb_path, preview_path, preview_clair_path, width, height,
       storage_bucket, original_path, original_filename, bytes`,
      { count: "exact" },
    )
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
    storage_bucket: string | null; original_path: string | null;
    original_filename: string | null; bytes: number | null;
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
      seau: r.storage_bucket ?? null,
      chemin: r.original_path ?? null,
      nomFichier: r.original_filename ?? null,
      octets: typeof r.bytes === "number" ? r.bytes : null,
    });
  }

  return { photos, total: typeof count === "number" ? count : photos.length };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  TOUS LES ORIGINAUX D'UNE GALERIE, POUR UN TÉLÉCHARGEMENT EN LOT (01/10/2026)
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * La liste complète des originaux d'une galerie, sans les aperçus.
 *
 * POURQUOI PAS `lirePhotosGalerie` : elle pagine par 60 et signe soixante aperçus nets au passage.
 * Un lot porte sur TOUTE la galerie — jusqu'à 431 photos — et n'a besoin d'aucun aperçu. Demander
 * les aperçus pour télécharger les originaux, c'est huit appels de signature pour rien.
 *
 * ON PAGINE QUAND MÊME, par mille : PostgREST plafonne ses réponses, et une galerie de 431 photos
 * passe en un seul aller-retour là où l'écran en fait huit. Le plafond de sécurité à 5 000 existe
 * parce qu'une boucle sans borne sur une réponse mal formée tournerait indéfiniment.
 *
 * L'ORDRE EST CELUI DE LA GRILLE, et ce n'est pas cosmétique : un lot qui s'arrête au bout de
 * quarante photos doit s'être arrêté aux quarante PREMIÈRES de la galerie, celles qu'on a sous les
 * yeux, pas à quarante photos au hasard.
 */
export async function lireOriginauxGalerie(albumId: string): Promise<PhotoGalerie[]> {
  const parPage = 1000;
  const tout: PhotoGalerie[] = [];
  for (let page = 0; page < 5; page += 1) {
    const debut = page * parPage;
    const { data, error } = await supabase
      .from("media_assets")
      .select("id, storage_bucket, original_path, original_filename, bytes, width, height")
      .eq("album_id", albumId)
      .eq("status", "ready")
      .order("position", { ascending: true })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(debut, debut + parPage - 1);
    if (error) throw error;

    type Ligne = {
      id: string; storage_bucket: string | null; original_path: string | null;
      original_filename: string | null; bytes: number | null;
      width: number | null; height: number | null;
    };
    const lignes = (data ?? []) as unknown as Ligne[];
    for (const r of lignes) {
      // SANS CHEMIN, IL N'Y A RIEN À TÉLÉCHARGER. La compter dans le lot donnerait un total
      // annoncé plus grand que le nombre de fichiers réellement enregistrables : le compteur
      // finirait à « 429 sur 431 » sans que rien n'ait échoué, et on chercherait la panne.
      if (!r.original_path) continue;
      const l = r.width ?? 0;
      const h = r.height ?? 0;
      tout.push({
        id: String(r.id),
        url: "",
        net: false,
        ratio: l > 0 && h > 0 ? l / h : 1,
        seau: r.storage_bucket ?? null,
        chemin: r.original_path,
        nomFichier: r.original_filename ?? null,
        octets: typeof r.bytes === "number" ? r.bytes : null,
      });
    }
    if (lignes.length < parPage) break;
  }
  return tout;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  CRÉER LES GALERIES D'UNE MISSION (01/10/2026)
// ══════════════════════════════════════════════════════════════════════════════════════════════

export interface EquipeDeMission {
  equipeId: string;
  nom: string;
  /** Les adversaires, assemblés par la base. Ils entrent dans le titre qu'elle fabrique. */
  adversaires: string | null;
}

/**
 * Les équipes que la base reconnaît sur cette mission.
 *
 * ON NE LES DÉDUIT PAS DU CHAMP TEXTE `prestations.equipes`, et c'est mesuré : sur SV-2026-3843 ce
 * champ dit « U11, U13 1, U13 1, U11, U6, U7, U14 3 » — sept entrées dont deux doublons et des noms
 * qui n'existent pas au club — là où `equipes_de_mission` rend les six vraies équipes
 * (U11, U12A, U13A, U14C, U6, U7), retrouvées par les présences planifiées et les matchs.
 *
 * C'est aussi elle qui décide du nombre de galeries à créer : l'écran n'annonce donc jamais un
 * nombre qu'il aurait compté lui-même.
 */
export async function lireEquipesDeMission(prestationId: string): Promise<EquipeDeMission[]> {
  const { data, error } = await supabase.rpc("equipes_de_mission", {
    p_prestation_id: prestationId,
  });
  if (error) throw new Error(error.message);
  type Ligne = { team_id: string; team_name: string | null; adversaires: string | null };
  return ((data ?? []) as Ligne[]).map((r) => ({
    equipeId: String(r.team_id),
    nom: (r.team_name ?? "").trim() || "Équipe",
    adversaires: (r.adversaires ?? "").trim() || null,
  }));
}

export interface GalerieDeMission {
  id: string;
  titre: string;
  /** Le nom de l'équipe, ou null pour une galerie de prestation sans équipe. */
  equipe: string | null;
  /** Vrai si cet appel l'a créée. Faux : elle existait déjà, et rien n'a été touché. */
  creee: boolean;
}

/**
 * Créer les galeries d'une mission.
 *
 * UN SEUL APPEL, ET C'EST CELUI DE L'OS : `rpc/creer_galeries_mission`, le même que le bouton de la
 * fiche mission. Elle est SECURITY DEFINER, elle lève sur un refus (42501), elle est idempotente, et
 * elle remplit `mission_id` — ce que l'insertion à la main ne fait pas. Mesuré : les 57 galeries
 * existantes ont toutes `mission_id` NULL, et un opérateur n'en voit aucune pour cette seule raison.
 *
 * PAS DE FAUX SUCCÈS (règle 4). Une RPC qui rend un tableau vide n'a rien créé et n'a rien trouvé :
 * on lève, plutôt que d'annoncer « c'est fait » sur zéro ligne. Le cas existe : une mission
 * introuvable lève déjà côté base (P0002), mais un tableau vide resterait muet.
 */
export async function creerGaleriesMission(prestationId: string): Promise<GalerieDeMission[]> {
  const { data, error } = await supabase.rpc("creer_galeries_mission", {
    p_prestation_id: prestationId,
  });
  if (error) throw new Error(error.message);

  type Ligne = { album_id: string; titre: string | null; team_name: string | null; cree: boolean | null };
  const lignes = (data ?? []) as Ligne[];
  if (!lignes.length) {
    throw new Error("La base n'a rendu aucune galerie. Rien n'a été créé : vérifiez la mission dans l'OS.");
  }
  return lignes.map((r) => ({
    id: String(r.album_id),
    titre: (r.titre ?? "").trim() || "Galerie",
    equipe: (r.team_name ?? "").trim() || null,
    creee: r.cree === true,
  }));
}

/**
 * Quelles missions ont déjà des galeries, et combien.
 *
 * UNE SEULE REQUÊTE POUR TOUTE LA LISTE, jamais une par mission : la liste des missions ne doit pas
 * coûter dix allers-retours au bord d'un terrain. On ne demande que `mission_id`, donc la réponse
 * pèse le strict nécessaire, et la RLS borne déjà ce qu'elle contient.
 */
export async function lireGaleriesParMission(): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from("media_albums")
    .select("mission_id")
    .not("mission_id", "is", null)
    .limit(2000);
  if (error) throw error;
  const compte = new Map<string, number>();
  for (const r of (data ?? []) as { mission_id: string | null }[]) {
    if (!r.mission_id) continue;
    compte.set(r.mission_id, (compte.get(r.mission_id) ?? 0) + 1);
  }
  return compte;
}

/**
 * Les galeries DÉJÀ rattachées à une mission, avec leur équipe.
 *
 * ON COMPARE LES ÉQUIPES, PAS LES NOMBRES, et c'est ce qui décide d'afficher ou non le bouton
 * « Créer les galeries manquantes ». Compter aurait suffi dans le cas simple et menti dans le vrai :
 * une mission peut porter une galerie SANS équipe (la galerie de prestation, quand aucune équipe
 * n'est reconnue) à côté de galeries d'équipes. Deux galeries pour trois équipes, ce n'est pas
 * « une manquante », c'est peut-être deux. Un bouton caché à tort est un geste rendu impossible.
 */
export async function lireGaleriesDeMission(
  prestationId: string,
): Promise<{ id: string; equipeId: string | null }[]> {
  const { data, error } = await supabase
    .from("media_albums")
    .select("id, team_id")
    .eq("mission_id", prestationId);
  if (error) throw error;
  return ((data ?? []) as { id: string; team_id: string | null }[]).map((r) => ({
    id: String(r.id),
    equipeId: r.team_id ?? null,
  }));
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  ENRICHIR UNE GALERIE : LE NOM, L'ÉQUIPE
// ══════════════════════════════════════════════════════════════════════════════════════════════

export interface EquipeDuClub {
  id: string;
  nom: string;
  /** La catégorie telle que le club la nomme, quand elle est renseignée. */
  categorie: string | null;
}

/**
 * Les équipes d'un club, pour le choix d'une équipe.
 *
 * ON DEMANDE LES ÉQUIPES DU CLUB DE LA GALERIE, PAS TOUTES. Mesuré : `club_teams` est lisible par
 * tout le staff (`ctm_staff_select` = `is_staff()`), et rend les 74 équipes des deux clubs — 43
 * Villemomble, 31 Fontainebleau. Proposer les 74 pour une galerie de Fontainebleau, c'est proposer
 * de rattacher une galerie à l'équipe d'un autre club, et la base ne l'interdit pas.
 *
 * LES ARCHIVÉES SONT ÉCARTÉES : 17 des 74 le sont (43 → 30 et 31 → 27). Une équipe archivée dans un
 * choix, c'est le nom d'une équipe qui n'existe plus proposé pour la galerie de samedi.
 */
export async function lireEquipesDuClub(clubId: string): Promise<EquipeDuClub[]> {
  const { data, error } = await supabase
    .from("club_teams")
    .select("id, name, categorie, archivee")
    .eq("club_id", clubId)
    .order("name", { ascending: true });
  if (error) throw error;
  type Ligne = { id: string; name: string | null; categorie: string | null; archivee: boolean | null };
  return ((data ?? []) as Ligne[])
    .filter((r) => r.archivee !== true)
    .map((r) => ({
      id: String(r.id),
      nom: (r.name ?? "").trim() || "Équipe",
      categorie: (r.categorie ?? "").trim() || null,
    }));
}

/**
 * Renommer une galerie.
 *
 * `.select("id")` N'EST PAS UNE PRÉCAUTION DE STYLE, c'est le seul moyen de distinguer un succès
 * d'un refus. Mesuré par le chemin réel, avec le jeton d'Antoine (opérateur) sur une galerie de sa
 * propre mission : l'UPDATE rend ZÉRO LIGNE ET AUCUNE ERREUR. Sans cette ligne, l'écran annoncerait
 * « renommée » sur une galerie qui n'a pas bougé — le « ça n'enregistre pas » de Villemomble, exact.
 */
export async function renommerGalerie(albumId: string, titre: string): Promise<void> {
  const propre = titre.trim();
  // Le titre est NOT NULL en base. Un champ vidé ne doit pas partir : la base refuserait, mais le
  // refus arriverait sous la forme d'un message technique.
  if (!propre) throw new Error("Une galerie doit porter un nom.");

  const { data, error } = await supabase
    .from("media_albums")
    .update({ title: propre })
    .eq("id", albumId)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || !data.length) {
    throw new Error(
      "Renommage refusé : seules l'Administration et la Production modifient une galerie.",
    );
  }
}

/**
 * Rattacher la galerie à une équipe, ou l'en détacher.
 *
 * ON N'ÉCRIT QUE `team_id`, JAMAIS `team_ids`. Les deux colonnes sont complémentaires, pas
 * redondantes : l'OS coche la principale dans `team_id` et les catégories supplémentaires dans
 * `team_ids` (mesuré : disjointes sur les 6 galeries qui en portent, par exemple `team_id` = Séniors
 * et `team_ids` = deux autres catégories). Écrire les deux depuis un téléphone, c'est effacer sans
 * le dire un travail fait sur l'ordinateur — le défaut que l'OS a payé le 12/09 sur ce même écran.
 *
 * Le rattachement d'une galerie à une équipe la sert aussi à cette équipe dans Club+ et à ses
 * familles dans Connect : c'est une écriture qui se voit dehors, pas un réglage d'affichage.
 */
export async function rattacherEquipe(albumId: string, equipeId: string | null): Promise<void> {
  const { data, error } = await supabase
    .from("media_albums")
    .update({ team_id: equipeId })
    .eq("id", albumId)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || !data.length) {
    throw new Error(
      "Rattachement refusé : seules l'Administration et la Production modifient une galerie.",
    );
  }
}
