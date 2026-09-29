// LE MOTEUR DE RECONNAISSANCE, DEUXIÈME GÉNÉRATION (29/09/2026).
//
// POURQUOI ON CHANGE DE MODÈLE. Le moteur précédent s'appuyait sur face-api, c'est-à-dire un
// détecteur SSD MobileNet et un descripteur de 128 valeurs, tous deux de 2017. Mesuré sur une
// vraie galerie de 110 photos de match : 183 visages relevés, soit 1,7 par photo — alors qu'on en
// voit souvent quatre ou cinq. Découper l'image en tuiles pour aider le détecteur n'a rendu que
// deux visages de plus pour trois fois et demie le temps : le cadrage n'était pas le problème, le
// détecteur l'était.
//
// CE QUI LE REMPLACE, et c'est éprouvé en production ailleurs (Immich s'en sert pour exactement
// cet usage) :
//
//   SCRFD              détecte les visages petits, de profil, partiellement masqués, et rend
//                      cinq points de repère par visage — yeux, nez, coins de la bouche.
//   ArcFace w600k_r50  produit une empreinte de 512 valeurs au lieu de 128, entraînée sur des
//                      millions de visages avec une marge angulaire : deux vues très différentes
//                      d'une même personne s'y ressemblent beaucoup plus qu'avec l'ancien.
//
// ET ON QUITTE LE NAVIGATEUR. L'ancien moteur lançait Chromium pour faire tourner du JavaScript.
// Ici tout se passe dans Node : le calcul est plus rapide, le démarrage aussi, et il n'y a plus de
// serveur local, de page à charger, ni de promesse qui ne revient jamais.
//
// CE FICHIER NE PORTE AUCUNE RÈGLE MÉTIER. Il ne sait pas qui a le droit d'être reconnu, ni à
// partir de quelle distance deux visages sont la même personne. Il détecte, il aligne, il calcule.
// Le reste vit dans la base, où il doit vivre.

import * as ort from "onnxruntime-node";
import sharp from "sharp";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ICI = dirname(fileURLToPath(import.meta.url));

/** Le nom qui voyage avec chaque empreinte. Deux empreintes de modèles différents ne se comparent
 *  PAS : changer ce nom oblige à tout recalculer, et c'est voulu — une comparaison entre deux
 *  espaces différents ne veut rien dire et personne ne s'en apercevrait. */
export const MODELE = "insightface-buffalo_l-arcface512";

const FILS = 6;

let detecteur = null, encodeur = null;

export async function preparer() {
  if (detecteur && encodeur) return;
  // COMBIEN DE FILS, ET CE QUE COÛTAIT LA PRUDENCE (29/09/2026).
  //
  // On en donnait DEUX, « pour ne pas ralentir le Mac ». Mesuré sur la même détection, même image,
  // même modèle : 2 fils → 1 640 ms, 4 → 877, 6 → 682, 8 → 596. La prudence coûtait un facteur
  // deux et demi sur ce qui représente les trois quarts du temps du moteur.
  //
  // SIX, ET PAS HUIT. La machine en a dix : six laissent de quoi travailler dessus, et le service
  // tourne de toute façon en priorité « Adaptive » — macOS lui donne les cœurs rapides quand
  // personne ne se sert du Mac, et le bride dès qu'on y revient. C'est ce réglage-là qui protège
  // l'usage, pas un nombre de fils choisi au doigt mouillé.
  //
  // ET ON FAIT TAIRE LES AVERTISSEMENTS DE FORME (29/09/2026). SCRFD est exporté pour une entrée de
  // 640 pixels ; on le fait tourner à 1920, ce qui est parfaitement licite — les dimensions sont
  // dynamiques — mais onnxruntime prévient à chaque sortie qu'elle n'a pas la taille inscrite dans
  // le fichier. Neuf avertissements par photo, mille par galerie : le journal du service n'était
  // plus lisible, et un journal illisible est un journal que personne ne lit le jour où il dit
  // quelque chose. Niveau 3 : les erreurs, rien d'autre.
  const options = {
    executionProviders: ["cpu"], intraOpNumThreads: FILS, graphOptimizationLevel: "all",
    logSeverityLevel: 3,
  };
  detecteur = await ort.InferenceSession.create(join(ICI, "modeles", "detection.onnx"), options);
  encodeur = await ort.InferenceSession.create(join(ICI, "modeles", "reconnaissance.onnx"), options);
}

