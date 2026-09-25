// Provider FOOTCLUBS_XLSX — lecture d'un fichier Excel déposé par un club.
//
// ── Ce qui a changé (07/09/2026) ──
// La première version exigeait que l'utilisateur désigne douze colonnes à la main. C'était le mur
// de l'import. Le provider s'appuie maintenant sur la détection PAR CONTENU (autodetect.ts) :
// une colonne dont les cellules se lisent comme des dates est la colonne date, une colonne dont
// les valeurs sont les équipes du club est l'équipe, donc l'autre colonne texte est l'adversaire.
// Le mapping manuel reste disponible, mais seulement quand la détection échoue ou que
// l'utilisateur veut corriger — plus comme passage obligé.
//
// ── Ce qui n'a pas changé, et pourquoi ──
// Toujours AUCUN nom de colonne Footclubs en dur. Ni "Equipe", ni "Adversaire", ni "Date". Le
// format réel n'a jamais été vu (Footclubs est derrière l'authentification du club) et le deviner
// produirait un import silencieusement décalé d'une colonne, le pire cas possible pour un club qui
// ferait confiance au résultat.
//
// La détection par contenu n'est pas un contournement de cette règle, c'est l'inverse : elle ne
// suppose RIEN du format, elle lit les données. Et sa proposition est affichée à l'utilisateur
// avec le nom des colonnes reconnues, donc vérifiable d'un coup d'œil avant le moindre écrit.
//
// Ce provider n'utilise volontairement pas les listes d'intitulés de header-hints.ts comme signal
// principal : elles ont été écrites pour du CSV générique. Elles ne servent ici que d'arbitre,
// via autodetect, quand deux colonnes ont exactement le même profil.

import { detectTabularLayout, layoutToMapping, type DetectedLayout } from "../autodetect.ts";
import { rowsToSourceEvents } from "../tabular.ts";
import { readXlsx } from "../xlsx.ts";
import { enrichirDepuisSections } from "../tabular-sections.ts";
import {
  TABULAR_FIELD_LABELS,
  TABULAR_REQUIRED_FIELDS,
  type CalendarProvider,
  type ParseResult,
  type ProviderInput,
  type SourceEvent,
  type SourceInspection,
  type SourceIssue,
  type TabularMapping,
} from "../types.ts";

async function toWorkbook(input: ProviderInput) {
  if (!input.bytes) throw new Error("Fichier .xlsx vide ou illisible.");
  return readXlsx(input.bytes);
}

/** Lignes remontées par `inspect()`. Assez pour que la détection ait de la matière et pour
 * reconnaître un export précédé de lignes de titre ; l'écran, lui, n'en affiche qu'une poignée. */
const INSPECT_ROWS = 40;

