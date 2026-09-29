// Lire les numéros de maillot (29/09/2026, deuxième écriture).
//
// POURQUOI CE FICHIER EXISTE
//
// « Je suis le numéro 7 » est la seule chose qu'une famille sait dire à coup sûr, et c'est la seule
// piste qui marche sur une photo DE DOS, où un moteur de visages ne rend rien. Fouka : « quand on
// met les numéros, hop, ça retrouve automatiquement toutes les photos du numéro 7 ».
//
// CE QUI EST ÉTABLI, EN REGARDANT LES PHOTOS. Sur 36 photos de la galerie ouvertes une par une
// (mesures/dossards-verite-terrain.json), 5 portent un dossard lisible — le 10, le 14, le 2 et le
// 10, le 4, le 10 — et TOUTES sont des vues de dos. La fonction n'est donc pas un gadget : c'est la
// seule prise sur une catégorie entière de photos.
//
// POURQUOI TESSERACT A ÉTÉ ABANDONNÉ
//
// Il est fait pour des documents imprimés. Un numéro de maillot est dessiné : trait fin, contour
// creux, police fantaisie, tissu qui plisse. Mesuré sur les 110 photos de la galerie : une lecture
// juste, deux fausses. Et sur un « 2 » qui s'étale en grand et en net, il lisait « 1 ». Ce n'est
// pas un seuil à bouger, c'est le mauvais outil.
//
// CE QU'ON UTILISE À LA PLACE : VISION, le moteur de texte de macOS, entraîné sur des photos du
// monde réel — panneaux, devantures, plaques. C'est exactement ce genre de texte. Il ne coûte ni
// téléchargement, ni service tiers, ni clé : le Mac qui fait déjà tourner la reconnaissance sait le
// faire. Voir outils/lire-texte.swift.
//
// LES TROIS CHOSES QUI FONT QUE ÇA MARCHE, chacune mesurée :
//   1. On ne cherche que dans le HAUT DU DOS d'une personne détectée, jamais dans l'image entière.
//      Sans cela on lit l'herbe et les grillages : 43 numéros inventés sur 36 photos.
//   2. On ne lit que les personnes SANS visage visible. Un numéro se porte dans le dos ; sur
//      quelqu'un vu de face, tout ce qu'on trouve est inventé (cas réel : un éducateur de face,
//      d'où sortaient « 2 » et « 1 »).
//   3. On présente QUATRE préparations de la même image. Aucune ne gagne toujours, et c'est mesuré
//      sur 1 404 variantes : « normalise » lit le 14 et le 2, « seuil » lit le 10 et rien d'autre,
//      et la quatrième — par la SATURATION et non par la lumière — rattrape les chiffres blancs sur
//      maillot clair, que les trois autres perdent en niveaux de gris. Une seule préparation, et on
//      perd les trois quarts des dossards.
import sharp from "sharp";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const ICI = dirname(fileURLToPath(import.meta.url));
const LECTEUR = join(ICI, "outils", "lire-texte");
const executer = promisify(execFile);

/**
 * VISION NE DONNE QUE TROIS NIVEAUX : 1, 0,5 et 0,3. On n'accepte que la certitude.
 *
 * Elle est volontairement absolue. Un numéro faux ne se contente pas d'être faux : il propose les
 * photos d'un enfant à la famille d'un autre. Rater un dossard ne coûte qu'une photo non proposée,
 * que le visage retrouvera peut-être. Les deux erreurs n'ont pas le même prix.
 */
export const CONFIANCE_MIN = 0.99;

/** Qui a lu. La base l'enregistre (v339) pour qu'on puisse effacer le travail d'un lecteur precis
 *  le jour ou il se revele faux, sans toucher a ce qu'un humain a saisi. */
export const LECTEUR_DOSSARDS = "macos-vision-dos-v1";

/** En dessous, une personne est trop petite dans l'image pour porter quoi que ce soit de lisible. */
const COTE_MIN = 30;