// ── La détection ────────────────────────────────────────────────────────────────────────────────
//
// SCRFD rend neuf tenseurs : pour chacune des trois échelles (un point tous les 8, 16 ou 32
// pixels), un score, une boîte et cinq points de repère. Les boîtes sont exprimées en DISTANCES
// depuis le point d'ancrage, pas en coordonnées : il faut les replier. Deux ancres par point.
const ETAGES = [
  { pas: 8,  iScore: 0, iBoite: 3, iPoints: 6 },
  { pas: 16, iScore: 1, iBoite: 4, iPoints: 7 },
  { pas: 32, iScore: 2, iBoite: 5, iPoints: 8 },
];
const ANCRES_PAR_POINT = 2;

/** Les visages d'une image, avec leurs cinq points de repère. `seuil` porte sur la confiance du
 *  détecteur, jamais sur la ressemblance : ce sont deux grandeurs sans rapport. */
export async function detecter(imageBrute, { seuil = 0.5, cote = 640 } = {}) {
  await preparer();

  const meta = await sharp(imageBrute).metadata();
  const echelle = Math.min(cote / meta.width, cote / meta.height);
  const l = Math.round(meta.width * echelle), h = Math.round(meta.height * echelle);

  // On redimensionne EN GARDANT LES PROPORTIONS et on complète en noir : déformer une image
  // déforme les visages, et un visage déformé ne ressemble plus à lui-même.
  const { data } = await sharp(imageBrute)
    .resize(l, h, { fit: "fill" })
    .extend({ top: 0, left: 0, bottom: cote - h, right: cote - l, background: { r: 0, g: 0, b: 0 } })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });

  // SCRFD attend du BGR centré : (x - 127,5) / 128, et les canaux séparés, pas entrelacés.
  const entree = new Float32Array(3 * cote * cote);
  const parCanal = cote * cote;
  for (let i = 0, p = 0; i < parCanal; i++, p += 3) {
    entree[i]               = (data[p + 2] - 127.5) / 128;
    entree[i + parCanal]    = (data[p + 1] - 127.5) / 128;
    entree[i + 2 * parCanal] = (data[p]     - 127.5) / 128;
  }

  const sorties = await detecteur.run({
    [detecteur.inputNames[0]]: new ort.Tensor("float32", entree, [1, 3, cote, cote]),
  });
  const t = detecteur.outputNames.map((n) => sorties[n]);

  const trouves = [];
  for (const etage of ETAGES) {
    const scores = t[etage.iScore].data, boites = t[etage.iBoite].data, points = t[etage.iPoints].data;
    const largeurGrille = Math.ceil(cote / etage.pas);
    for (let i = 0; i < scores.length; i++) {
      if (scores[i] < seuil) continue;
      const iPoint = Math.floor(i / ANCRES_PAR_POINT);
      const cx = (iPoint % largeurGrille) * etage.pas;
      const cy = Math.floor(iPoint / largeurGrille) * etage.pas;
      // Les quatre valeurs sont des distances au bord, en pas de grille : gauche, haut, droite, bas.
      const b = i * 4;
      const x1 = cx - boites[b] * etage.pas, y1 = cy - boites[b + 1] * etage.pas;
      const x2 = cx + boites[b + 2] * etage.pas, y2 = cy + boites[b + 3] * etage.pas;
      const rep = [];
      for (let k = 0; k < 5; k++) {
        const p = i * 10 + k * 2;
        rep.push([cx + points[p] * etage.pas, cy + points[p + 1] * etage.pas]);
      }
      trouves.push({ score: scores[i], boite: [x1, y1, x2 - x1, y2 - y1], reperes: rep });
    }
  }

  // Un même visage est trouvé plusieurs fois, par plusieurs ancres. On garde le meilleur et on
  // écarte ceux qui le recouvrent largement.
  trouves.sort((a, b) => b.score - a.score);
  const gardes = [];
  for (const d of trouves) {
    const [x, y, w, hh] = d.boite;
    const double = gardes.some((g) => {
      const [gx, gy, gw, gh] = g.boite;
      const ix = Math.max(0, Math.min(gx + gw, x + w) - Math.max(gx, x));
      const iy = Math.max(0, Math.min(gy + gh, y + hh) - Math.max(gy, y));
      const inter = ix * iy;
      return inter > 0.4 * Math.min(gw * gh, w * hh);
    });
    if (!double) gardes.push(d);
  }

  // On repasse dans les coordonnées de l'image d'origine.
  return gardes.map((d) => ({
    score: +d.score.toFixed(3),
    boite: d.boite.map((v) => v / echelle),
    reperes: d.reperes.map(([px, py]) => [px / echelle, py / echelle]),
  }));
}

