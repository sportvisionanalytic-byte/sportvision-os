// Reconstruction d'un tableau à partir des morceaux de texte d'un PDF.
//
// Un PDF ne contient pas de lignes ni de colonnes : il contient des fragments de texte posés à des
// coordonnées. « 14/09/2026 » peut arriver en un seul morceau, en trois, ou entrecoupé d'espaces
// positionnés. Tout le travail est ici : regrouper ces fragments en lignes, puis en cellules, sans
// jamais décaler une valeur d'une colonne — le pire résultat possible pour un club qui ferait
// confiance à l'import (cf. l'en-tête du provider .xlsx, même règle).
//
// Volontairement séparé de l'extraction elle-même (src/lib/pdf/extraire-texte.ts, qui dépend de
// pdf.js) : ce fichier est du TypeScript pur, sans dépendance, donc exécutable tel quel par le
// harnais de tests. C'est la logique fragile, c'est donc celle qui doit être testable.

/** Un fragment de texte tel que le PDF le pose. L'origine des y est en BAS de la page. */
export interface ElementTexte {
  texte: string;
  x: number;
  y: number;
  largeur: number;
  hauteur: number;
  page: number;
}

export interface OptionsLignes {
  /** Part des lignes qui doivent partager une même abscisse pour qu'on y voie une colonne. */
  partMinimaleColonne?: number;
}

const PART_MINIMALE_COLONNE = 0.3;

/** Deux fragments appartiennent à la même ligne si leurs bases sont plus proches que ça, exprimé
 * en fraction de la hauteur de caractère. Un indice ou un exposant ne doit pas créer une ligne. */
const TOLERANCE_LIGNE = 0.6;

/** Au-delà de cet écart, exprimé en fraction de la hauteur de caractère, on change de cellule.
 * Une espace typographique vaut environ 0,25 hauteur ; un séparateur de colonne est bien plus
 * large. Le seuil est volontairement haut : mieux vaut fusionner deux colonnes, ce qui se voit
 * immédiatement à l'écran, que couper une valeur en deux, ce qui ne se voit pas. */
const ECART_CELLULE = 0.9;

function mediane(valeurs: number[]): number {
  if (valeurs.length === 0) return 0;
  const t = [...valeurs].sort((a, b) => a - b);
  const m = Math.floor(t.length / 2);
  return t.length % 2 ? t[m]! : (t[m - 1]! + t[m]!) / 2;
}

/** Les fragments d'une page, regroupés en lignes visuelles, chacune triée de gauche à droite. */
function grouperEnLignes(elements: ElementTexte[], hauteur: number): ElementTexte[][] {
  const tries = [...elements].sort((a, b) => b.y - a.y || a.x - b.x);
  const lignes: ElementTexte[][] = [];
  let courante: ElementTexte[] = [];
  let reference = Number.NaN;

  for (const el of tries) {
    if (courante.length === 0 || Math.abs(el.y - reference) <= hauteur * TOLERANCE_LIGNE) {
      if (courante.length === 0) reference = el.y;
      courante.push(el);
    } else {
      lignes.push(courante.sort((a, b) => a.x - b.x));
      courante = [el];
      reference = el.y;
    }
  }
  if (courante.length > 0) lignes.push(courante.sort((a, b) => a.x - b.x));
  return lignes;
}

/**
 * Les abscisses où commencent des colonnes.
 *
 * On ne devine pas le nombre de colonnes : on regarde où les fragments s'alignent réellement d'une
 * ligne à l'autre. Une abscisse partagée par une part suffisante des lignes est une colonne. C'est
 * ce qui permet de tenir quand une cellule est VIDE : sans alignement global, la valeur suivante
 * remonterait d'un cran et tout le tableau serait décalé.
 */