/**
 * À PARTIR DE QUAND ON CONSIDÈRE QU'ON VOIT QUELQU'UN DE FACE (29/09/2026).
 *
 * Le détecteur trouve des visages jusqu'à 0,3, et c'est voulu pour la reconnaissance : un profil
 * vaut la peine d'être tenté. Mais il en trouve AUSSI sur les nuques — une tête vue de dos avec des
 * cheveux bouclés lui ressemble assez pour sortir un score faible.
 *
 * Mesuré en dessinant les boîtes sur les photos manquées : les vrais visages de face sortent à
 * 0,74 et 0,81 ; les faux, sur des nuques, à 0,30, 0,32, 0,49. La coupure se place donc toute
 * seule, et c'est elle qui manquait : trois dossards bien lisibles étaient écartés parce qu'on
 * croyait voir le visage de quelqu'un qui nous tournait le dos.
 */
const SCORE_VISAGE_DE_FACE = 0.6;

/**
 * DEUX HAUTEURS DE LECTURE, ET C'EST DÉCISIF (29/09/2026).
 *
 * Vision lit le texte dont la taille lui convient, et ignore le reste. Sur un dos où le numéro est
 * grand et l'étiquette d'équipe petite, il lit l'étiquette et saute le numéro — constaté sur un
 * « 10 » parfaitement net, où il rendait « U16A » et rien d'autre.
 *
 * Mesuré sur ce dos, même image, cinq hauteurs : à 200 px il lit « 10 » à 100 % ; à 300, 500, 800
 * et 1 200 il ne lit plus que l'étiquette. Réduire fait disparaître le petit texte et ramène le
 * grand chiffre dans la taille qu'il sait lire.
 *
 * On présente donc les deux : 500 px pour les numéros lointains ou petits, 200 px pour ceux qui
 * remplissent le dos. C'est la même leçon que la détection de visages à deux échelles — ce ne sont
 * pas des réglages concurrents, ce sont des regards différents.
 */
const HAUTEUR_LECTURE = 500;
const HAUTEUR_LECTURE_LARGE = 200;

/**
 * UN NUMÉRO DE MAILLOT OCCUPE LE DOS, PAS UN COIN (29/09/2026).
 *
 * Mesuré sur les dix lectures du passage complet : les neuf justes font de 22 % à 46 % de la
 * hauteur du cadre — normal, puisque le cadre EST le dos de la personne, donc la proportion ne
 * dépend pas de sa distance. La seule fausse faisait 3,2 % de haut, 4,3 % de large, dans le coin
 * supérieur gauche : du bruit binarisé que Vision a lu « 71 » avec un aplomb total.
 *
 * Le plancher est posé bien en dessous du plus petit vrai, et bien au-dessus du faux : on ne perd
 * rien de ce qu'on sait lire, et on écarte ce qui n'a pas la taille d'un dossard.
 */
const HAUTEUR_MIN_DU_CADRE = 0.12;

/**
 * Où chercher : le haut du dos de chaque personne qu'on ne voit pas de face.
 *
 * Le numéro se porte entre les omoplates. Mesuré sur les photos étiquetées, il occupe la bande qui
 * va de 13 % à 63 % de la hauteur du corps. On prend un peu large : mieux vaut cadrer un bout de
 * short que couper un chiffre en deux.
 */
