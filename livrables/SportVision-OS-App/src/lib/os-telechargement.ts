// RÉCUPÉRER LES ORIGINAUX D'UNE GALERIE, DEPUIS LE TÉLÉPHONE (01/10/2026).
//
// Décision de Fouka, ce matin : « un opérateur peut récupérer les ORIGINAUX des galeries de ses
// missions ». Ce fichier est le seul endroit de l'application qui fabrique une adresse vers un
// original, et le seul qui écrit dans la photothèque.
//
// == LA BASE AUTORISE DÉJÀ, ET C'EST MESURÉ ====================================================
//
// Rien n'a été ajouté côté droits, rien n'a été contourné. La policy de stockage
// `sv_media_prive_media_select` dit exactement ceci :
//
//     bucket = 'sportvision-media-prive' AND foldername[1] = 'media'
//     AND can_access_media(foldername[2]::uuid)          -- foldername[2] = l'identifiant de la galerie
//
// et `can_access_media` commence par :
//
//     if is_staff() then return not est_operateur_terrain() or photographe_voit_album(p_album_id);
//
// Donc un opérateur terrain accède aux originaux de SES galeries, et d'aucune autre. Vérifié par le
// chemin réel, en transaction annulée, en rattachant deux galeries réelles à la mission SV-2026-3843
// d'Antoine Blin (rôle photo, 5 missions) :
//
//   · Antoine, affecté   : `can_access_media` vrai sur les deux, 431 + 314 lignes `media_assets`
//     lisibles, et 314 objets lisibles dans `sportvision-media-prive/media/<galerie>/` — soit
//     EXACTEMENT les originaux de cette galerie-là, et zéro ailleurs dans le seau ;
//   · Erwan Moukassa, non affecté : faux partout, 0 ligne, 0 objet.
//
// Et aujourd'hui, sans ce rattachement : `media_albums.mission_id` est NULL sur 57 galeries sur 57,
// donc un opérateur voit zéro galerie et zéro original. Ce n'est pas un défaut de cet écran.
//
// == DEUX STOCKAGES, UNE SEULE QUESTION POSÉE À UN SEUL ENDROIT =================================
//
// LE PIÈGE QUI AURAIT CASSÉ DEUX TÉLÉCHARGEMENTS SUR TROIS. Mesuré : sur les 7 784 originaux,
// 5 117 (65,7 %, 50,07 Go) sont sur Cloudflare R2 et 2 667 (48,32 Go) dans le seau privé Supabase.
// Croisé objet par objet : AUCUN des 5 117 chemins « r2 » n'existe dans `storage.objects` de
// Supabase, et les 2 667 autres y sont tous. Signer naïvement une URL Supabase pour tout le monde
// aurait donc rendu une adresse valide qui répond « objet introuvable » sur deux photos sur trois.
//
// `media_assets.storage_bucket` fait foi, et elle seule — la même règle que `_shared/medias.ts`
// côté serveur, à laquelle ce fichier est le pendant côté téléphone :
//
//   "r2"                      → la fonction `r2-fichier`, mode « lecture », adresse signée 1 h
//   "sportvision-media-prive" → `createSignedUrl` sur le seau privé
//   vide                      → Supabase, par prudence : c'était la valeur par défaut historique
//
// POURQUOI `r2-fichier` ET PAS UNE SIGNATURE ICI. Les clés R2 ne doivent pas entrer dans un paquet
// d'application : un `.ipa` se déballe. La fonction, elle, relit `media_assets` AVEC LE JETON DE
// L'APPELANT — « l'existence de la ligne, pour lui, EST l'autorisation », dit son en-tête. Elle ne
// réécrit aucune règle, elle ne fait que signer ce que la base a déjà accepté de montrer.
//
// Mesuré par HTTP, avec un vrai jeton (Mikael, rôle prod) :
//   · `r2-fichier` { mode: "lecture" } → 200, adresse valable 3 600 s ; le fichier répond 206,
//     7 804 772 octets, `content-disposition: attachment; filename="114-DSC09819.jpg"` ;
//   · `storage/v1/object/sign/sportvision-media-prive/media/…` → 200 ; le fichier répond 206,
//     27 648 406 octets.
// Et avec le jeton d'un opérateur SANS mission (apple.review, rôle photo) : `r2-fichier` répond
// 404 « Photo introuvable. », et la signature Supabase 400 / NoSuchKey. Les deux portes sont
// fermées quand elles doivent l'être — d'où le bouton qui n'existe pas dans ce cas (règle 5).
//
// == LE POIDS DÉCIDE DE TOUT LE RESTE ==========================================================
//
// 12,94 Mo de moyenne par original, 36,02 Mo au maximum, et une galerie de match compte 100 à 431
// photos : 1,3 à 5,6 Go pour un seul match. Au bord d'un terrain, en 4G. Trois conséquences, et
// aucune n'est un détail de confort :
//
//   1. UN PAR UN, JAMAIS EN PARALLÈLE. Quatre téléchargements simultanés de 13 Mo sur une 4G
//      faible se volent la bande passante et échouent ensemble. La séquence est plus lente sur le
//      papier et arrive au bout.
//   2. INTERRUPTIBLE À TOUT MOMENT, et l'arrêt se lit entre deux photos : ce qui est déjà
//      enregistré reste enregistré, et on le DIT (« 12 enregistrées, arrêté »).
//   3. LE FICHIER DE TRAVAIL EST EFFACÉ APRÈS CHAQUE PHOTO. Sans ça, 431 photos laisseraient 5,6 Go
//      dans le cache de l'application EN PLUS des 5,6 Go de la photothèque, et le téléphone se
//      remplirait deux fois. On vérifie aussi la place AVANT de commencer : annoncer un lot qui ne
//      peut pas tenir, c'est promettre un échec.
//
// == PAS DE FAUX SUCCÈS (règle 4), MÊME SANS BASE DE DONNÉES ====================================
//
// Ici la règle ne se joue pas sur un `.select("id")` mais sur la même exigence : on ne dit
// « enregistrée » qu'après que la photothèque a accepté le fichier. Un téléchargement qui rend un
// fichier de zéro octet, une signature refusée, une permission retirée : chacun rend une ERREUR
// nommée, et le compteur des échecs monte. Un lot qui finit avec des échecs ne dit jamais
// « terminé » tout court.
import { File, Paths } from "expo-file-system";
// `expo-media-library/legacy` ET PAS L'API PRINCIPALE, pour une raison de droits et une seule :
// `saveToLibraryAsync` se contente de `NSPhotoLibraryAddUsageDescription` (écrire), là où
// `Asset.create` de la nouvelle API demande l'accès complet à la photothèque (lire aussi). L'OS
// écrit dans la photothèque et ne la lit JAMAIS : demander la lecture serait demander plus que ce
// dont on a besoin, sur le téléphone personnel d'un freelance. Le `saveToLibraryAsync` exporté par
// le point d'entrée principal, lui, LÈVE à l'exécution : c'est une souche de dépréciation.
import { requestPermissionsAsync, saveToLibraryAsync } from "expo-media-library/legacy";
import { supabase } from "./supabase";