function detecterColonnes(lignes: ElementTexte[][], hauteur: number, partMinimale: number): number[] {
  const tolerance = hauteur * 0.75;
  const comptes = new Map<number, Set<number>>();

  lignes.forEach((ligne, index) => {
    for (const el of ligne) {
      // Arrondi à la tolérance près pour que deux départs quasi identiques comptent ensemble.
      const cle = Math.round(el.x / tolerance);
      if (!comptes.has(cle)) comptes.set(cle, new Set());
      comptes.get(cle)!.add(index);
    }
  });

  const seuil = Math.max(2, Math.ceil(lignes.length * partMinimale));
  return [...comptes.entries()]
    .filter(([, lignesVues]) => lignesVues.size >= seuil)
    .map(([cle]) => cle * tolerance)
    .sort((a, b) => a - b);
}

/** Découpage d'une ligne sur les écarts, quand aucune structure de colonnes ne se dégage. */
function decouperParEcarts(ligne: ElementTexte[], hauteur: number): string[] {
  const cellules: string[] = [];
  let accumulateur = "";
  let finPrecedente = Number.NaN;

  for (const el of ligne) {
    const ecart = el.x - finPrecedente;
    if (accumulateur !== "" && ecart > hauteur * ECART_CELLULE) {
      cellules.push(accumulateur.trim());
      accumulateur = el.texte;
    } else {
      // Un fragment collé au précédent ne prend pas d'espace : « 14/ » + « 09 » fait « 14/09 ».
      const colle = accumulateur !== "" && ecart < hauteur * 0.12;
      accumulateur += (accumulateur === "" || colle ? "" : " ") + el.texte;
    }
    finPrecedente = el.x + el.largeur;
  }
  if (accumulateur.trim() !== "") cellules.push(accumulateur.trim());
  return cellules;
}

/** Répartition d'une ligne dans des colonnes connues. Une colonne sans fragment reste vide. */
function repartirDansColonnes(ligne: ElementTexte[], colonnes: number[], hauteur: number): string[] {
  const cellules = colonnes.map(() => "");
  const finParColonne = colonnes.map(() => Number.NaN);
  const marge = hauteur * 0.75;

  for (const el of ligne) {
    let index = 0;
    for (let i = 0; i < colonnes.length; i++) {
      if (el.x + marge >= colonnes[i]!) index = i;
      else break;
    }
    const colle = cellules[index] !== "" && el.x - finParColonne[index]! < hauteur * 0.12;
    cellules[index] += (cellules[index] === "" || colle ? "" : " ") + el.texte;
    finParColonne[index] = el.x + el.largeur;
  }
  return cellules.map((c) => c.trim());
}

/**
 * Les lignes d'un PDF, prêtes pour le moteur de détection par contenu (autodetect.ts) — le même
 * qui lit un CSV ou un tableur. Aucune règle propre au PDF au-delà d'ici : un calendrier reste un
 * calendrier, quel que soit le format dans lequel le club l'a reçu.
 */
export function elementsVersLignes(elements: ElementTexte[], options: OptionsLignes = {}): string[][] {
  const utiles = elements.filter((el) => el.texte.trim() !== "");
  if (utiles.length === 0) return [];

  const hauteur = mediane(utiles.map((el) => el.hauteur).filter((h) => h > 0)) || 10;
  const partMinimale = options.partMinimaleColonne ?? PART_MINIMALE_COLONNE;

  const pages = [...new Set(utiles.map((el) => el.page))].sort((a, b) => a - b);
  const resultat: string[][] = [];

  for (const page of pages) {
    const lignes = grouperEnLignes(utiles.filter((el) => el.page === page), hauteur);
    // Les colonnes sont cherchées page par page : un calendrier peut changer de mise en page
    // entre la page de garde et le tableau lui-même.
    const colonnes = detecterColonnes(lignes, hauteur, partMinimale);
    const enTableau = colonnes.length >= 2;

    for (const ligne of lignes) {
      const cellules = enTableau
        ? repartirDansColonnes(ligne, colonnes, hauteur)
        : decouperParEcarts(ligne, hauteur);
      if (cellules.some((c) => c !== "")) resultat.push(cellules);
    }
  }

  return resultat;
}
