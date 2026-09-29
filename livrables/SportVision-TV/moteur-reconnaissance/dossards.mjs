// Lire les numéros de maillot sur une photo (29/09/2026).
//
// POURQUOI CE FICHIER EXISTE
//
// « Je suis le numéro 7 » est la seule chose qu'une famille sait dire à coup sûr, et c'est la seule
// piste qui marche sur une photo DE DOS, où un moteur de visages ne rend rien. Fouka : « quand on
// met les numéros, hop, ça retrouve automatiquement toutes les photos du numéro 7 ». Le mécanisme
// côté base existe depuis la v302 ; il consomme `media_assets.numeros_visibles`, et sans lecteur
// ce champ reste vide — un mécanisme dont personne ne produit la matière.
//
// CE QUI CHANGE PAR RAPPORT À L'ANCIEN MOTEUR
//
// L'ancien lisait les dossards dans un Chromium, avec coco-ssd pour trouver les corps et
// tesseract.js dans la page. Il a relevé 59 photos sur 6 295 : ça marche, mais tout passait par
// `getImageData`, qui rapatrie les pixels depuis la carte graphique à chaque appel — des milliers
// de fois par photo. Ici les pixels sont lus UNE fois, et tout le reste est du calcul sur un
// tableau. Même algorithme de détection des chiffres, porté tel quel : il a fait ses preuves.
//
// CE QUI REMPLACE LE DÉTECTEUR DE CORPS. Le numéro se porte sur le torse, et le torse est sous le
// visage : les boîtes que SCRFD nous donne déjà suffisent à cadrer où chercher. On ajoute une passe
// sur l'image entière, parce qu'un joueur du premier plan porte le dossard le plus lisible de tous
// et que sa position ne dépend d'aucune détection.
//
// CE MODULE N'EST PAS BRANCHE, ET C'EST DELIBERE (29/09/2026)
//
// Le portage marche : il trouve des zones, il les lit, il rend des chiffres. Le probleme est qu'il
// rend des chiffres QUI N'EXISTENT PAS, exactement comme son predecesseur. Mesure sur 12 photos ou
// l'ancien moteur avait releve un numero : une seule lecture identique, 6 numeros sur 21 retrouves,
// 12 numeros en plus. Trois de ces photos ont ete ouvertes et regardees — un joueur de profil, un
// autre devant un sponsor « tess », un gardien en maillot raye : AUCUNE ne montre de numero.
//
// Les deux moteurs ne se contredisaient pas sur des lectures difficiles, ils inventaient tous les
// deux. La distribution le disait deja sans ouvrir une seule photo : sur 110 numeros releves en
// production, le 1 sortait 32 fois, le 4 vingt-quatre fois, le 3 vingt-deux fois. Un effectif de
// U16 ne porte pas trois fois le meme numero.
//
// La v338 a efface ces numeros et ferme la porte cote base. Ce fichier reste, parce que la moitie
// difficile — trouver OU chercher, a quelle echelle, et juger une lecture par le nombre de taches
// plutot que par la confiance de l'OCR — est ecrite et mesurable. Il sera branche le jour ou il
// saura lire un vrai numero sur une vraie photo, et pas avant : un dossard faux ne se contente pas
// d'etre faux, il envoie les photos d'un enfant a la famille d'un autre.
//
// CE QU'ON NE SAIT PAS ENCORE FAIRE. Sur une photo strictement de dos, il n'y a pas de visage, donc
// pas de torse déduit : seule la passe sur l'image entière travaille. C'est justement là que le
// dossard vaudrait le plus. Un vrai détecteur de personnes reste à ajouter, et c'est dit ici pour
// que personne ne croie le contraire en lisant le reste.
import sharp from "sharp";
import { createWorker } from "tesseract.js";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** Un chiffre de dossard n'est jamais minuscule : sous six pixels de haut, plus rien n'est lisible
 *  et on ne fait que donner à l'OCR des occasions de se tromper. */
const HAUTEUR_MIN_CHIFFRE = 6;

/** En dessous, une lecture ne vaut rien. Mesuré sur l'ancien moteur : c'est le seuil qui écarte les
 *  plis de maillot pris pour des « 1 » sans écarter les vrais numéros. */
