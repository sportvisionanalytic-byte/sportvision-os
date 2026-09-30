// LA PORTE DE L'ONGLET PRODUCTION (30/09/2026).
//
// L'onglet pointe sur `/prod`, qui n'est pas un ecran mais un dossier. Sans cette porte, expo-router
// n'a rien a afficher a cette adresse et previent qu'il manque une route : on tomberait sur un ecran
// vide au premier appui, ce qui est le pire des accueils.
//
// L'AFFECTATION EN PREMIER, parce que c'est le geste qui manquait et celui qui coute le plus cher
// quand il tarde : une prestation vendue sans personne dessus est une prestation qui s'annule.
import { Redirect } from "expo-router";

export default function PorteProduction() {
  return <Redirect href="/prod/affectation" />;
}
