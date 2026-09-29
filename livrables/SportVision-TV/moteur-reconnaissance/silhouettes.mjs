// Reconnaître quelqu'un de dos (29/09/2026).
//
// LE PROBLÈME, ET IL EST PARTICULIER AU SPORT. Fouka : « même de dos, que tu arrives à le
// reconnaître ». Un moteur de visages ne rend rien sur une vue de dos, et c'est une part énorme des
// photos de match. Mais l'astuce habituelle — décrire les vêtements — ne marche justement pas ici :
// une équipe porte un maillot IDENTIQUE. Décrire le maillot, c'est décrire l'équipe, pas le joueur.
//
// CE QUI RESTE POUR DISTINGUER DEUX COÉQUIPIERS DE DOS : les cheveux d'abord — blond bouclé, afro,
// dreadlocks, court châtain, c'est ce que l'œil humain utilise et c'est ce que Fouka décrit lui-même
// — puis la carnation des bras et des jambes, et la corpulence.
//
// CE FICHIER NE DÉCIDE RIEN TOUT SEUL. Il rapproche des corps. C'est le moteur qui, ayant nommé un
// visage, propage le nom aux vues de dos assez proches, et c'est la famille qui tranche.
import { pixelsDe } from "./dossards.mjs";

/** Douze teintes : assez pour séparer un blond d'un brun, assez peu pour qu'une même tête au soleil
 *  et à l'ombre reste la même. */
const TEINTES = 12;

/**
 * La signature d'une zone : un histogramme de teintes pondéré par la saturation, plus la clarté et
 * la saturation moyennes.
 *
 * Pondéré par la saturation, parce qu'un pixel gris n'a pas de teinte fiable : lui donner une voix
 * égale ferait du bruit le principal contributeur.
 */
function signatureZone(image, x, y, w, h) {
  const { pixels, largeur, hauteur, canaux } = image;
  const X = Math.max(0, Math.round(x)), Y = Math.max(0, Math.round(y));
  const W = Math.max(1, Math.min(largeur - X, Math.round(w)));
  const H = Math.max(1, Math.min(hauteur - Y, Math.round(h)));
  const hist = new Float32Array(TEINTES);
  let n = 0, sommeL = 0, sommeS = 0;
  for (let ly = 0; ly < H; ly++) {
    for (let lx = 0; lx < W; lx++) {
      const k = ((Y + ly) * largeur + (X + lx)) * canaux;
      const r = pixels[k] / 255, g = pixels[k + 1] / 255, b = pixels[k + 2] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), c = mx - mn;
      let t = 0;
      if (c > 0.001) {
        if (mx === r) t = ((g - b) / c + 6) % 6;
        else if (mx === g) t = (b - r) / c + 2;
        else t = (r - g) / c + 4;
        t = (t / 6) * TEINTES;
      }
      const sat = mx === 0 ? 0 : c / mx;
      hist[Math.min(TEINTES - 1, Math.floor(t))] += sat;
      sommeL += 0.299 * r + 0.587 * g + 0.114 * b;
      sommeS += sat;
      n++;
    }
  }
  const total = hist.reduce((a, v) => a + v, 0) || 1;
  const sortie = new Float32Array(TEINTES + 2);
  for (let i = 0; i < TEINTES; i++) sortie[i] = hist[i] / total;
  sortie[TEINTES] = n ? sommeL / n : 0;
  sortie[TEINTES + 1] = n ? sommeS / n : 0;
  return sortie;
}

/**
 * Les trois façons de décrire un corps qu'on a mesurées.
 *
 * `corps`   — six bandes sur toute la hauteur : cheveux, épaules, maillot, hanches, cuisses,
 *             chaussettes. C'est ce que faisait l'ancien moteur.
 * `tete`    — la tête seule, c'est-à-dire les cheveux, découpée en trois bandes.
 * `teteJambes` — la tête et le bas des jambes, en sautant le maillot, qui est le même pour tous.
 */
export const DESCRIPTEURS = {
  corps: (image, [x, y, w, h]) => {
    const s = [];
    for (let b = 0; b < 6; b++) s.push(signatureZone(image, x, y + h * b / 6, w, h / 6));
    return concat(s);
  },
  tete: (image, [x, y, w, h]) => {
    const s = [];
    for (let b = 0; b < 3; b++)
      s.push(signatureZone(image, x + w * 0.25, y + h * (0.02 + 0.055 * b), w * 0.5, h * 0.055));
    return concat(s);
  },
  teteJambes: (image, [x, y, w, h]) => {
    const s = [];
    for (let b = 0; b < 3; b++)
      s.push(signatureZone(image, x + w * 0.25, y + h * (0.02 + 0.055 * b), w * 0.5, h * 0.055));
    for (let b = 0; b < 2; b++)
      s.push(signatureZone(image, x, y + h * (0.70 + 0.15 * b), w, h * 0.15));
    return concat(s);
  },
};

function concat(parts) {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Float32Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Distance euclidienne. Les histogrammes sont déjà normalisés, les moyennes sont dans [0,1] :
 *  aucune dimension n'écrase les autres. */
export function distanceSignature(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
  return Math.sqrt(s);
}

export { pixelsDe };