export const CONFIANCE_MIN = 62;

let ocr = null;

export async function preparerOcr() {
  if (ocr) return ocr;
  // Le dictionnaire se telecharge une fois. Sans `cachePath`, il atterrit dans le dossier courant —
  // c'est-a-dire a la racine du depot quand le moteur est lance depuis la racine.
  ocr = await createWorker("eng", 1, { cachePath: dirname(fileURLToPath(import.meta.url)) });
  // On ne cherche que des chiffres. Sans cette liste, un « 8 » se lit « B » et disparaît au
  // filtrage, ce qui fait perdre une lecture pourtant bonne.
  await ocr.setParameters({ tessedit_char_whitelist: "0123456789" });
  return ocr;
}

export async function fermerOcr() {
  if (ocr) { try { await ocr.terminate(); } catch { /* rien à sauver */ } ocr = null; }
}

/**
 * Les pixels de l'image, une seule fois, en RGB.
 *
 * On travaille sur l'aperçu tel qu'il est (1067 × 1600) : l'agrandir n'inventerait pas de détail,
 * et le réduire effacerait les chiffres des joueurs du fond.
 */
export async function pixelsDe(imageBrute) {
  const { data, info } = await sharp(imageBrute)
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { pixels: data, largeur: info.width, hauteur: info.height, canaux: info.channels };
}

/**
 * Les zones où chercher : sous chaque visage, puis l'image entière.
 *
 * Un torse fait environ deux largeurs de visage et trois hauteurs, à partir du menton. On prend
 * large : mieux vaut fouiller un peu de pelouse que couper le numéro en deux.
 */
export function zonesDeRecherche(visages, largeur, hauteur) {
  const zones = [];
  for (const v of visages) {
    const [x, y, w, h] = v.boite;
    const zx = Math.max(0, x - w * 0.9);
    const zy = Math.max(0, y + h * 0.75);
    const zw = Math.min(largeur - zx, w * 2.8);
    const zh = Math.min(hauteur - zy, h * 3.4);
    if (zw > 12 && zh > 12) zones.push({ boite: [zx, zy, zw, zh], reference: h * 4.5 });
  }
  // L'échelle de la passe entière : celle du plus grand visage vu, faute de quoi on chercherait des
  // chiffres de la taille de l'image.
  const plusGrand = visages.reduce((m, v) => Math.max(m, v.boite[3]), 0);
  if (plusGrand) zones.push({ boite: [0, 0, largeur, hauteur], reference: plusGrand * 4.5 });
  return zones;
}

/**
 * Les groupes de taches qui ressemblent à un numéro, dans une zone.
 *
 * PORTÉ TEL QUEL DE L'ANCIEN MOTEUR, commentaires compris : c'est un algorithme calibré sur de
 * vraies photos de match, et le réécrire « plus proprement » reviendrait à recommencer sa
 * calibration.
 *
 * CE QUI DISTINGUE UN CHIFFRE BLANC, CE N'EST PAS SA LUMINOSITÉ, C'EST SON ABSENCE DE COULEUR. Un
 * « 11 » blanc sur un maillot bleu clair donne deux gris voisins : en niveaux de gris on ne sépare
 * rien. Par la saturation, le chiffre ressort net.
 */
