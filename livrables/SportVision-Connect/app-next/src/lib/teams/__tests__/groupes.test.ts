// Le regroupement d'équipes, sur les 38 équipes réelles de SF Villemomble.
//
//   node --test src/lib/teams/__tests__/groupes.test.ts
//
// Les groupes ne sont jamais codés en dur : ils se déduisent des équipes présentes. Ces tests
// vérifient donc la RÈGLE, pas une liste attendue pour un club en particulier — un club de basket
// avec cinq équipes doit obtenir cinq lignes propres, pas quinze rubriques vides.

import { test } from "node:test";
import assert from "node:assert/strict";
import { grouperEquipes, filtrerGroupes, estFeminine, type EquipeChoisissable } from "../groupes.ts";

/** Les 38 équipes de SF Villemomble au 09/09/2026, avec leur catégorie en base. */
const VILLEMOMBLE: EquipeChoisissable[] = [
  { name: "Anciens D1", categorie: "Vétérans", section: "Masculin" },
  { name: "Super Vétérans", categorie: "Vétérans", section: "Masculin" },
  { name: "Spécifique Gardiens", categorie: "Gardiens", section: "Mixte" },
  { name: "Séniors R2", categorie: "Seniors", section: "Masculin" },
  { name: "Séniors D1", categorie: "Seniors", section: "Masculin" },
  { name: "Séniors D2", categorie: "Seniors", section: "Masculin" },
  { name: "Séniors Féminines", categorie: "Seniors", section: "Féminin" },
  { name: "U18 R3", categorie: "U18", section: "Masculin" },
  { name: "U18 D2", categorie: "U18", section: "Masculin" },
  { name: "U18 F", categorie: "U18", section: "Féminin" },
  { name: "U16 D1", categorie: "U16", section: "Masculin" },
  { name: "U16 D3", categorie: "U16", section: "Masculin" },
  { name: "U15 F", categorie: "U15", section: "Féminin" },
  { name: "U14 D1", categorie: "U14", section: "Masculin" },
  { name: "U14 D4", categorie: "U14", section: "Masculin" },
  { name: "U14 C", categorie: "U14", section: "Masculin" },
  { name: "U13", categorie: "U13", section: "Masculin" },
  { name: "U13 Avenir", categorie: "U13", section: "Masculin" },
  { name: "U13 Espoir", categorie: "U13", section: "Masculin" },
  { name: "U13 F", categorie: "U13", section: "Féminin" },
  { name: "U12 Élite", categorie: "U12", section: "Masculin" },
  { name: "U12 Espoir 1", categorie: "U12", section: "Masculin" },
  { name: "U12 Espoir 2", categorie: "U12", section: "Masculin" },
  { name: "U12 REG", categorie: "U12", section: "Masculin" },
  { name: "U12 F", categorie: "U12", section: "Féminin" },
  { name: "U11 Élite", categorie: "U11", section: "Masculin" },
  { name: "U11 Espoir 1", categorie: "U11", section: "Masculin" },
  { name: "U11 Espoir 2", categorie: "U11", section: "Masculin" },
  { name: "U11 Avenir", categorie: "U11", section: "Masculin" },
  { name: "U11 F", categorie: "U11", section: "Féminin" },
  { name: "U10 Élite", categorie: "U10", section: "Masculin" },
  { name: "U10 Espoir 1", categorie: "U10", section: "Masculin" },
  { name: "U10 Espoir 2", categorie: "U10", section: "Masculin" },
  { name: "U10 Avenir", categorie: "U10", section: "Masculin" },
  { name: "U9", categorie: "U9", section: "Masculin" },
  { name: "U8", categorie: "U8", section: "Masculin" },
  { name: "U7", categorie: "U7", section: "Masculin" },
  { name: "U6", categorie: "U6", section: "Masculin" },
];

test("les 38 équipes se replient en une liste qu'on embrasse d'un regard", () => {
  const groupes = grouperEquipes(VILLEMOMBLE);
  assert.equal(groupes.reduce((n, g) => n + g.equipes.length, 0), 38, "aucune équipe perdue");
  assert.ok(!groupes.some((g) => g.equipes.length === 0), "aucun groupe vide");
  // 15 groupes fermés pour 38 équipes : c'est le nombre de tranches réellement présentes chez ce
  // club, pas un chiffre qu'on s'est fixé. Le gain n'est pas d'atteindre un seuil arbitraire mais
  // de remplacer une liste plate par des rubriques qu'on parcourt sans défiler.
  assert.ok(
    groupes.length < VILLEMOMBLE.length / 2,
    `${groupes.length} groupes pour ${VILLEMOMBLE.length} équipes : le repli doit diviser la liste, pas la recopier`,
  );
});

