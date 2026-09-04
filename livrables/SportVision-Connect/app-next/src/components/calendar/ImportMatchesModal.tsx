"use client";

import { useEffect, useState } from "react";
import { X, Upload } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { fetchClubTeams } from "@/lib/data/club/teams";
import { importClubMatches } from "@/lib/data/club/matches";
import { parseIcsEvents, parseMatchesCsv, type ImportedMatchRow } from "@/lib/calendar-import";
import type { Team } from "@/lib/types/teams";

// Import calendrier (ICS export fédéral / CSV) — prompt #6 backlog Club+ V2. Preview éditable
// avant tout écrit en base, même discipline que l'import d'effectif CSV (roster-import.ts) :
// jamais un import silencieux, l'admin revoit chaque ligne (adversaire pré-rempli mais éditable,
// équipe à choisir explicitement — aucune détection auto d'équipe depuis un fichier externe).

interface EditableRow extends ImportedMatchRow {
  opponent: string;
  teamId: string;
  include: boolean;
}

export function ImportMatchesModal({ clubId, onClose, onImported }: { clubId: string; onClose: () => void; onImported: () => void }) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [rows, setRows] = useState<EditableRow[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ succeeded: number; skipped: number; failed: number } | null>(null);

  useEffect(() => {
    fetchClubTeams(createClient(), clubId).then(setTeams);
  }, [clubId]);

  function handleFile(file: File) {
    setParseError(null);
    setResult(null);
    file.text().then((text) => {
      const isIcs = file.name.toLowerCase().endsWith(".ics") || text.includes("BEGIN:VCALENDAR");
      const parsed = isIcs ? parseIcsEvents(text) : parseMatchesCsv(text);
      if (parsed.length === 0) {
        setParseError("Aucun événement reconnu dans ce fichier.");
        setRows(null);
        return;
      }
      setRows(
        parsed.map((r) => ({
          ...r,
          opponent: r.suggestedOpponent,
          teamId: teams[0]?.id ?? "",
          include: true,
        })),
      );
    });
  }

  function updateRow(index: number, patch: Partial<EditableRow>) {
    setRows((prev) => (prev ? prev.map((r, i) => (i === index ? { ...r, ...patch } : r)) : prev));
  }

  async function submit() {
    if (!rows) return;
    const toImport = rows.filter((r) => r.include && r.opponent.trim() && r.teamId);
    if (toImport.length === 0) return;
    setSubmitting(true);
    try {
      const supabase = createClient();
      const res = await importClubMatches(
        supabase,
        clubId,
        toImport.map((r) => ({
          teamId: r.teamId,
          teamName: teams.find((t) => t.id === r.teamId)?.name ?? "",
          opponent: r.opponent.trim(),
          matchDate: r.date,
          lieu: r.location,
        })),
      );
      setResult(res);
      if (res.succeeded > 0) onImported();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(7,10,23,.65)] p-4">
      <Card className="animate-svfade relative flex max-h-[85vh] w-full max-w-[640px] flex-col gap-4 overflow-y-auto rounded-sv-modal p-6 shadow-sv-modal">
        <button
          aria-label="Fermer"
          onClick={onClose}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-text-faint hover:bg-surface-sunken hover:text-text"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>

        <h2 className="text-[19px] font-extrabold tracking-tight">Importer un calendrier</h2>
        <p className="text-[12.5px] leading-relaxed text-text-soft">
          Fichier .ics (export depuis le site de votre fédération) ou .csv (colonnes adversaire/date, heure et lieu
          optionnels). Chaque ligne reste modifiable avant import — rien n&apos;est créé sans validation.
        </p>

        {rows === null ? (
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border-strong px-6 py-10 text-center hover:border-brand-blue-pale">
            <Upload className="h-5 w-5 text-text-faint" aria-hidden />
            <span className="text-[13px] font-bold text-text">Choisir un fichier .ics ou .csv</span>
            <input
              type="file"
              accept=".ics,.csv,text/calendar,text/csv"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
          </label>
        ) : (
          <div className="flex flex-col gap-2.5">
            {rows.map((r, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-divider px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={r.include}
                  onChange={(e) => updateRow(i, { include: e.target.checked })}
                  className="h-4 w-4"
                />
                <span className="w-24 flex-none text-[12px] font-semibold text-text-soft">
                  {r.date}
                  {r.time ? ` · ${r.time}` : ""}
                </span>
                <input
                  value={r.opponent}
                  onChange={(e) => updateRow(i, { opponent: e.target.value })}
                  placeholder="Adversaire"
                  className="h-9 min-w-[140px] flex-1 rounded-lg border border-border-strong bg-input-bg px-2.5 text-[12.5px] font-semibold outline-none focus-visible:border-brand-blue"
                />
                <select
                  value={r.teamId}
                  onChange={(e) => updateRow(i, { teamId: e.target.value })}
                  className="h-9 rounded-lg border border-border-strong bg-input-bg px-2.5 text-[12.5px] font-semibold outline-none focus-visible:border-brand-blue"
                >
                  <option value="">Équipe…</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}

        {parseError && <p className="text-[12.5px] font-bold text-danger-fg">{parseError}</p>}

        {result && (
          <p className="text-[12.5px] font-bold text-success-fg">
            {result.succeeded} match{result.succeeded > 1 ? "s" : ""} importé{result.succeeded > 1 ? "s" : ""}
            {result.skipped > 0 && ` · ${result.skipped} déjà existant${result.skipped > 1 ? "s" : ""}`}
            {result.failed > 0 && ` · ${result.failed} échec${result.failed > 1 ? "s" : ""}`}
          </p>
        )}

        {rows !== null && !result && (
          <Button
            variant="primary"
            disabled={submitting || rows.every((r) => !r.include || !r.opponent.trim() || !r.teamId)}
            onClick={submit}
          >
            {submitting ? "Import…" : `Importer ${rows.filter((r) => r.include).length} match(s)`}
          </Button>
        )}
        {result && <Button onClick={onClose}>Fermer</Button>}
      </Card>
    </div>
  );
}
