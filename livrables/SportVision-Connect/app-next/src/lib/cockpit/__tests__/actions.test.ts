// Les « Actions à traiter » du CM.
//
//   node --test src/lib/cockpit/__tests__/actions.test.ts
//
// On vérifie la RÈGLE : quel niveau, quel texte, quel lien, et surtout ce qui n'apparaît pas.

import { test } from "node:test";
import assert from "node:assert/strict";
import { construireActions, pluriel, type CompteursAFaire } from "../actions.ts";

const VIDE: CompteursAFaire = { demandes_du_club: 0, resultats_manquants: 0, equipes_sans_coach: 0 };

test("un club sans rien à faire ne produit aucune ligne", () => {
  assert.deepEqual(construireActions(VIDE, { statut: "actif", sections_manquantes: [], invitations_preparees: 0 }), []);
});

test("les urgences passent devant, l'information derrière", () => {
  const actions = construireActions(
    { ...VIDE, demandes_du_club: 3, demandes_urgentes: 1, invitations_en_attente: 2, equipes_sans_coach: 4 },
    { statut: "actif", sections_manquantes: [], invitations_preparees: 0 },
  );
  assert.deepEqual(actions.map((a) => a.niveau), ["urgent", "a_faire", "a_faire", "information"]);
  assert.equal(actions[0]?.texte, "1 demande urgente du club");
});

test("une demande urgente n'est pas comptée une seconde fois parmi les demandes à traiter", () => {
  const actions = construireActions({ ...VIDE, demandes_du_club: 3, demandes_urgentes: 1 }, null);
  assert.equal(actions.find((a) => a.cle === "demandes")?.texte, "2 demandes du club à traiter");
});

test("résultats : ceux des derniers jours sont urgents, les anciens à faire, sans doublon", () => {
  const actions = construireActions({ ...VIDE, resultats_manquants: 49, resultats_recents: 5 }, null);
  assert.equal(actions.find((a) => a.cle === "resultats_recents")?.niveau, "urgent");
  assert.equal(actions.find((a) => a.cle === "resultats")?.nombre, 44);
});

test("avant le lancement, une invitation préparée est une information, pas une tâche", () => {
  const avant = construireActions({ ...VIDE, invitations_preparees: 8 },
    { statut: "en_preparation", sections_manquantes: ["Identité"], invitations_preparees: 8 });
  assert.equal(avant.find((a) => a.cle === "invitations_preparees"), undefined);
  assert.equal(avant.find((a) => a.cle === "invitations_au_lancement")?.niveau, "information");
  assert.equal(avant.find((a) => a.cle === "onboarding")?.texte, "Onboarding incomplet : Identité");

  const apres = construireActions({ ...VIDE, invitations_preparees: 8 },
    { statut: "actif", sections_manquantes: [], invitations_preparees: 8 });
  assert.equal(apres.find((a) => a.cle === "invitations_preparees")?.niveau, "a_faire");
});

test("un club prêt propose son lancement, et mène à l'écran de lancement", () => {
  const actions = construireActions(VIDE, { statut: "pret", sections_manquantes: [], invitations_preparees: 0 });
  assert.equal(actions[0]?.cle, "lancer");
  assert.equal(actions[0]?.vers, "/onboarding?section=lancement");
});

test("un problème de santé déjà compté n'est pas répété, les autres sont repris avec leur lien", () => {
  const actions = construireActions({ ...VIDE, equipes_sans_coach: 42 }, null, [
    { code: "equipes_sans_coach", niveau: "a_faire", nombre: 42, texte: "42 équipes sans coach", lien: "/teams?filtre=sans_coach" },
    { code: "effectif_non_renseigne", niveau: "information", nombre: 29, texte: "29 équipes avec des matchs mais sans effectif", lien: "/teams?filtre=effectif" },
  ]);
  assert.equal(actions.filter((a) => a.texte.includes("sans coach")).length, 1);
  assert.equal(actions.find((a) => a.cle === "sante_effectif_non_renseigne")?.vers, "/teams?filtre=effectif");
});

test("pluriel", () => {
  assert.equal(pluriel(1, "équipe"), "1 équipe");
  assert.equal(pluriel(2, "équipe"), "2 équipes");
  assert.equal(pluriel(2, "présence SportVision", "présences SportVision"), "2 présences SportVision");
});
