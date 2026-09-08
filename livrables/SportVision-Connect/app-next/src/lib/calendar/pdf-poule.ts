// Lecture d'un calendrier de POULE, tel que les districts et ligues le diffusent en PDF.
//
// Ce format n'a rien d'un tableau de matchs, et c'est pour ça que la détection par contenu
// échouait sur le vrai fichier de Fouka (08/09/2026) : « Impossible de reconnaître date ».
//
//   ASSOCIATION SPORTIVE VILLENEUVE LA GUYARD - 565301          ← le club destinataire
//   Seniors D3 / Unique                                          ← la catégorie
//   Poule A
//   Journée 1 - Aller  06/09/2026     Journée 26 - Retour  06/06/2027   ← les DEUX dates
//   52430.  0 - 1  12H30  79143682  U.S. Dionysienne St 2  - Champigny 2  79143815  15H  ... - ...
//                                                                   ↑ aller        ↑ retour
//
// Trois particularités, toutes traitées ici :
//
// 1. La date n'est pas dans une colonne, elle est dans un en-tête de journée qui vaut pour toutes
//    les lignes suivantes. Une ligne porte donc DEUX matchs : l'aller et le retour.
// 2. Une ligne peut être suivie d'une ligne de correction ne contenant qu'une date ou qu'une
//    heure : ce match-là se joue à une autre date. La colonne où elle apparaît dit si la
//    correction porte sur l'aller ou sur le retour.
// 3. Le document liste TOUTE la poule, y compris des matchs entre deux autres clubs. On ne garde
//    que ceux du club destinataire, reconnu depuis l'en-tête (voir estEquipeDuClub).
//
// La lecture d'une ligne est faite PAR CONTENU, jamais par numéro de colonne : le nombre de
// colonnes varie d'une page à l'autre dans le fichier réel, et un index figé décalerait les
// valeurs sans que ça se voie.

import type { SourceEvent, SportStatus } from "./types.ts";

const RE_NUMERO_MATCH = /^\d+\.$/;
const RE_IDENTIFIANT = /^\d{6,}$/;
const RE_HEURE = /^(\d{1,2})\s*[Hh:]\s*(\d{2})?$/;
const RE_DATE = /^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/;
/** « 0 - 1 », « 2 - 0 », ou « ... - ... » quand le match n'est pas joué. */
const RE_SCORE = /^(\d+|\.{2,})\s*-\s*(\d+|\.{2,})$/;

