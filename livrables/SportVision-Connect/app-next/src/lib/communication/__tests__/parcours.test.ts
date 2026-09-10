// Le parcours d'une demande de communication.
//
//   node --test src/lib/communication/__tests__/parcours.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { ETAPES_PARCOURS, etatParcours } from "../parcours.ts";

const etape = (d: string | null, c: string | null) => ETAPES_PARCOURS[etatParcours(d, c).etape];

test("une demande reçue, sans contenu, en est à « Demande »", () => {
  assert.equal(etape("recues", null), "Demande");
  assert.equal(etape("info_manquante", null), "Demande");
});

test("prise en charge ou transformée en brouillon : « Brief »", () => {
  assert.equal(etape("en_traitement", null), "Brief");
  assert.equal(etape("en_traitement", "brouillon"), "Brief");
});

test("le statut du contenu fait avancer le parcours", () => {
  assert.equal(etape("en_traitement", "a_valider_interne"), "Production");
  assert.equal(etape("en_traitement", "a_valider_client"), "Validation");
  assert.equal(etape("en_traitement", "corrections"), "Validation");
  assert.equal(etape("terminee", "programme"), "Programmation");
  assert.equal(etape("terminee", "publie"), "Publié");
});

test("un refus ou une archive arrêtent le parcours, et le disent", () => {
  assert.deepEqual(etatParcours("refusee", null), { etape: -1, arret: "Demande refusée" });
  assert.deepEqual(etatParcours("terminee", "archive"), { etape: -1, arret: "Contenu archivé" });
});