export function chercherChiffres(image, zone, clairSurFonce, reference) {
  const { pixels, largeur, hauteur, canaux } = image;
  const X = Math.max(0, Math.round(zone[0])), Y = Math.max(0, Math.round(zone[1]));
  const W = Math.max(1, Math.min(largeur - X, Math.round(zone[2])));
  const H = Math.max(1, Math.min(hauteur - Y, Math.round(zone[3])));

  const masque = new Uint8Array(W * H);
  for (let ly = 0; ly < H; ly++) {
    for (let lx = 0; lx < W; lx++) {
      const k = ((Y + ly) * largeur + (X + lx)) * canaux;
      const r = pixels[k] / 255, g = pixels[k + 1] / 255, b = pixels[k + 2] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const sat = mx === 0 ? 0 : (mx - mn) / mx;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      masque[ly * W + lx] = clairSurFonce
        ? ((sat < 0.25 && lum > 0.62) ? 1 : 0)
        : ((lum < 0.32) ? 1 : 0);
    }
  }

  const ech = reference || H;
  const hMin = Math.max(HAUTEUR_MIN_CHIFFRE, ech * 0.07), hMax = ech * 0.32;
  const vu = new Uint8Array(W * H), file = new Int32Array(W * H), taches = [];
  for (let s = 0; s < masque.length; s++) {
    if (!masque[s] || vu[s]) continue;
    let tete = 0, queue = 0; file[queue++] = s; vu[s] = 1;
    let x0 = W, x1 = 0, y0 = H, y1 = 0, n = 0;
    while (tete < queue) {
      const p = file[tete++]; const px = p % W, py = (p - px) / W; n++;
      if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
      if (px > 0     && masque[p - 1] && !vu[p - 1]) { vu[p - 1] = 1; file[queue++] = p - 1; }
      if (px < W - 1 && masque[p + 1] && !vu[p + 1]) { vu[p + 1] = 1; file[queue++] = p + 1; }
      if (py > 0     && masque[p - W] && !vu[p - W]) { vu[p - W] = 1; file[queue++] = p - W; }
      if (py < H - 1 && masque[p + W] && !vu[p + W]) { vu[p + W] = 1; file[queue++] = p + W; }
    }
    const th = y1 - y0 + 1, tw = x1 - x0 + 1;
    if (th < hMin || th > hMax) continue;
    if (tw < th * 0.12 || tw > th * 1.3) continue;            // un chiffre est plus haut que large
    if (n < tw * th * 0.15 || n > tw * th * 0.92) continue;   // ni un trait, ni un bloc plein
    taches.push({ x0, x1, y0, y1, th, tw });
  }

  // Regrouper : « 11 », ce sont deux taches côte à côte, à la même hauteur, de taille voisine.
  taches.sort((a, b) => a.x0 - b.x0);
  const groupes = [], pris = new Array(taches.length).fill(false);
  for (let i = 0; i < taches.length; i++) {
    if (pris[i]) continue;
    const g = { x0: taches[i].x0, x1: taches[i].x1, y0: taches[i].y0, y1: taches[i].y1, n: 1, parts: [taches[i]] };
    pris[i] = true;
    for (let j = i + 1; j < taches.length; j++) {
      if (pris[j]) continue;
      const t = taches[j], haut = g.y1 - g.y0 + 1;
      if (Math.abs(t.th - haut) < haut * 0.45
          && Math.abs((t.y0 + t.y1) / 2 - (g.y0 + g.y1) / 2) < haut * 0.45
          && t.x0 - g.x1 < haut * 0.8 && t.x0 >= g.x0) {
        g.x1 = Math.max(g.x1, t.x1); g.y0 = Math.min(g.y0, t.y0); g.y1 = Math.max(g.y1, t.y1);
        g.n++; g.parts.push(t); pris[j] = true;
      }
    }
    if (g.n <= 2) groupes.push(g);   // un dossard fait un ou deux chiffres, jamais cinq
  }

  return groupes.map((g) => ({
    x: X + g.x0, y: Y + g.y0, w: g.x1 - g.x0 + 1, h: g.y1 - g.y0 + 1,
    // CHAQUE TACHE EST UN CHIFFRE : les dix chiffres sont d'un seul tenant, même le 0. Leur NOMBRE
    // dit combien de chiffres attendre, et c'est le meilleur juge d'une lecture — sans lui, « 11 »
    // se lisait « 1 » à 83 % de confiance : sûr de lui, et faux.
    parts: g.parts.sort((a, b) => a.x0 - b.x0)
      .map((t) => ({ x: X + t.x0, y: Y + t.y0, w: t.x1 - t.x0 + 1, h: t.y1 - t.y0 + 1 })),
  }));
}

/**
 * Une vignette noir et blanc, agrandie, de ce qu'on croit être un chiffre.
 *
 * On binarise AVEC LE MÊME CRITÈRE que la détection : donner à l'OCR une image en couleurs
 * reviendrait à lui demander de refaire le tri qu'on vient de faire, et il le referait moins bien.
 */
