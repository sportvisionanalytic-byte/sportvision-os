// Provider PDF — le calendrier tel que la plupart des fédérations et des clubs le diffusent.
//
// C'est le format le plus courant et c'était le seul qu'on refusait : un club qui reçoit son
// calendrier en PDF devait le recopier à la main, ce qui est exactement le travail qu'on prétend
// lui enlever.
//
// Il commence par retrouver des lignes et des colonnes dans des fragments de texte positionnés
// (pdf-lignes.ts), puis suit DEUX chemins :
//
//   1. Calendrier de poule (district, ligue) — pdf-poule.ts. Mise en page où la date vit dans un
//      en-tête de journée et où chaque ligne porte l'aller et le retour. Ce lecteur n'est employé
//      que s'il RECONNAÎT la mise en page, jamais par défaut.
//   2. Tout le reste — le moteur de détection PAR CONTENU (autodetect.ts), le même qui lit un CSV
//      ou un tableur. Un calendrier reste un calendrier.
//
// La règle « aucun format de fédération en dur », héritée du provider .xlsx, tenait à ceci : le
// format réel n'avait jamais été vu, et le deviner aurait produit un import silencieusement
// décalé. Le 08/09/2026, Fouka a fourni un vrai calendrier de district. Écrire son lecteur n'est
// donc plus une supposition, c'est la lecture d'un format observé — et il reste testé sur ce
// fichier-là.

import { detectTabularLayout, layoutToMapping, type DetectedLayout } from "../autodetect.ts";
import { elementsVersLignes, type ElementTexte } from "../pdf-lignes.ts";
import { lireCalendrierDePoule, ressembleAUnCalendrierDePoule } from "../pdf-poule.ts";
import { rowsToSourceEvents } from "../tabular.ts";
import {
  TABULAR_FIELD_LABELS,
  TABULAR_REQUIRED_FIELDS,
  type CalendarProvider,
  type ParseResult,
  type ProviderInput,
  type SourceInspection,
  type TabularMapping,
} from "../types.ts";

/** Ce que l'appelant fournit à la place des octets quand le texte a déjà été extrait — c'est le
 * cas de l'écran d'import, qui extrait une fois pour l'aperçu et réutilise le résultat, et c'est
 * ce qui rend ce provider testable sans embarquer pdf.js dans le harnais. */
export interface OptionsPdf extends Partial<TabularMapping> {
  elements?: ElementTexte[];
  lignes?: string[][];
  /** Le club dont on veut le calendrier, quand le document ne le nomme pas lui-même. */
  nomClub?: string | null;
}

const INSPECT_LIGNES = 40;

/** Les octets ne sont lus que si personne n'a déjà fait l'extraction. L'import de pdf.js est
 * dynamique : ce fichier reste chargeable sans lui. */
async function lireLignes(input: ProviderInput): Promise<string[][]> {
  const options = input.options as OptionsPdf | undefined;
  if (options?.lignes) return options.lignes;
  if (options?.elements) return elementsVersLignes(options.elements);
  if (!input.bytes) throw new Error("Fichier PDF vide ou illisible.");
  const { extraireElementsTexte } = await import("../../pdf/extraire-texte.ts");
  return elementsVersLignes(await extraireElementsTexte(input.bytes));
}

