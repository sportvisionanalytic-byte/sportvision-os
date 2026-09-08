// Provider PDF — le calendrier tel que la plupart des fédérations et des clubs le diffusent.
//
// C'est le format le plus courant et c'était le seul qu'on refusait : un club qui reçoit son
// calendrier en PDF devait le recopier à la main, ce qui est exactement le travail qu'on prétend
// lui enlever.
//
// Ce provider n'invente AUCUNE règle de lecture qui lui soit propre. Il fait une seule chose que
// les autres n'ont pas à faire : retrouver des lignes et des colonnes dans des fragments de texte
// positionnés (pdf-lignes.ts). Ensuite il passe le relais au moteur de détection PAR CONTENU
// (autodetect.ts), le même qui lit un CSV ou un tableur. Un calendrier reste un calendrier.
//
// Conséquence directe : aucun nom de colonne de fédération en dur ici, pas plus que dans le
// provider .xlsx, et pour la même raison — le format réel varie d'une ligue à l'autre et le
// deviner produirait un import silencieusement décalé.

import { detectTabularLayout, layoutToMapping, type DetectedLayout } from "../autodetect.ts";
import { elementsVersLignes, type ElementTexte } from "../pdf-lignes.ts";
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
