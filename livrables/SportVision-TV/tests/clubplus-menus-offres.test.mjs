// Un club Full Communication n'oublie pas d'entrée de menu que le même club en Club+ possède.
//
//   node livrables/SportVision-TV/tests/clubplus-menus-offres.test.mjs
//
// POURQUOI CE TEST. Trois fois en trois semaines, le même défaut : une page qui fonctionne, un
// droit qui l'autorise, et aucune entrée de menu pour y mener. À chaque fois découvert par un
// retour client, jamais par nous.
//   · 23/08/2026 — « Membres & accès » : un club Full Communication ne pouvait inviter personne.
//   · 12/09/2026 — « Actualités » et « Demandes » : le président devait taper l'URL.
//   · 14/09/2026 — « Calendrier » : SF Villemomble avait 426 matchs et aucun moyen de les ouvrir.
//
// Les trois entrées manquaient à NAV_CLUB_FULLCOM en étant présentes dans NAV_CLUB_PLUS. C'est le
// même club, le même produit, les mêmes pages : une entrée qui existe pour l'un et pas pour
// l'autre est un oubli jusqu'à preuve du contraire. Ce test exige cette preuve, sous la forme
// d'une ligne écrite ci-dessous.
//
// Aucune donnée, aucun réseau, aucun navigateur : la navigation est lue dans le code source.

import { resolveNavigation } from "../../SportVision-Connect/app-next/src/lib/navigation.ts";

// Ce qu'un club Full Communication n'a délibérément PAS, alors que Club+ l'a. Chaque ligne est une
// décision, pas un constat : la justifier ici est ce qui distingue un choix d'un oubli.
const ABSENCES_VOULUES = {
  "/studio": "Le Studio est l'outil de l'offre Club+ (47 modèles à composer soi-même). En Full Communication, c'est SportVision qui produit : le club demande, il ne compose pas.",
  "/matchcenter": "Le Match Center est piloté par SportVision en Full Communication ; le club suit ses matchs par le Calendrier.",
  "/galeries": "Les galeries de production arrivent par « Contenus », même page de destination.",
  "/accompagnement": "L'accompagnement est l'offre d'autonomie de Club+ ; en Full Communication, le CM EST l'accompagnement (entrée « Mon CM »).",
  "/contracts": "Le contrat Full Communication est signé hors produit ; « Documents » porte les pièces du club.",
  "/support": "Remplacé par l'accès direct au CM (« Mon CM ») et la messagerie.",
};

const entrees = (nav) => nav.filter((e) => e.href).map((e) => e.href);
const clubPlus = entrees(resolveNavigation("club", "performance"));
const fullCom = entrees(resolveNavigation("club", "full_communication"));

const r = []; const t = (n, ok, d = "") => r.push(`${ok ? "ok  " : "KO  "} ${n}${d ? "  · " + d : ""}`);

t("les deux navigations de club sont bien distinctes", clubPlus.length > 0 && fullCom.length > 0,
  `Club+ ${clubPlus.length} entrées, Full Communication ${fullCom.length}`);

const manquantes = clubPlus.filter((h) => !fullCom.includes(h) && !ABSENCES_VOULUES[h]);
t("aucune entrée de Club+ ne manque au menu Full Communication sans raison écrite",
  manquantes.length === 0,
  manquantes.length ? `à décider : ${manquantes.join(", ")}` : `${Object.keys(ABSENCES_VOULUES).length} absence(s) assumée(s)`);

// L'inverse : une justification qui ne correspond plus à rien vieillit mal.
const perimees = Object.keys(ABSENCES_VOULUES).filter((h) => !clubPlus.includes(h) || fullCom.includes(h));
t("aucune justification d'absence n'est périmée", perimees.length === 0,
  perimees.length ? `à supprimer : ${perimees.join(", ")}` : "");

// Les trois oublis réellement survenus : ils doivent rester présents.
for (const [libelle, href] of [["Calendrier", "/calendar"], ["Membres & accès", "/users"], ["Actualités", "/newsroom"], ["Demandes", "/requests"]]) {
  t(`« ${libelle} » est dans le menu d'un club Full Communication`, fullCom.includes(href), href);
}

console.log(r.join("\n"));
console.log(`${r.filter((l) => l.startsWith("ok")).length}/${r.length} vérifications passées.`);
if (r.some((l) => l.startsWith("KO"))) process.exit(1);
