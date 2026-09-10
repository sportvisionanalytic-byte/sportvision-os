// Le planning éditorial du CM.
//
//   node --test src/lib/communication/__tests__/planning.test.ts
//
// Le workflow est celui de la base : proposer une étape qu'elle refuse ferait échouer le geste du
// CM sans qu'il comprenne pourquoi. Et « À préparer » doit dire vrai : un contenu déjà prêt n'y a
// pas sa place.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ecrireCanaux, grilleMois, libelleCanaux, ligneContenu, lireCanaux, resumePlanning, semaineDe,
  statutsSuivants, suggestionsMatch, isoJour, trierContenus, type ContenuPlanning,
} from "../planning.ts";

const c = (id: string, datePrevue: string | null, heurePrevue: string | null, statut: ContenuPlanning["statut"], extra = {}) =>
  ({ id, titre: id, statut, typeContenu: "carrousel", plateforme: "instagram", datePrevue, heurePrevue, equipe: null, ...extra });
const JEUDI = new Date(2026, 8, 10, 11, 0); // jeudi 10/09/2026

test("le workflow suit la base : un brouillon ne passe pas directement « à valider par le club »", () => {
  assert.deepEqual(statutsSuivants("brouillon"), ["pret", "a_valider_interne", "a_valider_tuteur"]);
  assert.ok(!statutsSuivants("brouillon").includes("a_valider_client"));
  assert.deepEqual(statutsSuivants("programme"), ["publie"]);
  assert.deepEqual(statutsSuivants("archive"), []);
});

test("réseaux : lecture souple, écriture propre", () => {
  assert.deepEqual(lireCanaux("Instagram + Facebook"), ["instagram", "facebook"]);
  assert.equal(ecrireCanaux(["instagram", "Instagram", "facebook"]), "instagram,facebook");
  assert.equal(ecrireCanaux([]), null);
  assert.equal(libelleCanaux("instagram,facebook"), "Instagram + Facebook");
});

test("la ligne d'un contenu : heure · type · équipe", () => {
  assert.equal(ligneContenu({ heurePrevue: "18:00:00", typeContenu: "carrousel", equipe: "Seniors R2" }), "18:00 · 📸 Carrousel · Seniors R2");
  assert.equal(ligneContenu({ heurePrevue: null, typeContenu: null, equipe: null }), "✳️ Contenu");
});

test("la semaine va du lundi au dimanche, le mois en semaines complètes", () => {
  const s = semaineDe(JEUDI).map(isoJour);
  assert.equal(s[0], "2026-09-07");
  assert.equal(s[6], "2026-09-13");
  const g = grilleMois(JEUDI);
  assert.equal(g.length % 7, 0);
  assert.equal(isoJour(g[0]!), "2026-08-31");
});

test("Aujourd'hui | Cette semaine | À préparer", () => {
  const r = resumePlanning([
    c("auj-brouillon", "2026-09-10", "18:00", "brouillon"),
    c("auj-pret", "2026-09-10", "12:00", "pret"),
    c("dimanche", "2026-09-13", "10:00", "corrections"),
    c("semaine-pro", "2026-09-16", null, "brouillon"),
    c("loin", "2026-09-30", null, "brouillon"),
    c("archive", "2026-09-10", null, "archive"),
  ], JEUDI);
  assert.deepEqual(r.aujourdhui.map((x) => x.id), ["auj-pret", "auj-brouillon"]);
  assert.equal(r.semaine, 3);
  assert.deepEqual(r.aPreparer.map((x) => x.id), ["auj-brouillon", "dimanche", "semaine-pro"]);
});

test("tri : date puis heure, sans date à la fin", () => {
  assert.deepEqual(trierContenus([c("b", "2026-09-11", "09:00", "pret"), c("sans", null, null, "pret"), c("a", "2026-09-11", "08:00", "pret")]).map((x) => x.id), ["a", "b", "sans"]);
});

test("autour d'un match : cinq propositions, datées autour du coup d'envoi", () => {
  const s = suggestionsMatch({ date: "2026-09-13", heure: "15:00", equipe: "Seniors R2", adversaire: "Bondy" });
  assert.deepEqual(s.map((x) => x.cle), ["veille", "matchday", "compo", "score", "images"]);
  assert.equal(s[0]!.datePrevue, "2026-09-12");
  assert.equal(s[2]!.heurePrevue, "14:00");
  assert.equal(s[3]!.heurePrevue, "17:00");
  assert.equal(s[4]!.datePrevue, "2026-09-14");
  assert.match(s[1]!.titre, /Matchday · Seniors R2 contre Bondy/);
});