/**
 * Les visages, vus à DEUX échelles (29/09/2026).
 *
 * MESURÉ SUR 40 PHOTOS RÉELLES, et ce n'est pas ce qu'on croyait. À 640 px comme à 1920 px, le
 * détecteur trouve exactement le même NOMBRE de visages — 71 chacun. Mais pas les mêmes : chaque
 * taille en trouve 9 que l'autre rate. Ce n'est donc pas « 1920 est meilleur », c'est « les deux
 * regardent ailleurs ». SCRFD est un détecteur à ancres, calibré pour une entrée de 640 : agrandir
 * l'image déplace les visages par rapport à ces ancres, ça en révèle certains et en cache d'autres.
 *
 * Les deux ensembles réunis font 80 visages, soit 13 % de plus, pour 12 % de temps en plus — 640 px
 * ne coûte que 193 ms quand 1920 en coûte 1 669. C'est le meilleur rapport de toutes les
 * combinaisons essayées (512, 640, 800, 960, 1280, 1600, 1920, seules et mélangées).
 *
 * L'ORDRE COMPTE, et c'est la raison pour laquelle on ne trie pas par score. Les repères d'un
 * visage trouvé à 640 px sont trois fois moins fins, et l'alignement d'ArcFace en dépend : mesuré,
 * la même tête donne des empreintes distantes de 0,24 en médiane selon la taille de détection —
 * beaucoup, quand une reconnaissance certaine se joue à 0,95. On garde donc TOUJOURS la version
 * 1920 d'un visage vu aux deux tailles, et on n'ajoute de 640 que ce qui manquait.
 */
export async function detecterFin(imageBrute, { seuil = 0.5, cotes = [1920, 640] } = {}) {
  const gardes = [];
  for (const cote of cotes) {
    for (const v of await detecter(imageBrute, { seuil, cote })) {
      const [x, y, w, h] = v.boite;
      const double = gardes.some((g) => {
        const [gx, gy, gw, gh] = g.boite;
        const ix = Math.max(0, Math.min(gx + gw, x + w) - Math.max(gx, x));
        const iy = Math.max(0, Math.min(gy + gh, y + h) - Math.max(gy, y));
        return ix * iy > 0.4 * Math.min(gw * gh, w * h);
      });
      if (!double) gardes.push(v);
    }
  }
  return gardes;
}

// ── L'empreinte ─────────────────────────────────────────────────────────────────────────────────
//
// ArcFace veut un visage ALIGNÉ : yeux, nez et bouche toujours aux mêmes endroits d'un carré de
// 112 pixels. Sans cet alignement, une tête penchée produit une empreinte très différente de la
// même tête droite, et on ne reconnaît plus personne. Les cinq points de repère servent à calculer
// la rotation, l'échelle et le décalage qui les y amènent.
const REFERENCE = [
  [38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366],
  [41.5493, 92.3655], [70.7299, 92.2041],
];

/** La transformation de similarité qui amène les cinq points sur la référence, au sens des
 *  moindres carrés (méthode d'Umeyama, réduite au cas d'une rotation, d'une échelle et d'une
 *  translation — jamais de déformation, qui abîmerait le visage). */
function transformation(reperes) {
  const n = reperes.length;
  const moy = (pts, i) => pts.reduce((s, p) => s + p[i], 0) / n;
  const mx = moy(reperes, 0), my = moy(reperes, 1);
  const rx = moy(REFERENCE, 0), ry = moy(REFERENCE, 1);

  let varSource = 0, a = 0, b = 0;
  for (let i = 0; i < n; i++) {
    const sx = reperes[i][0] - mx, sy = reperes[i][1] - my;
    const dx = REFERENCE[i][0] - rx, dy = REFERENCE[i][1] - ry;
    varSource += sx * sx + sy * sy;
    a += dx * sx + dy * sy;      // partie « cosinus »
    b += dy * sx - dx * sy;      // partie « sinus »
  }
  const norme = Math.hypot(a, b) || 1;
  const echelle = norme / (varSource || 1);
  const cos = (a / norme) * echelle, sin = (b / norme) * echelle;
  return {
    a: cos, b: -sin, c: rx - (cos * mx - sin * my),
    d: sin, e: cos,  f: ry - (sin * mx + cos * my),
  };
}

