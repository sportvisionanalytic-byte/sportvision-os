// Lecture technique d'un fichier .xlsx — ZIP + XML, sans aucune dépendance.
//
// Pourquoi pas une librairie :
//   * `xlsx` (SheetJS) n'est plus publié sur npm par ses auteurs ; la version qui y reste
//     (0.18.5) porte deux avis de sécurité non corrigés (pollution de prototype, ReDoS). Ce sont
//     des fichiers déposés par des clubs qui passeraient dedans.
//   * `exceljs` embarque son propre polyfill ZIP et pèse ~1 Mo dans le bundle client, pour un
//     écran d'import utilisé quelques fois par saison.
//   * Le repo lit déjà tous ses formats à la main (roster-import.ts, providers/csv.ts,
//     providers/ics.ts). Un .xlsx est un ZIP de XML : `DecompressionStream("deflate-raw")` est
//     nativement disponible côté navigateur (Chrome 103+, Safari 16.4+, Firefox 113+) et côté
//     Node 18+, ce qui laisse ~200 lignes de code lisible plutôt qu'une dépendance opaque.
//
// Ce module ne sait rien du football : il rend des feuilles de cellules texte. C'est
// providers/xlsx.ts qui, avec un mapping de colonnes fourni par un humain, en fait des matchs.
//
// Limites assumées et documentées : pas de ZIP64 (un calendrier de club ne dépasse pas 4 Go),
// pas de lecture des styles — une cellule de date revient donc sous la forme de son numéro de
// série Excel, que `parseFlexibleDate` sait convertir.

export interface XlsxSheet {
  name: string;
  rows: string[][];
}

export interface XlsxWorkbook {
  sheets: XlsxSheet[];
}

// ───────────────────────────── ZIP ─────────────────────────────

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
}

function findEndOfCentralDirectory(view: DataView): number {
  // Le commentaire final d'un ZIP fait au plus 65535 octets, l'EOCD 22 : au-delà, inutile de
  // remonter plus loin.
  const minOffset = Math.max(0, view.byteLength - 22 - 65535);
  for (let i = view.byteLength - 22; i >= minOffset; i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) return i;
  }
  return -1;
}

