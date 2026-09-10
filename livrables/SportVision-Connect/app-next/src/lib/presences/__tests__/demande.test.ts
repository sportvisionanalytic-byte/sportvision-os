// La liste de la demande de présence : filtres rapides, recherche, journées.
//
//   node --test src/lib/presences/__tests__/demande.test.ts
//
// Un filtre qui laisse passer un mauvais jour ferait demander une présence sur un événement que le
// président n'a jamais vu : c'est ce que ces tests tiennent.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fenetre, filtrerEvenements, grouperParJour, heure, libelleSelection, normaliser } from "../demande.ts";

// Mercredi 9 septembre 2026, 10 h, heure locale.
const MERCREDI = new Date(2026, 8, 9, 10, 0);
const ev = (id: string, kind: "match" | "training", y: number, m: number, d: number, h = 0, mn = 0, extra = {}) => ({
  id, kind, title: id, startsAt: new Date(y, m, d, h, mn).toISOString(), allDay: false, ...extra,
});
const EVENEMENTS = [
  ev("u10-mer", "training", 2026, 8, 9, 18),
  ev("u12-sam", "match", 2026, 8, 12, 14, 30, { teamName: "U12 A", location: "Stade Georges-Pompidou" }),
  ev("u15-dim", "match", 2026, 8, 13, 10, 0, { opponent: "Bondy" }),
  ev("u17-lun", "match", 2026, 8, 14, 20),
  ev("seniors-sam-suivant", "match", 2026, 8, 19, 15),
];
const ids = (l: { id: string }[]) => l.map((e) => e.id);

test("la semaine va jusqu'au dimanche soir", () => {
  const [debut, fin] = fenetre("semaine", MERCREDI);
  assert.equal(debut.getDate(), 9);
  assert.equal(fin.getDate(), 14); // lundi 0 h, exclu
  assert.deepEqual(ids(filtrerEvenements(EVENEMENTS, "semaine", "", MERCREDI)), ["u10-mer", "u12-sam", "u15-dim"]);
});

test("le week-end : le prochain en semaine, celui en cours le samedi comme le dimanche", () => {
  assert.deepEqual(ids(filtrerEvenements(EVENEMENTS, "weekend", "", MERCREDI)), ["u12-sam", "u15-dim"]);
  const dimanche = new Date(2026, 8, 13, 9, 0);
  assert.deepEqual(ids(filtrerEvenements(EVENEMENTS, "weekend", "", dimanche)), ["u12-sam", "u15-dim"]);
  const samedi = new Date(2026, 8, 12, 9, 0);
  assert.equal(fenetre("weekend", samedi)[0].getDate(), 12);
});

test("matchs et entraînements se séparent", () => {
  assert.deepEqual(ids(filtrerEvenements(EVENEMENTS, "entrainements", "", MERCREDI)), ["u10-mer"]);
  assert.equal(filtrerEvenements(EVENEMENTS, "matchs", "", MERCREDI).length, 4);
});

test("la recherche ignore accents et majuscules, et lit équipe, lieu, adversaire", () => {
  assert.equal(normaliser("  Entraînement "), "entrainement");
  assert.deepEqual(ids(filtrerEvenements(EVENEMENTS, "tous", "pompidou", MERCREDI)), ["u12-sam"]);
  assert.deepEqual(ids(filtrerEvenements(EVENEMENTS, "tous", "BONDY", MERCREDI)), ["u15-dim"]);
  assert.deepEqual(ids(filtrerEvenements(EVENEMENTS, "tous", "u12 a", MERCREDI)), ["u12-sam"]);
});

test("les journées suivent l'ordre, avec Aujourd'hui et Demain", () => {
  const jours = grouperParJour(EVENEMENTS, MERCREDI);
  assert.equal(jours.length, 5);
  assert.match(jours[0]!.libelle, /^Aujourd'hui · mercredi 9 septembre/);
  assert.match(jours[1]!.libelle, /^Samedi 12 septembre/);
  const deuxLeMemeJour = grouperParJour([ev("a", "match", 2026, 8, 12, 10), ev("b", "match", 2026, 8, 12, 23, 30)], MERCREDI);
  assert.equal(deuxLeMemeJour.length, 1, "un match de 23 h 30 reste sur sa journée");
});

test("l'heure n'apparaît que si elle est connue", () => {
  assert.equal(heure(ev("x", "match", 2026, 8, 12, 14, 30)), "14:30");
  assert.equal(heure(ev("y", "match", 2026, 8, 12)), null);
  assert.equal(heure({ ...ev("z", "match", 2026, 8, 12, 14), allDay: true }), null);
});

test("le récapitulatif se lit", () => {
  assert.equal(libelleSelection(0), "Aucun événement sélectionné");
  assert.equal(libelleSelection(1), "1 événement sélectionné");
  assert.equal(libelleSelection(3), "3 événements sélectionnés");
});
