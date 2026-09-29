// Trouver les personnes sur une photo (29/09/2026).
//
// POURQUOI. Un moteur de visages ne rend rien sur une photo de dos, et c'est précisément là que
// vit le numéro de maillot. Sur 36 photos réelles regardées une par une, 5 portent un dossard
// lisible, et TOUTES sont des vues de dos. Sans savoir où sont les corps, on cherche des chiffres
// dans l'herbe, les grillages et les poteaux — c'est exactement ce qui a fait inventer 110 numéros
// à l'ancien moteur.
//
// QUEL MODÈLE. SSD MobileNet v1, du zoo officiel d'ONNX. C'est la même famille que le coco-ssd que
// l'ancien moteur faisait tourner dans son navigateur, donc un comportement déjà éprouvé sur ces
// photos-là, mais ici en Node, sans Chromium.
//
// CE QU'IL REND. Des boîtes de personnes, dans les coordonnées de l'image d'origine. Rien d'autre :
// ni identité, ni empreinte. Une boîte de corps n'est pas une donnée biométrique et n'est
// conservée nulle part — elle sert le temps d'un calcul, comme le reste.
import ort from "onnxruntime-node";
import sharp from "sharp";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ICI = dirname(fileURLToPath(import.meta.url));
let session = null;

/** COCO : la classe 1 est « personne ». */
const CLASSE_PERSONNE = 1;

export async function preparerPersonnes() {
  if (session) return;
  session = await ort.InferenceSession.create(join(ICI, "modeles", "personnes.onnx"), {
    executionProviders: ["cpu"], intraOpNumThreads: 2, graphOptimizationLevel: "all",
    logSeverityLevel: 3,
  });
}

/**
 * Les personnes d'une image.
 *
 * `seuil` porte sur la confiance du détecteur. `minHauteur` écarte les silhouettes trop petites
 * pour porter quoi que ce soit de lisible : en dessous, on ne gagne que du bruit.
 */
export async function personnesDe(imageBrute, { seuil = 0.45, cote = 640, minHauteur = 0.08 } = {}) {
  await preparerPersonnes();
  const meta = await sharp(imageBrute).metadata();

  // SSD MobileNet prend des octets bruts, pas des flottants centrés : c'est un réseau entraîné
  // avec sa propre normalisation interne.
  const { data, info } = await sharp(imageBrute)
    .resize(cote, cote, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });

  const sorties = await session.run({
    "image_tensor:0": new ort.Tensor("uint8", new Uint8Array(data), [1, info.height, info.width, 3]),
  });
  const boites = sorties["detection_boxes:0"].data;
  const classes = sorties["detection_classes:0"].data;
  const scores = sorties["detection_scores:0"].data;
  const combien = Number(sorties["num_detections:0"].data[0]);

  const trouves = [];
  for (let i = 0; i < combien; i++) {
    if (Number(classes[i]) !== CLASSE_PERSONNE || scores[i] < seuil) continue;
    // Les boîtes arrivent normalisées, dans l'ordre haut, gauche, bas, droite.
    const [y1, x1, y2, x2] = [boites[i * 4], boites[i * 4 + 1], boites[i * 4 + 2], boites[i * 4 + 3]];
    const h = (y2 - y1) * meta.height;
    if (h < minHauteur * meta.height) continue;
    trouves.push({
      score: +scores[i].toFixed(3),
      boite: [x1 * meta.width, y1 * meta.height, (x2 - x1) * meta.width, h],
    });
  }
  return trouves.sort((a, b) => b.boite[3] - a.boite[3]);
}
