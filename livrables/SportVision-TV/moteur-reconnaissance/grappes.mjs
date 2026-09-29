// REGROUPER LES VISAGES AVANT DE LES NOMMER (29/09/2026).
//
// L'IDEE, ET CE QU'ELLE CHANGE. Jusqu'ici on comparait chaque visage de la galerie a la photo de
// reference, un par un. Un visage de trois quarts, mal eclaire ou flou tombait au-dela du seuil et
// etait perdu — meme quand il ressemblait beaucoup a un AUTRE visage de la meme galerie, lui
// parfaitement reconnu.
//
// On regroupe donc d'abord tous les visages entre eux : une grappe, c'est une personne, vue sous
// tous ses angles ce jour-la. Il suffit alors qu'UN SEUL visage de la grappe soit reconnu pour que
// toute la grappe prenne le nom. C'est ce qui permet de retrouver quelqu'un de profil : ce n'est
// plus lui qui doit ressembler a sa photo de reference, c'est lui qui doit ressembler a lui-meme
// de face — et la, il n'y a plus de doute.
//
// POURQUOI CA MARCHE MAINTENANT ET PAS AVANT. Avec l'ancien modele, deux personnes differentes
// descendaient a 0,574 et la meme personne montait a 0,53 : les grappes auraient fusionne des
// inconnus des le premier chainage. Avec ArcFace, deux personnes differentes ne descendent pas
// sous 1,41 et la meme est a 0,30. C'est cette marge qui rend le regroupement sur.
//
// CE QUI BORNE LA DERIVE, parce qu'un chainage mal regle finit toujours par relier deux enfants :
//   - deux visages d'une MEME photo ne peuvent jamais tomber dans la meme grappe ;
//   - on fusionne par lien MOYEN, pas par lien simple : une seule paire proche ne suffit pas a
//     coller deux grappes, il faut que l'ensemble se ressemble ;
//   - et le seuil de fusion est plus severe que celui qui sert a reconnaitre.
import { distance } from "./visages.mjs";

/**
 * Regrouper des visages en personnes.
 *
 * `visages` : [{ cle, asset, emp }]  — `cle` identifie le visage, `asset` la photo.
 * Rend [{ membres:[cle], centre:[...], assets:Set }] : les grappes, de la plus grande a la plus petite.
 */
export function regrouper(visages, { seuilFusion = 0.9, minMoyen = 1.0 } = {}) {
  // Chaque visage commence seul.
  let grappes = visages.map((v) => ({ membres: [v], assets: new Set([v.asset]) }));

  // Les distances, calculees une fois. Sur 284 visages cela fait 40 000 paires : c'est instantane,
  // et les recalculer a chaque tour de fusion ne le serait pas.
  const n = visages.length;
  const d = new Float32Array(n * n);
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      d[i * n + j] = d[j * n + i] = distance(visages[i].emp, visages[j].emp);
  const index = new Map(visages.map((v, i) => [v.cle, i]));

  /** La distance MOYENNE entre deux grappes. Le lien moyen resiste a une paire trompeuse, la ou le
   *  lien simple — la paire la plus proche — suffirait a coller deux personnes qui se ressemblent
   *  sur une seule photo. */
  const ecart = (a, b) => {
    let s = 0, k = 0;
    for (const x of a.membres) for (const y of b.membres) { s += d[index.get(x.cle) * n + index.get(y.cle)]; k++; }
    return k ? s / k : Infinity;
  };

  // Fusion agglomerative : on rapproche la paire la plus proche tant qu'elle est sous le seuil.
  for (;;) {
    let meilleur = null, best = Infinity;
    for (let i = 0; i < grappes.length; i++) {
      for (let j = i + 1; j < grappes.length; j++) {
        // DEUX VISAGES D'UNE MEME PHOTO SONT DEUX PERSONNES. C'est la seule certitude gratuite
        // dont on dispose, et elle empeche la plupart des fusions abusives.
        let memePhoto = false;
        for (const a of grappes[i].assets) if (grappes[j].assets.has(a)) { memePhoto = true; break; }
        if (memePhoto) continue;
        const e = ecart(grappes[i], grappes[j]);
        if (e < best) { best = e; meilleur = [i, j]; }
      }
    }
    if (!meilleur || best >= seuilFusion) break;
    const [i, j] = meilleur;
    grappes[i].membres = grappes[i].membres.concat(grappes[j].membres);
    for (const a of grappes[j].assets) grappes[i].assets.add(a);
    grappes.splice(j, 1);
  }

  // Le centre d'une grappe : la moyenne de ses empreintes, renormalisee. C'est un visage moyen,
  // plus stable que n'importe lequel de ses membres, et c'est lui qu'on presentera a la base.
  for (const g of grappes) {
    const dim = g.membres[0].emp.length;
    const c = new Array(dim).fill(0);
    for (const m of g.membres) for (let k = 0; k < dim; k++) c[k] += m.emp[k];
    let norme = 0;
    for (let k = 0; k < dim; k++) { c[k] /= g.membres.length; norme += c[k] * c[k]; }
    norme = Math.sqrt(norme) || 1;
    for (let k = 0; k < dim; k++) c[k] /= norme;
    g.centre = c;
    // La cohesion dit si la grappe tient : une grappe etalee est probablement un melange, et on
    // refusera de la nommer d'un coup.
    let s = 0, k = 0;
    for (let x = 0; x < g.membres.length; x++)
      for (let y = x + 1; y < g.membres.length; y++) { s += distance(g.membres[x].emp, g.membres[y].emp); k++; }
    g.cohesion = k ? s / k : 0;
    g.fiable = g.cohesion < minMoyen;
  }

  return grappes.sort((a, b) => b.membres.length - a.membres.length);
}