function readZipEntries(buffer: ArrayBuffer): ZipEntry[] {
  const view = new DataView(buffer);
  const eocd = findEndOfCentralDirectory(view);
  if (eocd === -1) throw new Error("Fichier .xlsx illisible : archive ZIP non reconnue.");

  const entryCount = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder("utf-8");
  const entries: ZipEntry[] = [];

  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(offset, true) !== CENTRAL_SIGNATURE) break;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(new Uint8Array(buffer, offset + 46, nameLength));
    entries.push({ name, method, compressedSize, localHeaderOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error(
      "Ce navigateur ne sait pas décompresser les fichiers .xlsx. Enregistrez votre tableur au format .csv et réimportez-le.",
    );
  }
  const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readZipFile(buffer: ArrayBuffer, entry: ZipEntry): Promise<string> {
  const view = new DataView(buffer);
  if (view.getUint32(entry.localHeaderOffset, true) !== LOCAL_SIGNATURE) {
    throw new Error(`Fichier .xlsx illisible : entrée « ${entry.name} » corrompue.`);
  }
  // La taille des champs "extra" de l'en-tête LOCAL diffère de celle de l'annuaire central : il
  // faut relire les deux longueurs ici, pas les réutiliser depuis l'entrée centrale.
  const nameLength = view.getUint16(entry.localHeaderOffset + 26, true);
  const extraLength = view.getUint16(entry.localHeaderOffset + 28, true);
  const dataStart = entry.localHeaderOffset + 30 + nameLength + extraLength;
  const raw = new Uint8Array(buffer, dataStart, entry.compressedSize);

  const bytes = entry.method === 0 ? raw : await inflateRaw(raw);
  return new TextDecoder("utf-8").decode(bytes);
}

// ───────────────────────────── XML ─────────────────────────────

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXml(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, code: string) => {
    if (code.startsWith("#x") || code.startsWith("#X")) return String.fromCodePoint(parseInt(code.slice(2), 16));
    if (code.startsWith("#")) return String.fromCodePoint(parseInt(code.slice(1), 10));
    return ENTITIES[code] ?? whole;
  });
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`).exec(tag);
  return m ? decodeXml(m[1]!) : null;
}

/** "AB12" → 27 (index 0-based de la colonne AB). Les cellules vides sont absentes du XML : sans
 * cette conversion, un trou de colonne décalerait toutes les suivantes. */
function columnIndex(cellRef: string): number {
  let index = 0;
  for (const char of cellRef) {
    const code = char.charCodeAt(0);
    if (code < 65 || code > 90) break;
    index = index * 26 + (code - 64);
  }
  return index - 1;
}

function parseSharedStrings(xml: string): string[] {
  const items: string[] = [];
  const siRe = /<si(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/si>)/g;
  let match: RegExpExecArray | null;
  while ((match = siRe.exec(xml)) !== null) {
    const body = match[1] ?? "";
    // Un <si> peut contenir plusieurs <t> (texte enrichi découpé en « runs ») : il faut les
    // concaténer, sinon "FC Melun" saisi avec un mot en gras ressort tronqué à "FC ".
    const parts = body.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g) ?? [];
    items.push(parts.map((p) => decodeXml(p.replace(/^<t(?:\s[^>]*)?>/, "").replace(/<\/t>$/, ""))).join(""));
  }
  return items;
}

function parseSheet(xml: string, sharedStrings: string[]): string[][] {
  const rows: string[][] = [];
  const rowRe = /<row(\s[^>]*?)?\s*(?:\/>|>([\s\S]*?)<\/row>)/g;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRe.exec(xml)) !== null) {
    const rowAttrs = rowMatch[1] ?? "";
    const body = rowMatch[2] ?? "";
    const cells: string[] = [];
    const cellRe = /<c(\s[^>]*)?(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch: RegExpExecArray | null;

    while ((cellMatch = cellRe.exec(body)) !== null) {
      const tag = `<c${cellMatch[1] ?? ""}>`;
      const inner = cellMatch[2] ?? "";
      const type = attr(tag, "t");
      const ref = attr(tag, "r");
      let value = "";

      if (type === "inlineStr") {
        const texts = inner.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g) ?? [];
        value = texts.map((t) => decodeXml(t.replace(/^<t(?:\s[^>]*)?>/, "").replace(/<\/t>$/, ""))).join("");
      } else {
        const v = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(inner);
        const raw = v ? decodeXml(v[1]!) : "";
        if (type === "s") {
          const index = Number(raw);
          value = Number.isInteger(index) ? sharedStrings[index] ?? "" : "";
        } else if (type === "b") {
          value = raw === "1" ? "VRAI" : "FAUX";
        } else if (type === "e") {
          value = ""; // #N/A, #REF!… : une cellule en erreur vaut une cellule vide, jamais une valeur inventée
        } else {
          value = raw;
        }
      }

      const target = ref ? columnIndex(ref) : cells.length;
      while (cells.length < target) cells.push("");
      cells[target] = value;
    }

    // `r` de <row> : une feuille peut sauter des lignes entières. On respecte la position pour
    // que « ligne 12 » dans un message d'erreur soit bien la ligne 12 du tableur de l'utilisateur.
    const rowRef = attr(`<row${rowAttrs}>`, "r");
    const target = rowRef ? Number(rowRef) - 1 : rows.length;
    while (rows.length < target) rows.push([]);
    rows[target] = cells;
  }
  return rows;
}

export async function readXlsx(buffer: ArrayBuffer): Promise<XlsxWorkbook> {
  const entries = readZipEntries(buffer);
  const byName = new Map(entries.map((e) => [e.name, e]));

  const workbookEntry = byName.get("xl/workbook.xml");
  if (!workbookEntry) throw new Error("Fichier .xlsx illisible : xl/workbook.xml absent.");
  const workbookXml = await readZipFile(buffer, workbookEntry);

  const relsEntry = byName.get("xl/_rels/workbook.xml.rels");
  const relTargets = new Map<string, string>();
  if (relsEntry) {
    const relsXml = await readZipFile(buffer, relsEntry);
    for (const tag of relsXml.match(/<Relationship\b[^>]*>/g) ?? []) {
      const id = attr(tag, "Id");
      const target = attr(tag, "Target");
      if (id && target) relTargets.set(id, target.replace(/^\/?xl\//, "").replace(/^\.\//, ""));
    }
  }

  const sharedEntry = byName.get("xl/sharedStrings.xml");
  const sharedStrings = sharedEntry ? parseSharedStrings(await readZipFile(buffer, sharedEntry)) : [];

  const sheets: XlsxSheet[] = [];
  const sheetTags = workbookXml.match(/<sheet\b[^>]*\/?>/g) ?? [];
  for (let i = 0; i < sheetTags.length; i++) {
    const tag = sheetTags[i]!;
    const name = attr(tag, "name") ?? `Feuille ${i + 1}`;
    const relId = attr(tag, "r:id") ?? attr(tag, "id");
    const target = (relId && relTargets.get(relId)) || `worksheets/sheet${i + 1}.xml`;
    const entry = byName.get(`xl/${target}`);
    if (!entry) continue;
    sheets.push({ name, rows: parseSheet(await readZipFile(buffer, entry), sharedStrings) });
  }

  if (sheets.length === 0) throw new Error("Fichier .xlsx illisible : aucune feuille de calcul trouvée.");
  return { sheets };
}
