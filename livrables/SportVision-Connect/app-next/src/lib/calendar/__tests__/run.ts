// Harnais de tests du moteur de calendrier — s'exécute sans navigateur, sans bundler et sans
// dépendance de test :
//
//   node --test src/lib/calendar/__tests__/run.ts
//
// (Node ≥ 22 : le typage est retiré à la volée. C'est la raison pour laquelle tout le dossier
// src/lib/calendar utilise des imports relatifs avec extension `.ts` — un alias `@/` ne serait pas
// résolu ici.)
//
// Les 18 scénarios exigés par le chantier sont couverts, sauf ceux qui ne peuvent être prouvés
// qu'en base réelle — deux clubs voyant le même match, la levée de l'ancienne contrainte, le
// journal de synchronisation. Ceux-là sont testés en SQL sur la base de production en transaction
// annulée (voir le rapport de la passe).

import assert from "node:assert/strict";
import test from "node:test";

import { parseCsvSource } from "../providers/csv.ts";
import { parseIcsSource } from "../providers/ics.ts";
import { xlsxProvider, detectXlsxLayout } from "../providers/xlsx.ts";
import { pdfProvider } from "../providers/pdf.ts";
import { elementsVersLignes, type ElementTexte } from "../pdf-lignes.ts";
import { lireCalendrierDePoule, ressembleAUnCalendrierDePoule, estEquipeDuClub, clubsCandidats } from "../pdf-poule.ts";
import { detectProvider } from "../providers/index.ts";
import { buildImportPreview, type ClubTeamRef, type ExistingMatch, type TeamSourceMapping } from "../diff.ts";
import { fallbackIdentityKey, externalIdentityKey } from "../identity.ts";
import { parseFlexibleDate, parseFlexibleTime, coerceSportStatus, detectSportStatus } from "../normalize.ts";
import { readXlsx } from "../xlsx.ts";
import { detectTabularLayout } from "../autodetect.ts";
import { enrichirDepuisSections } from "../tabular-sections.ts";
import { isBlockedHost, validateCalendarUrl } from "../remote.ts";
import type { ProviderId, SourceEvent } from "../types.ts";

const TEAMS: ClubTeamRef[] = [
  { id: "team-u18", name: "U18 D2" },
  { id: "team-u16", name: "U16 D3" },
];

function preview(
  provider: ProviderId,
  events: SourceEvent[],
  existing: ExistingMatch[] = [],
  extra: { mappings?: TeamSourceMapping[]; teams?: ClubTeamRef[]; defaultTeamId?: string | null } = {},
) {
  return buildImportPreview({
    provider,
    events,
    issues: [],
    existing,
    teams: extra.teams ?? TEAMS,
    mappings: extra.mappings ?? [],
    // `in` et non `??` : `defaultTeamId: null` est un cas de test à part entière (aucune équipe
    // par défaut), que `??` transformerait en "team-u18".
    defaultTeamId: "defaultTeamId" in extra ? extra.defaultTeamId ?? null : "team-u18",
  });
}

function existingFrom(event: SourceEvent, provider: ProviderId, overrides: Partial<ExistingMatch> = {}): ExistingMatch {
  return {
    id: `db-${event.sourceLine}`,
    provider,
    externalEventId: event.externalEventId,
    teamId: "team-u18",
    teamName: "U18 D2",
    opponent: event.opponent,
    matchDate: event.matchDate,
    kickoffTime: event.kickoffTime,
    competition: event.competitionName,
    location: event.location,
    sportStatus: event.sportStatus ?? "scheduled",
    score: event.score,
    ...overrides,
  };
}

// ─────────────────────────── Normalisation ───────────────────────────

test("normalisation des dates et heures", () => {
  assert.equal(parseFlexibleDate("12/09/2026"), "2026-09-12");
  assert.equal(parseFlexibleDate("2026-09-12"), "2026-09-12");
  assert.equal(parseFlexibleDate("12.09.26"), "2026-09-12");
  assert.equal(parseFlexibleDate("31/02/2026"), null, "une date inexistante n'est jamais devinée");
  assert.equal(parseFlexibleDate("46277"), "2026-09-12", "numéro de série Excel");
  assert.equal(parseFlexibleTime("15:00"), "15:00");
  assert.equal(parseFlexibleTime("15h30"), "15:30");
  assert.equal(parseFlexibleTime("1500"), "15:00");
  assert.equal(parseFlexibleTime("0.625"), "15:00", "fraction de journée Excel");
  assert.equal(parseFlexibleTime("n'importe quoi"), null);
});

test("statut : cellule remplie mais illisible = unknown, absence = null", () => {
  assert.equal(coerceSportStatus("Reporté"), "postponed");
  assert.equal(coerceSportStatus("Annulé"), "cancelled");
  assert.equal(coerceSportStatus("blablabla"), "unknown");
  assert.equal(detectSportStatus("U18 D2 - AS Rivage"), null, "un titre neutre n'affirme aucun statut");
});

// ─────────────────────────── Cas 1 & 2 : CSV ───────────────────────────

const CSV_BASE = [
  "Date;Heure;Adversaire;Equipe;Competition;Lieu",
  "12/09/2026;15:00;AS Rivage;U18 D2;Championnat D2;Stade municipal",
  "19/09/2026;17:00;FC Melun;U16 D3;Championnat D3;Stade des Sources",
].join("\n");

test("cas 1 — import CSV initial : tout est nouveau", () => {
  const parsed = parseCsvSource(CSV_BASE);
  assert.equal(parsed.events.length, 2);
  assert.equal(parsed.issues.length, 0);
  assert.equal(parsed.events[0]!.opponent, "AS Rivage");
  assert.equal(parsed.events[0]!.kickoffTime, "15:00");
  assert.equal(parsed.events[0]!.competitionName, "Championnat D2");
  assert.equal(parsed.events[0]!.sourceTeamName, "U18 D2");

  const result = preview("CSV", parsed.events);
  assert.equal(result.counts.new, 2);
  assert.equal(result.counts.updated, 0);
  assert.equal(result.rows[0]!.teamId, "team-u18");
  assert.equal(result.rows[1]!.teamId, "team-u16", "l'équipe est rapprochée par son nom");
});

test("cas 2 — réimport du MÊME CSV : zéro nouveau, zéro modifié", () => {
  const parsed = parseCsvSource(CSV_BASE);
  const existing = [
    existingFrom(parsed.events[0]!, "CSV"),
    existingFrom(parsed.events[1]!, "CSV", { teamId: "team-u16", teamName: "U16 D3" }),
  ];
  const result = preview("CSV", parsed.events, existing);
  assert.equal(result.counts.new, 0);
  assert.equal(result.counts.updated, 0);
  assert.equal(result.counts.unchanged, 2);
  assert.equal(result.selectedCount, 0, "rien à écrire, la case est décochée par défaut");
});

// ─────────────────────────── Cas 3 & 4 : ICS ───────────────────────────