/** Le seau privé Supabase, où vivent 2 667 des 7 784 originaux. */
const SEAU_PRIVE = "sportvision-media-prive";

/** Cinq minutes : le temps de télécharger un fichier de 36 Mo, pas le temps d'une nuit. */
const VALIDITE_SIGNATURE = 300;

/** Ce qu'il faut savoir d'une photo pour aller chercher son original. */
export interface OriginalDemande {
  id: string;
  /** `media_assets.storage_bucket`. Elle seule décide où est le fichier. */
  seau: string | null;
  /** `media_assets.original_path`, de la forme `media/<galerie>/<photo>.jpg`. */
  chemin: string | null;
  /** Le nom du fichier du reflex (« 114-DSC09819.jpg »), celui qu'attend l'opérateur. */
  nomFichier: string | null;
  /** Le poids réel, pour annoncer un lot avant de le lancer. */
  octets: number | null;
}

/** Vrai quand l'original est sur Cloudflare R2. Même règle que `_shared/medias.ts`, côté serveur. */
function surR2(seau: string | null): boolean {
  return (seau ?? "").trim().toLowerCase() === "r2";
}

/**
 * L'adresse signée d'un original.
 *
 * Elle LÈVE avec une phrase lisible plutôt que de rendre null : l'appelant a un écran à remplir, et
 * « Téléchargement refusé » n'est pas la même nouvelle que « la connexion a coupé ».
 */
