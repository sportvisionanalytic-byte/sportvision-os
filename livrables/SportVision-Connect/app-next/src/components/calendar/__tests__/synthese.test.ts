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
  lignesParCase, equipeParDefaut, aBesoinDuLieu, lieuCourt,
  statutLisible, scoreDecompose, couvertureLisible,
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

// ── Doublons d'entraînements : ce qui en est un, et ce qui n'en est pas ──
//
// Fouka, 09/09/2026 : « doublon sur les entrainement deux fois le meme ». L'audit à la source a
// montré qu'il n'y avait AUCUN doublon en base : cinq équipes de Villemomble ont deux séances le
// même jour sur deux TERRAINS différents, le planning municipal réservant deux terrains à une même
// catégorie. Ce que l'écran ne montrait pas, faute d'afficher le lieu.
//
// Ces tests fixent la règle : deux séances réellement distinctes restent deux lignes, et c'est
// l'affichage qui doit permettre de les distinguer — jamais un dédoublonnage qui en masquerait une.

const mardiSeniorsR2 = [
  ev("training", "20:00", "Séniors R2", { location: "PARC DES SPORTS GEORGES POMPIDOU - VILLEMOMBLE" }),
  ev("training", "20:30", "Séniors R2", { location: "STADE CLAUDE RIPERT - VILLEMOMBLE" }),
];

test("deux séances de la même équipe le même jour restent DEUX occurrences", () => {
  const resume = resumerJournee(mardiSeniorsR2, 4);
  assert.equal(resume.visibles.length, 2, "on ne masque jamais une séance réelle");
  assert.equal(resume.total, 2);
});

test("le lieu s'affiche quand il est ce qui distingue deux séances", () => {
  assert.equal(aBesoinDuLieu(mardiSeniorsR2[0]!, mardiSeniorsR2), true);
  assert.equal(aBesoinDuLieu(mardiSeniorsR2[1]!, mardiSeniorsR2), true);
});

test("le lieu ne s'affiche pas quand il n'apprend rien", () => {
  const seule = [ev("training", "18:00", "U10 Élite", { location: "STADE ALAIN MIMOUN" })];
  assert.equal(aBesoinDuLieu(seule[0]!, seule), false, "une seule séance : le lieu mangerait la place pour rien");

  const deuxEquipes = [
    ev("training", "18:00", "U10 Élite", { location: "STADE ALAIN MIMOUN" }),
    ev("training", "18:00", "U11 Élite", { location: "STADE CLAUDE RIPERT" }),
  ];
  assert.equal(aBesoinDuLieu(deuxEquipes[0]!, deuxEquipes), false, "équipes différentes : aucune confusion possible");
});

test("un match n'a jamais besoin du lieu pour être distingué", () => {
  const jour = [
    ev("match", "15:00", "Séniors R2", { opponent: "Meaux", location: "STADE ALAIN MIMOUN" }),
    ev("training", "20:00", "Séniors R2", { location: "STADE CLAUDE RIPERT" }),
  ];
  assert.equal(aBesoinDuLieu(jour[0]!, jour), false, "l'adversaire suffit à l'identifier");
});

test("le lieu est ramené à ce qui le distingue", () => {
  assert.equal(lieuCourt("STADE GEORGES POMPIDOU 1 - VILLEMOMBLE"), "Georges Pompidou 1");
  assert.equal(lieuCourt("PARC DES SPORTS GEORGES POMPIDOU"), "Georges Pompidou");
  assert.equal(lieuCourt("STADE CLAUDE RIPERT - VILLEMOMBLE"), "Claude Ripert");
  // Une chaîne déjà en casse mixte a été saisie par quelqu'un : on n'y touche pas.
  assert.equal(lieuCourt("Stade Alain Mimoun"), "Alain Mimoun");
  assert.equal(lieuCourt(undefined), null);
  assert.equal(lieuCourt(""), null);
});

// ── La fiche match : plus aucun terme technique à l'écran ──

test("les statuts de la base sont traduits, jamais affichés bruts", () => {
  assert.equal(statutLisible(ev("match", "15:00", "Séniors R2", { status: "scheduled" })).label, "À venir");
  assert.equal(statutLisible(ev("match", "15:00", "Séniors R2", { status: "postponed" })).label, "Reporté");
  assert.equal(statutLisible(ev("match", "15:00", "Séniors R2", { status: "cancelled" })).label, "Annulé");
  assert.equal(statutLisible(ev("training", "18:00", "U10 Élite", { status: "modifiee" })).label, "Horaire exceptionnel");
});

test("une feuille de match remplie prime sur un statut non mis à jour", () => {
  // La source oublie parfois de passer un match à « terminé ». Un score prouve que la rencontre a
  // eu lieu : afficher « À venir » sur un 2-0 serait absurde.
  const joue = ev("match", "15:00", "Séniors R2", { status: "scheduled", score: "2-0" });
  assert.equal(statutLisible(joue).label, "Terminé");
});

test("le score est rendu du point de vue de notre équipe", () => {
  // La base stocke toujours « receveur - visiteur ». À l'extérieur, le score de notre équipe est
  // donc le second nombre : l'intervertir ici évite que chaque écran ait à y penser.
  assert.deepEqual(scoreDecompose(ev("match", "15:00", "Séniors R2", { score: "3-1", isHome: true })),
    { domicile: "3", exterieur: "1" });
  assert.deepEqual(scoreDecompose(ev("match", "15:00", "Séniors R2", { score: "3-1", isHome: false })),
    { domicile: "1", exterieur: "3" }, "à l'extérieur, notre score passe à gauche");
});

test("un match non joué n'a pas de score à décomposer", () => {
  assert.equal(scoreDecompose(ev("match", "15:00", "Séniors R2", {})), null);
  assert.equal(scoreDecompose(ev("match", "15:00", "Séniors R2", { score: "à jouer" })), null,
    "un score illisible vaut mieux masqué qu'affiché de travers");
});

test("la couverture dit l'état ET le type, ou rien du tout", () => {
  assert.equal(couvertureLisible(ev("match", "15:00", "Séniors R2", {})), null,
    "sans couverture, aucun bloc — un « aucune couverture » sur 80 entraînements serait du bruit");
  const prevue = couvertureLisible(ev("match", "15:00", "Séniors R2", { coverage: "prevu", coverageType: "photo" }))!;
  assert.equal(prevue.label, "Couverture prévue · Photo");
  const confirmee = couvertureLisible(ev("match", "15:00", "Séniors R2", { coverage: "mission_creee", coverageType: "photo_video" }))!;
  assert.equal(confirmee.label, "Couverture confirmée · Photo et vidéo");
  assert.equal(confirmee.icone, "📸🎥");
});