async function vignette(image, zone, clairSurFonce) {
  const { pixels, largeur, hauteur, canaux } = image;
  const marge = Math.round(zone.h * 0.30);
  const zx = Math.max(0, Math.round(zone.x - marge));
  const zy = Math.max(0, Math.round(zone.y - marge));
  const zw = Math.max(1, Math.min(largeur - zx, Math.round(zone.w + marge * 2)));
  const zh = Math.max(1, Math.min(hauteur - zy, Math.round(zone.h + marge * 2)));

  const gris = Buffer.allocUnsafe(zw * zh);
  for (let ly = 0; ly < zh; ly++) {
    for (let lx = 0; lx < zw; lx++) {
      const k = ((zy + ly) * largeur + (zx + lx)) * canaux;
      const r = pixels[k] / 255, g = pixels[k + 1] / 255, b = pixels[k + 2] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const sat = mx === 0 ? 0 : (mx - mn) / mx;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const est = clairSurFonce ? (sat < 0.25 && lum > 0.62) : (lum < 0.32);
      // Tesseract lit du noir sur du blanc : le chiffre devient noir, le reste blanc.
      gris[ly * zw + lx] = est ? 0 : 255;
    }
  }

  // Tesseract lit mal en dessous d'une trentaine de pixels de haut. On agrandit jusqu'à 140, sans
  // lissage : interpoler un trait binaire lui rendrait ses gris, donc son ambiguïté.
  const ech = Math.min(12, Math.max(3, 140 / zh));
  return sharp(gris, { raw: { width: zw, height: zh, channels: 1 } })
    .resize(Math.round(zw * ech), Math.round(zh * ech), { kernel: "nearest" })
    .png().toBuffer();
}

/**
 * Les numéros lisibles sur une photo.
 *
 * Rend une liste d'entiers de 1 à 99, sans doublon. Une liste vide veut dire « rien de lisible »,
 * jamais « il n'y a personne » : c'est la base qui en tire les conséquences.
 */
export async function lireDossards(image, visages, { confianceMin = CONFIANCE_MIN } = {}) {
  const t = await preparerOcr();
  const numeros = [];
  const zones = zonesDeRecherche(visages, image.largeur, image.hauteur);

  for (const z of zones) {
    for (const clair of [true, false]) {
      for (const groupe of chercherChiffres(image, z.boite, clair, z.reference)) {
        const attendus = groupe.parts.length;
        const vue = await vignette(image, groupe, clair);
        const essais = [];
        // Trois découpages de page : le mot seul, le bloc, la ligne brute. Aucun ne gagne toujours.
        for (const psm of ["7", "8", "13"]) {
          await t.setParameters({ tessedit_pageseg_mode: psm });
          const { data } = await t.recognize(vue);
          const brut = (data.text || "").replace(/[^0-9]/g, "");
          if (brut.length >= 1 && brut.length <= 2) essais.push({ t: brut, c: data.confidence });
        }
        // Puis chiffre par chiffre : c'est ce qui rattrape les « 11 » lus « 1 ».
        await t.setParameters({ tessedit_pageseg_mode: "10" });
        let parChiffre = "", somme = 0, nb = 0;
        for (const part of groupe.parts) {
          const { data } = await t.recognize(await vignette(image, part, clair));
          const ch = (data.text || "").replace(/[^0-9]/g, "");
          if (ch.length === 1) { parChiffre += ch; somme += data.confidence; nb++; }
        }
        if (parChiffre) essais.push({ t: parChiffre, c: nb ? somme / nb : 0 });

        // La bonne LONGUEUR d'abord, la confiance ensuite.
        essais.sort((a, b) => ((b.t.length === attendus) - (a.t.length === attendus)) || (b.c - a.c));
        const lu = essais[0];
        if (!lu || !lu.t) continue;
        const n = +lu.t;
        if (n >= 1 && n <= 99 && lu.c >= confianceMin && !numeros.includes(n)) numeros.push(n);
      }
    }
  }
  return numeros;
}
