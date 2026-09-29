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
// tesseract.js dans la page. Il avait annoté 59 photos sur 6 295 — et en les ouvrant, AUCUNE ne
// montrait de numéro : il lisait les plis de maillot et les sponsors. La v338 les a effacées.
// Ici tout tourne en Node : les pixels sont lus une fois, le reste est du calcul sur un tableau.
//
// CE MODULE N'EST PAS BRANCHE, ET VOICI EXACTEMENT POURQUOI (29/09/2026)
//
// CE QUI EST ETABLI. Sur 36 photos regardees une par une (mesures/dossards-verite-terrain.json),
// 5 portent un dossard lisible, soit 14 %, et TOUTES sont des vues de dos — c'est-a-dire les photos
// ou la reconnaissance du visage ne peut rien. La fonction vaut donc le coup : ce n'est pas un
// gadget, c'est la seule piste sur une categorie entiere de photos.
//
// CE QUI A ETE REPARE, ET QUI COMPTE.
//   - On part des CORPS, plus des visages ni de l'image entiere. Sans cela on cherche des chiffres
//     dans l'herbe et les grillages : 43 numeros inventes sur 36 photos.
//   - La vignette envoyee a l'OCR faisait 963 x 1170 pixels, a cause d'un agrandissement force d'au
//     moins trois fois. Tesseract lit mal ce qui est trop gros : un « 10 » parfaitement net etait lu
//     « 4 » puis « 0 », et lu « 10 » a 95 % une fois ramene a 96 px de haut.
//   - On ne lit que les dos : une personne dont on voit le visage n'a rien a lire dans le dos.
//   - Le seuil de confiance est monte de 62 a 90, parce que les lectures justes sortent a 95 et les
//     inventees entre 77 et 87.
//
// OU ON EN EST, SANS L'ARRANGER. Sur les 110 photos de la galerie : UNE lecture juste, DEUX fausses.
// Sur le sous-ensemble de 36 photos etiquetees, la precision paraissait de 100 % — l'echantillon
// etait trop petit, et le seuil avait ete cale dessus. C'est la lecon a retenir de ce fichier autant
// que le reste : une mesure sur 36 cas ne prouve rien qu'un passage sur 110 ne renverse.
//
// POURQUOI CA COINCE, ET CE QU'IL FAUDRAIT. Tesseract est fait pour lire des documents imprimes. Un
// numero de maillot est dessine : trait fin, contour creux, police fantaisie, tissu qui plisse. Sur
// une photo ou le « 2 » est gros et net, il lit « 1 ». Aucun reglage ne rattrapera cela — il faut un
// classifieur de chiffres entraine sur ce genre d'images (du type SVHN, les numeros de rue), pas un
// OCR de documents. C'est un modele a trouver ou a entrainer, pas un seuil a bouger.
//
// EN ATTENDANT, ON NE BRANCHE RIEN. Un dossard faux ne se contente pas d'etre faux : il envoie les
// photos d'un enfant a la famille d'un autre. Deux lectures fausses pour une juste, c'est un
// mauvais echange, et la v338 ferme d'ailleurs la porte cote base.
//
// CE QUI EST DEJA UTILISABLE, LUI : personnes.mjs. Le detecteur de corps marche tres bien, y compris
// sur les joueurs du fond, et c'est la brique qui manquait pour reconnaitre quelqu'un DE DOS.
//
// CE QU'ON NE SAIT PAS ENCORE FAIRE. Nommer la personne dont on lit le dossard : on sait qu'un
// corps porte le numero 10, pas qui est ce corps. C'est la famille qui tranche, en declarant son
// numero — le rapprochement se fait en base (v305), jamais ici.
import sharp from "sharp";
import { createWorker } from "tesseract.js";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** Un chiffre de dossard n'est jamais minuscule : sous six pixels de haut, plus rien n'est lisible
 *  et on ne fait que donner à l'OCR des occasions de se tromper. */
const HAUTEUR_MIN_CHIFFRE = 6;

/**
 * EN DESSOUS, ON PRÉFÈRE NE RIEN DIRE (29/09/2026).
 *
 * Mesuré sur 36 photos étiquetées à l'œil : les deux dossards correctement lus le sont à 95 % de
 * confiance, et les trois lectures inventées à 87, 77 et 82. La coupure se place donc toute seule.
 *
 * ELLE EST VOLONTAIREMENT HAUTE. Un numéro faux ne se contente pas d'être faux : il propose les
 * photos d'un enfant à la famille d'un autre. Rater un dossard ne coûte qu'une photo non proposée,
 * que la reconnaissance du visage retrouvera peut-être ; en inventer un coûte la confiance d'une
 * famille. Les deux erreurs n'ont pas le même prix, le seuil ne les traite donc pas pareil.
 */
