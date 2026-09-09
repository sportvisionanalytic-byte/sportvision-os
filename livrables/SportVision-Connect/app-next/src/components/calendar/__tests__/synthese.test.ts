// La vue Mois doit faire remonter ce qui compte, pas ce qui arrive tôt.
//
//   node --test src/components/calendar/__tests__/synthese.test.ts
//
// ── Le cas réel qui a motivé cette refonte ──
// Mercredi 16 septembre 2026, SF Villemomble : 30 événements, dont 28 entraînements et 2 matchs.
// Les entraînements commencent à 13h45, les matchs à 19h. La vue Mois affichait les trois
// premiers par ordre CHRONOLOGIQUE, donc trois entraînements de catégorie U10, puis « +27 de
// plus ». Les deux seuls matchs de la journée étaient invisibles.
//
// Les données ci-dessous sont celles de ce jour-là, relevées en base le 09/09/2026.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resumerJournee, parPriorite, libelleCourt, passeVueRapide, aCouverture,
  lignesParCase, equipeParDefaut,
} from "../synthese.ts";
import type { CalendarEvent } from "../../../lib/types/calendar.ts";

let seq = 0;
function ev(kind: CalendarEvent["kind"], heure: string, teamName: string, extra: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: `e${seq++}`,
    organizationId: "club",
    kind,
    title: `${kind === "match" ? "Match" : "Entraînement"} ${teamName}`,
    startsAt: `2026-09-16T${heure}:00`,
    allDay: false,
    teamName,
    ...extra,
  };
}

/** Le mercredi 16/09/2026 de SF Villemomble, tel qu'il est en base. */
function mercrediReel(): CalendarEvent[] {
  const equipes = [
    "U10 Avenir", "U10 ESPOIR 1", "U10 ESPOIR 2", "U11 Avenir", "U11 ESPOIR 1", "U11 ESPOIR 2",
    "U11 F", "U12 ELITE", "U12 Espoir 1", "U12 Espoir 2", "U13", "U13 Avenir", "U13 ESPOIR",
    "U13 F", "U14 C", "U14 D1", "U14 D4", "U15 F", "U16 D1", "U16 D3", "U18 D2", "U18 F",
    "U18 R3", "U6", "U7", "U8", "U9", "Spécifique Gardiens",
  ];
  const entrainements = equipes.map((e, i) => ev("training", i < 14 ? "13:45" : "17:30", e));
  const matchs = [
    ev("match", "19:00", "U16 D1", { opponent: "Montferrmeil", competition: "U16 D1" }),
    ev("match", "19:00", "U16 D3", { opponent: "Montferrmeil", competition: "U16 D3" }),
  ];
  return [...entrainements, ...matchs];
}

test("les matchs remontent devant les entraînements, même s'ils commencent cinq heures plus tard", () => {
  const resume = resumerJournee(mercrediReel(), 2);
  assert.equal(resume.total, 30);
  assert.equal(resume.visibles.length, 2);
  assert.ok(
    resume.visibles.every((e) => e.kind === "match"),
    "les deux lignes visibles doivent être les deux matchs, pas les entraînements de 13h45",
  );
});

test("le reste part en compteurs groupés, dans l'ordre de priorité", () => {
  const resume = resumerJournee(mercrediReel(), 2);
  assert.deepEqual(resume.compteurs, [{ kind: "training", n: 28 }]);
});

test("un jour calme reste affiché en clair, sans compteur inutile", () => {
  const jour = [ev("training", "18:00", "U10 ELITE"), ev("match", "15:00", "Séniors R2", { opponent: "Meaux" })];
  const resume = resumerJournee(jour, 2);
  assert.equal(resume.visibles.length, 2);
  assert.deepEqual(resume.compteurs, [], "rien à replier quand tout tient");
});

test("une couverture SportVision n'est jamais noyée dans un compteur", () => {
  const jour = [
    ...Array.from({ length: 10 }, (_, i) => ev("training", "18:00", `U1${i}`)),
    ev("training", "19:00", "U15 F", { coverage: "prevu" }),
  ];
  const resume = resumerJournee(jour, 2);
  assert.equal(resume.couvertures, 1);
  assert.ok(
    resume.visibles.some(aCouverture),
    "un entraînement filmé engage un déplacement d'équipe : il remonte au-dessus des séances ordinaires",
  );
});