export const xlsxProvider: CalendarProvider = {
  id: "FOOTCLUBS_XLSX",
  label: "Fichier Excel .xlsx (export Footclubs ou autre tableur)",
  accept: ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  // false : la détection par contenu suffit dans le cas normal. Le mapping n'est demandé que
  // lorsqu'elle échoue, ce que l'appelant constate via `detectTabularLayout().missingRequired`.
  needsColumnMapping: false,
  reads: "binary",
  // Le format Footclubs reste inconnu : on ne promet pas un import Footclubs clé en main, on
  // promet de lire un tableur et de montrer ce qu'on a compris. L'UI le dit ainsi.
  isReady: false,

  detect(fileName) {
    return fileName.toLowerCase().endsWith(".xlsx");
  },

  async inspect(input: ProviderInput): Promise<SourceInspection> {
    const workbook = await toWorkbook(input);
    return {
      sheets: workbook.sheets.map((sheet, index) => ({
        index,
        name: sheet.name,
        rows: sheet.rows.slice(0, INSPECT_ROWS).map((row) => row.map((cell) => cell ?? "")),
        rowCount: sheet.rows.length,
      })),
    };
  },

  async parse(input: ProviderInput): Promise<ParseResult> {
    const workbook = await toWorkbook(input);
    const provided = input.options as TabularMapping | undefined;

    // UN ONGLET DÉSIGNÉ : on lit celui-là, et rien d'autre. C'est le choix de l'utilisateur.
    if (provided?.sheetIndex !== undefined) {
      return lireFeuille(workbook, provided.sheetIndex, input, provided, 0);
    }

    // AUCUN ONGLET DÉSIGNÉ : on les lit TOUS.
    //
    // TROUVÉ LE 25/09/2026 EN BRANCHANT LA SYNCHRONISATION DE NUIT sur le classeur de Villemomble :
    // le lecteur ne retenait qu'un onglet, « le meilleur » au sens du nombre d'équipes reconnues.
    // Sur un classeur d'une feuille par mois, il a choisi novembre — la saison passée — et la
    // synchronisation n'a rien importé du tout. Personne ne l'aurait su : elle aurait simplement
    // annoncé zéro match, nuit après nuit.
    //
    // « Le meilleur onglet » n'a de sens que pour un export d'une seule table précédée d'une page
    // de garde. Un planning de club, lui, est réparti exprès. Les lignes périmées sont déjà
    // écartées par le plancher de saison, et un match présent deux fois dans le fichier est
    // reconnu comme doublon par le moteur : rien ne s'oppose à tout lire.
    const events: SourceEvent[] = [];
    const issues: SourceIssue[] = [];
    let auMoinsUneLue = false;

    for (let i = 0; i < workbook.sheets.length; i++) {
      const resultat = lireFeuille(workbook, i, input, undefined, i * DECALAGE_PAR_FEUILLE);
      if (resultat.events.length > 0) {
        auMoinsUneLue = true;
        events.push(...resultat.events);
        issues.push(...resultat.issues);
      } else {
        // Un onglet illisible n'est signalé QUE si aucun autre n'a rien donné : un classeur de
        // club contient des pages de garde et des listes de contacts, et se plaindre de chacune
        // noierait les vrais signalements sous du bruit.
        issues.push(...resultat.issues.map((x) => ({
          ...x, reason: `« ${workbook.sheets[i]?.name ?? i} » : ${x.reason}` })));
      }
    }

    if (!auMoinsUneLue) return { events: [], issues };
    // On ne garde que les signalements des onglets qui ont vraiment produit des matchs.
    return { events, issues: issues.filter((x) => !/^« /.test(String(x.reason))) };
  },
};

/** Le pas entre deux onglets dans la numérotation des lignes.
 *
 *  Les lignes d'un classeur portent leur numéro Excel, et ce numéro sert de clé : c'est lui que
 *  l'écran d'import utilise pour retenir « sur CETTE ligne, l'équipe est celle-ci ». Lire
 *  plusieurs onglets sans décalage ferait de la ligne 5 de janvier et de la ligne 5 de février la
 *  même clé — un choix fait sur l'une s'appliquerait silencieusement à l'autre.
 *
 *  Un million : très au-delà du million de lignes d'une feuille Excel, donc sans collision
 *  possible, et assez lisible pour qu'on retrouve l'onglet et la ligne à l'œil (3000042 = onglet
 *  3, ligne 42). */
const DECALAGE_PAR_FEUILLE = 1_000_000;

/** Lit UN onglet. `decalage` s'ajoute aux numéros de ligne pour qu'ils restent uniques dans le
 *  classeur entier. */
