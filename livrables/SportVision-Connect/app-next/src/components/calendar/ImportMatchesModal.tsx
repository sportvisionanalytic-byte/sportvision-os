"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronRight, Upload, X } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { useModalA11y } from "@/lib/useModalA11y";
import { fetchClubTeams } from "@/lib/data/club/teams";
import { fetchClubCurrentSaison } from "@/lib/data/club/season-transition";
import {
  applyCalendarImport,
  fetchExistingMatches,
  fetchSaisons,
  fetchTeamSourceMappings,
  recordCalendarSyncRun,
  resolveDefaultSaisonId,
  saveTeamSourceMappings,
  type ApplyResult,
  type SaisonRef,
} from "@/lib/data/club/calendar-sync";
import { CALENDAR_ACCEPT, detectProvider } from "@/lib/calendar/providers";
import {
  XLSX_FIELDS,
  XLSX_FIELD_LABELS,
  XLSX_REQUIRED_FIELDS,
  type XlsxColumnMapping,
  type XlsxField,
} from "@/lib/calendar/providers/xlsx";
import {
  buildImportPreview,
  CHANGED_FIELD_LABELS,
  VERDICT_LABELS,
  type ClubTeamRef,
  type ExistingMatch,
  type ImportPreview,
  type PreviewRow,
  type RowVerdict,
  type TeamSourceMapping,
} from "@/lib/calendar/diff";
import { SPORT_STATUS_LABELS, type CalendarProvider, type ParseResult, type SourceInspection } from "@/lib/calendar/types";

// Import / synchronisation de calendrier — écran unique du chantier "calendriers externes"
// (phase TypeScript, 05/09/2026). Le fil conducteur est inchangé depuis la première version :
// RIEN n'est écrit sans que l'admin ait vu ligne par ligne ce qui va se passer. Ce qui change,
// c'est qu'il voit maintenant AVANT confirmation ce que chaque ligne va faire — créer, modifier,
// ou ne rien faire — au lieu d'un simple "X match(s)".
//
// Trois écrans : dépôt du fichier → (mapping des colonnes, .xlsx uniquement) → preview + diff.
// Toute la logique de décision est dans lib/calendar (pure, testée hors navigateur) et l'écriture
// dans lib/data/club/calendar-sync.ts. Ce composant ne fait qu'orchestrer et afficher.

type Step = "source" | "mapping" | "preview" | "done";

const VERDICT_STYLES: Record<RowVerdict, string> = {
  new: "bg-[rgba(36,84,255,.12)] text-brand-blue-electric",
  updated: "bg-[rgba(245,158,11,.14)] text-[#B45309]",
  unchanged: "bg-surface-sunken text-text-faint",
  needs_mapping: "bg-[rgba(239,91,103,.12)] text-danger-fg",
  ambiguous: "bg-[rgba(239,91,103,.12)] text-danger-fg",
  error: "bg-[rgba(239,91,103,.12)] text-danger-fg",
};

const COUNT_ORDER: RowVerdict[] = ["new", "updated", "unchanged", "needs_mapping", "ambiguous", "error"];