test("à importance égale, l'heure départage", () => {
  const tard = ev("match", "20:00", "Séniors R2", { opponent: "Rueil" });
  const tot = ev("match", "15:00", "U18 R3", { opponent: "Argenteuil" });
  assert.deepEqual([tard, tot].sort(parPriorite).map((e) => e.id), [tot.id, tard.id]);
});

test("les libellés raccourcis restent lisibles par un humain", () => {
  assert.equal(libelleCourt(ev("training", "18:00", "U11 ESPOIR 2")), "U11 Espoir 2");
  assert.equal(libelleCourt(ev("training", "18:00", "U18 FÉMININES 2")), "U18 F 2");
  assert.equal(libelleCourt(ev("training", "18:00", "SENIORS 1")), "Séniors 1");
  // Pour un match, l'adversaire prime : dans une case de mois on cherche « contre qui ».
  assert.equal(libelleCourt(ev("match", "19:00", "U16 D1", { opponent: "Montfermeil" })), "Montfermeil");
});

test("« À couvrir » ne propose que les matchs sans décision, jamais 80 entraînements", () => {
  const matchNu = ev("match", "15:00", "U18 R3", { opponent: "Argenteuil" });
  const matchCouvert = ev("match", "15:00", "Séniors R2", { opponent: "Meaux", coverage: "prevu" });
  const seance = ev("training", "18:00", "U10 ELITE");
  assert.equal(passeVueRapide(matchNu, "a_couvrir"), true);
  assert.equal(passeVueRapide(matchCouvert, "a_couvrir"), false);
  assert.equal(passeVueRapide(seance, "a_couvrir"), false);
});

test("« Résultats » ne retient que ce qui porte un score", () => {
  const joue = ev("match", "15:00", "Séniors R2", { opponent: "Meaux", score: "2-0" });
  const aVenir = ev("match", "15:00", "Séniors D1", { opponent: "Bobigny" });
  assert.equal(passeVueRapide(joue, "resultats"), true);
  assert.equal(passeVueRapide(aVenir, "resultats"), false);
});

test("un gros club passe en cases compactes, un petit club respire", () => {
  // Villemomble : une trentaine d'événements les mercredis, deux ou trois les autres jours.
  const gros = [
    ...Array.from({ length: 30 }, () => ev("training", "18:00", "U10 Élite")),
    ...Array.from({ length: 28 }, (_, i) => ({ ...ev("training", "18:00", "U11 Élite"), startsAt: `2026-09-${String(9 + (i % 3)).padStart(2, "0")}T18:00:00` })),
  ];
  assert.equal(lignesParCase(gros), 2, "journées chargées : on synthétise");

  const petit = Array.from({ length: 6 }, (_, i) => ({
    ...ev("match", "15:00", "Séniors R2", { opponent: "Meaux" }),
    startsAt: `2026-09-${String(10 + i).padStart(2, "0")}T15:00:00`,
  }));
  assert.equal(lignesParCase(petit), 4, "un ou deux événements par jour : tout tient, rien à replier");
});

test("un tournoi isolé ne fait pas basculer tout le mois en mode compact", () => {
  const mois = [
    ...Array.from({ length: 40 }, () => ev("match", "10:00", "U10 Élite", { opponent: "Tournoi" })),
    ...Array.from({ length: 10 }, (_, i) => ({
      ...ev("training", "18:00", "U11 Élite"),
      startsAt: `2026-09-${String(10 + i).padStart(2, "0")}T18:00:00`,
    })),
  ];
  // La médiane vaut 1 (dix jours à un seul événement contre un jour à 40), pas la moyenne qui
  // dépasserait 4 et rendrait tout le mois compact pour un seul jour de tournoi.
  assert.equal(lignesParCase(mois), 4);
});

test("un éducateur qui n'encadre qu'une équipe ouvre sur elle", () => {
  assert.equal(equipeParDefaut("coach", ["U14 D1"]), "U14 D1");
  assert.equal(equipeParDefaut("sports_director", ["U16 D1"]), "U16 D1");
});

test("on ne choisit jamais à la place de quelqu'un qui en encadre plusieurs", () => {
  assert.equal(equipeParDefaut("coach", ["U14 D1", "U14 D4"]), "");
  assert.equal(equipeParDefaut("coach", []), "");
  assert.equal(equipeParDefaut("communication_manager", ["U14 D1"]), "", "un CM suit tout le club");
  assert.equal(equipeParDefaut("admin", ["U14 D1"]), "");
});