function ics(events: { uid: string; start: string; summary: string; status?: string; modified?: string }[]): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Test//FR"];
  for (const e of events) {
    lines.push("BEGIN:VEVENT", `UID:${e.uid}`, `DTSTART:${e.start}`, `SUMMARY:${e.summary}`, "LOCATION:Stade municipal");
    if (e.status) lines.push(`STATUS:${e.status}`);
    if (e.modified) lines.push(`LAST-MODIFIED:${e.modified}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

const ICS_BASE = ics([{ uid: "FFF-778812", start: "20260912T150000", summary: "U18 D2 - AS Rivage" }]);

test("cas 3 — import ICS initial : UID lu, adversaire côté droit", () => {
  const parsed = parseIcsSource(ICS_BASE);
  assert.equal(parsed.events.length, 1);
  const event = parsed.events[0]!;
  assert.equal(event.externalEventId, "FFF-778812");
  assert.equal(event.opponent, "AS Rivage");
  assert.equal(event.sourceTeamName, "U18 D2");
  assert.equal(event.matchDate, "2026-09-12");
  assert.equal(event.kickoffTime, "15:00");

  const result = preview("ICS", parsed.events);
  assert.equal(result.counts.new, 1);
  assert.equal(result.rows[0]!.teamId, "team-u18");
  assert.equal(result.rows[0]!.source.isHome, true, "le club est à gauche du titre : match à domicile");
});

test("cas 4 — réimport ICS identique : inchangé", () => {
  const parsed = parseIcsSource(ICS_BASE);
  const result = preview("ICS", parsed.events, [existingFrom(parsed.events[0]!, "ICS")]);
  assert.equal(result.counts.unchanged, 1);
  assert.equal(result.counts.new, 0);
});

test("ICS — DTSTART en UTC converti sur Europe/Paris", () => {
  const parsed = parseIcsSource(ics([{ uid: "A", start: "20260912T130000Z", summary: "U18 D2 - AS Rivage" }]));
  assert.equal(parsed.events[0]!.kickoffTime, "15:00", "13:00 UTC en septembre = 15:00 à Paris");
});

test("ICS — le club à droite du titre signifie un match à l'extérieur", () => {
  const parsed = parseIcsSource(ics([{ uid: "B", start: "20260912T150000", summary: "AS Rivage - U18 D2" }]));
  const result = preview("ICS", parsed.events);
  assert.equal(result.rows[0]!.source.opponent, "AS Rivage");
  assert.equal(result.rows[0]!.source.isHome, false);
  assert.equal(result.rows[0]!.teamId, "team-u18");
});

// ───────────────── Cas 5, 6, 9 : même identifiant, données qui bougent ─────────────────

test("cas 5 — même external_event_id, nouvelle date : MODIFIÉ, pas NOUVEAU", () => {
  const before = parseIcsSource(ICS_BASE).events[0]!;
  const after = parseIcsSource(ics([{ uid: "FFF-778812", start: "20260919T150000", summary: "U18 D2 - AS Rivage" }])).events[0]!;
  const result = preview("ICS", [after], [existingFrom(before, "ICS")]);
  assert.equal(result.counts.updated, 1);
  assert.equal(result.counts.new, 0);
  assert.deepEqual(
    result.rows[0]!.changes.map((c) => c.field),
    ["date"],
  );
  assert.equal(result.rows[0]!.existingId, "db-1");
});

test("cas 6 — même external_event_id, nouvelle heure : MODIFIÉ (12/09 15:00 → 12/09 17:00)", () => {
  const before = parseIcsSource(ICS_BASE).events[0]!;
  const after = parseIcsSource(ics([{ uid: "FFF-778812", start: "20260912T170000", summary: "U18 D2 - AS Rivage" }])).events[0]!;
  const result = preview("ICS", [after], [existingFrom(before, "ICS")]);
  assert.equal(result.counts.updated, 1);
  const change = result.rows[0]!.changes.find((c) => c.field === "time");
  assert.equal(change?.before, "15:00");
  assert.equal(change?.after, "17:00");
});

test("cas 7 — report : statut postponed appliqué sur le match existant", () => {
  const before = parseIcsSource(ICS_BASE).events[0]!;
  const after = parseIcsSource(ics([{ uid: "FFF-778812", start: "20260912T150000", summary: "U18 D2 - AS Rivage", status: "TENTATIVE" }])).events[0]!;
  assert.equal(after.sportStatus, "unknown", "TENTATIVE n'est pas un report");

  const postponed = parseIcsSource(
    ics([{ uid: "FFF-778812", start: "20260912T150000", summary: "U18 D2 - AS Rivage - REPORTÉ" }]),
  ).events[0]!;
  assert.equal(postponed.sportStatus, "postponed");
  const result = preview("ICS", [postponed], [existingFrom(before, "ICS")]);
  assert.equal(result.counts.updated, 1);
  assert.ok(result.rows[0]!.changes.some((c) => c.field === "status"));
});

test("cas 8 — annulation : STATUS:CANCELLED", () => {
  const before = parseIcsSource(ICS_BASE).events[0]!;
  const cancelled = parseIcsSource(
    ics([{ uid: "FFF-778812", start: "20260912T150000", summary: "U18 D2 - AS Rivage", status: "CANCELLED" }]),
  ).events[0]!;
  assert.equal(cancelled.sportStatus, "cancelled");
  const result = preview("ICS", [cancelled], [existingFrom(before, "ICS")]);
  assert.equal(result.counts.updated, 1);
  const change = result.rows[0]!.changes.find((c) => c.field === "status");
  assert.equal(change?.after, "Annulé");
});

test("cas 9 — replanification : le match reporté reprend une date et redevient programmé", () => {
  const before = parseIcsSource(ICS_BASE).events[0]!;
  const existing = existingFrom(before, "ICS", { sportStatus: "postponed" });
  const rescheduled = parseIcsSource(
    ics([{ uid: "FFF-778812", start: "20260926T150000", summary: "U18 D2 - AS Rivage", status: "CONFIRMED" }]),
  ).events[0]!;
  const result = preview("ICS", [rescheduled], [existing]);
  assert.equal(result.counts.updated, 1);
  assert.deepEqual(
    result.rows[0]!.changes.map((c) => c.field).sort(),
    ["date", "status"],
  );
});

test("un calendrier muet ne repasse pas un match joué en programmé", () => {
  const parsed = parseCsvSource(CSV_BASE);
  const existing = [
    existingFrom(parsed.events[0]!, "CSV", { sportStatus: "completed", score: "3-1" }),
    existingFrom(parsed.events[1]!, "CSV", { teamId: "team-u16", teamName: "U16 D3" }),
  ];
  const result = preview("CSV", parsed.events, existing);
  assert.equal(result.counts.updated, 0, "le CSV n'a pas de colonne statut : il n'affirme rien");
  assert.equal(result.counts.unchanged, 2);
});

// ─────────────────────────── Cas 11 : casse ───────────────────────────

test("cas 11 — casse différente sur l'adversaire : inchangé, pas de doublon", () => {
  const parsed = parseCsvSource(
    ["Date;Heure;Adversaire;Equipe", "12/09/2026;15:00;fc melun;U18 D2"].join("\n"),
  );
  const existing: ExistingMatch[] = [
    {
      id: "db-1",
      provider: "CSV",
      externalEventId: null,
      teamId: "team-u18",
      teamName: "U18 D2",
      opponent: "FC Melun",
      matchDate: "2026-09-12",
      kickoffTime: "15:00",
      competition: null,
      location: null,
      sportStatus: "scheduled",
      score: null,
    },
  ];
  const result = preview("CSV", parsed.events, existing);
  assert.equal(result.counts.unchanged, 1);
  assert.equal(result.counts.new, 0);
  assert.equal(
    fallbackIdentityKey({ teamId: "team-u18", opponent: "  FC   Melun ", matchDate: "2026-09-12", kickoffTime: "15:00" }),
    fallbackIdentityKey({ teamId: "team-u18", opponent: "fc melun", matchDate: "2026-09-12", kickoffTime: "15:00" }),
  );
});

// ─────────────────── Cas 12 & 13 : plusieurs matchs le même jour ───────────────────

const CSV_TOURNOI = [
  "Date;Heure;Adversaire;Equipe",
  "12/09/2026;09:00;AS Rivage;U18 D2",
  "12/09/2026;11:00;AS Rivage;U18 D2",
  "12/09/2026;14:00;FC Melun;U18 D2",
].join("\n");

test("cas 12 — deux matchs le même jour contre le même adversaire à des heures différentes", () => {
  const parsed = parseCsvSource(CSV_TOURNOI);
  const result = preview("CSV", parsed.events);
  assert.equal(result.counts.new, 3, "l'ancienne contrainte n'en autorisait qu'un seul par jour et adversaire");
  assert.equal(result.counts.unchanged, 0);
  assert.notEqual(
    fallbackIdentityKey({ teamId: "team-u18", opponent: "AS Rivage", matchDate: "2026-09-12", kickoffTime: "09:00" }),
    fallbackIdentityKey({ teamId: "team-u18", opponent: "AS Rivage", matchDate: "2026-09-12", kickoffTime: "11:00" }),
  );
});

test("cas 13 — tournoi réimporté : les trois matchs restent inchangés, aucun doublon", () => {
  const parsed = parseCsvSource(CSV_TOURNOI);
  const existing = parsed.events.map((e, i) => existingFrom(e, "CSV", { id: `db-${i}` }));
  const result = preview("CSV", parsed.events, existing);
  assert.equal(result.counts.unchanged, 3);
  assert.equal(result.counts.new, 0);
});

test("deux lignes strictement identiques dans le même fichier : la seconde est un doublon interne", () => {
  const parsed = parseCsvSource(
    ["Date;Heure;Adversaire;Equipe", "12/09/2026;09:00;AS Rivage;U18 D2", "12/09/2026;09:00;AS Rivage;U18 D2"].join("\n"),
  );
  const result = preview("CSV", parsed.events);
  assert.equal(result.counts.new, 1);
  assert.equal(result.counts.unchanged, 1);
  assert.match(result.rows[1]!.reason ?? "", /Doublon dans le fichier/);
});

test("un CSV sans heure réimporté après saisie de l'horaire ne crée pas de doublon", () => {
  const parsed = parseCsvSource(["Date;Adversaire;Equipe", "12/09/2026;AS Rivage;U18 D2"].join("\n"));
  const existing: ExistingMatch[] = [
    {
      id: "db-1",
      provider: "CSV",
      externalEventId: null,
      teamId: "team-u18",
      teamName: "U18 D2",
      opponent: "AS Rivage",
      matchDate: "2026-09-12",
      kickoffTime: "15:00",
      competition: null,
      location: null,
      sportStatus: "scheduled",
      score: null,
    },
  ];
  const result = preview("CSV", parsed.events, existing);
  assert.equal(result.counts.unchanged, 1, "repli tolérant à l'heure : un seul candidat, donc le même match");
  assert.equal(result.counts.new, 0);
});

// ─────────────────────────── Cas 14 & 15 : mapping ───────────────────────────

test("cas 14 — mapping confirmé : l'équipe est reconnue sans comparer le moindre texte", () => {
  const parsed = parseCsvSource(["Date;Heure;Adversaire;Equipe", "12/09/2026;15:00;AS Rivage;SENIORS A POULE B"].join("\n"));
  const mappings: TeamSourceMapping[] = [
    {
      id: "map-1",
      teamId: "team-u16",
      provider: "CSV",
      externalTeamId: "name:seniors a poule b",
      externalTeamName: "SENIORS A POULE B",
      externalCompetitionId: null,
      status: "confirmed",
    },
  ];
  const result = preview("CSV", parsed.events, [], { mappings, defaultTeamId: null });
  assert.equal(result.rows[0]!.teamId, "team-u16");
  assert.equal(result.rows[0]!.fromConfirmedMapping, true);
  assert.deepEqual(result.rows[0]!.teamCandidates, [], "aucun rapprochement de nom n'a été tenté");
});

test("cas 15 — mapping ambigu : décision humaine demandée, rien n'est écrit", () => {
  const teams: ClubTeamRef[] = [
    { id: "a", name: "Seniors A" },
    { id: "b", name: "Seniors B" },
  ];
  const parsed = parseCsvSource(["Date;Heure;Adversaire;Equipe", "12/09/2026;15:00;AS Rivage;Seniors"].join("\n"));
  const result = preview("CSV", parsed.events, [], { teams, defaultTeamId: null });
  assert.equal(result.counts.ambiguous, 1);
  assert.equal(result.rows[0]!.include, false);
  assert.match(result.rows[0]!.reason ?? "", /ressemble autant/);
});

test("aucune équipe reconnaissable et aucune équipe par défaut : à mapper", () => {
  const parsed = parseCsvSource(["Date;Heure;Adversaire", "12/09/2026;15:00;AS Rivage"].join("\n"));
  const result = preview("CSV", parsed.events, [], { defaultTeamId: null });
  assert.equal(result.counts.needs_mapping, 1);
  assert.equal(result.rows[0]!.include, false);
});

// ─────────────────────────── Robustesse ───────────────────────────

test("un fichier partiellement invalide reste importable, ligne par ligne", () => {
  const parsed = parseCsvSource(
    [
      "Date;Heure;Adversaire;Equipe",
      "12/09/2026;15:00;AS Rivage;U18 D2",
      "pas une date;15:00;FC Melun;U18 D2",
      "19/09/2026;;;U18 D2",
      "26/09/2026;pas une heure;US Ville;U18 D2",
    ].join("\n"),
  );
  assert.equal(parsed.events.length, 2, "les deux lignes lisibles sont conservées");
  assert.equal(parsed.issues.length, 3);
  assert.equal(parsed.issues[0]!.line, 3, "le numéro de ligne est celui du tableur");
  assert.match(parsed.issues[0]!.reason, /Date illisible/);
  assert.match(parsed.issues[2]!.reason, /Heure illisible/);

  const result = buildImportPreview({
    provider: "CSV",
    events: parsed.events,
    issues: parsed.issues,
    existing: [],
    teams: TEAMS,
    mappings: [],
    defaultTeamId: null,
  });
  assert.equal(result.counts.error, 3);
  assert.equal(result.counts.new, 2);
});

test("colonne obligatoire absente : message explicite, pas un silence", () => {
  const parsed = parseCsvSource(["Journee;Heure;Equipe", "1;15:00;U18 D2"].join("\n"));
  assert.equal(parsed.events.length, 0);
  assert.match(parsed.issues[0]!.reason, /adversaire/);
  assert.match(parsed.issues[0]!.reason, /En-têtes lus/);
});

test('"date de modification" ne vole pas la colonne "date"', () => {
  const parsed = parseCsvSource(
    ["Date de modification;Date;Adversaire;Equipe", "01/09/2026;12/09/2026;AS Rivage;U18 D2"].join("\n"),
  );
  assert.equal(parsed.events[0]!.matchDate, "2026-09-12");
  assert.ok(parsed.events[0]!.sourceUpdatedAt?.startsWith("2026-09-01"));
});

test('"équipe adverse" est l\'adversaire, pas l\'équipe du club', () => {
  const parsed = parseCsvSource(["Date;Equipe adverse;Equipe", "12/09/2026;AS Rivage;U18 D2"].join("\n"));
  assert.equal(parsed.events[0]!.opponent, "AS Rivage");
  assert.equal(parsed.events[0]!.sourceTeamName, "U18 D2");
});

test("identité : la clé externe inclut le provider, la clé de repli traite les NULL comme égaux", () => {
  assert.equal(externalIdentityKey({ provider: "ICS", externalEventId: null }), null);
  assert.notEqual(
    externalIdentityKey({ provider: "ICS", externalEventId: "1" }),
    externalIdentityKey({ provider: "CSV", externalEventId: "1" }),
  );
  assert.equal(
    fallbackIdentityKey({ teamId: null, opponent: "AS Rivage", matchDate: "2026-09-12", kickoffTime: null }),
    fallbackIdentityKey({ teamId: null, opponent: "as rivage", matchDate: "2026-09-12", kickoffTime: null }),
  );
});

test("détection de provider", () => {
  assert.equal(detectProvider("calendrier.csv", "")?.id, "CSV");
  assert.equal(detectProvider("calendrier.ics", "BEGIN:VCALENDAR")?.id, "ICS");
  assert.equal(detectProvider("export.xlsx", "")?.id, "FOOTCLUBS_XLSX");
  assert.equal(detectProvider("calendrier.txt", "BEGIN:VCALENDAR")?.id, "ICS", "un .ics renommé reste reconnu");
  assert.equal(detectProvider("photo.png", ""), null);
});

// ─────────────────────────── XLSX ───────────────────────────

function crcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
}
const CRC_TABLE = crcTable();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Écrit un ZIP minimal (entrées STORED ou DEFLATE) — sert uniquement à fabriquer un .xlsx de test
 * sans dépendance. */
async function makeZip(files: { name: string; content: string }[], compress: boolean): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const raw = encoder.encode(file.content);
    const data = compress
      ? new Uint8Array(
          await new Response(new Blob([raw as unknown as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer(),
        )
      : raw;

    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, compress ? 8 : 0, true);
    lv.setUint32(14, crc32(raw), true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    chunks.push(local);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, compress ? 8 : 0, true);
    cv.setUint32(16, crc32(raw), true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    central.push(cd);

    offset += local.length;
  }

  const centralSize = central.reduce((sum, c) => sum + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const total = offset + centralSize + 22;
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of [...chunks, ...central, eocd]) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  return out.buffer;
}

const SHEET_XML = `<?xml version="1.0"?><worksheet><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
<row r="2"><c r="A2"><v>46277</v></c><c r="B2" t="s"><v>3</v></c><c r="C2"><v>0.625</v></c></row>
<row r="3"><c r="A3"><v>46284</v></c><c r="B3" t="inlineStr"><is><t>FC </t><t>Melun</t></is></c></row>
</sheetData></worksheet>`;

const XLSX_FILES = [
  { name: "xl/workbook.xml", content: `<?xml version="1.0"?><workbook><sheets><sheet name="Rencontres" sheetId="1" r:id="rId1"/></sheets></workbook>` },
  {
    name: "xl/_rels/workbook.xml.rels",
    content: `<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="ws" Target="worksheets/sheet1.xml"/></Relationships>`,
  },
  {
    name: "xl/sharedStrings.xml",
    content: `<?xml version="1.0"?><sst><si><t>Date de rencontre</t></si><si><t>Club recevant</t></si><si><t>Horaire</t></si><si><t>AS Rivage &amp; Co</t></si></sst>`,
  },
  { name: "xl/worksheets/sheet1.xml", content: SHEET_XML },
];

test("lecture .xlsx — entrées non compressées", async () => {
  const buffer = await makeZip(XLSX_FILES, false);
  const workbook = await readXlsx(buffer);
  assert.equal(workbook.sheets.length, 1);
  assert.equal(workbook.sheets[0]!.name, "Rencontres");
  assert.deepEqual(workbook.sheets[0]!.rows[0], ["Date de rencontre", "Club recevant", "Horaire"]);
  assert.deepEqual(workbook.sheets[0]!.rows[1], ["46277", "AS Rivage & Co", "0.625"]);
  assert.deepEqual(workbook.sheets[0]!.rows[2], ["46284", "FC Melun"], "les runs de texte enrichi sont recollés");
});

test("lecture .xlsx — entrées compressées (deflate)", async () => {
  const buffer = await makeZip(XLSX_FILES, true);
  const workbook = await readXlsx(buffer);
  assert.deepEqual(workbook.sheets[0]!.rows[0], ["Date de rencontre", "Club recevant", "Horaire"]);
});

test("provider XLSX — colonnes reconnues sans mapping manuel, sur des intitulés jamais vus", async () => {
  const buffer = await makeZip(XLSX_FILES, false);

  const inspection = await xlsxProvider.inspect!({ fileName: "export.xlsx", bytes: buffer });
  assert.equal(inspection.sheets[0]!.name, "Rencontres");
  assert.deepEqual(inspection.sheets[0]!.rows[0], ["Date de rencontre", "Club recevant", "Horaire"]);

  // Aucun `options` : la structure est deduite du CONTENU des cellules. "Club recevant" et
  // "Horaire" ne figurent dans aucune liste d'intitules, c'est bien la donnee qui parle.
  const auto = await xlsxProvider.parse({ fileName: "export.xlsx", bytes: buffer });
  assert.equal(auto.events.length, 2);
  assert.equal(auto.events[0]!.matchDate, "2026-09-12");
  assert.equal(auto.events[0]!.kickoffTime, "15:00");
  assert.equal(auto.events[0]!.opponent, "AS Rivage & Co");
  assert.equal(auto.events[0]!.sourceLine, 2, "numero de ligne Excel");

  // Ce que l'ecran affiche a l'utilisateur pour qu'il verifie la deduction.
  const { sheetIndex, layout } = detectXlsxLayout(inspection);
  assert.equal(sheetIndex, 0);
  assert.equal(layout.headerRow, 0);
  assert.deepEqual(layout.missingRequired, []);
  assert.equal(layout.columns.date, 0);
  assert.equal(layout.columns.opponent, 1);
  assert.equal(layout.columns.time, 2);

  // Le mapping manuel reste disponible et prime sur la detection.
  const forced = await xlsxProvider.parse({
    fileName: "export.xlsx",
    bytes: buffer,
    options: { sheetIndex: 0, headerRow: 0, firstDataRow: 1, columns: { date: 0, opponent: 2, time: 1 } },
  });
  assert.equal(forced.events[0]!.opponent, "0.625", "le mapping impose a la main prime sur la detection");
  // Deux signalements attendus : la colonne designee comme heure contient du texte, et la
  // derniere ligne n a rien dans la colonne designee comme adversaire.
  assert.equal(forced.issues.length, 2);
});

// ─────────────────────────── Detection par le contenu ───────────────────────────

test("detection : lignes de titre ignorees, en-tete trouvee toute seule", () => {
  const rows = [
    ["Calendrier des rencontres"],
    ["Villneuve 340 SC", "edite le 07/09/2026"],
    [],
    ["Journee", "Rencontre", "Le", "A"],
    ["1", "AS Rivage", "12/09/2026", "15:00"],
    ["2", "FC Melun", "19/09/2026", "17:00"],
    ["3", "US Ville", "26/09/2026", "15:00"],
  ];
  const layout = detectTabularLayout(rows, { now: new Date("2026-09-07T00:00:00Z") });
  assert.equal(layout.headerRow, 3);
  assert.equal(layout.firstDataRow, 4);
  assert.equal(layout.columns.date, 2, '"Le" est la colonne date parce qu elle contient des dates');
  assert.equal(layout.columns.time, 3, '"A" est l heure parce qu elle contient des heures');
  assert.equal(layout.columns.opponent, 1);
  assert.deepEqual(layout.missingRequired, []);
});

test("detection : intitules anglais inconnus, reconnus par la donnee", () => {
  const rows = [
    ["Matchday", "Versus", "When", "KO"],
    ["1", "AS Rivage", "2026-09-12", "15:00"],
    ["2", "FC Melun", "2026-09-19", "17:00"],
    ["3", "US Ville", "2026-09-26", "15:00"],
  ];
  const layout = detectTabularLayout(rows, { now: new Date("2026-09-07T00:00:00Z") });
  assert.deepEqual(layout.missingRequired, []);
  assert.equal(layout.columns.date, 2);
  assert.equal(layout.columns.opponent, 1);
});

test("detection : une colonne d identifiants n est pas prise pour la colonne date", () => {
  // 46277 est un numero de serie Excel parfaitement valide : sans la fenetre temporelle, une
  // colonne d identifiants a 5 chiffres serait detectee comme la colonne date.
  const rows = [
    ["Id", "Adversaire", "Date"],
    ["900001", "AS Rivage", "12/09/2026"],
    ["900002", "FC Melun", "19/09/2026"],
    ["900003", "US Ville", "26/09/2026"],
  ];
  const layout = detectTabularLayout(rows, { now: new Date("2026-09-07T00:00:00Z") });
  assert.equal(layout.columns.date, 2);
  assert.equal(layout.columns.externalEventId, 0);
});

test("detection : la colonne qui contient MES equipes est l equipe, l autre est l adversaire", () => {
  const rows = [
    ["A", "B", "C"],
    ["U18 D2", "AS Rivage", "12/09/2026"],
    ["U16 D3", "FC Melun", "19/09/2026"],
    ["U18 D2", "US Ville", "26/09/2026"],
  ];
  const layout = detectTabularLayout(rows, { teams: TEAMS, now: new Date("2026-09-07T00:00:00Z") });
  assert.equal(layout.columns.team, 0);
  assert.equal(layout.columns.opponent, 1);
  assert.equal(layout.columns.date, 2);
});

test("detection : statut, domicile/exterieur et competition reconnus par leur vocabulaire", () => {
  const rows = [
    ["X1", "X2", "X3", "X4", "X5"],
    ["12/09/2026", "AS Rivage", "Reporte", "Dom", "Championnat D2"],
    ["19/09/2026", "FC Melun", "Prevu", "Ext", "Championnat D2"],
    ["26/09/2026", "US Ville", "Annule", "Dom", "Championnat D2"],
    ["03/10/2026", "AS Nord", "Prevu", "Ext", "Championnat D2"],
  ];
  const layout = detectTabularLayout(rows, { now: new Date("2026-09-07T00:00:00Z") });
  assert.equal(layout.columns.status, 2);
  assert.equal(layout.columns.home, 3);
  assert.equal(layout.columns.competition, 4);
});

test("CSV : intitules inconnus, la lecture bascule sur le contenu au lieu d echouer", () => {
  const parsed = parseCsvSource(
    ["Matchday;Versus;When;KO", "1;AS Rivage;12/09/2026;15:00", "2;FC Melun;19/09/2026;17:00", "3;US Ville;26/09/2026;15:00"].join(
      "\n",
    ),
  );
  assert.equal(parsed.events.length, 3, "avant ce correctif, ce fichier renvoyait zero ligne");
  assert.equal(parsed.events[0]!.opponent, "AS Rivage");
  assert.equal(parsed.events[0]!.matchDate, "2026-09-12");
  assert.equal(parsed.events[0]!.kickoffTime, "15:00");
});

test("CSV : ni le nom ni le contenu ne donnent l adversaire -> message explicite", () => {
  const parsed = parseCsvSource(["Journee;Points", "1;3", "2;0"].join("\n"));
  assert.equal(parsed.events.length, 0);
  assert.match(parsed.issues[0]!.reason, /ni par son nom ni par son contenu/);
});

// ─────────────────────── Recuperation d une source distante ───────────────────────

test("URL distante : webcal normalise, schemas et hotes internes refuses", () => {
  const ok = validateCalendarUrl("webcal://calendrier.exemple.fr/club.ics");
  assert.ok("url" in ok);
  assert.equal(ok.url.protocol, "https:", "webcal n est pas un protocole reseau, c est du https");

  for (const bad of [
    "file:///etc/passwd",
    "gopher://exemple.fr",
    "http://localhost:3000/interne",
    "http://127.0.0.1/interne",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.5/interne",
    "http://192.168.1.10/interne",
    "http://172.20.0.3/interne",
    "http://base.internal/dump",
    "pas une url",
  ]) {
    const result = validateCalendarUrl(bad);
    assert.ok("error" in result, `${bad} aurait du etre refusee`);
  }

  assert.ok("url" in validateCalendarUrl("https://calendrier.exemple.fr/club.ics"));
});

test("URL distante : plages privees et publiques correctement separees", () => {
  // Faire recuperer une URL arbitraire par notre serveur, c est lui preter son identite reseau.
  // 169.254.169.254 est l adresse des metadonnees d instance chez tous les hebergeurs.
  for (const host of ["127.0.0.1", "10.1.2.3", "192.168.0.1", "172.31.255.255", "169.254.169.254", "100.64.0.1", "::1"]) {
    assert.equal(isBlockedHost(host), true, `${host} doit etre bloque`);
  }
  for (const host of ["8.8.8.8", "172.32.0.1", "192.169.0.1", "calendrier.fff.fr", "100.128.0.1"]) {
    assert.equal(isBlockedHost(host), false, `${host} ne doit pas etre bloque`);
  }
});

// ─────────────────────────── Compatibilité ───────────────────────────

test("cas 18 — les parseurs historiques restent exportés et fonctionnels", async () => {
  const legacy = await import("../../calendar-import.ts");
  const rows = legacy.parseIcsEvents(ICS_BASE);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.date, "2026-09-12");
  assert.equal(rows[0]!.suggestedOpponent, "AS Rivage");
  assert.equal(legacy.parseMatchesCsv(CSV_BASE).length, 2);
});

// ─────────────────────────────────────────────────────────────────────────────
// PDF — reconstruire un tableau à partir de fragments positionnés (08/09/2026)
//
// Le PDF est le format le plus diffusé par les fédérations, et c'était le seul qu'on refusait.
// Le risque propre à ce format n'est pas de rater une ligne — ça se voit — mais de décaler une
// valeur d'une colonne, ce qui ne se voit pas. Ces tests portent d'abord là-dessus.
// ─────────────────────────────────────────────────────────────────────────────

/** Fabrique des fragments comme pdf.js les rend : origine en bas, une ligne par rangée. */
function fragmentsPdf(
  rangees: { y: number; cellules: { x: number; texte: string }[] }[],
  hauteur = 10,
): ElementTexte[] {
  return rangees.flatMap((r) =>
    r.cellules.map((c) => ({
      texte: c.texte,
      x: c.x,
      y: r.y,
      largeur: c.texte.length * hauteur * 0.5,
      hauteur,
      page: 1,
    })),
  );
}

const COLONNES_X = { date: 50, heure: 130, equipe: 190, adversaire: 330 };

function calendrierPdf(): ElementTexte[] {
  return fragmentsPdf([
    { y: 700, cellules: [
      { x: COLONNES_X.date, texte: "Date" }, { x: COLONNES_X.heure, texte: "Heure" },
      { x: COLONNES_X.equipe, texte: "Equipe" }, { x: COLONNES_X.adversaire, texte: "Adversaire" }] },
    { y: 680, cellules: [
      { x: COLONNES_X.date, texte: "14/09/2026" }, { x: COLONNES_X.heure, texte: "15:00" },
      { x: COLONNES_X.equipe, texte: "U18 D2" }, { x: COLONNES_X.adversaire, texte: "FC Sens" }] },
    { y: 660, cellules: [
      { x: COLONNES_X.date, texte: "21/09/2026" }, { x: COLONNES_X.heure, texte: "10:30" },
      { x: COLONNES_X.equipe, texte: "U16 D3" }, { x: COLONNES_X.adversaire, texte: "AS Montereau" }] },
    { y: 640, cellules: [
      { x: COLONNES_X.date, texte: "28/09/2026" }, { x: COLONNES_X.heure, texte: "14:00" },
      { x: COLONNES_X.equipe, texte: "U18 D2" }, { x: COLONNES_X.adversaire, texte: "US Bray" }] },
  ]);
}

test("PDF : les fragments positionnés redeviennent des lignes et des colonnes", () => {
  const lignes = elementsVersLignes(calendrierPdf());
  assert.equal(lignes.length, 4);
  assert.deepEqual(lignes[0], ["Date", "Heure", "Equipe", "Adversaire"]);
  assert.deepEqual(lignes[1], ["14/09/2026", "15:00", "U18 D2", "FC Sens"]);
  assert.deepEqual(lignes[3], ["28/09/2026", "14:00", "U18 D2", "US Bray"]);
});

test("PDF : une cellule vide ne décale pas les suivantes", () => {
  // Le cas qui casse un découpage naïf : sans heure, « U18 D2 » remonterait dans la colonne heure
  // et l'adversaire dans la colonne équipe. Tout le calendrier serait faux, sans que ça se voie.
  const avecTrou = fragmentsPdf([
    { y: 700, cellules: [
      { x: COLONNES_X.date, texte: "Date" }, { x: COLONNES_X.heure, texte: "Heure" },
      { x: COLONNES_X.equipe, texte: "Equipe" }, { x: COLONNES_X.adversaire, texte: "Adversaire" }] },
    { y: 680, cellules: [
      { x: COLONNES_X.date, texte: "14/09/2026" }, { x: COLONNES_X.heure, texte: "15:00" },
      { x: COLONNES_X.equipe, texte: "U18 D2" }, { x: COLONNES_X.adversaire, texte: "FC Sens" }] },
    { y: 660, cellules: [
      { x: COLONNES_X.date, texte: "21/09/2026" },
      { x: COLONNES_X.equipe, texte: "U16 D3" }, { x: COLONNES_X.adversaire, texte: "AS Montereau" }] },
    { y: 640, cellules: [
      { x: COLONNES_X.date, texte: "28/09/2026" }, { x: COLONNES_X.heure, texte: "14:00" },
      { x: COLONNES_X.equipe, texte: "U18 D2" }, { x: COLONNES_X.adversaire, texte: "US Bray" }] },
  ]);
  const lignes = elementsVersLignes(avecTrou);
  assert.deepEqual(lignes[2], ["21/09/2026", "", "U16 D3", "AS Montereau"]);
});

test("PDF : une date coupée en plusieurs fragments est recollée", () => {
  // pdf.js rend souvent « 14/ », « 09/ », « 2026 » séparément selon le crénage.
  const morcele = fragmentsPdf([
    { y: 700, cellules: [
      { x: COLONNES_X.date, texte: "Date" }, { x: COLONNES_X.heure, texte: "Heure" },
      { x: COLONNES_X.equipe, texte: "Equipe" }, { x: COLONNES_X.adversaire, texte: "Adversaire" }] },
    { y: 680, cellules: [
      { x: 50, texte: "14/" }, { x: 65, texte: "09/" }, { x: 80, texte: "2026" },
      { x: COLONNES_X.heure, texte: "15:00" },
      { x: COLONNES_X.equipe, texte: "U18 D2" }, { x: COLONNES_X.adversaire, texte: "FC Sens" }] },
    { y: 660, cellules: [
      { x: COLONNES_X.date, texte: "21/09/2026" }, { x: COLONNES_X.heure, texte: "10:30" },
      { x: COLONNES_X.equipe, texte: "U16 D3" }, { x: COLONNES_X.adversaire, texte: "AS Montereau" }] },
  ]);
  assert.equal(elementsVersLignes(morcele)[1]![0], "14/09/2026");
});

test("PDF : un calendrier en texte libre, sans colonnes, reste découpé", () => {
  const libre = fragmentsPdf([
    { y: 700, cellules: [{ x: 40, texte: "Sam. 14/09/2026" }, { x: 200, texte: "15:00" }, { x: 260, texte: "U18 D2" }, { x: 400, texte: "FC Sens" }] },
    { y: 680, cellules: [{ x: 40, texte: "Dim. 21/09/2026" }, { x: 210, texte: "10:30" }, { x: 275, texte: "U16 D3" }, { x: 420, texte: "AS Montereau" }] },
  ]);
  const lignes = elementsVersLignes(libre);
  assert.equal(lignes.length, 2);
  assert.ok(lignes[0]!.includes("FC Sens"));
  assert.ok(lignes[0]!.some((c) => c.includes("14/09/2026")));
});

test("PDF : le moteur de détection reconnaît les colonnes du PDF reconstruit", async () => {
  const resultat = await pdfProvider.parse({
    fileName: "calendrier.pdf",
    options: { elements: calendrierPdf() },
    teams: TEAMS,
  });
  assert.equal(resultat.issues.length, 0);
  assert.equal(resultat.events.length, 3);
  assert.equal(resultat.events[0]!.matchDate, "2026-09-14");
  assert.equal(resultat.events[0]!.kickoffTime, "15:00");
  assert.equal(resultat.events[0]!.opponent, "FC Sens");
  assert.equal(resultat.events[0]!.sourceTeamName, "U18 D2");
});

test("PDF : chaque match part vers l'équipe que le PDF nomme, pas vers une seule", () => {
  // C'est la demande de Fouka : « j'ai le calendrier de toutes les catégories ».
  const apercu = preview("PDF", [
    { matchDate: "2026-09-14", kickoffTime: "15:00", sourceTeamName: "U18 D2", opponent: "FC Sens", isHome: null, competitionName: null, location: null, sportStatus: "scheduled", externalEventId: null, externalCompetitionId: null, externalTeamId: null, sourceUpdatedAt: null, sourceLine: 1, rawLabel: "", score: null },
    { matchDate: "2026-09-21", kickoffTime: "10:30", sourceTeamName: "U16 D3", opponent: "AS Montereau", isHome: null, competitionName: null, location: null, sportStatus: "scheduled", externalEventId: null, externalCompetitionId: null, externalTeamId: null, sourceUpdatedAt: null, sourceLine: 1, rawLabel: "", score: null },
  ], [], { teams: TEAMS });
  const parEquipe = apercu.rows.map((r) => r.teamId);
  assert.ok(parEquipe.includes("team-u18"));
  assert.ok(parEquipe.includes("team-u16"));
});

test("PDF : un document sans rien de reconnaissable le dit, il n'invente pas", async () => {
  const resultat = await pdfProvider.parse({
    fileName: "reglement.pdf",
    options: { lignes: [["Règlement intérieur"], ["Article 1"], ["Article 2"]] },
    teams: TEAMS,
  });
  assert.equal(resultat.events.length, 0);
  assert.equal(resultat.issues.length, 1);
  assert.ok(/désignez les colonnes|\.csv/i.test(resultat.issues[0]!.reason));
});

test("PDF : le fichier est reconnu par son nom comme par son entête", () => {
  assert.equal(detectProvider("calendrier.pdf", "")?.id, "PDF");
  assert.equal(detectProvider("export", "%PDF-1.7")?.id, "PDF");
});

// ─────────────────────────────────────────────────────────────────────────────
// Calendrier de POULE — le vrai format de district (08/09/2026)
//
// Le premier vrai calendrier fourni par Fouka a fait échouer la détection par contenu :
// « Impossible de reconnaître date ». Normal, la date n'y est pas dans une colonne mais dans un
// en-tête de journée, et chaque ligne porte l'aller ET le retour. Ces lignes sont reprises
// telles quelles du fichier « calendrier 34SC.pdf ».
// ─────────────────────────────────────────────────────────────────────────────

const POULE_REELLE: string[][] = [
  ["ASSOCIATION SPORTIVE VILLENEUVE LA GUYARD - 565301", "", "", "", "", "", "", "Calendriers*", ""],
  ["Seniors D3 / Unique", "", "", "", "", "", "", "", ""],
  ["Poule A", "", "", "", "", "Matin P1", "", "", ""],
  ["Journée", "1", "- Aller", "06/09/2026", "", "Journée 26 - Retour", "06/06/2027", "", ""],
  ["52430.", "0 - 1", "12H30", "79143682", "U.S. Dionysienne St 2", "- Champigny 2", "79143815", "15H", "... - ..."],
  ["52434.", "... - ...", "15H", "79143686", "As Vlg 1", "- J. Senonaise 1", "79143819", "15H", "... - ..."],
  ["", "", "11/11/26", "", "", "", "", "", ""],
  ["Journée", "2", "- Aller", "20/09/2026", "", "Journée 14 - Retour", "14/02/2027", "", ""],
  ["52437.", "2 - 1", "15H", "79143689", "St Serotin 1", "- As Vlg 1", "79143752", "14H30", "... - ..."],
  // Ligne décalée d'un cran : elle commence par une cellule vide. Deux matchs U18 étaient perdus.
  ["", "52224.", "... - ...", "16H", "79121576", "As Vlg 21", "- J. Senonaise 21", "79121616", "16H", "... - ..."],
];

test("poule : la mise en page est reconnue avant d'être lue", () => {
  assert.equal(ressembleAUnCalendrierDePoule(POULE_REELLE), true);
  assert.equal(ressembleAUnCalendrierDePoule([["Date", "Equipe"], ["14/09/2026", "U18 D2"]]), false);
});

test("poule : le club destinataire est reconnu sous son abréviation", () => {
  const entete = "ASSOCIATION SPORTIVE VILLENEUVE LA GUYARD - 565301";
  for (const nom of ["As Vlg 1", "As Vlg 21", "A.S. Villeneuve La Guyard 1"]) {
    assert.equal(estEquipeDuClub(nom, entete), true, nom);
  }
  // Les pièges : un autre club dont le nom recoupe partiellement le nôtre.
  for (const nom of ["Villeneuve 1", "As Villeneuve 1", "Guyard 1", "As Tso 1", "Champigny 2", "J. Senonaise 1"]) {
    assert.equal(estEquipeDuClub(nom, entete), false, nom);
  }
});

test("poule : une ligne donne deux matchs, l'aller et le retour, équipes inversées", () => {
  const r = lireCalendrierDePoule(POULE_REELLE);
  const senonaise = r.evenements.filter((e) => e.opponent === "J. Senonaise 1");
  assert.equal(senonaise.length, 2);
  assert.equal(senonaise[0]!.matchDate, "2026-11-11"); // corrigée par la ligne suivante
  assert.equal(senonaise[0]!.isHome, true);
  assert.equal(senonaise[1]!.matchDate, "2027-06-06");
  assert.equal(senonaise[1]!.isHome, false);
});

test("poule : les matchs entre deux autres clubs ne sont jamais importés", () => {
  const r = lireCalendrierDePoule(POULE_REELLE);
  assert.equal(r.matchsAutresClubs, 1); // U.S. Dionysienne / Champigny
  assert.ok(r.evenements.every((e) => e.sourceTeamName!.startsWith("As Vlg")));
});

test("poule : une ligne décalée d'une colonne est quand même lue", () => {
  const r = lireCalendrierDePoule(POULE_REELLE);
  assert.ok(r.evenements.some((e) => e.externalEventId === "79121576"), "match U18 décalé perdu");
});

test("poule : chaque catégorie du document est conservée", () => {
  const r = lireCalendrierDePoule(POULE_REELLE);
  assert.ok(r.evenements.every((e) => e.competitionName === "Seniors D3 / Unique"));
  assert.deepEqual(r.equipesDuClub.sort(), ["As Vlg 1", "As Vlg 21"]);
});

test("poule : un score renseigné dit que le match est joué, « ... - ... » ne dit rien", () => {
  const r = lireCalendrierDePoule(POULE_REELLE);
  const joue = r.evenements.find((e) => e.externalEventId === "79143689");
  assert.equal(joue!.sportStatus, "completed");
  assert.equal(joue!.score, "2-1");
  const aVenir = r.evenements.find((e) => e.externalEventId === "79143819");
  assert.equal(aVenir!.sportStatus, null);
});

test("poule : le provider PDF emprunte ce chemin tout seul", async () => {
  const r = await pdfProvider.parse({ fileName: "calendrier 34SC.pdf", options: { lignes: POULE_REELLE }, teams: TEAMS });
  assert.ok(r.events.length >= 5);
  assert.ok(r.issues.some((i) => /ne concerne pas/i.test(i.reason)));
});

// ── Le même calendrier existe en deux versions (08/09/2026) ──────────────────
// Celle adressée au club porte son nom en en-tête ; celle diffusée par le district porte
// « DISTRICT YONNE » et ne nomme personne. La seconde a redonné « 0 match » : impossible de
// savoir de quel club il s'agit. C'est la seule chose qu'on demande à l'humain.

const POULE_DISTRICT: string[][] = [
  ["DISTRICT YONNE", "", "", "", "", "", "", "Calendriers*", ""],
  ["U18 Departemental 2 / Departemental 2", "", "", "", "", "", "", "", ""],
  ["Poule A", "", "", "", "", "Apres-Midi P1", "", "", ""],
  ["Journée", "1", "- Aller", "05/09/2026", "", "Journée 18 - Retour", "05/06/2027", "", ""],
  ["52183.", "... - ...", "16H", "79121535", "Mt St Sulpice 21", "- As Vlg 21", "79121620", "16H", "... - ..."],
  ["52184.", "... - ...", "14H", "79121536", "J. Senonaise 21", "- Football Club Charny 21", "79121621", "16H", "... - ..."],
  ["U15 Access D2 / Automne", "", "", "", "", "", "", "", ""],
  ["Journée", "1", "- Aller", "12/09/2026", "", "", "", "", ""],
  ["52501.", "... - ...", "10H", "79130001", "As Vlg 1", "- Migennes 1", "", "", ""],
];

test("district : sans nom de club dans l'en-tête, rien n'est importé en silence", () => {
  const r = lireCalendrierDePoule(POULE_DISTRICT);
  assert.equal(r.club, null);
  assert.equal(r.evenements.length, 0);
});

test("district : les clubs proposés sortent des vraies poules, le plus présent en tête", () => {
  const candidats = clubsCandidats(POULE_DISTRICT);
  assert.equal(candidats[0], "As Vlg 21", `attendu As Vlg en tête, obtenu ${candidats.join(", ")}`);
});

test("district : le club choisi par l'humain fait foi, toutes ses équipes confondues", () => {
  const r = lireCalendrierDePoule(POULE_DISTRICT, { nomClub: "As Vlg 21" });
  // « As Vlg 21 » en U18 et « As Vlg 1 » en U15 sont le même club : le numéro d'équipe ne compte pas.
  assert.equal(r.evenements.length, 3);
  assert.deepEqual(
    [...new Set(r.evenements.map((e) => e.competitionName))].sort(),
    ["U15 Access D2 / Automne", "U18 Departemental 2 / Departemental 2"],
  );
  assert.equal(r.matchsAutresClubs, 1); // J. Senonaise / Charny
});

test("district : une ligne de matchs effondrée en une cellule n'est pas prise pour une catégorie", () => {
  // Sur les pages de coupe régionale, la reconstruction des colonnes échoue. Sans garde-fou, cette
  // ligne devenait une catégorie et renommait tous les matchs suivants.
  const effondree = [
    ...POULE_DISTRICT,
    ["... - ... 12H 56606354 St Georges 21 - Cosne Ucs Football 21 ... - ... 31971. ... - ... 15H"],
    ["52502.", "... - ...", "11H", "79130002", "As Vlg 1", "- Paron F.C. 2", "", "", ""],
  ];
  const r = lireCalendrierDePoule(effondree, { nomClub: "As Vlg 21" });
  const dernier = r.evenements[r.evenements.length - 1]!;
  assert.equal(dernier.competitionName, "U15 Access D2 / Automne");
});

// ── Classeurs Excel a balises prefixees (09/09/2026) ─────────────────────────
// Un vrai planning de club deposé par Fouka renvoyait « Fichier .xlsx illisible : aucune feuille
// de calcul trouvée ». Le fichier était parfaitement valide : il est produit par la bibliothèque
// OpenXML, qui préfixe ses balises — <x:sheet>, <x:row>, <x:c> — là où le lecteur n'acceptait que
// la forme sans préfixe. Tout export venant d'un outil .NET tombait dans ce trou.

function classeurPrefixe(): ArrayBuffer {
  // Un .xlsx minimal, entièrement en balises préfixées `x:`, sans compression (méthode 0).
  const fichiers: Record<string, string> = {
    "xl/workbook.xml":
      `<?xml version="1.0"?><x:workbook xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"` +
      ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<x:sheets><x:sheet name="Feuil1" sheetId="1" r:id="rId1"/></x:sheets></x:workbook>`,
    "xl/_rels/workbook.xml.rels":
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Target="worksheets/sheet.xml"/></Relationships>`,
    "xl/worksheets/sheet.xml":
      `<?xml version="1.0"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>` +
      `<x:row r="1"><x:c t="inlineStr"><x:is><x:t>Date</x:t></x:is></x:c><x:c t="inlineStr"><x:is><x:t>Equipe</x:t></x:is></x:c><x:c t="inlineStr"><x:is><x:t>Adversaire</x:t></x:is></x:c></x:row>` +
      `<x:row r="2"><x:c t="inlineStr"><x:is><x:t>14/09/2026</x:t></x:is></x:c><x:c t="inlineStr"><x:is><x:t>U18 D2</x:t></x:is></x:c><x:c t="inlineStr"><x:is><x:t>FC Sens</x:t></x:is></x:c></x:row>` +
      `<x:row r="3"><x:c t="inlineStr"><x:is><x:t>21/09/2026</x:t></x:is></x:c><x:c t="inlineStr"><x:is><x:t>U16 D3</x:t></x:is></x:c><x:c t="inlineStr"><x:is><x:t>AS Montereau</x:t></x:is></x:c></x:row>` +
      `</x:sheetData></x:worksheet>`,
  };
  const enc = new TextEncoder();
  const locales: Uint8Array[] = [];
  const centrales: Uint8Array[] = [];
  let offset = 0;
  const u32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  const u16 = (n: number) => [n & 255, (n >> 8) & 255];
  for (const [nom, contenu] of Object.entries(fichiers)) {
    const nomOctets = enc.encode(nom);
    const donnees = enc.encode(contenu);
    // CRC32 — necessaire, un lecteur strict le verifierait.
    let crc = ~0;
    for (const octet of donnees) {
      crc ^= octet;
      for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    crc = ~crc >>> 0;
    const entete = Uint8Array.from([
      0x50, 0x4b, 3, 4, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      ...u32(crc), ...u32(donnees.length), ...u32(donnees.length),
      ...u16(nomOctets.length), 0, 0,
    ]);
    const local = new Uint8Array(entete.length + nomOctets.length + donnees.length);
    local.set(entete, 0);
    local.set(nomOctets, entete.length);
    local.set(donnees, entete.length + nomOctets.length);
    locales.push(local);
    const centrale = Uint8Array.from([
      0x50, 0x4b, 1, 2, 20, 0, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      ...u32(crc), ...u32(donnees.length), ...u32(donnees.length),
      ...u16(nomOctets.length), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...u32(offset),
    ]);
    const cd = new Uint8Array(centrale.length + nomOctets.length);
    cd.set(centrale, 0);
    cd.set(nomOctets, centrale.length);
    centrales.push(cd);
    offset += local.length;
  }
  const tailleCd = centrales.reduce((n, c) => n + c.length, 0);
  const fin = Uint8Array.from([
    0x50, 0x4b, 5, 6, 0, 0, 0, 0,
    ...u16(centrales.length), ...u16(centrales.length),
    ...u32(tailleCd), ...u32(offset), 0, 0,
  ]);
  const total = offset + tailleCd + fin.length;
  const sortie = new Uint8Array(total);
  let p = 0;
  for (const l of locales) { sortie.set(l, p); p += l.length; }
  for (const c of centrales) { sortie.set(c, p); p += c.length; }
  sortie.set(fin, p);
  return sortie.buffer;
}

test("xlsx : un classeur a balises prefixees est lu comme les autres", async () => {
  const resultat = await xlsxProvider.parse({ fileName: "planning.xlsx", bytes: classeurPrefixe(), teams: TEAMS });
  assert.equal(resultat.issues.length, 0, resultat.issues.map((i) => i.reason).join(" / "));
  assert.equal(resultat.events.length, 2);
  assert.equal(resultat.events[0]!.matchDate, "2026-09-14");
  assert.equal(resultat.events[0]!.opponent, "FC Sens");
});

// ── Une equipe qui couvre deux categories (09/09/2026) ───────────────────────
// Beaucoup de clubs font jouer les U8 avec les U9 : une seule equipe, deux categories. Le
// calendrier peut dire l'une ou l'autre, il doit tomber sur la meme equipe.

test("categories fusionnees : U8 et U9 trouvent la meme equipe", () => {
  const equipes: ClubTeamRef[] = [
    { id: "petits", name: "Les Petits", categories: ["U8", "U9"] },
    { id: "u15", name: "U15 D2", categories: ["U15"] },
  ];
  const evenement = (nom: string): SourceEvent => ({
    sourceLine: 1, rawLabel: "", externalEventId: null, externalCompetitionId: null,
    competitionName: null, externalTeamId: null, sourceTeamName: nom, opponent: "FC X",
    matchDate: "2026-09-14", kickoffTime: null, location: null, isHome: null,
    sportStatus: null, score: null, sourceUpdatedAt: null,
  });
  for (const libelle of ["U8", "U9"]) {
    const apercu = preview("CSV", [evenement(libelle)], [], { teams: equipes });
    assert.equal(apercu.rows[0]!.teamId, "petits", `« ${libelle} » n'a pas trouve l'equipe fusionnee`);
  }
  // Et une categorie qu'elle NE couvre PAS ne doit pas lui etre attribuee.
  const autre = preview("CSV", [evenement("U15")], [], { teams: equipes });
  assert.equal(autre.rows[0]!.teamId, "u15");
});

// ── Planning « par blocs » : la date est un titre de section (09/09/2026) ─────
// Le planning reel de Villemomble Sports : un onglet par mois, et dans chaque onglet des blocs
// « titre du club / date seule / en-tete / matchs ». Aucune colonne date : la detection refusait
// tout le fichier.

const PLANNING_PAR_BLOCS: string[][] = [
  ["PLANNING DES MATCHS DU CLUB 2026", "", "", "", "", "", ""],
  ["46246", "", "", "", "", "", ""],
  ["CATEGORIES VSF", "ADVERSAIRES", "RDV", "EDUCATEURS", "COMPETITION", "HORAIRES COUP D'ENVOI", "LIEU"],
  ["Séniors R2", "Meaux", "19h", "Diatta", "Amical", "20h15", "Stade Ripert"],
  ["", "", "", "", "", "", ""],
  ["PLANNING DES MATCHS DU CLUB 2026", "", "", "", "", "", ""],
  ["46250", "", "", "", "", "", ""],
  ["CATEGORIES VSF", "ADVERSAIRES", "RDV", "EDUCATEURS", "COMPETITION", "HORAIRES COUP D'ENVOI", "LIEU"],
  ["U18 D2", "As Chelles", "18h", "", "Amical", "20h30", "Stade Mimoun"],
  ["U16 D1", "Bondy", "14h", "", "Championnat", "15h", "Parc Pompidou"],
];

test("planning par blocs : la date du titre de section est reportee sur ses matchs", () => {
  const lignes = enrichirDepuisSections(PLANNING_PAR_BLOCS);
  assert.ok(lignes, "le planning par blocs n'a pas ete reconnu");
  // Une seule ligne d'en-tete conservee, en tete, malgre ses deux occurrences dans le fichier.
  assert.equal(lignes![0]![0], "CATEGORIES VSF");
  assert.equal(lignes!.filter((l) => l[0] === "CATEGORIES VSF").length, 1);
  assert.equal(lignes!.length, 4); // en-tete + 3 matchs
});

test("planning par blocs : chaque match part vers l'equipe que sa ligne nomme", () => {
  const lignes = enrichirDepuisSections(PLANNING_PAR_BLOCS)!;
  const layout = detectTabularLayout(lignes, { teams: [{ name: "Séniors R2" }, { name: "U18 D2" }] });
  assert.equal(layout.missingRequired.length, 0, `manquant : ${layout.missingRequired.join(", ")}`);
  assert.notEqual(layout.columns.team, undefined, "la colonne des categories n'est pas reconnue comme equipe");
  assert.equal(layout.columns.team, 0);
  assert.equal(layout.columns.opponent, 1);
});

test("planning par blocs : un tableau ordinaire n'est PAS transforme", () => {
  // Une seule cellule-date isolee ne doit pas declencher cette lecture.
  const ordinaire = [
    ["Date", "Equipe", "Adversaire"],
    ["14/09/2026", "U18 D2", "FC Sens"],
    ["21/09/2026", "U16 D3", "AS Montereau"],
  ];
  assert.equal(enrichirDepuisSections(ordinaire), null);
});