export function zonesDeRecherche(personnes, visages = []) {
  // UN VISAGE APPARTIENT À UN SEUL CORPS (29/09/2026).
  //
  // On testait « y a-t-il un visage dans cette boîte ». Sur un terrain les corps se chevauchent, et
  // le visage du joueur d'arrière-plan tombait AUSSI dans la boîte de celui de devant : les deux
  // étaient écartés, alors qu'un seul nous fait face. Cas réel, une photo où le n°4 est de dos
  // juste devant un coéquipier qui regarde l'objectif — aucun des deux n'était lu.
  //
  // On attribue donc chaque visage au corps qui lui va le mieux : celui dont la tête est la plus
  // proche, à l'échelle près. Un visage, un corps, et les autres restent des dos.
  const deFace = new Set();
  for (const v of visages) {
    if ((v.score ?? 0) < SCORE_VISAGE_DE_FACE) continue;
    const [fx, fy, fw, fh] = v.boite;
    const cx = fx + fw / 2, cy = fy + fh / 2;
    let meilleur = -1, best = Infinity;
    for (const [i, p] of personnes.entries()) {
      const [x, y, w, h] = p.boite;
      if (cx < x + w * 0.20 || cx > x + w * 0.80) continue;
      if (cy < y || cy > y + h * 0.30) continue;
      if (fh < h * 0.06 || fh > h * 0.30) continue;
      // La tête de quelqu'un est en haut, au milieu : on mesure l'écart à cet endroit-là, rapporté
      // à sa taille, pour que deux corps de tailles différentes soient comparables.
      const ecart = Math.hypot((cx - (x + w / 2)) / w, (cy - (y + h * 0.12)) / h);
      if (ecart < best) { best = ecart; meilleur = i; }
    }
    if (meilleur >= 0) deFace.add(meilleur);
  }

  const zones = [];
  for (const [i, p] of personnes.entries()) {
    if (deFace.has(i)) continue;
    const [x, y, w, h] = p.boite;
    const zx = Math.max(0, Math.round(x)), zy = Math.max(0, Math.round(y + h * 0.13));
    const zw = Math.round(w), zh = Math.round(h * 0.50);
    if (zw >= COTE_MIN && zh >= COTE_MIN) zones.push([zx, zy, zw, zh]);
  }
  return zones;
}

/**
 * Les trois préparations d'un même dos.
 *
 * Mesuré sur les trois dossards de référence : « normalise » seul lit le 14 et le 2 mais pas le 10 ;
 * « seuil » seul lit le 10 et rien d'autre ; « contraste » rattrape le 2. Les trois ensemble lisent
 * les trois. C'est le même principe que la détection à deux échelles des visages : ce ne sont pas
 * des réglages concurrents, ce sont des regards différents.
 */
/**
 * LA QUATRIÈME PRÉPARATION : PAR LA COULEUR, PAS PAR LA LUMIÈRE (29/09/2026).
 *
 * Ce qui distingue un chiffre blanc sur un maillot, ce n'est pas sa luminosité — c'est son ABSENCE
 * DE COULEUR. Un « 10 » blanc sur du bleu clair en plein soleil donne, en niveaux de gris, deux
 * gris voisins : les trois autres préparations le perdent entièrement, et Vision ne lisait sur ce
 * dos que l'étiquette « U16A », cousue plus petit mais plus contrastée.
 *
 * On fabrique donc un noir et blanc à partir de la SATURATION : ce qui est incolore et lumineux
 * devient le chiffre, le reste disparaît. Le maillot, lui, est toujours coloré — c'est un maillot
 * de club.
 */
