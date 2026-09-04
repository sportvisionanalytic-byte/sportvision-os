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
import { xlsxProvider } from "../providers/xlsx.ts";
import { detectProvider } from "../providers/index.ts";
import { buildImportPreview, type ClubTeamRef, type ExistingMatch, type TeamSourceMapping } from "../diff.ts";
import { fallbackIdentityKey, externalIdentityKey } from "../identity.ts";
import { parseFlexibleDate, parseFlexibleTime, coerceSportStatus, detectSportStatus } from "../normalize.ts";
import { readXlsx } from "../xlsx.ts";
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

test("provider XLSX — aucune colonne devinée, mapping manuel obligatoire", async () => {
  const buffer = await makeZip(XLSX_FILES, false);

  const inspection = await xlsxProvider.inspect!({ fileName: "export.xlsx", bytes: buffer });
  assert.equal(inspection.sheets[0]!.name, "Rencontres");
  assert.deepEqual(inspection.sheets[0]!.rows[0], ["Date de rencontre", "Club recevant", "Horaire"]);

  const withoutMapping = await xlsxProvider.parse({ fileName: "export.xlsx", bytes: buffer });
  assert.equal(withoutMapping.events.length, 0);
  assert.match(withoutMapping.issues[0]!.reason, /mapping/i);

  const partial = await xlsxProvider.parse({
    fileName: "export.xlsx",
    bytes: buffer,
    options: { sheetIndex: 0, headerRow: 0, columns: { date: 0 } },
  });
  assert.match(partial.issues[0]!.reason, /Adversaire/);

  const mapped = await xlsxProvider.parse({
    fileName: "export.xlsx",
    bytes: buffer,
    options: { sheetIndex: 0, headerRow: 0, columns: { date: 0, opponent: 1, time: 2 } },
  });
  assert.equal(mapped.events.length, 2);
  assert.equal(mapped.events[0]!.matchDate, "2026-09-12");
  assert.equal(mapped.events[0]!.kickoffTime, "15:00");
  assert.equal(mapped.events[0]!.opponent, "AS Rivage & Co");
  assert.equal(mapped.events[0]!.sourceLine, 2, "numéro de ligne Excel");
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
