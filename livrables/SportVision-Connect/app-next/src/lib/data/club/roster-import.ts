import type { SupabaseClient } from "@supabase/supabase-js";

// Import CSV d'effectif + anti-doublon (migration-clubplus-v56, 03/09/2026) — voir le docstring SQL
// de import_club_players pour les règles de correspondance (jamais de fusion sur prénom+nom seul,
// toujours combiné à une date de naissance ou un numéro de licence identique). Ce fichier ne fait
// que parser le CSV côté client et appeler les deux RPC ; toute la logique de matching/écriture
// vit en base (security definer, is_club_admin vérifié côté serveur).

export interface RosterImportRow {
  prenom: string;
  nom: string;
  dateNaissance: string; // ISO yyyy-mm-dd
  numeroLicence?: string;
  numeroMaillot?: string;
}

export type RosterPreviewCategory = "nouveau" | "existant" | "ambigu" | "a_verifier" | "erreur";
export type RosterImportStatus = "nouveau" | "existant" | "erreur";

export interface RosterPreviewResult {
  index: number;
  categorie: RosterPreviewCategory;
}

export interface RosterImportResult {
  index: number;
  statut: RosterImportStatus;
  playerId?: string;
  message?: string;
}

/** Parseur CSV minimal, sans dépendance externe — colonnes attendues (insensible à la casse,
 * séparateur `,` ou `;`) : prenom, nom, date_naissance (accepte JJ/MM/AAAA ou AAAA-MM-JJ),
 * numero_licence (facultatif), numero_maillot (facultatif). Gère les champs entre guillemets
 * contenant le séparateur — un effectif de club peut légitimement contenir des noms avec virgule
 * ("Martin, Jean-Paul" dans un export mal formé) même si ce n'est pas le cas attendu en pratique. */
export function parseRosterCsv(text: string): { rows: RosterImportRow[]; errors: string[] } {
  const errors: string[] = [];
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { rows: [], errors: ["Fichier vide."] };

  function splitLine(line: string): string[] {
    const sep = line.includes(";") && !line.includes(",") ? ";" : ",";
    const out: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        inQuotes = !inQuotes;
      } else if (c === sep && !inQuotes) {
        out.push(current.trim());
        current = "";
      } else {
        current += c;
      }
    }
    out.push(current.trim());
    return out;
  }

  const header = splitLine(lines[0] ?? "").map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const idx = {
    prenom: header.findIndex((h) => h === "prenom" || h === "firstname"),
    nom: header.findIndex((h) => h === "nom" || h === "lastname"),
    dateNaissance: header.findIndex((h) => h === "datenaissance" || h === "birthdate" || h === "dob"),
    licence: header.findIndex((h) => h === "numerolicence" || h === "licence" || h === "licensenumber"),
    maillot: header.findIndex((h) => h === "numeromaillot" || h === "maillot" || h === "jersey"),
  };
  if (idx.prenom === -1 || idx.nom === -1 || idx.dateNaissance === -1) {
    return { rows: [], errors: ["Colonnes obligatoires manquantes : prenom, nom, date_naissance."] };
  }

  function normalizeDate(raw: string): string | null {
    const v = raw.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m && m[1] && m[2] && m[3]) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return null;
  }

  const rows: RosterImportRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitLine(lines[i] ?? "");
    const prenom = cols[idx.prenom]?.trim() ?? "";
    const nom = cols[idx.nom]?.trim() ?? "";
    const rawDate = cols[idx.dateNaissance]?.trim() ?? "";
    const dateNaissance = normalizeDate(rawDate);
    if (!prenom || !nom || !dateNaissance) {
      errors.push(`Ligne ${i + 1} : prénom, nom et date de naissance (JJ/MM/AAAA) sont obligatoires.`);
      continue;
    }
    rows.push({
      prenom,
      nom,
      dateNaissance,
      numeroLicence: idx.licence >= 0 ? cols[idx.licence]?.trim() || undefined : undefined,
      numeroMaillot: idx.maillot >= 0 ? cols[idx.maillot]?.trim() || undefined : undefined,
    });
  }
  return { rows, errors };
}

function toRpcRows(rows: RosterImportRow[]) {
  return rows.map((r) => ({
    prenom: r.prenom,
    nom: r.nom,
    date_naissance: r.dateNaissance,
    numero_licence: r.numeroLicence ?? null,
    numero_maillot: r.numeroMaillot ?? null,
  }));
}

export async function previewRosterImport(supabase: SupabaseClient, clubId: string, rows: RosterImportRow[]): Promise<RosterPreviewResult[]> {
  const { data, error } = await supabase.rpc("preview_club_players_import", { p_club_id: clubId, p_rows: toRpcRows(rows) });
  if (error) throw error;
  return (data?.resultats ?? []) as RosterPreviewResult[];
}

export async function confirmRosterImport(
  supabase: SupabaseClient,
  clubId: string,
  teamId: string,
  saison: string,
  rows: RosterImportRow[],
): Promise<RosterImportResult[]> {
  const { data, error } = await supabase.rpc("import_club_players", { p_club_id: clubId, p_team_id: teamId, p_saison: saison, p_rows: toRpcRows(rows) });
  if (error) throw error;
  return ((data?.resultats ?? []) as { index: number; statut: RosterImportStatus; player_id?: string; message?: string }[]).map((r) => ({
    index: r.index,
    statut: r.statut,
    playerId: r.player_id,
    message: r.message,
  }));
}
