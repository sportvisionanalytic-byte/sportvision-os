// Les filtres de la page Équipes, pour qui pilote le club.
//
//   node --test src/lib/teams/__tests__/pilotage.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compterParFiltre,
  filtreDepuisParam,
  filtrerEquipes,
  imageIncomplete,
  problemes,
  type EtatPilotage,
} from "../pilotage.ts";

const base: EtatPilotage = {
  team_id: "x", nom: "U14 D1", categorie: "U14", section: "Masculin",
  joueurs: 18, encadrant_statut: "actif", creneaux: 2, evenements: 20, image_valides: 18,
};
const E = (p: Partial<EtatPilotage>): EtatPilotage => ({ ...base, ...p, team_id: p.nom ?? base.nom });

const CLUB = [
  E({ nom: "U14 D1" }),
  E({ nom: "U14 D4", encadrant_statut: "aucun" }),
  E({ nom: "U15 F", categorie: "U15", section: "Féminin", joueurs: 0, image_valides: 0 }),
  E({ nom: "Séniors R2", categorie: "Seniors", image_valides: 16 }),
  E({ nom: "U8 A", categorie: "U8", creneaux: 0, evenements: 0, joueurs: 0, image_valides: 0, encadrant_statut: "prepare" }),
];

test("une équipe complète n'a aucun problème", () => {
  assert.deepEqual(problemes(base), []);
});

test("une équipe sans joueur mais avec des matchs dit « Effectif non renseigné », pas « configurée »", () => {
  assert.deepEqual(problemes(E({ joueurs: 0, image_valides: 0 })), ["Effectif non renseigné"]);
});

test("sans joueur, le droit à l'image n'est pas « incomplet » : il n'y a rien à mesurer", () => {
  assert.equal(imageIncomplete(E({ joueurs: 0, image_valides: 0 })), false);
  assert.equal(imageIncomplete(E({ joueurs: 18, image_valides: 16 })), true);
});

test("une invitation préparée suffit à ne plus être « sans coach »", () => {
  assert.equal(problemes(E({ encadrant_statut: "prepare" })).includes("Coach manquant"), false);
});

test("les compteurs de filtres", () => {
  assert.deepEqual(compterParFiltre(CLUB), { toutes: 5, sans_coach: 1, effectif: 2, image: 1, probleme: 4 });
});

test("filtre, catégorie, sexe et recherche se combinent", () => {
  assert.deepEqual(filtrerEquipes(CLUB, { filtre: "effectif", categorie: "", section: "Féminin", recherche: "" }).map((e) => e.nom), ["U15 F"]);
  assert.deepEqual(filtrerEquipes(CLUB, { filtre: "toutes", categorie: "", section: "", recherche: "seniors" }).map((e) => e.nom), ["Séniors R2"]);
  assert.deepEqual(filtrerEquipes(CLUB, { filtre: "probleme", categorie: "U14", section: "", recherche: "" }).map((e) => e.nom), ["U14 D4"]);
});

test("un paramètre inconnu retombe sur « Toutes »", () => {
  assert.equal(filtreDepuisParam("sans_coach"), "sans_coach");
  assert.equal(filtreDepuisParam("n_importe_quoi"), "toutes");
  assert.equal(filtreDepuisParam(null), "toutes");
});