function lireFeuille(
  workbook: { sheets: { name: string; rows: string[][] }[] },
  sheetIndex: number,
  input: ProviderInput,
  provided: TabularMapping | undefined,
  decalage: number,
): ParseResult {
  const sheet = workbook.sheets[sheetIndex];
  if (!sheet) {
    return { events: [], issues: [{ line: 0, raw: input.fileName, reason: "Feuille de calcul introuvable." }] };
  }

  // Mapping fourni (l'utilisateur a corrigé) : il fait foi. Sinon on détecte.
  let mapping = provided;
  let updatedAtColumn: number | null = null;
  let lignes = sheet.rows;
  let dateParSection = false;
  // Un humain a-t-il DÉSIGNÉ les colonnes, ou seulement choisi une feuille ? La nuance compte :
  // `provided` peut ne porter qu'un `sheetIndex`, et choisir un onglet n'est pas se prononcer
  // sur le contenu des colonnes. Seul le premier cas fait taire les garde-fous de contenu.
  const mappageImpose = !!provided
    && TABULAR_REQUIRED_FIELDS.every((f) => provided.columns?.[f] !== undefined);
  // `mapping.columns` peut manquer : l'écran d'import n'envoie parfois qu'un `sheetIndex`, quand
  // l'utilisateur choisit un onglet sans se prononcer sur les colonnes. Sans le `?.`, la lecture
  // plantait — trouvé le 25/09/2026 en rejouant les dix onglets du classeur de Villemomble.
  if (!mapping || TABULAR_REQUIRED_FIELDS.some((f) => mapping!.columns?.[f] === undefined)) {
    let layout = detectTabularLayout(lignes, { teams: input.teams });

    // Planning « par blocs » : la date est un titre de section, pas une colonne. On la reporte
    // sur chaque ligne, puis on relit avec le moteur habituel — aucune regle de lecture
    // nouvelle, juste une colonne de plus.
    if (layout.missingRequired.includes("date")) {
      const enrichies = enrichirDepuisSections(lignes);
      if (enrichies) {
        const relecture = detectTabularLayout(enrichies, { teams: input.teams });
        if (relecture.missingRequired.length < layout.missingRequired.length) {
          lignes = enrichies;
          layout = relecture;
          dateParSection = true;
        }
      }
    }

    if (layout.missingRequired.length > 0) {
      return {
        events: [],
        issues: [
          {
            line: 0,
            raw: input.fileName,
            reason: `Impossible de reconnaître ${layout.missingRequired
              .map((f) => TABULAR_FIELD_LABELS[f].toLowerCase())
              .join(" et ")} dans « ${sheet.name} ». Désignez les colonnes vous-même.`,
          },
        ],
      };
    }
    mapping = layoutToMapping(layout, sheetIndex);
    updatedAtColumn = layout.updatedAtColumn;
  }

  const lu = rowsToSourceEvents(lignes, { mapping, updatedAtColumn, mappageImpose, dateParSection });
  if (!decalage) return lu;
  return {
    events: lu.events.map((e) => ({ ...e, sourceLine: e.sourceLine + decalage })),
    issues: lu.issues.map((x) => ({ ...x, line: x.line ? x.line + decalage : x.line })),
  };
}

/** Ce que l'écran d'import a besoin de savoir pour AFFICHER ce qui a été compris : quelle feuille
 * a été retenue et quelles colonnes ont été reconnues. Sans ça, l'utilisateur devrait faire
 * confiance à une détection invisible. */
export function detectXlsxLayout(
  inspection: SourceInspection,
  teams?: { name: string }[],
): { sheetIndex: number; layout: DetectedLayout } {
  const sheets = inspection.sheets.map((s) => ({ name: s.name, rows: s.rows }));
  const sheetIndex = pickBestSheet(sheets, teams);
  return { sheetIndex, layout: detectTabularLayout(sheets[sheetIndex]?.rows ?? [], { teams }) };
}

/**
 * Un classeur Footclubs peut contenir plusieurs feuilles (une par équipe, ou des feuilles
 * annexes). On retient celle où la détection trouve le plus de champs, à égalité celle qui a le
 * plus de lignes. Bien meilleur défaut que « la première feuille », qui est souvent une page de
 * garde.
 */
function pickBestSheet(sheets: { name: string; rows: string[][] }[], teams?: { name: string }[]): number {
  let bestIndex = 0;
  let bestScore = -1;
  for (let i = 0; i < sheets.length; i++) {
    const sheet = sheets[i]!;
    const layout = detectTabularLayout(sheet.rows, { teams });
    const complete = layout.missingRequired.length === 0 ? 100 : 0;
    const score = complete + Object.keys(layout.columns).length * 5 + Math.min(sheet.rows.length, 50) / 50;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return bestIndex;
}
