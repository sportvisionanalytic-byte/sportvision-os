// Les équipes vues par qui pilote le club : ce qui manque à chacune, et les filtres qui les
// trouvent. Fonctions pures, testées seules (__tests__/pilotage.test.ts). Les chiffres viennent
// tous de `club_equipes_etat` : rien n'est recompté ici.

export type FiltreEquipes = "toutes" | "sans_coach" | "effectif" | "image" | "probleme";

export const FILTRES_EQUIPES: { id: FiltreEquipes; libelle: string }[] = [
  { id: "toutes", libelle: "Toutes" },
  { id: "sans_coach", libelle: "Sans coach" },
  { id: "effectif", libelle: "Effectif incomplet" },
  { id: "image", libelle: "Droit à l'image incomplet" },
  { id: "probleme", libelle: "Avec problème" },
];

/** Ce que la base dit d'une équipe — le sous-ensemble dont les filtres ont besoin. */
export interface EtatPilotage {
  team_id: string;
  nom: string;
  categorie: string | null;
  section: string | null;
  joueurs: number;
  encadrant_statut: string;
  creneaux: number;
  evenements: number;
  image_valides: number;
}

export function sansCoach(e: EtatPilotage): boolean {
  return e.encadrant_statut === "aucun";
}

/** Aucun joueur : l'effectif n'est pas renseigné, même si l'équipe a déjà des matchs. */
export function effectifIncomplet(e: EtatPilotage): boolean {
  return e.joueurs === 0;
}

/** Des joueurs dont l'autorisation n'est pas validée. Sans joueur, il n'y a rien à mesurer :
 *  l'équipe tombe dans « Effectif incomplet », pas ici. */
export function imageIncomplete(e: EtatPilotage): boolean {
  return e.joueurs > 0 && e.image_valides < e.joueurs;
}

/** Les problèmes d'une équipe, dans l'ordre où on les résout. */
export function problemes(e: EtatPilotage): string[] {
  const p: string[] = [];
  if (sansCoach(e)) p.push("Coach manquant");
  if (effectifIncomplet(e)) p.push(e.evenements > 0 ? "Effectif non renseigné" : "Aucun joueur");
  if (imageIncomplete(e)) p.push("Droit à l'image incomplet");
  if (e.creneaux === 0) p.push("Sans entraînement");
  if (e.evenements === 0) p.push("Calendrier vide");
  return p;
}

export function passeFiltre(e: EtatPilotage, filtre: FiltreEquipes): boolean {
  switch (filtre) {
    case "sans_coach":
      return sansCoach(e);
    case "effectif":
      return effectifIncomplet(e);
    case "image":
      return imageIncomplete(e);
    case "probleme":
      return problemes(e).length > 0;
    default:
      return true;
  }
}

/** Les liens du tableau de bord parlent la même langue : `/teams?filtre=sans_coach`. */
export function filtreDepuisParam(valeur: string | null): FiltreEquipes {
  return FILTRES_EQUIPES.some((f) => f.id === valeur) ? (valeur as FiltreEquipes) : "toutes";
}

export interface CriteresEquipes {
  filtre: FiltreEquipes;
  categorie: string;
  section: string;
  recherche: string;
}

function normaliser(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export function filtrerEquipes<T extends EtatPilotage>(etats: T[], c: CriteresEquipes): T[] {
  const q = normaliser(c.recherche);
  return etats.filter(
    (e) =>
      passeFiltre(e, c.filtre) &&
      (!c.categorie || e.categorie === c.categorie) &&
      (!c.section || e.section === c.section) &&
      (!q || normaliser(e.nom).includes(q)),
  );
}

export function compterParFiltre(etats: EtatPilotage[]): Record<FiltreEquipes, number> {
  return {
    toutes: etats.length,
    sans_coach: etats.filter(sansCoach).length,
    effectif: etats.filter(effectifIncomplet).length,
    image: etats.filter(imageIncomplete).length,
    probleme: etats.filter((e) => problemes(e).length > 0).length,
  };
}