export async function adresseOriginale(photo: OriginalDemande): Promise<string> {
  const chemin = (photo.chemin ?? "").trim();
  if (!chemin) {
    throw new Error("Cette photo n'a pas de fichier original enregistré. Signalez-le à la production.");
  }

  if (surR2(photo.seau)) {
    // `functions.invoke` porte le jeton de la session : `r2-fichier` est déployée avec
    // vérification du jeton (verify_jwt = true, vérifié par l'API Management), elle refuse sans.
    const { data, error } = await supabase.functions.invoke("r2-fichier", {
      body: { asset_id: photo.id, mode: "lecture" },
    });
    // Un 404 « Photo introuvable » n'est pas une panne : c'est la base qui ne montre pas cette
    // photo à cette personne. On le dit avec ses mots, pas avec un code HTTP.
    if (error) {
      throw new Error(
        "Cette photo ne vous est pas accessible : une galerie vous revient quand elle est "
        + "rattachée à une de vos missions.",
      );
    }
    const url = (data as { url?: string } | null)?.url;
    if (!url) throw new Error("Le stockage n'a pas rendu d'adresse de téléchargement. Réessayez.");
    return url;
  }

  const { data, error } = await supabase.storage
    .from((photo.seau ?? "").trim() || SEAU_PRIVE)
    .createSignedUrl(chemin, VALIDITE_SIGNATURE, { download: photo.nomFichier || undefined });
  if (error || !data?.signedUrl) {
    throw new Error(
      "Cette photo ne vous est pas accessible : une galerie vous revient quand elle est "
      + "rattachée à une de vos missions.",
    );
  }
  return data.signedUrl;
}

/** Un nom de fichier sûr, qui garde le nom du reflex quand il y en a un. */
function nomLocal(photo: OriginalDemande): string {
  const brut = (photo.nomFichier ?? "").trim();
  const propre = brut.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (propre && /\.[A-Za-z0-9]{2,5}$/.test(propre)) return propre;
  // L'EXTENSION EST OBLIGATOIRE : `saveToLibraryAsync` la demande explicitement pour reconnaître
  // le type du fichier. Un original sans nom repart donc sous son identifiant, en .jpg — les
  // 7 784 photos de la base sont toutes en `image/jpeg` (mesuré).
  return `${photo.id}.jpg`;
}

/**
 * La permission d'écrire dans la photothèque.
 *
 * `true` en premier argument = écriture SEULE. iOS montre alors « Ajouter des photos », pas
 * « Accéder à toutes vos photos » : c'est la demande juste, et la seule qu'on ait le droit de
 * faire puisque `NSPhotoLibraryAddUsageDescription` est la seule justification déclarée.
 */
export async function autoriserPhototheque(): Promise<boolean> {
  try {
    const r = await requestPermissionsAsync(true);
    return r?.granted === true;
  } catch {
    return false;
  }
}

/**
 * Enregistrer UN original dans la photothèque.
 *
 * Le fichier de travail est effacé dans tous les cas, succès comme échec : un téléchargement
 * interrompu laisse un fichier partiel de plusieurs mégaoctets, et personne ne va le chercher.
 */
export async function enregistrerOriginal(photo: OriginalDemande): Promise<void> {
  const url = await adresseOriginale(photo);
  const fichier = new File(Paths.cache, nomLocal(photo));
  try {
    // `idempotent` : la même photo demandée deux fois ne doit pas échouer sur « le fichier existe
    // déjà ». Cela arrive pour de vrai — on relance un lot interrompu.
    const telecharge = await File.downloadFileAsync(url, fichier, { idempotent: true });
    // UN FICHIER DE ZÉRO OCTET N'EST PAS UNE PHOTO. Le cas existe quand la connexion coupe pendant
    // l'en-tête de la réponse : sans ce contrôle, la photothèque accepterait un fichier vide et
    // l'écran annoncerait « enregistrée » (le faux succès de la règle 4, sous une autre forme).
    if (!telecharge.exists || telecharge.size <= 0) {
      throw new Error("Le fichier est arrivé vide. Vérifiez votre connexion et réessayez.");
    }
    await saveToLibraryAsync(telecharge.uri);
  } finally {
    try { if (fichier.exists) fichier.delete(); } catch { /* le cache se videra tout seul */ }
  }
}