function normaliser(texte: string): string[] {
  return texte
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Un jeton du nom d'équipe explique soit le début d'un mot de l'en-tête, soit les initiales de
 * plusieurs mots consécutifs : « As Vlg » se lit « Association Sportive » + « Villeneuve La
 * Guyard ». On exige que l'en-tête soit couvert EN ENTIER, sinon « Villeneuve 1 » — un autre club
 * — passerait pour le nôtre.
 */
function couvre(candidat: string[], ci: number, entete: string[], ei: number): boolean {
  if (ci === candidat.length) return ei === entete.length;
  if (ei >= entete.length) return false;
  const jeton = candidat[ci]!;

  if (jeton.length >= 2 && entete[ei]!.startsWith(jeton) && couvre(candidat, ci + 1, entete, ei + 1)) {
    return true;
  }
  for (let n = 1; ei + n <= entete.length; n++) {
    if (jeton.length !== n) continue;
    let correspond = true;
    for (let k = 0; k < n; k++) {
      if (entete[ei + k]![0] !== jeton[k]) {
        correspond = false;
        break;
      }
    }
    if (correspond && couvre(candidat, ci + 1, entete, ei + n)) return true;
  }
  return false;
}

/** Cette équipe est-elle une équipe du club auquel le calendrier est adressé ? */
export function estEquipeDuClub(nomEquipe: string, entete: string): boolean {
  const candidat = normaliser(nomEquipe).filter((j) => !/^\d+$/.test(j));
  // Le numéro d'affiliation de l'en-tête (565301) n'est pas un mot du nom.
  const mots = normaliser(entete).filter((j) => !/^\d{4,}$/.test(j));
  return candidat.length > 0 && mots.length > 0 && couvre(candidat, 0, mots, 0);
}

function versDateIso(brut: string): string | null {
  const m = RE_DATE.exec(brut.trim());
  if (!m) return null;
  const annee = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
  return `${annee}-${m[2]}-${m[1]}`;
}

function versHeure(brut: string): string | null {
  const m = RE_HEURE.exec(brut.trim());
  if (!m) return null;
  return `${m[1]!.padStart(2, "0")}:${m[2] ?? "00"}`;
}

/** Un score renseigné veut dire que le match a été joué ; « ... - ... » ne dit rien. */
function statutDepuisScore(brut: string | null): { statut: SportStatus | null; score: string | null } {
  if (!brut) return { statut: null, score: null };
  const m = RE_SCORE.exec(brut.trim());
  if (!m) return { statut: null, score: null };
  if (m[1]!.startsWith(".") || m[2]!.startsWith(".")) return { statut: null, score: null };
  return { statut: "completed", score: `${m[1]}-${m[2]}` };
}

interface MatchBrut {
  indexLigne: number;
  identifiant: string | null;
  domicile: string;
  exterieur: string;
  heure: string | null;
  score: string | null;
  /** Colonne où se trouve l'identifiant : sert à savoir si une correction porte sur ce match. */
  colonne: number;
}

/** Une ligne de match donne l'aller ET le retour. Lecture par contenu, pas par index. */
function lireLigneMatch(ligne: string[]): { aller: MatchBrut; retour: MatchBrut } | null {
  // Le numéro n'est pas toujours en première colonne : dans le fichier réel, certaines lignes
  // commencent par une cellule vide et tout se décale d'un cran. Chercher la première cellule
  // remplie au lieu de l'index 0 récupère ces lignes-là (deux matchs U18 perdus autrement).
  const colonneNumero = ligne.findIndex((c) => (c ?? "").trim() !== "");
  if (colonneNumero < 0 || !RE_NUMERO_MATCH.test(ligne[colonneNumero]!.trim())) return null;

  const identifiants: { valeur: string; colonne: number }[] = [];
  const heures: { valeur: string; colonne: number }[] = [];
  const scores: { valeur: string; colonne: number }[] = [];
  let domicile = "";
  let exterieur = "";
  let colonneDomicile = -1;

  ligne.forEach((cellule, colonne) => {
    const valeur = (cellule ?? "").trim();
    if (valeur === "" || colonne === colonneNumero) return;
    if (RE_IDENTIFIANT.test(valeur)) identifiants.push({ valeur, colonne });
    else if (RE_HEURE.test(valeur)) heures.push({ valeur, colonne });
    else if (RE_SCORE.test(valeur)) scores.push({ valeur, colonne });
    else if (valeur.startsWith("-")) exterieur = valeur.replace(/^-\s*/, "").trim();
    else if (domicile === "") {
      domicile = valeur;
      colonneDomicile = colonne;
    }
  });

  if (domicile === "" || exterieur === "") return null;
  void colonneDomicile;

  const colonneSeparation = identifiants[1]?.colonne ?? Number.MAX_SAFE_INTEGER;
  const avant = <T extends { colonne: number }>(l: T[]) => l.find((x) => x.colonne < colonneSeparation);
  const apres = <T extends { colonne: number }>(l: T[]) => l.find((x) => x.colonne >= colonneSeparation);

  return {
    aller: {
      indexLigne: 0,
      identifiant: identifiants[0]?.valeur ?? null,
      domicile,
      exterieur,
      heure: versHeure(avant(heures)?.valeur ?? ""),
      score: avant(scores)?.valeur ?? null,
      colonne: identifiants[0]?.colonne ?? 0,
    },
    // Au retour, les équipes sont inversées : c'est l'autre club qui reçoit.
    retour: {
      indexLigne: 0,
      identifiant: identifiants[1]?.valeur ?? null,
      domicile: exterieur,
      exterieur: domicile,
      heure: versHeure(apres(heures)?.valeur ?? ""),
      score: apres(scores)?.valeur ?? null,
      colonne: identifiants[1]?.colonne ?? colonneSeparation,
    },
  };
}

/** Une ligne qui ne porte qu'une date et/ou une heure corrige le match de la ligne précédente. */
function lireLigneCorrection(ligne: string[]): { date: string | null; heure: string | null; colonne: number } | null {
  const remplies = ligne
    .map((c, colonne) => ({ valeur: (c ?? "").trim(), colonne }))
    .filter((c) => c.valeur !== "");
  if (remplies.length === 0 || remplies.length > 2) return null;

  let date: string | null = null;
  let heure: string | null = null;
  for (const { valeur } of remplies) {
    const d = versDateIso(valeur);
    const h = versHeure(valeur);
    if (d) date = d;
    else if (h) heure = h;
    else return null;
  }
  if (!date && !heure) return null;
  return { date, heure, colonne: remplies[0]!.colonne };
}

export interface ResultatPoule {
  /** Le club auquel le calendrier est adressé, tel que l'en-tête le nomme. */
  club: string | null;
  /** Les noms sous lesquels ses équipes apparaissent dans le document. */
  equipesDuClub: string[];
  evenements: SourceEvent[];
  /** Matchs de la poule ne concernant pas le club — comptés, jamais importés. */
  matchsAutresClubs: number;
}

/** Reconnaît la mise en page avant de la lire : sans ça, on tenterait ce lecteur sur n'importe
 * quel PDF et on produirait des matchs à partir de rien. */
export function ressembleAUnCalendrierDePoule(lignes: string[][]): boolean {
  let entetesJournee = 0;
  let lignesMatch = 0;
  for (const ligne of lignes) {
    const texte = ligne.join(" ");
    if (/journ[ée]e/i.test(texte) && /(aller|retour)/i.test(texte)) entetesJournee++;
    const premiere = ligne.find((c) => (c ?? "").trim() !== "");
    if (premiere && RE_NUMERO_MATCH.test(premiere.trim())) lignesMatch++;
  }
  return entetesJournee >= 2 && lignesMatch >= 4;
}

export function lireCalendrierDePoule(lignes: string[][]): ResultatPoule {
  const club =
    lignes
      .map((l) => (l[0] ?? "").trim())
      .find((t) => /\d{5,}/.test(t) && normaliser(t).length >= 3) ?? null;

  const evenements: SourceEvent[] = [];
  const equipesDuClub = new Set<string>();
  let matchsAutresClubs = 0;

  let categorie: string | null = null;
  let dateAller: string | null = null;
  let dateRetour: string | null = null;
  /** Le dernier match émis de chaque côté, pour qu'une ligne de correction sache quoi corriger. */
  let dernierAller: SourceEvent | null = null;
  let dernierRetour: SourceEvent | null = null;
  let colonneSeparation = Number.MAX_SAFE_INTEGER;

  const estDuClub = (nom: string) => (club ? estEquipeDuClub(nom, club) : false);

  lignes.forEach((ligne, index) => {
    const remplies = ligne.filter((c) => (c ?? "").trim() !== "");
    const texte = ligne.join(" ").trim();

    // ── Catégorie : « Seniors D3 / Unique », « U18 Departemental 2 / … »
    if (remplies.length === 1 && remplies[0]!.includes("/") && !RE_DATE.test(remplies[0]!.trim())) {
      categorie = remplies[0]!.trim();
      return;
    }

    // ── En-tête de journée : porte la date de l'aller et celle du retour.
    if (/journ[ée]e/i.test(texte) && /(aller|retour)/i.test(texte)) {
      const dates = ligne.map((c) => versDateIso((c ?? "").trim())).filter((d): d is string => d !== null);
      dateAller = dates[0] ?? null;
      dateRetour = dates[1] ?? null;
      dernierAller = null;
      dernierRetour = null;
      return;
    }

    // ── Correction de date ou d'heure sur le match précédent.
    const correction = lireLigneCorrection(ligne);
    if (correction) {
      const cible = correction.colonne < colonneSeparation ? dernierAller : dernierRetour;
      if (cible) {
        if (correction.date) cible.matchDate = correction.date;
        if (correction.heure) cible.kickoffTime = correction.heure;
      }
      return;
    }

    // ── Ligne de match.
    const lu = lireLigneMatch(ligne);
    if (!lu) return;
    colonneSeparation = lu.retour.colonne;
    dernierAller = null;
    dernierRetour = null;

    for (const [cote, brut, date] of [
      ["aller", lu.aller, dateAller],
      ["retour", lu.retour, dateRetour],
    ] as const) {
      if (!date) continue;
      const nous = estDuClub(brut.domicile) ? brut.domicile : estDuClub(brut.exterieur) ? brut.exterieur : null;
      if (!nous) {
        if (cote === "aller") matchsAutresClubs++;
        continue;
      }
      equipesDuClub.add(nous);
      const aDomicile = nous === brut.domicile;
      const { statut, score } = statutDepuisScore(brut.score);

      const evenement: SourceEvent = {
        sourceLine: index + 1,
        rawLabel: `${categorie ?? "?"} — ${brut.domicile} / ${brut.exterieur} (${cote})`,
        externalEventId: brut.identifiant,
        externalCompetitionId: null,
        competitionName: categorie,
        externalTeamId: null,
        sourceTeamName: nous,
        opponent: aDomicile ? brut.exterieur : brut.domicile,
        matchDate: date,
        kickoffTime: brut.heure,
        location: null,
        isHome: aDomicile,
        sportStatus: statut,
        score,
        sourceUpdatedAt: null,
      };
      evenements.push(evenement);
      if (cote === "aller") dernierAller = evenement;
      else dernierRetour = evenement;
    }
  });

  return { club, equipesDuClub: [...equipesDuClub], evenements, matchsAutresClubs };
}