export const pdfProvider: CalendarProvider = {
  id: "PDF",
  label: "Calendrier PDF (fédération, ligue ou district)",
  accept: ".pdf,application/pdf",
  // La détection par contenu suffit dans le cas normal ; le mapping manuel reste offert quand
  // elle échoue, exactement comme pour un tableur.
  needsColumnMapping: false,
  reads: "binary",
  // Un PDF est une mise en page, pas une table de données : la reconstruction réussit souvent
  // mais pas toujours. L'écran le dit, et montre ce qui a été compris avant d'écrire quoi que ce
  // soit. Le prétendre « prêt » serait promettre une fiabilité que le format ne permet pas.
  isReady: false,

  detect(fileName, head) {
    return fileName.toLowerCase().endsWith(".pdf") || head.startsWith("%PDF-");
  },

  async inspect(input: ProviderInput): Promise<SourceInspection> {
    const lignes = await lireLignes(input);
    return {
      sheets: [
        {
          index: 0,
          name: "Document PDF",
          rows: lignes.slice(0, INSPECT_LIGNES),
          rowCount: lignes.length,
        },
      ],
    };
  },

  async parse(input: ProviderInput): Promise<ParseResult> {
    const lignes = await lireLignes(input);
    if (lignes.length === 0) {
      return {
        events: [],
        issues: [{ line: 0, raw: input.fileName, reason: "Aucun texte lisible dans ce PDF." }],
      };
    }

    // Un calendrier de POULE (district, ligue) ne se lit pas comme un tableau : la date est dans
    // un en-tête de journée et chaque ligne porte l'aller ET le retour. Son lecteur dédié passe
    // en premier, mais seulement s'il RECONNAÎT la mise en page — sinon on lirait n'importe quel
    // PDF avec lui et on fabriquerait des matchs à partir de rien.
    if (ressembleAUnCalendrierDePoule(lignes)) {
      const poule = lireCalendrierDePoule(lignes, { nomClub: (input.options as OptionsPdf | undefined)?.nomClub });
      if (poule.evenements.length > 0) {
        return {
          events: poule.evenements,
          issues:
            poule.matchsAutresClubs > 0
              ? [
                  {
                    line: 0,
                    raw: input.fileName,
                    reason: `${poule.matchsAutresClubs} match${poule.matchsAutresClubs > 1 ? "s" : ""} de la poule ne concerne${poule.matchsAutresClubs > 1 ? "nt" : ""} pas ${poule.club ?? "votre club"} : ignoré${poule.matchsAutresClubs > 1 ? "s" : ""}.`,
                  },
                ]
              : [],
        };
      }
      return {
        events: [],
        issues: [
          {
            line: 0,
            raw: input.fileName,
            reason: poule.club
              ? `Calendrier de poule reconnu, mais aucun match de « ${poule.club} » n'y a été trouvé. Vérifiez que c'est bien le calendrier de votre club.`
              : "Calendrier de poule reconnu, mais ce document ne dit pas à quel club il s'adresse. Choisissez votre club ci-dessus.",
          },
        ],
      };
    }

    const fourni = input.options as TabularMapping | undefined;
    let mapping = fourni?.columns ? fourni : undefined;

    if (!mapping || TABULAR_REQUIRED_FIELDS.some((f) => mapping!.columns[f] === undefined)) {
      const layout = detectTabularLayout(lignes, { teams: input.teams });
      if (layout.missingRequired.length > 0) {
        return {
          events: [],
          issues: [
            {
              line: 0,
              raw: input.fileName,
              reason: `Impossible de reconnaître ${layout.missingRequired
                .map((f) => TABULAR_FIELD_LABELS[f].toLowerCase())
                .join(" et ")} dans ce PDF. Désignez les colonnes vous-même, ou déposez le calendrier en .csv ou .xlsx.`,
            },
          ],
        };
      }
      mapping = layoutToMapping(layout, 0);
      return rowsToSourceEvents(lignes, { mapping, updatedAtColumn: layout.updatedAtColumn });
    }

    return rowsToSourceEvents(lignes, { mapping });
  },
};

/** Ce que l'écran affiche pour que l'humain vérifie la lecture avant tout écrit : les colonnes
 * reconnues dans le PDF reconstruit. Miroir de detectXlsxLayout. */
export function detecterLayoutPdf(
  inspection: SourceInspection,
  teams?: { name: string }[],
): DetectedLayout {
  return detectTabularLayout(inspection.sheets[0]?.rows ?? [], { teams });
}