/** L'empreinte d'UN visage, déjà détecté. Rend 512 valeurs normalisées : deux empreintes se
 *  comparent alors par simple distance euclidienne, comme les anciennes. */
export async function empreinte(imageBrute, reperes) {
  await preparer();
  const t = transformation(reperes);

  // On applique la transformation inverse en lisant l'image d'origine : sharp ne sait pas faire de
  // transformation affine libre, on passe donc par une extraction et une rotation équivalentes.
  const { data, info } = await sharp(imageBrute).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: L, height: H, channels: C } = info;
  const det = t.a * t.e - t.b * t.d || 1e-9;
  const ia = t.e / det, ib = -t.b / det, ic = (t.b * t.f - t.e * t.c) / det;
  const id = -t.d / det, ie = t.a / det, iff = (t.d * t.c - t.a * t.f) / det;

  const COTE = 112;
  const entree = new Float32Array(3 * COTE * COTE);
  const parCanal = COTE * COTE;
  for (let y = 0; y < COTE; y++) {
    for (let x = 0; x < COTE; x++) {
      // Interpolation bilinéaire : sans elle, un visage un peu tourné devient crénelé, et le
      // modèle y perd autant qu'à un flou.
      const sx = ia * x + ib * y + ic, sy = id * x + ie * y + iff;
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const fx = sx - x0, fy = sy - y0;
      const lire = (px, py, canal) => {
        const cx = Math.min(L - 1, Math.max(0, px)), cy = Math.min(H - 1, Math.max(0, py));
        return data[(cy * L + cx) * C + canal];
      };
      const i = y * COTE + x;
      for (let canal = 0; canal < 3; canal++) {
        const v = lire(x0, y0, canal) * (1 - fx) * (1 - fy)
                + lire(x0 + 1, y0, canal) * fx * (1 - fy)
                + lire(x0, y0 + 1, canal) * (1 - fx) * fy
                + lire(x0 + 1, y0 + 1, canal) * fx * fy;
        // ArcFace attend du RGB centré sur (x - 127,5) / 127,5.
        entree[canal * parCanal + i] = (v - 127.5) / 127.5;
      }
    }
  }

  const sortie = await encodeur.run({
    [encodeur.inputNames[0]]: new ort.Tensor("float32", entree, [1, 3, COTE, COTE]),
  });
  const brut = sortie[encodeur.outputNames[0]].data;

  // NORMALISATION L2, ET ELLE N'EST PAS DÉCORATIVE. Deux empreintes normalisées se comparent par
  // distance euclidienne dans un intervalle stable : sans elle, la longueur du vecteur — qui
  // dépend surtout de la qualité de l'image — se mêlerait à la ressemblance.
  let norme = 0;
  for (let i = 0; i < brut.length; i++) norme += brut[i] * brut[i];
  norme = Math.sqrt(norme) || 1;
  const emp = new Array(brut.length);
  for (let i = 0; i < brut.length; i++) emp[i] = brut[i] / norme;
  return emp;
}

/** Les visages d'une image avec leur empreinte, en une fois. */
export async function visagesDe(imageBrute, options = {}) {
  // `cote` reste accepté pour une détection à une seule échelle (la photo de référence, où il n'y a
  // qu'un visage à trouver et où l'on veut la meilleure empreinte possible).
  const trouves = options.cote
    ? await detecter(imageBrute, options)
    : await detecterFin(imageBrute, options);
  const sortie = [];
  for (const v of trouves) {
    sortie.push({ ...v, empreinte: await empreinte(imageBrute, v.reperes) });
  }
  return sortie;
}

/** La distance entre deux empreintes. Euclidienne, comme partout ailleurs dans le produit — et la
 *  même unité que les seuils, leçon payée le 28/09. */
export const distance = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
  return Math.sqrt(s);
};