async function parLaCouleur(image, x, y, w, h, hauteur) {
  const { data, info } = await sharp(image)
    .extract({ left: x, top: y, width: w, height: h })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const gris = Buffer.allocUnsafe(info.width * info.height);
  for (let i = 0, k = 0; i < gris.length; i++, k += info.channels) {
    const r = data[k] / 255, g = data[k + 1] / 255, b = data[k + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = mx === 0 ? 0 : (mx - mn) / mx;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    // Noir pour le chiffre, blanc pour le reste : Vision lit du sombre sur du clair.
    gris[i] = (sat < 0.25 && lum > 0.62) ? 0 : 255;
  }
  return sharp(gris, { raw: { width: info.width, height: info.height, channels: 1 } })
    .resize({ height: hauteur }).png().toBuffer();
}

async function preparations(image, zone, largeurImage, hauteurImage) {
  const [x, y, w, h] = zone;
  const zw = Math.min(largeurImage - x, w), zh = Math.min(hauteurImage - y, h);
  if (zw < COTE_MIN || zh < COTE_MIN) return [];
  const decoupe = sharp(image).extract({ left: x, top: y, width: zw, height: zh });

  // Vision lit bien autour de 500 px de haut : au-delà le chiffre cesse de ressembler à du texte,
  // en deçà il n'y a plus assez de trait.
  const direct = await decoupe.clone().resize({ height: HAUTEUR_LECTURE }).toBuffer();

  // AGRANDIR PUIS RÉDUIRE, et ce n'est pas un détour inutile. Passer par 900 px avant de revenir à
  // 500 lisse les contours dessinés ; mesuré, c'est ce lissage — et lui seul — qui rend lisible un
  // « 10 » en trait fin, que le chemin direct perd. Deux chemins vers la même taille donnent deux
  // images différentes, et on a besoin des deux.
  const gonfle = await sharp(await decoupe.clone().resize({ height: 900 }).png().toBuffer())
    .resize({ height: HAUTEUR_LECTURE }).toBuffer();

  return [
    await sharp(direct).greyscale().normalise().png().toBuffer(),
    await sharp(gonfle).greyscale().threshold(150).png().toBuffer(),
    await sharp(gonfle).greyscale().normalise().threshold(150).png().toBuffer(),
    await parLaCouleur(image, x, y, zw, zh, HAUTEUR_LECTURE),
    // Les deux mêmes regards, en plus petit : c'est là que les grands numéros se lisent.
    await decoupe.clone().resize({ height: HAUTEUR_LECTURE_LARGE })
      .greyscale().normalise().png().toBuffer(),
    await parLaCouleur(image, x, y, zw, zh, HAUTEUR_LECTURE_LARGE),
  ];
}

/** Un entier de 1 à 99, ou rien. Vision rend la ligne entière : « U16A » n'est pas un numéro, et
 *  c'est exactement ce qu'il faut écarter puisque cette étiquette est cousue juste au-dessus. */
function commeNumero(texte) {
  const t = String(texte).trim();
  if (!/^\d{1,2}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= 99 ? n : null;
}

/**
 * Les numéros lisibles sur une photo.
 *
 * Rend une liste d'entiers sans doublon. Une liste vide veut dire « rien de lisible », jamais « il
 * n'y a personne » : c'est la base qui en tire les conséquences (v305).
 */
export async function lireDossards(imageBrute, personnes, visages = [], { confianceMin = CONFIANCE_MIN } = {}) {
  const zones = zonesDeRecherche(personnes, visages);
  if (!zones.length) return [];
  const meta = await sharp(imageBrute).metadata();

  const dossier = await mkdtemp(join(tmpdir(), "sv-dossards-"));
  try {
    const fichiers = [];
    for (const [i, zone] of zones.entries()) {
      const vues = await preparations(imageBrute, zone, meta.width, meta.height);
      for (const [j, png] of vues.entries()) {
        const chemin = join(dossier, `${i}-${j}.png`);
        await writeFile(chemin, png);
        fichiers.push({ chemin, zone: i });
      }
    }
    if (!fichiers.length) return [];

    const { stdout } = await executer(LECTEUR, fichiers.map((f) => f.chemin), { maxBuffer: 1 << 26 });
    const parZone = new Map();
    for (const ligne of stdout.trim().split("\n")) {
      if (!ligne) continue;
      let o; try { o = JSON.parse(ligne); } catch { continue; }
      const source = fichiers.find((f) => f.chemin === o.fichier);
      if (!source) continue;
      for (const l of o.lignes || []) {
        if (l.confiance < confianceMin) continue;
        // La boîte que Vision rend est en fraction du cadre : hauteur en quatrième position.
        if (!Array.isArray(l.boite) || (l.boite[3] ?? 0) < HAUTEUR_MIN_DU_CADRE) continue;
        const n = commeNumero(l.texte);
        if (n === null) continue;
        const votes = parZone.get(source.zone) || new Map();
        votes.set(n, (votes.get(n) || 0) + 1);
        parZone.set(source.zone, votes);
      }
    }

    // UN DOS PORTE UN NUMÉRO. Si deux préparations lisent deux valeurs différentes, on prend celle
    // qui revient le plus ; à égalité, on ne tranche pas — deviner entre deux lectures, c'est
    // exactement ce qu'on refuse de faire.
    const numeros = [];
    for (const votes of parZone.values()) {
      const classees = [...votes].sort((a, b) => b[1] - a[1]);
      if (classees.length > 1 && classees[0][1] === classees[1][1]) continue;
      if (!numeros.includes(classees[0][0])) numeros.push(classees[0][0]);
    }
    return numeros;
  } finally {
    await rm(dossier, { recursive: true, force: true });
  }
}
