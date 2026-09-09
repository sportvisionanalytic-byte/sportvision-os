// Plannings « par blocs » : la date est un titre de section, pas une colonne.
//
// Beaucoup de clubs tiennent leur planning ainsi, un onglet par mois (constaté le 09/09/2026 sur
// le planning réel de Villemomble Sports) :
//
//   PLANNING DES MATCHS VILLEMOMBLE SPORTS FOOTBALL 2026
//   46246                                                 ← la date, seule dans sa cellule
//   CATEGORIES VSF | ADVERSAIRES | RDV | EDUCATEURS | COMPETITION | HORAIRES | LIEU
//   Séniors R2     | Meaux       | 19h |            | Amical      | 20h15    | Stade Ripert
//   (lignes vides, puis le bloc suivant avec une autre date)
//
// La détection par contenu ne trouvait alors aucune colonne date et refusait tout le fichier.
//
// Le remède ne crée AUCUNE règle de lecture nouvelle : on ajoute simplement une colonne date à
// chaque ligne, reprise du dernier titre de section rencontré. Le moteur habituel reconnaît
// ensuite ce fichier comme n'importe quel tableau.

import { parseFlexibleDate } from "./normalize.ts";

/** Une ligne qui ne porte qu'UNE valeur, et que cette valeur soit une date, est un titre de
 *  section. Deux valeurs ou plus, c'est une ligne de données — même si l'une est une date. */
function dateDeSection(ligne: string[]): string | null {
  const remplies = ligne.map((c) => (c ?? "").trim()).filter((c) => c !== "");
  if (remplies.length !== 1) return null;
  return parseFlexibleDate(remplies[0]!);
}

/**
 * Renvoie les lignes avec une colonne date ajoutée en fin, ou `null` si le fichier ne ressemble
 * pas à un planning par blocs.
 *
 * On exige au moins deux sections datées : une seule pourrait n'être qu'une cellule isolée dans
 * un tableau ordinaire, et on ne veut pas transformer un fichier normal sur un hasard.
 */
/** La premiere cellule remplie d'une ligne, normalisee. */
function premiereValeur(ligne: string[]): string {
  return (ligne.find((c) => (c ?? "").trim() !== "") ?? "").trim().toLowerCase();
}

/** Signature d'une ligne, pour reconnaitre les en-tetes repetes au milieu de la feuille. */
function signature(ligne: string[]): string {
  return ligne.map((c) => (c ?? "").trim().toLowerCase()).join("\u0001");
}

export function enrichirDepuisSections(lignes: string[][]): string[][] | null {
  const largeur = lignes.reduce((max, l) => Math.max(max, l.length), 0);
  const complete = (l: string[]) => [...l, ...Array(Math.max(0, largeur - l.length)).fill("")];

  // 1. Trouver la ligne d'en-tete : la premiere qui porte au moins trois intitules.
  let entete: string[] | null = null;
  let signatureEntete: string | null = null;
  let premiereEntete = "";
  for (const ligne of lignes) {
    if (dateDeSection(ligne)) continue;
    const c = complete(ligne);
    if (c.filter((x) => (x ?? "").trim() !== "").length >= 3) {
      entete = c;
      signatureEntete = signature(c);
      premiereEntete = premiereValeur(c);
      break;
    }
  }
  if (!entete) return null;

  // 2. Reconstruire un tableau ORDINAIRE : l'en-tete en premier, puis les seules lignes de
  //    donnees, chacune portant la date de sa section.
  //
  //    Sans cette remise a plat, la detection ne trouvait aucune ligne d'en-tete — elle est au
  //    milieu de la feuille, precedee du titre du club et de la date — et se rabattait sur le
  //    contenu seul. Elle prenait alors la colonne des categories pour le lieu et le lieu pour
  //    l'adversaire. Les intitules etaient pourtant la, il fallait juste les lui donner.
  const sortie: string[][] = [[...entete, "Date"]];
  let sections = 0;
  let courante: string | null = null;

  for (const ligne of lignes) {
    const date = dateDeSection(ligne);
    if (date) {
      courante = date;
      sections++;
      continue;
    }
    const c = complete(ligne);
    // En-tete repete a chaque bloc. On compare la ligne entiere ET, a defaut, sa premiere cellule
    // remplie : d'un bloc a l'autre l'en-tete varie parfois d'une cellule de fin, ce qui suffisait
    // a le laisser passer pour un match dont l'adversaire s'appelait « ADVERSAIRES ».
    if (signature(c) === signatureEntete) continue;
    if (premiereValeur(c) !== "" && premiereValeur(c) === premiereEntete) continue;
    // Un match porte au minimum une equipe et un adversaire. Une ligne a zero ou une seule valeur
    // est un titre de bloc (« PLANNING DES MATCHS… »), une ligne vide, ou une note.
    if (c.filter((x) => (x ?? "").trim() !== "").length < 2) continue;
    if (!courante) continue;                                        // avant la premiere date
    sortie.push([...c, courante]);
  }

  // Au moins deux sections datees : une cellule-date isolee dans un tableau ordinaire ne doit pas
  // declencher cette lecture.
  if (sections < 2 || sortie.length < 2) return null;
  return sortie;
}