export const CONFIANCE_MIN = 90;

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
 * Où chercher : le haut du dos de chaque personne.
 *
 * CE QUI A CHANGÉ LE 29/09/2026. On cherchait sous les visages et, à défaut, dans l'image entière.
 * Or les 5 photos à dossard des 36 regardées sont TOUTES des vues de dos, donc sans visage : il ne
 * restait que la passe sur l'image entière, qui fouille l'herbe, les grillages et les poteaux. D'où
 * 43 numéros inventés sur 36 photos, et 4 % de précision.
 *
 * Maintenant on part des corps. Le numéro se porte entre les omoplates : mesuré sur les photos
 * étiquetées, il occupe la bande qui va de 15 % à 60 % de la hauteur du corps, et l'essentiel de sa
 * largeur. On prend un peu plus large que nécessaire — mieux vaut fouiller un bout de short que
 * couper un chiffre en deux.
 */
export function zonesDeRecherche(personnes, visages = []) {
  const zones = [];
  for (const p of personnes) {
    const [x, y, w, h] = p.boite;
    // ON NE LIT QUE LES DOS (29/09/2026). Un numéro de maillot se porte entre les omoplates ; sur
    // une personne vue de face, il n'y a rien à lire, et tout ce qu'on y trouve est inventé. Le cas
    // réel : un éducateur filmé de face, polo blanc et bleu, d'où le moteur a sorti « 2 » et « 1 ».
    //
    // Reconnaître un dos ne demande aucun modèle de plus : c'est une personne SANS visage. Et c'est
    // précisément là que la reconnaissance faciale ne peut rien, donc là que le dossard vaut
    // quelque chose — les deux méthodes se partagent le travail au lieu de se concurrencer.
    // C'est SON visage à elle qu'on cherche, pas celui du voisin : sur un terrain les corps se
    // chevauchent, et « un visage quelque part dans la boîte » écartait des joueurs de dos parce
    // qu'un coéquipier passait derrière. Le sien est en haut, au milieu, et à l'échelle du corps.
    const deFace = visages.some((v) => {
      const [fx, fy, fw, fh] = v.boite;
      const cx = fx + fw / 2, cy = fy + fh / 2;
      return cx > x + w * 0.20 && cx < x + w * 0.80
          && cy > y && cy < y + h * 0.30
          && fh > h * 0.06 && fh < h * 0.30;
    });
    if (deFace) continue;
    const zx = x + w * 0.05, zy = y + h * 0.13;
    const zw = w * 0.90, zh = h * 0.50;
    if (zw > 16 && zh > 16) zones.push({ boite: [zx, zy, zw, zh], reference: h });
  }
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

  // CE QUI DISTINGUE UN CHIFFRE BLANC, CE N'EST PAS SA LUMINOSITÉ, C'EST SON ABSENCE DE COULEUR.
  // Un « 11 » blanc sur un maillot bleu clair donne deux gris voisins : en niveaux de gris, on ne
  // sépare rien. Par la saturation, le chiffre ressort net.
  //
  // OTSU A ÉTÉ ESSAYÉ ET ÉCARTÉ (29/09/2026). Un seuil calculé sur la zone paraissait plus robuste
  // qu'une constante — au soleil, à l'ombre, quelle que soit la couleur du club. Mesuré : il fait
  // tomber la lecture de 2 dossards sur 6 à 0 sur 6. Sur un dos, le maillot occupe l'écrasante
  // majorité des pixels et Otsu place sa coupure à l'intérieur du tissu, pas entre le tissu et le
  // chiffre. On garde donc la règle mesurée, et cette note pour que personne ne la « modernise »
  // une deuxième fois.
  const masque = new Uint8Array(W * H);
  for (let ly = 0; ly < H; ly++) {
    for (let lx = 0; lx < W; lx++) {
      const k = ((Y + ly) * largeur + (X + lx)) * canaux;
      const r = pixels[k] / 255, g = pixels[k + 1] / 255, b = pixels[k + 2] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const sat = mx === 0 ? 0 : (mx - mn) / mx;
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      masque[ly * W + lx] = clairSurFonce
        ? ((sat < 0.25 && l > 0.62) ? 1 : 0)
        : ((l < 0.32) ? 1 : 0);
    }
  }

  // L'ÉCHELLE EST CELLE DU CORPS, ET LA FENÊTRE EST ÉTROITE. Mesuré sur les photos étiquetées : un
  // numéro de maillot fait entre 12 % et 25 % de la hauteur du joueur. L'ancienne fenêtre, de 7 % à
  // 32 %, laissait entrer les lettres du sponsor (« tessi », 6 %) et les plis de tissu.
  const ech = reference || H;
  const hMin = Math.max(HAUTEUR_MIN_CHIFFRE, ech * 0.10), hMax = ech * 0.30;
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
export async function vignette(image, zone, clairSurFonce) {
  const { pixels, largeur, hauteur, canaux } = image;
  const marge = Math.round(zone.h * 0.30);
  const zx = Math.max(0, Math.round(zone.x - marge));
  const zy = Math.max(0, Math.round(zone.y - marge));
  const zw = Math.max(1, Math.min(largeur - zx, Math.round(zone.w + marge * 2)));
  const zh = Math.max(1, Math.min(hauteur - zy, Math.round(zone.h + marge * 2)));

  // MÊME CRITÈRE QUE LA DÉTECTION, sur ce même morceau : donner à l'OCR une image binarisée
  // autrement que celle où l'on a trouvé le chiffre reviendrait à lui montrer autre chose.
  const gris = Buffer.allocUnsafe(zw * zh);
  for (let ly = 0; ly < zh; ly++) {
    for (let lx = 0; lx < zw; lx++) {
      const k = ((zy + ly) * largeur + (zx + lx)) * canaux;
      const r = pixels[k] / 255, g = pixels[k + 1] / 255, b = pixels[k + 2] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const sat = mx === 0 ? 0 : (mx - mn) / mx;
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      const est = clairSurFonce ? (sat < 0.25 && l > 0.62) : (l < 0.32);
      // Tesseract lit du noir sur du blanc : le chiffre devient noir, le reste blanc.
      gris[ly * zw + lx] = est ? 0 : 255;
    }
  }

  // LA TAILLE, ET C'ÉTAIT LE DÉFAUT (29/09/2026). L'ancienne règle agrandissait TOUJOURS d'au moins
  // trois fois : un numéro déjà grand dans l'image donnait une vignette de 963 × 1170 pixels.
  // Tesseract lit mal ce qui est trop gros autant que ce qui est trop petit — mesuré sur un « 10 »
  // parfaitement net : illisible à 1 170 px de haut (il lisait « 4 », puis « 0 »), lu « 10 » à 95 %
  // une fois ramené à 96 px. C'est ce qui faisait échouer la lecture des vrais dossards pendant que
  // le bruit, lui, passait.
  //
  // On vise donc une hauteur de texte d'environ 100 pixels, en agrandissant OU en réduisant.
  const ech = Math.min(12, Math.max(0.15, 100 / zh));
  return sharp(gris, { raw: { width: zw, height: zh, channels: 1 } })
    .resize(Math.max(1, Math.round(zw * ech)), Math.max(1, Math.round(zh * ech)),
            { kernel: ech >= 1 ? "nearest" : "lanczos3" })
    // Une marge blanche : Tesseract cherche une ligne de texte, et une ligne collée au bord du
    // cadre ne ressemble pas à une ligne de texte.
    .extend({ top: 24, bottom: 24, left: 24, right: 24, background: { r: 255, g: 255, b: 255 } })
    .png().toBuffer();
}

/**
 * Les numéros lisibles sur une photo.
 *
 * Rend une liste d'entiers de 1 à 99, sans doublon. Une liste vide veut dire « rien de lisible »,
 * jamais « il n'y a personne » : c'est la base qui en tire les conséquences.
 */
export async function lireDossards(image, personnes, visages = [], { confianceMin = CONFIANCE_MIN, detail = false } = {}) {
  const t = await preparerOcr();
  const numeros = [];
  for (const z of zonesDeRecherche(personnes, visages)) {
    // Un joueur porte UN numéro. On garde la meilleure lecture de son dos, pas toutes.
    let meilleure = null;
    for (const clair of [true, false]) {
      for (const groupe of chercherChiffres(image, z.boite, clair, z.reference)) {
        const attendus = groupe.parts.length;
        const vue = await vignette(image, groupe, clair);
        const essais = [];
        // LES MODES QUI MARCHENT, mesurés sur un dossard net : 6, 7 et 11 lisent « 10 » à 95 %,
        // tandis que 8 et 13 s'arrêtent au premier chiffre et rendent « 0 » avec autant d'aplomb.
        // Garder ces deux-là revenait à fabriquer de faux votes pour une lecture tronquée.
        for (const psm of ["6", "7", "11"]) {
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
        if (!essais.length) continue;

        // L'ACCORD PLUTÔT QUE LA CONFIANCE (29/09/2026). Tesseract rend toujours quelque chose, et
        // il le rend avec aplomb : c'est comme ça qu'un pli de maillot devenait un « 1 » à 83 %.
        // Quatre lectures indépendantes du même bout d'image, en revanche, ne tombent d'accord par
        // hasard que très rarement. On exige donc que la bonne longueur ET la même valeur sortent
        // au moins deux fois.
        const voix = new Map();
        for (const e of essais) {
          if (e.t.length !== attendus) continue;
          const v = voix.get(e.t) || { n: 0, c: 0 };
          voix.set(e.t, { n: v.n + 1, c: Math.max(v.c, e.c) });
        }
        let lu = null;
        for (const [texte, v] of voix)
          if (v.n >= 2 && v.c >= confianceMin && (!lu || v.n > lu.n || (v.n === lu.n && v.c > lu.c)))
            lu = { t: texte, n: v.n, c: v.c };
        if (!lu) continue;

        const n = +lu.t;
        if (n < 1 || n > 99) continue;
        // La plus grande lecture du dos l'emporte : un vrai numéro est le plus gros caractère du
        // maillot, et ce qui est plus petit est un sponsor ou une taille.
        if (!meilleure || groupe.h > meilleure.h)
          meilleure = { n, h: groupe.h, c: lu.c, voix: lu.n, chiffres: attendus, part: groupe.h / z.reference, clair };
      }
    }
    if (meilleure && !numeros.some((x) => (detail ? x.n : x) === meilleure.n))
      numeros.push(detail ? meilleure : meilleure.n);
  }
  return numeros;
}
