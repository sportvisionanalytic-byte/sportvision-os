// Le décompte des présences du mois.
//
//   node --test src/lib/presences/__tests__/mois.test.ts
//
// Ce que ces tests protègent avant tout : l'absence de dénominateur. Aucune de ces fonctions ne
// renvoie d'objectif, de reste à faire ou de pourcentage — c'est volontaire, et c'est la demande
// explicite de Fouka du 10/09/2026.

import { test } from "node:test";
import assert from "node:assert/strict";
import { decompterLeMois, libelleMois, type PresenceDatee } from "../mois.ts";

const LE_10_SEPTEMBRE = new Date(2026, 8, 10);

function p(date: string, status: PresenceDatee["status"] = "scheduled"): PresenceDatee {
  return { date, status };
}

test("l'exemple de Fouka : 3 programmées, 1 réalisée, 2 à venir", () => {
  const d = decompterLeMois(
    [p("2026-09-05", "completed"), p("2026-09-19"), p("2026-09-26")],
    LE_10_SEPTEMBRE,
  );
  assert.deepEqual(d, { programmees: 3, realisees: 1, aVenir: 2 });
});

test("« programmées » compte tout le mois, réalisé compris", () => {
  // C'est le nombre de fois où SportVision est attendu ce mois-ci, pas ce qui resterait à faire.
  const d = decompterLeMois([p("2026-09-01", "completed"), p("2026-09-02", "completed")], LE_10_SEPTEMBRE);
  assert.equal(d.programmees, 2);
  assert.equal(d.aVenir, 0);
});

test("une annulation ne compte nulle part", () => {
  const d = decompterLeMois([p("2026-09-19", "cancelled"), p("2026-09-20")], LE_10_SEPTEMBRE);
  assert.deepEqual(d, { programmees: 1, realisees: 0, aVenir: 1 });
});

test("une présence passée non clôturée n'est plus « à venir »", () => {
  // Sinon le décompte ne redescend jamais : la production n'a pas encore clôturé, mais la date
  // est derrière nous.
  const d = decompterLeMois([p("2026-09-05")], LE_10_SEPTEMBRE);
  assert.deepEqual(d, { programmees: 1, realisees: 0, aVenir: 0 });
});

test("la présence du jour est encore à venir", () => {
  assert.equal(decompterLeMois([p("2026-09-10")], LE_10_SEPTEMBRE).aVenir, 1);
});

test("les autres mois sont ignorés, y compris le même jour d'un autre mois", () => {
  const d = decompterLeMois(
    [p("2026-08-10", "completed"), p("2026-10-10"), p("2025-09-10", "completed"), p("2026-09-11")],
    LE_10_SEPTEMBRE,
  );
  assert.deepEqual(d, { programmees: 1, realisees: 0, aVenir: 1 });
});

test("un mois sans présence n'est pas un manque : trois zéros, rien d'autre", () => {
  assert.deepEqual(decompterLeMois([], LE_10_SEPTEMBRE), { programmees: 0, realisees: 0, aVenir: 0 });
});

test("vingt présences dans le mois passent sans broncher", () => {
  // Aucun plafond : la règle métier est « le CM choisit librement ».
  const vingt = Array.from({ length: 20 }, (_, i) => p(`2026-09-${String(i + 1).padStart(2, "0")}`));
  const d = decompterLeMois(vingt, LE_10_SEPTEMBRE);
  assert.equal(d.programmees, 20);
});

test("une date illisible est ignorée plutôt que comptée de travers", () => {
  assert.deepEqual(decompterLeMois([p("à planifier")], LE_10_SEPTEMBRE), {
    programmees: 0,
    realisees: 0,
    aVenir: 0,
  });
});

test("le mois s'écrit avec une capitale", () => {
  assert.equal(libelleMois(LE_10_SEPTEMBRE), "Septembre 2026");
});

// 11/09/2026, Villemomble : quatre matchs cochés le même jour au même stade forment une seule
// mission (v133). L'écran en comptait quatre ; c'est un seul déplacement de SportVision.
test("une mission regroupée compte pour une présence", () => {
  const m = (date: string, mission: string | null, status: PresenceDatee["status"] = "scheduled"): PresenceDatee => ({
    date,
    status,
    missionReference: mission,
  });
  const d = decompterLeMois(
    [
      m("2026-09-12", "SV-2026-0268"), m("2026-09-12", "SV-2026-0268"), m("2026-09-12", "SV-2026-0268"), m("2026-09-12", "SV-2026-0268"),
      m("2026-09-13", "SV-2026-0274"), m("2026-09-13", "SV-2026-0274"), m("2026-09-13", "SV-2026-0274"), m("2026-09-13", "SV-2026-0274"),
      m("2026-09-05", "SV-2026-0200", "completed"), m("2026-09-05", "SV-2026-0200", "completed"),
      m("2026-09-20", null), m("2026-09-21", null),
    ],
    LE_10_SEPTEMBRE,
  );
  assert.deepEqual(d, { programmees: 5, realisees: 1, aVenir: 4 });
});

test("un match retiré d'une mission regroupée ne la retire pas", () => {
  const d = decompterLeMois(
    [
      { date: "2026-09-12", status: "cancelled", missionReference: "SV-2026-0268" },
      { date: "2026-09-12", status: "scheduled", missionReference: "SV-2026-0268" },
    ],
    LE_10_SEPTEMBRE,
  );
  assert.deepEqual(d, { programmees: 1, realisees: 0, aVenir: 1 });
});