test("l'ordre est sportif, jamais alphabétique", () => {
  const ids = grouperEquipes(VILLEMOMBLE).map((g) => g.id);
  assert.equal(ids[0], "seniors", "les Seniors d'abord");
  const u = ids.filter((i) => /^u\d+$/.test(i));
  assert.deepEqual(u, ["u18", "u16", "u15", "u14", "u13", "u12", "u11", "u10", "u9", "u8", "u7", "u6"],
    "du plus âgé au plus jeune ; l'alphabétique mettrait U10 avant U9");
  assert.ok(ids.indexOf("veterans") > ids.indexOf("u6"), "les catégories particulières à la fin");
});

test("un vétéran ne se perd pas chez les seniors", () => {
  const groupes = grouperEquipes(VILLEMOMBLE);
  const veterans = groupes.find((g) => g.id === "veterans");
  assert.deepEqual(veterans?.equipes.map((e) => e.name).sort(), ["Anciens D1", "Super Vétérans"]);
  // « Super Vétérans » aurait pu tomber chez les Seniors si on avait testé la tranche d'abord.
  const seniors = groupes.find((g) => g.id === "seniors");
  assert.ok(!seniors?.equipes.some((e) => /v[ée]t[ée]ran/i.test(e.name)));
});

test("dans un groupe, le niveau prime sur l'alphabet", () => {
  const u12 = grouperEquipes(VILLEMOMBLE).find((g) => g.id === "u12")!;
  const noms = u12.equipes.map((e) => e.name);
  assert.ok(noms.indexOf("U12 REG") < noms.indexOf("U12 Espoir 1"), "le régional avant l'espoir");
  assert.ok(noms.indexOf("U12 Élite") < noms.indexOf("U12 Espoir 1"), "l'élite avant l'espoir");
  const seniors = grouperEquipes(VILLEMOMBLE).find((g) => g.id === "seniors")!;
  assert.equal(seniors.equipes[0]!.name, "Séniors R2", "l'équipe régionale en tête");
});

test("la catégorie structurée fait autorité, le nom n'est qu'un repli", () => {
  const sansCategorie = grouperEquipes([{ name: "U12 Espoir 1" }]);
  assert.equal(sansCategorie[0]!.id, "u12", "à défaut de catégorie, on lit le nom");

  const nomLibre = grouperEquipes([{ name: "Les Lionceaux", categorie: "U12" }]);
  assert.equal(nomLibre[0]!.id, "u12", "un nom qui ne dit rien ne doit pas défaire la catégorie");
});

test("un petit club n'obtient pas quinze rubriques vides", () => {
  const basket: EquipeChoisissable[] = [
    { name: "Seniors 1", categorie: "Seniors" },
    { name: "Seniors 2", categorie: "Seniors" },
    { name: "U11 Mixte", categorie: "U11" },
  ];
  const groupes = grouperEquipes(basket);
  assert.equal(groupes.length, 2, "deux groupes, pas quinze");
  assert.deepEqual(groupes.map((g) => g.label), ["Seniors", "U11"]);
});

test("chercher un groupe garde tout le groupe", () => {
  const trouve = filtrerGroupes(grouperEquipes(VILLEMOMBLE), "U12");
  assert.equal(trouve.length, 1);
  assert.equal(trouve[0]!.equipes.length, 5, "taper « U12 » montre les cinq U12, pas une seule");
});

test("chercher un niveau traverse les groupes", () => {
  const trouve = filtrerGroupes(grouperEquipes(VILLEMOMBLE), "espoir");
  const noms = trouve.flatMap((g) => g.equipes.map((e) => e.name));
  assert.ok(noms.includes("U12 Espoir 1") && noms.includes("U10 Espoir 2") && noms.includes("U13 Espoir"));
  assert.ok(!noms.includes("Séniors R2"));
});

test("la recherche ignore accents, casse et espaces", () => {
  assert.equal(filtrerGroupes(grouperEquipes(VILLEMOMBLE), "seniors r2")[0]?.equipes.some((e) => e.name === "Séniors R2"), true);
  assert.equal(filtrerGroupes(grouperEquipes(VILLEMOMBLE), "u 12").length, 1, "« u 12 » trouve les U12");
  assert.equal(filtrerGroupes(grouperEquipes(VILLEMOMBLE), "ELITE").length > 0, true);
});

test("une recherche sans résultat ne laisse aucun groupe vide", () => {
  assert.deepEqual(filtrerGroupes(grouperEquipes(VILLEMOMBLE), "handball"), []);
});

test("le repère féminin se lit dans la section, et à défaut dans le nom", () => {
  assert.equal(estFeminine({ name: "U15 F", section: "Féminin" }), true);
  assert.equal(estFeminine({ name: "Séniors Féminines", section: "Féminin" }), true);
  assert.equal(estFeminine({ name: "U18 F" }), true, "sans section, le nom suffit");
  assert.equal(estFeminine({ name: "U14 D1", section: "Masculin" }), false);
  // Une U15 F reste dans le groupe U15 : on ne scinde pas chaque tranche en deux.
  const u15 = grouperEquipes(VILLEMOMBLE).find((g) => g.id === "u15")!;
  assert.equal(u15.equipes.length, 1);
});
