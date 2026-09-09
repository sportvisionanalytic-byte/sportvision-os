"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Link2, RefreshCw, Upload, X } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { useModalA11y } from "@/lib/useModalA11y";
import { fetchClubTeams } from "@/lib/data/club/teams";
import { fetchClubCurrentSaison } from "@/lib/data/club/season-transition";
import {
  applyCalendarImport,
  fetchCalendarSource,
  fetchExistingMatches,
  fetchSaisons,
  fetchTeamSourceMappings,
  recordCalendarSyncRun,
  resolveDefaultSaisonId,
  saveCalendarSourceUrl,
  saveTeamSourceMappings,
  type ApplyResult,
  type CalendarSourceRow,
  type SaisonRef,
} from "@/lib/data/club/calendar-sync";
import { CALENDAR_ACCEPT, detectProvider, getProvider } from "@/lib/calendar/providers";
import { normalizeCalendarUrl } from "@/lib/calendar/normalize";
import { detectXlsxLayout } from "@/lib/calendar/providers/xlsx";
import { layoutToMapping, type DetectedLayout } from "@/lib/calendar/autodetect";
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
import {
  SPORT_STATUS_LABELS,
  TABULAR_FIELDS,
  TABULAR_FIELD_LABELS,
  type CalendarProvider,
  type ParseResult,
  type SourceInspection,
  type TabularField,
  type TabularMapping,
} from "@/lib/calendar/types";

// Import de calendrier — écran volontairement réduit à DEUX gestes : déposer le fichier, cliquer
// sur Importer.
//
// La version précédente demandait, dans l'ordre : le fichier, la feuille, la ligne d'en-tête,
// douze colonnes, la saison, l'équipe par défaut, puis une relecture de 500 lignes. Sept gestes
// pour une action que le club fait une ou deux fois par saison, sans s'en souvenir d'une fois sur
// l'autre. Ce qui a été supprimé n'est pas la rigueur, c'est le travail qu'on faisait faire à
// l'utilisateur alors qu'on pouvait le faire nous-mêmes :
//
//   * les colonnes sont reconnues par le CONTENU des cellules (lib/calendar/autodetect.ts), pas
//     par leur intitulé — donc plus d'écran de mapping dans le cas normal ;
//   * la saison et l'équipe sont déduites et affichées en une ligne, modifiables d'un clic ;
//   * seules les lignes qui demandent VRAIMENT un avis sont affichées. Les autres sont derrière
//     un « voir le détail », consultable mais jamais imposé.
//
// Rien n'est écrit sans validation, et tout ce qui a été deviné est montré avec ce sur quoi la
// déduction s'appuie. Une preview qu'on ne lit pas parce qu'elle fait 500 lignes ne protège
// personne ; une preview de 4 lignes, si.

type Step = "source" | "review" | "done";

const VERDICT_STYLES: Record<RowVerdict, string> = {
  new: "bg-[rgba(36,84,255,.12)] text-brand-blue-electric",
  updated: "bg-[rgba(245,158,11,.14)] text-[#B45309]",
  unchanged: "bg-surface-sunken text-text-faint",
  needs_mapping: "bg-[rgba(239,91,103,.12)] text-danger-fg",
  ambiguous: "bg-[rgba(239,91,103,.12)] text-danger-fg",
  error: "bg-[rgba(239,91,103,.12)] text-danger-fg",
};

/** Les verdicts qui appellent une décision humaine. Ce sont les seules lignes affichées d'office. */
const NEEDS_ATTENTION: RowVerdict[] = ["needs_mapping", "ambiguous"];

const SELECT_CLASS =
  "h-9 rounded-lg border border-border-strong bg-input-bg px-2.5 text-[12.5px] font-semibold outline-none focus-visible:border-brand-blue";

