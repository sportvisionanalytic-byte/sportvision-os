// L'état d'encadrement d'une équipe.
//
//   node --test src/lib/teams/__tests__/encadrement.test.ts
//
// Ce qui se joue ici n'est pas cosmétique : l'écran s'appuie sur ces états pour dire à un club si
// son coach a réellement accès à l'équipe. Un faux « actif » ferait croire à un accès que la RLS
// refuse, et personne ne saisirait les résultats de l'équipe.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  encadrantsDeLEquipe,
  etatEncadrement,
  libelleEtat,
  nomDeclare,
  perimetresApproximatifs,
} from "../encadrement.ts";
import type { OrgUser } from "../../types/settings.ts";

const LE_9_SEPTEMBRE = new Date("2026-09-09T10:00:00Z");

function membre(p: Partial<OrgUser> & { id: string }): OrgUser {
  return {
    membershipId: `m-${p.id}`,
    firstName: "Karim",
    lastName: "B.",
    email: "",
    role: "coach",
    teamScope: [],
    status: "active",
    ...p,
  } as OrgUser;
}

test("aucun membre, aucun nom : l'équipe est sans coach", () => {
  const e = etatEncadrement([], "U15 D1", "—", LE_9_SEPTEMBRE);
  assert.equal(e.etat, "absent");
  assert.equal(libelleEtat(e), "Coach non renseigné");
});

test("un nom saisi sans compte n'est pas un accès : l'équipe reste à inviter", () => {
  // Le cas le plus trompeur : la fiche affiche « Karim B. », le club se croit couvert, et en base
  // personne n'a le moindre droit sur l'équipe.
  const e = etatEncadrement([], "U15 D1", "Karim Benali", LE_9_SEPTEMBRE);
  assert.equal(e.etat, "a_inviter");
  assert.equal(e.nomDeclare, "Karim Benali");
});

test("« — » de fetchClubTeams ne compte pas comme un nom", () => {
  assert.equal(nomDeclare("—"), null);
  assert.equal(nomDeclare("   "), null);
  assert.equal(nomDeclare(" Karim "), "Karim");
});

test("un coach actif sur l'équipe suffit, même si un autre est encore invité", () => {
  const membres = [
    membre({ id: "1", teamScope: ["U15 D1"], status: "active" }),
    membre({ id: "2", teamScope: ["U15 D1"], status: "invited", invitedAt: "2026-08-01T09:00:00Z" }),
  ];
  const e = etatEncadrement(membres, "U15 D1", null, LE_9_SEPTEMBRE);
  assert.equal(e.etat, "actif");
  assert.equal(e.membres.length, 2);
});

test("une invitation récente s'affiche comme envoyée, une vieille comme sans réponse", () => {
  const recent = etatEncadrement(
    [membre({ id: "1", teamScope: ["U15 D1"], status: "invited", invitedAt: "2026-09-07T09:00:00Z" })],
    "U15 D1",
    null,
    LE_9_SEPTEMBRE,
  );
  assert.equal(recent.etat, "invitation_envoyee");
  assert.equal(recent.joursDAttente, 2);

  const vieille = etatEncadrement(
    [membre({ id: "1", teamScope: ["U15 D1"], status: "invited", invitedAt: "2026-08-20T09:00:00Z" })],
    "U15 D1",
    null,
    LE_9_SEPTEMBRE,
  );
  assert.equal(vieille.etat, "invitation_sans_reponse");
  assert.equal(libelleEtat(vieille), "Sans réponse depuis 20 jours");
});

test("un membre suspendu n'encadre plus rien", () => {
  const e = etatEncadrement(
    [membre({ id: "1", teamScope: ["U15 D1"], status: "disabled" })],
    "U15 D1",
    null,
    LE_9_SEPTEMBRE,
  );
  assert.equal(e.etat, "absent");
  assert.equal(e.membres.length, 0);
});

test("un trésorier avec l'équipe dans son périmètre n'est pas un encadrant", () => {
  // `teams` sert aussi à cibler ce qu'un membre voit ; le porter ne fait pas de vous un coach.
  const membres = [membre({ id: "1", role: "treasurer", teamScope: ["U15 D1"] })];
  assert.equal(encadrantsDeLEquipe(membres, "U15 D1").length, 0);
});

test("responsable d'équipe et directeur sportif encadrent, eux", () => {
  const membres = [
    membre({ id: "1", role: "team_manager", teamScope: ["U15 D1"] }),
    membre({ id: "2", role: "sports_director", teamScope: ["U15 D1"] }),
  ];
  assert.equal(encadrantsDeLEquipe(membres, "U15 D1").length, 2);
});

test("la correspondance est exacte, comme is_team_educateur en base", () => {
  // « u15 d1 » ne donne AUCUN droit en base : l'écran ne doit pas prétendre le contraire.
  const membres = [membre({ id: "1", teamScope: ["u15 d1"] })];
  assert.equal(encadrantsDeLEquipe(membres, "U15 D1").length, 0);
  assert.equal(etatEncadrement(membres, "U15 D1", null, LE_9_SEPTEMBRE).etat, "absent");
});

test("mais la quasi-correspondance est signalée, pas ignorée", () => {
  const membres = [
    membre({ id: "1", teamScope: ["u15  d1"] }),
    membre({ id: "2", teamScope: ["U15 D1"] }), // exact : ce n'est pas une anomalie
    membre({ id: "3", teamScope: ["U16 D1"] }), // une autre équipe : rien à signaler
  ];
  const anomalies = perimetresApproximatifs(membres, "U15 D1");
  assert.equal(anomalies.length, 1);
  assert.equal(anomalies[0]?.membre.id, "1");
  assert.equal(anomalies[0]?.ecrit, "u15  d1");
});

test("les accents et l'espace insécable comptent comme des quasi-correspondances", () => {
  const membres = [
    membre({ id: "1", teamScope: ["Seniors R2"] }), // accent oublié
    membre({ id: "2", teamScope: ["Séniors R2"] }), // espace insécable, invisible à l'œil
    membre({ id: "3", teamScope: ["Séniors R2"] }), // écrit exactement : ce n'est pas une anomalie
  ];
  const anomalies = perimetresApproximatifs(membres, "Séniors R2");
  assert.deepEqual(
    anomalies.map((a) => a.membre.id).sort(),
    ["1", "2"],
  );
});
