// Le classement des matchs en files.
//
//   node --test src/lib/matches/__tests__/etat.test.ts
//
// Le test central est le dernier : sur la donnée réelle de SF Villemomble (430 matchs tous au
// statut `a_venir`, dont 50 déjà joués), l'ancien écran ne proposait la saisie sur AUCUN d'eux.
// Ces tests fixent la règle qui l'en rend capable, sans jamais l'offrir sur les 380 autres.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fileDuMatch,
  grouperMatchs,
  issue,
  peutSaisirResultat,
  retardEnJours,
  scoreAffiche,
  scoreOfficielNonConfirme,
} from "../etat.ts";
import type { Match } from "../../types/studio.ts";

const AUJOURDHUI = new Date(2026, 8, 10); // 10 septembre 2026, minuit local

function match(p: Partial<Match> & { id: string }): Match {
  return {
    organizationId: "club",
    teamId: "t1",
    teamName: "U15 D1",
    opponent: "AS Adverse",
    competition: "D1",
    kickoffAt: "2026-09-20",
    venue: "",
    isHome: true,
    status: "upcoming",
    ...p,
  } as Match;
}

test("un match joué et sans score attend sa feuille de match", () => {
  const m = match({ id: "1", kickoffAt: "2026-09-06", status: "upcoming" });
  assert.equal(fileDuMatch(m, AUJOURDHUI), "a_renseigner");
  assert.equal(retardEnJours(m, AUJOURDHUI), 4);
  assert.equal(peutSaisirResultat(m, AUJOURDHUI), true);
});

test("le statut `a_venir` d'un match passé ne le protège pas : c'est la date qui tranche", () => {
  // Exactement la situation des 50 matchs de Villemomble : rien en base ne les a fait basculer.
  assert.equal(fileDuMatch(match({ id: "1", kickoffAt: "2026-08-15" }), AUJOURDHUI), "a_renseigner");
});

test("le match du jour n'est pas encore en retard", () => {
  const m = match({ id: "1", kickoffAt: "2026-09-10" });
  assert.equal(fileDuMatch(m, AUJOURDHUI), "cette_semaine");
  assert.equal(retardEnJours(m, AUJOURDHUI), 0);
});

test("sept jours devant, c'est la semaine ; huit, c'est plus tard", () => {
  assert.equal(fileDuMatch(match({ id: "1", kickoffAt: "2026-09-17" }), AUJOURDHUI), "cette_semaine");
  assert.equal(fileDuMatch(match({ id: "2", kickoffAt: "2026-09-18" }), AUJOURDHUI), "a_venir");
});

test("un match lointain ne propose pas la saisie", () => {
  // Sinon l'action se retrouve sur 380 lignes, donc en évidence sur aucune.
  assert.equal(peutSaisirResultat(match({ id: "1", kickoffAt: "2027-05-30" }), AUJOURDHUI), false);
});

test("un match sans date attend une saisie plutôt que de disparaître au fond de la saison", () => {
  assert.equal(fileDuMatch(match({ id: "1", kickoffAt: "" }), AUJOURDHUI), "a_renseigner");
  assert.equal(retardEnJours(match({ id: "1", kickoffAt: "" }), AUJOURDHUI), 0);
});

test("un score officiel ne clôt pas le match : le club n'a encore rien confirmé", () => {
  // La synchro fédérale recopie le score publié. Elle ne connaît ni les buteurs, ni l'homme du
  // match, ni le commentaire — le match reste donc à compléter, score déjà rempli.
  const m = match({ id: "1", kickoffAt: "2026-09-06", status: "upcoming", scoreFor: 3, scoreAgainst: 1 });
  assert.equal(fileDuMatch(m, AUJOURDHUI), "a_renseigner");
  assert.equal(scoreOfficielNonConfirme(m), true);
  assert.equal(peutSaisirResultat(m, AUJOURDHUI), true);
});

test("une fois le club passé dessus, le match rejoint les résultats", () => {
  const m = match({ id: "1", kickoffAt: "2026-09-06", status: "result_received", scoreFor: 3, scoreAgainst: 1 });
  assert.equal(fileDuMatch(m, AUJOURDHUI), "joues");
  assert.equal(scoreOfficielNonConfirme(m), false);
});

test("annulé et reporté ont leur file, et l'annulé ne se saisit pas", () => {
  const annule = match({ id: "1", kickoffAt: "2026-09-06", status: "cancelled" });
  const reporte = match({ id: "2", kickoffAt: "2026-09-06", status: "postponed" });
  assert.equal(fileDuMatch(annule, AUJOURDHUI), "annules");
  assert.equal(fileDuMatch(reporte, AUJOURDHUI), "reportes");
  assert.equal(peutSaisirResultat(annule, AUJOURDHUI), false);
  // Un match reporté finit par se jouer : sa saisie reste ouverte, comportement d'avant conservé.
  assert.equal(peutSaisirResultat(reporte, AUJOURDHUI), true);
});

test("les files vides disparaissent, et les retards remontent du plus ancien", () => {
  const groupes = grouperMatchs(
    [
      match({ id: "recent", kickoffAt: "2026-09-08" }),
      match({ id: "vieux", kickoffAt: "2026-08-15" }),
      match({ id: "futur", kickoffAt: "2027-01-10" }),
    ],
    AUJOURDHUI,
  );
  assert.deepEqual(groupes.map((g) => g.file), ["a_renseigner", "a_venir"]);
  assert.deepEqual(groupes[0]?.matchs.map((m) => m.id), ["vieux", "recent"]);
});

test("l'avenir se lit du plus proche, le passé du plus récent", () => {
  const groupes = grouperMatchs(
    [
      match({ id: "loin", kickoffAt: "2027-05-30" }),
      match({ id: "proche", kickoffAt: "2026-10-01" }),
      match({ id: "joue-vieux", kickoffAt: "2026-08-15", status: "result_received", scoreFor: 1, scoreAgainst: 0 }),
      match({ id: "joue-recent", kickoffAt: "2026-09-05", status: "result_received", scoreFor: 2, scoreAgainst: 2 }),
    ],
    AUJOURDHUI,
  );
  const par = Object.fromEntries(groupes.map((g) => [g.file, g.matchs.map((m) => m.id)]));
  assert.deepEqual(par["a_venir"], ["proche", "loin"]);
  assert.deepEqual(par["joues"], ["joue-recent", "joue-vieux"]);
});

test("le score s'inverse à l'extérieur, l'issue non", () => {
  const dehors = match({ id: "1", isHome: false, scoreFor: 1, scoreAgainst: 3 });
  assert.deepEqual(scoreAffiche(dehors), { gauche: 3, droite: 1 });
  assert.equal(issue(dehors), "perdu");

  const maison = match({ id: "2", isHome: true, scoreFor: 1, scoreAgainst: 3 });
  assert.deepEqual(scoreAffiche(maison), { gauche: 1, droite: 3 });
  assert.equal(issue(maison), "perdu");

  assert.equal(issue(match({ id: "3", scoreFor: 2, scoreAgainst: 2 })), "nul");
  assert.equal(scoreAffiche(match({ id: "4" })), null);
});

test("le 0-0 est un résultat, pas une absence de résultat", () => {
  // Piège classique : un test de vérité sur `scoreFor` traiterait 0 comme « non saisi ».
  const m = match({ id: "1", kickoffAt: "2026-09-06", status: "result_received", scoreFor: 0, scoreAgainst: 0 });
  assert.equal(fileDuMatch(m, AUJOURDHUI), "joues");
  assert.deepEqual(scoreAffiche(m), { gauche: 0, droite: 0 });
  assert.equal(issue(m), "nul");
});