const LINK_CLASS = "text-[12px] font-bold text-brand-blue-electric underline underline-offset-2";

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
  // Un PDF coûte cher à lire : on l'extrait une fois au dépôt, et toutes les relectures
  // (changement de colonnes, réessai) repartent de ces lignes-là.
  const lignesPdfRef = useRef<string[][] | null>(null);
  // Certains calendriers de poule sont diffusés par le district et ne nomment aucun club : seul
  // l'humain sait duquel il s'agit. On lui propose les équipes des vraies poules, la sienne en
  // tête, plutôt que de deviner.
  const clubPdfRef = useRef<string | null>(null);
  const [clubsPdf, setClubsPdf] = useState<string[]>([]);
  const [clubPdf, setClubPdf] = useState<string | null>(null);
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

  // Fichier
  const [fileName, setFileName] = useState("");
  const [fileBytes, setFileBytes] = useState<ArrayBuffer | null>(null);
  const [fileText, setFileText] = useState<string | null>(null);
  const [provider, setProvider] = useState<CalendarProvider | null>(null);
  const [inspection, setInspection] = useState<SourceInspection | null>(null);
  const [layout, setLayout] = useState<DetectedLayout | null>(null);
  const [mapping, setMapping] = useState<TabularMapping | null>(null);
  const [parsed, setParsed] = useState<ParseResult | null>(null);

  // Source distante (URL d'abonnement)
  const [savedSource, setSavedSource] = useState<CalendarSourceRow | null>(null);
  const [urlInput, setUrlInput] = useState("");
  /** URL réellement utilisée pour la lecture en cours ; enregistrée seulement si l'import aboutit. */
  const [urlUsed, setUrlUsed] = useState<string | null>(null);

  // Décisions humaines
  const [defaultTeamId, setDefaultTeamId] = useState<string>("");
  const [teamIdByLine, setTeamIdByLine] = useState<Record<number, string>>({});
  const [excludedLines, setExcludedLines] = useState<number[]>([]);
  const [includedLines, setIncludedLines] = useState<number[]>([]);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);

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
        // Un club d'une seule équipe n'a aucune décision d'équipe à prendre : on la choisit pour
        // lui. C'est le cas de la totalité des comptes Club+ Gratuit.
        if (teamRows.length === 1) setDefaultTeamId(teamRows[0]!.id);
      })
      .catch(() => {
        if (!cancelled) setFatalError("Impossible de charger le contexte du club (équipes, saisons, calendrier existant).");
      });
    return () => {
      cancelled = true;
    };
  }, [clubId]);

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

  // Adresse d'abonnement déjà enregistrée par le club, s'il y en a une. C'est elle qui permet de
  // proposer « Synchroniser » plutôt que « Importer un fichier » dès la deuxième fois.
  useEffect(() => {
    if (!saisonId) return;
    let cancelled = false;
    fetchCalendarSource(createClient(), clubId, saisonId, "ICS").then((row) => {
      if (cancelled) return;
      setSavedSource(row);
      if (row?.sourceUrl) setUrlInput(row.sourceUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [clubId, saisonId]);

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

  const runParse = useCallback(
    async (
      target: CalendarProvider,
      source: { text: string | null; bytes: ArrayBuffer | null; name: string },
      options?: TabularMapping,
    ) => {
      const parseResult = await target.parse({
        fileName: source.name,
        text: source.text ?? undefined,
        bytes: source.bytes ?? undefined,
        options:
          target.id === "PDF" && lignesPdfRef.current
            ? { ...(options ?? {}), lignes: lignesPdfRef.current, nomClub: clubPdfRef.current }
            : options,
        teams,
      });
      setParsed(parseResult);
    },
    [teams],
  );

  const handleFile = useCallback(
    async (file: File) => {
      setFatalError(null);
      setResult(null);
      setBusy(true);
      try {
        const bytes = await file.arrayBuffer();
        const nomBas = file.name.toLowerCase();
        const isProbablyText = !nomBas.endsWith(".xlsx") && !nomBas.endsWith(".pdf");
        const text = isProbablyText ? new TextDecoder("utf-8").decode(bytes) : "";
        const found = detectProvider(file.name, text.slice(0, 1024));
        if (!found) {
          setFatalError("Format non reconnu. Formats acceptés : .pdf, .csv, .ics, .xlsx.");
          return;
        }

        setFileName(file.name);
        setFileBytes(bytes);
        setFileText(isProbablyText ? text : null);
        setProvider(found);
        setTeamIdByLine({});
        setExcludedLines([]);
        setIncludedLines([]);
        setAdjustOpen(false);
        setColumnsOpen(false);
        setInspection(null);
        setLayout(null);
        setMapping(null);
        setUrlUsed(null);
        lignesPdfRef.current = null;
        clubPdfRef.current = null;
        setClubsPdf([]);
        setClubPdf(null);

        // Un PDF n'est pas un tableau : c'est du texte posé à des coordonnées. On le reconstruit
        // en lignes et colonnes ici, une seule fois, avant que le moteur de détection habituel
        // s'en occupe comme d'un tableur.
        if (found.id === "PDF") {
          const { extraireElementsTexte } = await import("@/lib/pdf/extraire-texte");
          const { elementsVersLignes } = await import("@/lib/calendar/pdf-lignes");
          const { clubsCandidats, ressembleAUnCalendrierDePoule, lireCalendrierDePoule } = await import(
            "@/lib/calendar/pdf-poule"
          );
          lignesPdfRef.current = elementsVersLignes(await extraireElementsTexte(bytes));
          if (ressembleAUnCalendrierDePoule(lignesPdfRef.current) && !lireCalendrierDePoule(lignesPdfRef.current).club) {
            setClubsPdf(clubsCandidats(lignesPdfRef.current).slice(0, 12));
          }
        }

        // .xlsx : on inspecte pour pouvoir MONTRER quelles colonnes ont été reconnues, puis on
        // parse avec ce qui a été détecté. L'écran de mapping n'apparaît que si ça échoue.
        let detectedMapping: TabularMapping | undefined;
        if (found.inspect) {
          const found_inspection = await found.inspect({
            fileName: file.name,
            bytes,
            teams,
            options: lignesPdfRef.current ? { lignes: lignesPdfRef.current } : undefined,
          });
          const detection = detectXlsxLayout(found_inspection, teams);
          setInspection(found_inspection);
          setLayout(detection.layout);
          detectedMapping = layoutToMapping(detection.layout, detection.sheetIndex);
          setMapping(detectedMapping);
        }

        await runParse(found, { text, bytes, name: file.name }, detectedMapping);
        setStep("review");
      } catch (error) {
        setFatalError(error instanceof Error ? error.message : "Fichier illisible.");
      } finally {
        setBusy(false);
      }
    },
    [runParse, teams],
  );

  /**
   * Lecture depuis une adresse d'abonnement. Le fetch passe par une route serveur : aucun serveur
   * de fédération n'envoie d'en-tête CORS, le navigateur ne peut donc pas y aller lui-même. Une
   * fois le texte récupéré, tout se passe comme pour un fichier déposé — même moteur, même
   * preview, même validation avant écriture.
   */
  const handleUrl = useCallback(
    async (rawUrl: string) => {
      const url = normalizeCalendarUrl(rawUrl);
      if (!url) return;
      const icsProvider = getProvider("ICS");
      if (!icsProvider) return;

      setFatalError(null);
      setResult(null);
      setBusy(true);
      try {
        const response = await fetch("/clubplus/api/calendar/fetch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url }),
        });
        const payload = (await response.json()) as { text?: string; error?: string };
        if (!response.ok || !payload.text) {
          setFatalError(payload.error ?? "Impossible de récupérer ce calendrier.");
          return;
        }

        setFileName(new URL(url).hostname);
        setFileBytes(null);
        setFileText(payload.text);
        setProvider(icsProvider);
        setInspection(null);
        setLayout(null);
        setMapping(null);
        setTeamIdByLine({});
        setExcludedLines([]);
        setIncludedLines([]);
        setAdjustOpen(false);
        setUrlUsed(url);

        setParsed(await icsProvider.parse({ fileName: url, text: payload.text, teams }));
        setStep("review");
      } catch {
        setFatalError("Impossible de récupérer ce calendrier.");
      } finally {
        setBusy(false);
      }
    },
    [teams],
  );

  async function applyMappingChange(next: TabularMapping) {
    if (!provider) return;
    setMapping(next);
    setBusy(true);
    try {
      await runParse(provider, { text: fileText, bytes: fileBytes, name: fileName }, next);
    } catch (error) {
      setFatalError(error instanceof Error ? error.message : "Lecture impossible avec ces colonnes.");
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
      const applied = await applyCalendarImport(supabase, { clubId, saisonId, provider: provider.id, rows: preview.rows });
      setResult(applied);

      // L'adresse n'est mémorisée qu'une fois l'import réellement abouti : une URL qui n'a jamais
      // rien produit n'a rien à faire dans la configuration du club, et surtout pas dans la tâche
      // nocturne.
      if (urlUsed) await saveCalendarSourceUrl(supabase, { clubId, saisonId, provider: provider.id, url: urlUsed, userId: userId ?? null });

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

  const attentionRows = preview?.rows.filter((r) => NEEDS_ATTENTION.includes(r.verdict)) ?? [];
  const readyRows = preview?.rows.filter((r) => !NEEDS_ATTENTION.includes(r.verdict)) ?? [];
  const saisonLabel = saisons.find((s) => s.id === saisonId)?.label ?? "aucune";
  const headerCells = inspection?.sheets[mapping?.sheetIndex ?? 0]?.rows[layout?.headerRow ?? -1] ?? [];

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label="Importer un calendrier"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(7,10,23,.65)] p-4"
    >
      <Card className="animate-svfade relative flex max-h-[88vh] w-full max-w-[720px] flex-col gap-4 overflow-y-auto rounded-sv-modal p-6 shadow-sv-modal">
        <button
          aria-label="Fermer"
          onClick={onClose}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-text-faint hover:bg-surface-sunken hover:text-text"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>

        <h2 className="text-[19px] font-extrabold tracking-tight">Importer un calendrier</h2>

        {fatalError && (
          <p className="flex items-start gap-2 rounded-lg bg-[rgba(239,91,103,.1)] px-3 py-2.5 text-[12.5px] font-bold text-danger-fg">
            <AlertTriangle className="mt-[1px] h-4 w-4 flex-none" aria-hidden />
            {fatalError}
          </p>
        )}

        {step === "source" && (
          <>
            {/* Adresse déjà enregistrée : c'est le chemin le plus court, il passe donc en premier.
                Un club qui a fait ça une fois ne cherche plus jamais de fichier. */}
            {savedSource?.sourceUrl && (
              <div className="flex flex-col gap-2 rounded-xl border border-brand-blue-pale bg-[rgba(36,84,255,.05)] px-4 py-3.5">
                <div className="flex items-center gap-2 text-[12.5px] font-bold text-text">
                  <Link2 className="h-4 w-4 flex-none text-brand-blue-electric" aria-hidden />
                  Calendrier abonné : {safeHost(savedSource.sourceUrl)}
                </div>
                <p className="text-[11.5px] text-text-faint">
                  {savedSource.lastSyncAt
                    ? `Dernière synchronisation le ${new Date(savedSource.lastSyncAt).toLocaleString("fr-FR", {
                        day: "numeric",
                        month: "long",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}.`
                    : "Jamais synchronisé pour l'instant."}{" "}
                  La mise à jour se fait aussi toute seule chaque nuit.
                </p>
                <Button variant="primary" disabled={busy} onClick={() => handleUrl(savedSource.sourceUrl!)}>
                  <RefreshCw className="h-4 w-4" aria-hidden />
                  {busy ? "Récupération…" : "Synchroniser maintenant"}
                </Button>
              </div>
            )}

            <p className="text-[12.5px] leading-relaxed text-text-soft">
              {savedSource?.sourceUrl
                ? "Ou repartez d'un fichier, ou changez d'adresse d'abonnement."
                : "Deux façons de faire. La plus simple est de coller l'adresse d'abonnement de votre calendrier : elle se met à jour toute seule ensuite, vous n'aurez plus rien à faire."}
            </p>

            <div className="flex flex-col gap-2">
              <label className="text-[11px] font-bold uppercase tracking-[.04em] text-text-faint" htmlFor="calendar-url">
                Adresse d&apos;abonnement (.ics)
              </label>
              <div className="flex flex-wrap gap-2">
                <input
                  id="calendar-url"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && urlInput.trim()) {
                      e.preventDefault();
                      void handleUrl(urlInput);
                    }
                  }}
                  placeholder="https://… ou webcal://…"
                  inputMode="url"
                  className="h-11 min-w-[220px] flex-1 rounded-lg border border-border-strong bg-input-bg px-3 text-[12.5px] font-semibold outline-none focus-visible:border-brand-blue"
                />
                <Button variant="secondary" disabled={busy || !urlInput.trim()} onClick={() => handleUrl(urlInput)}>
                  {busy ? "Récupération…" : "Récupérer"}
                </Button>
              </div>
              <p className="text-[11px] leading-relaxed text-text-faint">
                Sur le site de votre fédération ou de votre club, cherchez « S&apos;abonner au calendrier », « Exporter
                vers mon agenda » ou une icône d&apos;agenda, puis copiez le lien. Aucun mot de passe ne vous sera
                jamais demandé.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-divider" aria-hidden />
              <span className="text-[11px] font-bold uppercase tracking-[.04em] text-text-faint">ou</span>
              <span className="h-px flex-1 bg-divider" aria-hidden />
            </div>

            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border-strong px-6 py-8 text-center hover:border-brand-blue-pale">
              <Upload className="h-5 w-5 text-text-faint" aria-hidden />
              <span className="text-[13px] font-bold text-text">
                {busy ? "Lecture du fichier…" : "Déposer un fichier .pdf, .ics, .csv ou .xlsx"}
              </span>
              <span className="text-[11.5px] text-text-faint">
                On reconnaît les colonnes tout seuls et on vous montre ce qui va changer avant d&apos;écrire.
              </span>
              <input
                type="file"
                accept={CALENDAR_ACCEPT}
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
            </label>
          </>
        )}

        {step === "review" && preview && (
          <div className="flex flex-col gap-3.5">
            {/* Le document ne dit pas à quel club il s'adresse : c'est la seule chose qu'on ne
                peut pas déduire, et la seule qu'on demande. Les équipes des vraies poules sont
                proposées, la plus présente en tête. */}
            {clubsPdf.length > 0 && (
              <div className="flex flex-col gap-2 rounded-xl border border-border-strong p-3.5">
                <div className="text-[12.5px] font-bold text-text">De quel club est ce calendrier ?</div>
                <p className="text-[11.5px] text-text-soft">
                  Ce document liste toute la poule et ne nomme aucun club. Choisissez le vôtre : les matchs
                  des autres clubs seront ignorés.
                </p>
                <div className="flex flex-wrap gap-2">
                  {clubsPdf.map((nom) => (
                    <Button
                      key={nom}
                      variant={clubPdf === nom ? "primary" : "secondary"}
                      className="h-8 px-3 text-[12px]"
                      disabled={busy}
                      onClick={async () => {
                        setClubPdf(nom);
                        clubPdfRef.current = nom;
                        setBusy(true);
                        setFatalError(null);
                        try {
                          if (provider) await runParse(provider, { text: fileText, bytes: fileBytes, name: fileName }, mapping ?? undefined);
                        } catch (error) {
                          setFatalError(error instanceof Error ? error.message : "Lecture impossible pour ce club.");
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      {nom}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* Zéro match lu n'est pas un succès : annoncer « Tout est prêt » sur un fichier dont
                rien n'a été tiré est faux, et c'est ce que l'écran affichait (constaté le
                08/09/2026 sur un vrai calendrier de district). */}
            <p className="text-[14px] font-extrabold leading-relaxed text-text">
              {preview.rows.length === 0 ? (
                <span className="text-[#B45309]">Aucun match n&apos;a pu être lu dans ce fichier.</span>
              ) : (
                <>
                  {preview.rows.length} match{preview.rows.length > 1 ? "s" : ""} lu{preview.rows.length > 1 ? "s" : ""}.{" "}
                  {attentionRows.length === 0 ? (
                    <span className="text-success-fg">Tout est prêt.</span>
                  ) : (
                    <span className="text-[#B45309]">
                      {attentionRows.length} demande{attentionRows.length > 1 ? "nt" : ""} votre avis.
                    </span>
                  )}
                </>
              )}
            </p>

            {/* Ce qui a été déduit, en une ligne. Visible mais jamais bloquant. */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-text-faint">
              <span>{fileName}</span>
              <span aria-hidden>·</span>
              <span>Saison {saisonLabel}</span>
              {defaultTeamId && (
                <>
                  <span aria-hidden>·</span>
                  <span>Équipe {teams.find((t) => t.id === defaultTeamId)?.name}</span>
                </>
              )}
              <button type="button" onClick={() => setAdjustOpen((v) => !v)} className={LINK_CLASS}>
                {adjustOpen ? "masquer" : "ajuster"}
              </button>
            </div>

            {adjustOpen && (
              <div className="flex flex-col gap-3 rounded-lg border border-divider px-3 py-3">
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

                {layout && mapping && (
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-text-soft">
                      <Check className="h-3.5 w-3.5 flex-none text-success-fg" aria-hidden />
                      <span>
                        Colonnes reconnues :{" "}
                        {layout.detected
                          .filter((d) => d.field === "date" || d.field === "opponent" || d.field === "time" || d.field === "team")
                          .map((d) => `${TABULAR_FIELD_LABELS[d.field]} = « ${d.header || `colonne ${d.index + 1}`} »`)
                          .join(", ")}
                      </span>
                      <button type="button" onClick={() => setColumnsOpen((v) => !v)} className={LINK_CLASS}>
                        {columnsOpen ? "masquer" : "corriger"}
                      </button>
                    </div>

                    {columnsOpen && (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {inspection && inspection.sheets.length > 1 && (
                          <Field label="Feuille">
                            <select
                              value={mapping.sheetIndex}
                              onChange={(e) => {
                                const sheetIndex = Number(e.target.value);
                                void applyMappingChange({ ...mapping, sheetIndex });
                              }}
                              className={SELECT_CLASS}
                            >
                              {inspection.sheets.map((sheet) => (
                                <option key={sheet.index} value={sheet.index}>
                                  {sheet.name} ({sheet.rowCount} lignes)
                                </option>
                              ))}
                            </select>
                          </Field>
                        )}
                        {TABULAR_FIELDS.map((field) => (
                          <Field key={field} label={TABULAR_FIELD_LABELS[field]}>
                            <select
                              value={mapping.columns[field] ?? ""}
                              onChange={(e) => {
                                const columns = { ...mapping.columns };
                                if (e.target.value === "") delete columns[field as TabularField];
                                else columns[field as TabularField] = Number(e.target.value);
                                void applyMappingChange({ ...mapping, columns });
                              }}
                              className={SELECT_CLASS}
                            >
                              <option value="">— non utilisée —</option>
                              {headerCells.map((header, index) => (
                                <option key={index} value={index}>
                                  {header || `Colonne ${index + 1}`}
                                </option>
                              ))}
                            </select>
                          </Field>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {attentionRows.length > 0 && (
              <div className="flex max-h-[34vh] flex-col gap-2 overflow-y-auto">
                {attentionRows.map((row) => (
                  <AttentionRow key={row.key} row={row} teams={teams} onTeam={(id) => setTeamIdByLine((p) => ({ ...p, [row.key]: id }))} />
                ))}
              </div>
            )}

            {preview.issues.length > 0 && (
              <details className="rounded-lg border border-[rgba(239,91,103,.35)] px-3 py-2.5">
                <summary className="cursor-pointer text-[12px] font-extrabold text-danger-fg">
                  {preview.issues.length} ligne{preview.issues.length > 1 ? "s" : ""} non lue
                  {preview.issues.length > 1 ? "s" : ""} — le reste du fichier reste importable
                </summary>
                <ul className="mt-1.5 flex flex-col gap-1">
                  {preview.issues.slice(0, 20).map((issue, index) => (
                    <li key={index} className="text-[11.5px] leading-relaxed text-text-soft">
                      <span className="font-bold">Ligne {issue.line}</span> — {issue.reason}
                    </li>
                  ))}
                  {preview.issues.length > 20 && (
                    <li className="text-[11.5px] text-text-faint">… et {preview.issues.length - 20} autre(s).</li>
                  )}
                </ul>
              </details>
            )}

            {readyRows.length > 0 && (
              <details className="rounded-lg border border-divider px-3 py-2.5">
                <summary className="cursor-pointer text-[12px] font-bold text-text-soft">
                  Voir le détail des {readyRows.length} ligne{readyRows.length > 1 ? "s" : ""} ({preview.counts.new} nouvelle
                  {preview.counts.new > 1 ? "s" : ""}, {preview.counts.updated} modifiée{preview.counts.updated > 1 ? "s" : ""},{" "}
                  {preview.counts.unchanged} inchangée{preview.counts.unchanged > 1 ? "s" : ""})
                </summary>
                <div className="mt-2 flex max-h-[30vh] flex-col gap-1.5 overflow-y-auto">
                  {readyRows.map((row) => (
                    <div key={row.key} className="flex flex-wrap items-center gap-2 border-b border-divider pb-1.5 last:border-0">
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
                      <span className="w-[100px] flex-none text-[11.5px] font-semibold text-text-soft">
                        {row.source.matchDate}
                        {row.source.kickoffTime ? ` · ${row.source.kickoffTime}` : ""}
                      </span>
                      <span className="min-w-[110px] flex-1 text-[12px] font-bold text-text">{row.source.opponent}</span>
                      <span className="text-[11px] text-text-faint">{row.teamName ?? ""}</span>
                      {row.changes.length > 0 && (
                        <span className="w-full text-[11px] text-text-faint">
                          {row.changes
                            .map((c) => `${CHANGED_FIELD_LABELS[c.field]} : ${c.before ?? "—"} → ${c.after ?? "—"}`)
                            .join(" · ")}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </details>
            )}

            {!saisonId && (
              <p className="text-[12px] font-bold text-danger-fg">
                Aucune saison sélectionnée : un match importé sans saison ne remonterait dans aucun bilan de saison.
              </p>
            )}

            <Button variant="primary" disabled={busy || !saisonId || preview.selectedCount === 0} onClick={submit}>
              {busy ? "Import…" : `Importer ${preview.selectedCount} match${preview.selectedCount > 1 ? "s" : ""}`}
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

/** Une ligne qui demande une décision : on montre pourquoi, et on met le choix juste à côté. */
function AttentionRow({
  row,
  teams,
  onTeam,
}: {
  row: PreviewRow;
  teams: ClubTeamRef[];
  onTeam: (teamId: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[rgba(245,158,11,.4)] bg-[rgba(245,158,11,.06)] px-3 py-2.5">
      <span className="w-[100px] flex-none text-[12px] font-semibold text-text-soft">
        {row.source.matchDate}
        {row.source.kickoffTime ? ` · ${row.source.kickoffTime}` : ""}
      </span>
      <span className="min-w-[110px] flex-1 text-[12.5px] font-bold text-text">{row.source.opponent}</span>
      <select value={row.teamId ?? ""} onChange={(e) => onTeam(e.target.value)} aria-label="Équipe" className={SELECT_CLASS}>
        <option value="">Choisir l&apos;équipe…</option>
        {teams.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <p className="w-full text-[11.5px] leading-relaxed text-text-faint">
        {row.source.sportStatus && row.source.sportStatus !== "scheduled" && (
          <span className="mr-2 font-bold text-[#B45309]">{SPORT_STATUS_LABELS[row.source.sportStatus]}</span>
        )}
        {row.reason}
      </p>
    </div>
  );
}

/** Affiche le domaine d'une URL sans faire planter l'écran si elle est malformée. */
function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-bold uppercase tracking-[.04em] text-text-faint">{label}</span>
      {children}
    </label>
  );
}