export function ImportMatchesModal({
  clubId,
  userId,
  onClose,
  onImported,
}: {
  clubId: string;
  /** ctx.user.id — tracé dans club_team_source_mappings.confirmed_by. */
  userId?: string | null;
  onClose: () => void;
  onImported: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  useModalA11y(containerRef, onClose);

  const [step, setStep] = useState<Step>("source");
  const [busy, setBusy] = useState(false);
  const [fatalError, setFatalError] = useState<string | null>(null);

  // Contexte club
  const [teams, setTeams] = useState<ClubTeamRef[]>([]);
  const [saisons, setSaisons] = useState<SaisonRef[]>([]);
  const [saisonId, setSaisonId] = useState<string | null>(null);
  const [existing, setExisting] = useState<ExistingMatch[]>([]);
  const [mappings, setMappings] = useState<TeamSourceMapping[]>([]);

  // Fichier en cours
  const [fileName, setFileName] = useState("");
  const [fileBytes, setFileBytes] = useState<ArrayBuffer | null>(null);
  const [fileText, setFileText] = useState<string | null>(null);
  const [provider, setProvider] = useState<CalendarProvider | null>(null);
  const [inspection, setInspection] = useState<SourceInspection | null>(null);
  const [mapping, setMapping] = useState<XlsxColumnMapping>({ sheetIndex: 0, headerRow: 0, columns: {} });
  const [parsed, setParsed] = useState<ParseResult | null>(null);

  // Décisions humaines sur la preview
  const [defaultTeamId, setDefaultTeamId] = useState<string>("");
  const [teamIdByLine, setTeamIdByLine] = useState<Record<number, string>>({});
  const [excludedLines, setExcludedLines] = useState<number[]>([]);
  const [includedLines, setIncludedLines] = useState<number[]>([]);

  // Résultat
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [journalWarning, setJournalWarning] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    Promise.all([
      fetchClubTeams(supabase, clubId),
      fetchSaisons(supabase),
      fetchClubCurrentSaison(supabase, clubId),
      fetchExistingMatches(supabase, clubId),
    ])
      .then(([teamRows, saisonRows, clubSaison, matches]) => {
        if (cancelled) return;
        setTeams(teamRows.map((t) => ({ id: t.id, name: t.name })));
        setSaisons(saisonRows);
        setSaisonId(resolveDefaultSaisonId(saisonRows, clubSaison));
        setExisting(matches);
      })
      .catch(() => {
        if (!cancelled) setFatalError("Impossible de charger le contexte du club (équipes, saisons, calendrier existant).");
      });
    return () => {
      cancelled = true;
    };
  }, [clubId]);

  // Les mappings sont scopés (club, saison, provider) : ils ne peuvent être lus qu'une fois les
  // deux derniers connus.
  useEffect(() => {
    if (!provider || !saisonId) return;
    let cancelled = false;
    fetchTeamSourceMappings(createClient(), clubId, saisonId, provider.id).then((rows) => {
      if (!cancelled) setMappings(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [clubId, provider, saisonId]);

  const preview: ImportPreview | null = useMemo(() => {
    if (!provider || !parsed) return null;
    return buildImportPreview({
      provider: provider.id,
      events: parsed.events,
      issues: parsed.issues,
      existing,
      teams,
      mappings,
      defaultTeamId: defaultTeamId || null,
      overrides: { teamIdByLine, excludedLines, includedLines },
    });
  }, [provider, parsed, existing, teams, mappings, defaultTeamId, teamIdByLine, excludedLines, includedLines]);

  const handleFile = useCallback(
    async (file: File) => {
      setFatalError(null);
      setResult(null);
      setBusy(true);
      try {
        const bytes = await file.arrayBuffer();
        // Le sniff de contenu ne sert qu'aux formats texte (un .ics renommé). Décoder un binaire
        // en UTF-8 produirait du bruit, jamais une détection utile.
        const isProbablyText = !file.name.toLowerCase().endsWith(".xlsx");
        const text = isProbablyText ? new TextDecoder("utf-8").decode(bytes) : "";
        const found = detectProvider(file.name, text.slice(0, 1024));
        if (!found) {
          setFatalError("Format non reconnu. Formats acceptés : .csv, .ics, .xlsx.");
          return;
        }

        setFileName(file.name);
        setFileBytes(bytes);
        setFileText(isProbablyText ? text : null);
        setProvider(found);
        setTeamIdByLine({});
        setExcludedLines([]);
        setIncludedLines([]);

        if (found.needsColumnMapping && found.inspect) {
          const found_inspection = await found.inspect({ fileName: file.name, bytes });
          setInspection(found_inspection);
          setMapping({ sheetIndex: 0, headerRow: 0, columns: {} });
          setStep("mapping");
          return;
        }

        const parseResult = await found.parse({ fileName: file.name, text, bytes });
        setParsed(parseResult);
        setStep("preview");
      } catch (error) {
        setFatalError(error instanceof Error ? error.message : "Fichier illisible.");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  async function applyMapping() {
    if (!provider || !fileBytes) return;
    setBusy(true);
    setFatalError(null);
    try {
      const parseResult = await provider.parse({ fileName, bytes: fileBytes, text: fileText ?? undefined, options: mapping });
      setParsed(parseResult);
      setStep("preview");
    } catch (error) {
      setFatalError(error instanceof Error ? error.message : "Lecture du tableur impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!provider || !preview || !saisonId) return;
    setBusy(true);
    setFatalError(null);
    const supabase = createClient();
    const startedAt = new Date().toISOString();
    try {
      const applied = await applyCalendarImport(supabase, {
        clubId,
        saisonId,
        provider: provider.id,
        rows: preview.rows,
      });
      setResult(applied);

      const mappingResult = await saveTeamSourceMappings(supabase, {
        clubId,
        saisonId,
        provider: provider.id,
        rows: preview.rows,
        userId: userId ?? null,
      });

      const journal = await recordCalendarSyncRun(supabase, {
        clubId,
        saisonId,
        provider: provider.id,
        startedAt,
        created: applied.created,
        updated: applied.updated,
        cancelled: applied.cancelledOrPostponed,
        unchanged: applied.skipped + preview.counts.unchanged,
        changes: applied.changes,
        errors: [
          ...applied.failed,
          ...preview.issues.map((i) => ({ line: i.line, label: i.raw.slice(0, 120), message: i.reason })),
        ],
        sourceLabel: fileName,
      });

      setJournalWarning(journal.error ?? mappingResult.error);
      setStep("done");
      if (applied.created + applied.updated > 0) onImported();
    } catch (error) {
      setFatalError(error instanceof Error ? error.message : "L'import a échoué.");
    } finally {
      setBusy(false);
    }
  }

  function toggleRow(row: PreviewRow) {
    if (row.include) {
      setExcludedLines((prev) => [...prev.filter((l) => l !== row.key), row.key]);
      setIncludedLines((prev) => prev.filter((l) => l !== row.key));
    } else {
      setIncludedLines((prev) => [...prev.filter((l) => l !== row.key), row.key]);
      setExcludedLines((prev) => prev.filter((l) => l !== row.key));
    }
  }

  const headerRowCells = inspection?.sheets[mapping.sheetIndex]?.rows[mapping.headerRow] ?? [];
  const mappingComplete = XLSX_REQUIRED_FIELDS.every((field) => mapping.columns[field] !== undefined);

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label="Importer un calendrier"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(7,10,23,.65)] p-4"
    >
      <Card className="animate-svfade relative flex max-h-[88vh] w-full max-w-[820px] flex-col gap-4 overflow-y-auto rounded-sv-modal p-6 shadow-sv-modal">
        <button
          aria-label="Fermer"
          onClick={onClose}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-text-faint hover:bg-surface-sunken hover:text-text"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>

        <div>
          <h2 className="text-[19px] font-extrabold tracking-tight">Importer un calendrier</h2>
          <p className="mt-1 text-[12.5px] leading-relaxed text-text-soft">
            Déposez l&apos;export de votre fédération ou de votre logiciel de club (.ics), un tableur (.csv) ou un fichier
            Excel (.xlsx). Vous verrez exactement ce qui sera créé et ce qui sera modifié avant que quoi que ce soit
            n&apos;entre dans le calendrier.
          </p>
        </div>

        {fatalError && (
          <p className="flex items-start gap-2 rounded-lg bg-[rgba(239,91,103,.1)] px-3 py-2.5 text-[12.5px] font-bold text-danger-fg">
            <AlertTriangle className="mt-[1px] h-4 w-4 flex-none" aria-hidden />
            {fatalError}
          </p>
        )}

        {step === "source" && (
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border-strong px-6 py-10 text-center hover:border-brand-blue-pale">
            <Upload className="h-5 w-5 text-text-faint" aria-hidden />
            <span className="text-[13px] font-bold text-text">
              {busy ? "Lecture du fichier…" : "Choisir un fichier .csv, .ics ou .xlsx"}
            </span>
            <span className="text-[11.5px] text-text-faint">
              Aucun mot de passe de votre compte fédéral ne vous sera jamais demandé.
            </span>
            <input
              type="file"
              accept={CALENDAR_ACCEPT}
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
          </label>
        )}

        {step === "mapping" && inspection && (
          <div className="flex flex-col gap-3.5">
            <div className="rounded-lg bg-[rgba(245,158,11,.1)] px-3 py-2.5 text-[12px] font-semibold leading-relaxed text-[#B45309]">
              Le format exact des exports Footclubs n&apos;est pas encore connu de SportVision : aucune colonne
              n&apos;est devinée. Indiquez vous-même où se trouvent l&apos;adversaire et la date. Ce que vous
              choisissez ici sera réutilisé pour les prochains imports du même fichier.
            </div>

            <div className="flex flex-wrap gap-3">
              <Field label="Feuille">
                <select
                  value={mapping.sheetIndex}
                  onChange={(e) => setMapping({ sheetIndex: Number(e.target.value), headerRow: 0, columns: {} })}
                  className={SELECT_CLASS}
                >
                  {inspection.sheets.map((sheet) => (
                    <option key={sheet.index} value={sheet.index}>
                      {sheet.name} ({sheet.rowCount} lignes)
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Ligne d'en-tête">
                <select
                  value={mapping.headerRow}
                  onChange={(e) => setMapping((m) => ({ ...m, headerRow: Number(e.target.value), columns: {} }))}
                  className={SELECT_CLASS}
                >
                  {(inspection.sheets[mapping.sheetIndex]?.rows ?? []).map((row, index) => (
                    <option key={index} value={index}>
                      Ligne {index + 1} — {row.slice(0, 4).filter(Boolean).join(" / ") || "(vide)"}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {XLSX_FIELDS.map((field) => (
                <Field key={field} label={XLSX_FIELD_LABELS[field]}>
                  <select
                    value={mapping.columns[field] ?? ""}
                    onChange={(e) =>
                      setMapping((m) => {
                        const columns = { ...m.columns };
                        if (e.target.value === "") delete columns[field];
                        else columns[field] = Number(e.target.value);
                        return { ...m, columns };
                      })
                    }
                    className={SELECT_CLASS}
                  >
                    <option value="">— non utilisé —</option>
                    {headerRowCells.map((header, index) => (
                      <option key={index} value={index}>
                        {header || `Colonne ${index + 1}`}
                      </option>
                    ))}
                  </select>
                </Field>
              ))}
            </div>

            <Button variant="primary" disabled={!mappingComplete || busy} onClick={applyMapping}>
              {busy ? "Lecture…" : "Voir ce qui sera importé"}
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        )}

        {step === "preview" && preview && (
          <div className="flex flex-col gap-3.5">
            <div className="flex flex-wrap gap-3">
              <Field label="Saison">
                <select value={saisonId ?? ""} onChange={(e) => setSaisonId(e.target.value || null)} className={SELECT_CLASS}>
                  {saisons.length === 0 && <option value="">Aucune saison</option>}
                  {saisons.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                      {s.active ? " (active)" : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Équipe par défaut">
                <select value={defaultTeamId} onChange={(e) => setDefaultTeamId(e.target.value)} className={SELECT_CLASS}>
                  <option value="">— aucune —</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {COUNT_ORDER.map((verdict) => (
                <span
                  key={verdict}
                  className={`rounded-full px-2.5 py-1 text-[11.5px] font-bold ${VERDICT_STYLES[verdict]}`}
                >
                  {VERDICT_LABELS[verdict]} : {preview.counts[verdict]}
                </span>
              ))}
            </div>

            {preview.issues.length > 0 && (
              <div className="rounded-lg border border-[rgba(239,91,103,.35)] px-3 py-2.5">
                <div className="text-[12px] font-extrabold text-danger-fg">
                  {preview.issues.length} ligne{preview.issues.length > 1 ? "s" : ""} non lue
                  {preview.issues.length > 1 ? "s" : ""} — le reste du fichier reste importable
                </div>
                <ul className="mt-1.5 flex flex-col gap-1">
                  {preview.issues.slice(0, 12).map((issue, index) => (
                    <li key={index} className="text-[11.5px] leading-relaxed text-text-soft">
                      <span className="font-bold">Ligne {issue.line}</span> — {issue.reason}
                      {issue.raw && <span className="text-text-faint"> · {issue.raw.slice(0, 90)}</span>}
                    </li>
                  ))}
                  {preview.issues.length > 12 && (
                    <li className="text-[11.5px] text-text-faint">… et {preview.issues.length - 12} autre(s).</li>
                  )}
                </ul>
              </div>
            )}

            <div className="flex max-h-[36vh] flex-col gap-2 overflow-y-auto">
              {preview.rows.map((row) => (
                <div key={row.key} className="flex flex-wrap items-center gap-2 rounded-lg border border-divider px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={row.include}
                    onChange={() => toggleRow(row)}
                    aria-label={`Importer ${row.source.opponent} du ${row.source.matchDate}`}
                    className="h-4 w-4"
                  />
                  <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-extrabold ${VERDICT_STYLES[row.verdict]}`}>
                    {VERDICT_LABELS[row.verdict]}
                  </span>
                  <span className="w-[104px] flex-none text-[12px] font-semibold text-text-soft">
                    {row.source.matchDate}
                    {row.source.kickoffTime ? ` · ${row.source.kickoffTime}` : ""}
                  </span>
                  <span className="min-w-[120px] flex-1 text-[12.5px] font-bold text-text">{row.source.opponent}</span>
                  <select
                    value={row.teamId ?? ""}
                    onChange={(e) => setTeamIdByLine((prev) => ({ ...prev, [row.key]: e.target.value }))}
                    aria-label="Équipe"
                    className={SELECT_CLASS}
                  >
                    <option value="">Équipe…</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <div className="w-full text-[11.5px] leading-relaxed text-text-faint">
                    {row.source.sportStatus && row.source.sportStatus !== "scheduled" && (
                      <span className="mr-2 font-bold text-[#B45309]">{SPORT_STATUS_LABELS[row.source.sportStatus]}</span>
                    )}
                    {row.changes.length > 0 &&
                      row.changes
                        .map((c) => `${CHANGED_FIELD_LABELS[c.field]} : ${c.before ?? "—"} → ${c.after ?? "—"}`)
                        .join(" · ")}
                    {row.changes.length === 0 && row.reason}
                    {row.fromConfirmedMapping && <span className="ml-2">Équipe reconnue automatiquement.</span>}
                  </div>
                </div>
              ))}
            </div>

            {!saisonId && (
              <p className="text-[12px] font-bold text-danger-fg">
                Aucune saison sélectionnée : un match importé sans saison ne remonterait dans aucun bilan de saison.
              </p>
            )}

            <Button variant="primary" disabled={busy || !saisonId || preview.selectedCount === 0} onClick={submit}>
              {busy
                ? "Import…"
                : `Importer ${preview.selectedCount} ligne${preview.selectedCount > 1 ? "s" : ""} (${preview.counts.new} nouveau${preview.counts.new > 1 ? "x" : ""}, ${preview.counts.updated} modifié${preview.counts.updated > 1 ? "s" : ""})`}
            </Button>
          </div>
        )}

        {step === "done" && result && (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] font-bold text-success-fg">
              {result.created} créé{result.created > 1 ? "s" : ""} · {result.updated} mis à jour ·{" "}
              {result.skipped + (preview?.counts.unchanged ?? 0)} inchangé
              {result.skipped + (preview?.counts.unchanged ?? 0) > 1 ? "s" : ""}
              {result.cancelledOrPostponed > 0 && ` · ${result.cancelledOrPostponed} reporté(s)/annulé(s)`}
            </p>

            {result.failed.length > 0 && (
              <div className="rounded-lg border border-[rgba(239,91,103,.35)] px-3 py-2.5">
                <div className="text-[12px] font-extrabold text-danger-fg">
                  {result.failed.length} ligne{result.failed.length > 1 ? "s" : ""} en échec
                </div>
                <ul className="mt-1.5 flex flex-col gap-1">
                  {result.failed.map((failure, index) => (
                    <li key={index} className="text-[11.5px] leading-relaxed text-text-soft">
                      <span className="font-bold">Ligne {failure.line}</span> — {failure.label} : {failure.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {journalWarning && (
              <p className="text-[11.5px] leading-relaxed text-text-faint">
                Les matchs sont bien enregistrés. En revanche le journal de synchronisation n&apos;a pas pu être écrit
                ({journalWarning}).
              </p>
            )}

            <Button onClick={onClose}>Fermer</Button>
          </div>
        )}
      </Card>
    </div>
  );
}

const SELECT_CLASS =
  "h-9 rounded-lg border border-border-strong bg-input-bg px-2.5 text-[12.5px] font-semibold outline-none focus-visible:border-brand-blue";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-bold uppercase tracking-[.04em] text-text-faint">{label}</span>
      {children}
    </label>
  );
}