/** Où en est un lot. Envoyé à l'écran entre chaque photo, jamais pendant. */
export interface AvancementLot {
  /** Combien sont RÉELLEMENT dans la photothèque. */
  enregistrees: number;
  /** Combien ont échoué, et sont donc à refaire. */
  echecs: number;
  total: number;
  /** Les octets déjà écrits, pour dire « 143 Mo sur 1,3 Go ». */
  octets: number;
  /** Le nom du fichier en cours, pour que l'attente ne soit pas muette. */
  enCours: string | null;
}

export interface BilanLot extends AvancementLot {
  /** Vrai si la personne a demandé l'arrêt : ce n'est PAS un échec, et ça ne se dit pas pareil. */
  arrete: boolean;
  /** Le premier refus rencontré, pour l'afficher une fois plutôt que soixante. */
  premierSouci: string | null;
}

/** Le total d'un lot, en octets, d'après ce que la base annonce. Sert à l'annoncer AVANT. */
export function poidsDuLot(photos: OriginalDemande[]): number {
  return photos.reduce((s, p) => s + (typeof p.octets === "number" && p.octets > 0 ? p.octets : 0), 0);
}

/** « 1,3 Go », « 143 Mo ». Le vocabulaire français, et l'unité qui se lit. */
export function poids(octets: number): string {
  if (octets >= 1073741824) return `${(octets / 1073741824).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Go`;
  if (octets >= 1048576) return `${Math.round(octets / 1048576).toLocaleString("fr-FR")} Mo`;
  return `${Math.max(1, Math.round(octets / 1024)).toLocaleString("fr-FR")} ko`;
}

/**
 * La place libre sur le téléphone, en octets. `null` si on ne sait pas.
 *
 * ON NE LANCE PAS UN LOT QUI NE PEUT PAS TENIR. Une galerie de 431 photos pèse 5,6 Go : sur un
 * téléphone presque plein, le lot s'arrêterait au milieu, après un quart d'heure d'attente.
 */
export function placeLibre(): number | null {
  try {
    const n = Paths.availableDiskSpace;
    return typeof n === "number" && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * Enregistrer un lot, une photo après l'autre.
 *
 * `doitArreter` est relu ENTRE deux photos : on n'interrompt pas un téléchargement en cours, on ne
 * commence pas le suivant. C'est ce qui garantit qu'aucune photo ne finit à moitié dans la
 * photothèque, et que le compte annoncé est le compte réel.
 *
 * Un échec N'ARRÊTE PAS le lot : sur cent photos en bord de terrain, une coupure de quelques
 * secondes en fait tomber une ou deux. S'arrêter là priverait des quatre-vingt-dix-huit autres.
 * En revanche, un REFUS de droits arrête tout de suite : les suivantes seraient refusées aussi, et
 * quatre-vingt-dix-neuf messages identiques n'apprennent rien de plus que le premier.
 */
export async function enregistrerLot(
  photos: OriginalDemande[],
  surAvancement: (a: AvancementLot) => void,
  doitArreter: () => boolean,
): Promise<BilanLot> {
  const bilan: BilanLot = {
    enregistrees: 0, echecs: 0, total: photos.length, octets: 0,
    enCours: null, arrete: false, premierSouci: null,
  };

  for (const p of photos) {
    if (doitArreter()) { bilan.arrete = true; break; }
    bilan.enCours = nomLocal(p);
    surAvancement({ ...bilan });
    try {
      await enregistrerOriginal(p);
      bilan.enregistrees += 1;
      bilan.octets += typeof p.octets === "number" && p.octets > 0 ? p.octets : 0;
    } catch (e) {
      bilan.echecs += 1;
      const message = (e as Error)?.message ?? "Téléchargement impossible.";
      if (!bilan.premierSouci) bilan.premierSouci = message;
      // Un refus d'accès ne se répare pas en réessayant : il vaut pour toutes les photos de la
      // galerie, puisque la base répond sur la GALERIE, pas sur la photo.
      if (message.startsWith("Cette photo ne vous est pas accessible")) break;
    }
    surAvancement({ ...bilan });
  }

  bilan.enCours = null;
  surAvancement({ ...bilan });
  return bilan;
}
