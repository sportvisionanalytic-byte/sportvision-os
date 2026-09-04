"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CalendarEvent } from "@/lib/types/calendar";
import { CALENDAR_EVENT_KIND_LABELS } from "@/lib/types/calendar";
import { fetchClubCalendarEvents } from "@/lib/data/club/calendar";
import {
  createCoverageWishes,
  COVERAGE_TYPE_LABELS,
  COVERAGE_PRIORITY_LABELS,
  type CoverageType,
  type CoveragePriority,
} from "@/lib/data/club/coverageWishes";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useModalA11y } from "@/lib/useModalA11y";

// Interface Club+ du souhait de présence (§26-33, priorité remontée par Fouka en post-audit
// 05/09/2026 — le backend E24/E25 existait depuis 4 jours sans aucun écran). Un souhait n'est
// jamais une mission : SELECTED côté CM crée une vraie planned_presences plus tard, cette modale
// ne fait qu'appeler create_coverage_wishes (bulk, idempotent par événement).
interface RequestPresenceModalProps {
  supabase: SupabaseClient;
  clubId: string;
  onClose: () => void;
  onSubmitted: () => void;
}

const COVERAGE_TYPES: CoverageType[] = ["photo", "video", "photo_video", "interview", "autre"];
const PRIORITIES: CoveragePriority[] = ["forte", "normale", "optionnelle"];

function parseEventRef(id: string): { matchId?: string; calendarEventId?: string } {
  if (id.startsWith("match-")) return { matchId: id.slice(6) };
  if (id.startsWith("event-")) return { calendarEventId: id.slice(6) };
  return {};
}

function formatEventDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
}

export function RequestPresenceModal({ supabase, clubId, onClose, onSubmitted }: RequestPresenceModalProps) {
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [coverageType, setCoverageType] = useState<CoverageType>("photo_video");
  const [priority, setPriority] = useState<CoveragePriority>("normale");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useModalA11y(containerRef, onClose);

  useEffect(() => {
    fetchClubCalendarEvents(supabase, clubId)
      .then(setEvents)
      .catch(() => {
        setLoadError(true);
        setEvents([]);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubId]);

  const upcoming = useMemo(() => {
    const now = Date.now();
    return (events ?? [])
      .filter((e) => new Date(e.startsAt).getTime() >= now - 24 * 60 * 60 * 1000)
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  }, [events]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit() {
    if (selected.size === 0) return;
    setSubmitting(true);
    setError(null);
    const items = Array.from(selected).map((id) => ({ ...parseEventRef(id), coverageType, priority, note: note.trim() || undefined }));
    try {
      await createCoverageWishes(supabase, clubId, items);
      setDone(true);
      onSubmitted();
    } catch {
      setError("Impossible d'envoyer votre demande pour le moment. Réessayez.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label="Demander une présence SportVision"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(7,10,23,.65)] p-4"
    >
      <Card className="animate-svfade relative flex max-h-[85vh] w-full max-w-[520px] flex-col gap-4 overflow-y-auto rounded-sv-modal p-6 shadow-sv-modal">
        <button
          aria-label="Fermer"
          onClick={onClose}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-text-faint hover:bg-surface-sunken hover:text-text"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>

        {done ? (
          <>
            <h2 className="text-[19px] font-extrabold tracking-tight">Demande envoyée</h2>
            <p className="text-[13.5px] leading-relaxed text-text-soft">
              Votre souhait a été transmis à SportVision. La présence n&apos;est pas encore confirmée — vous verrez son
              avancement dans la liste ci-dessous.
            </p>
            <div className="mt-1 flex justify-end">
              <Button onClick={onClose}>Fermer</Button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-[19px] font-extrabold tracking-tight">Demander une présence SportVision</h2>
            <p className="text-[12.5px] text-text-soft">
              Sélectionnez un ou plusieurs événements. SportVision étudiera votre demande et vous tiendra informé.
            </p>

            <div>
              <span className="mb-1.5 block text-[12.5px] font-bold text-text-soft">Événements</span>
              {events === null ? (
                <div className="rounded-xl border border-border-strong bg-surface-sunken px-3.5 py-6 text-center text-[13px] text-text-faint">
                  Chargement…
                </div>
              ) : loadError || upcoming.length === 0 ? (
                <div className="rounded-xl border border-border-strong bg-surface-sunken px-3.5 py-6 text-center text-[13px] text-text-faint">
                  {loadError ? "Impossible de charger le calendrier." : "Aucun événement à venir dans votre calendrier."}
                </div>
              ) : (
                <div className="flex max-h-[220px] flex-col gap-1.5 overflow-y-auto rounded-xl border border-border-strong p-2">
                  {upcoming.map((e) => (
                    <label
                      key={e.id}
                      className="flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 hover:bg-surface-sunken"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(e.id)}
                        onChange={() => toggle(e.id)}
                        className="h-4 w-4 accent-brand-blue-electric"
                      />
                      <span className="w-[70px] flex-none text-[12px] font-bold text-text-soft">{formatEventDate(e.startsAt)}</span>
                      <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-text">{e.title}</span>
                      <span className="flex-none text-[11px] text-text-faint">{CALENDAR_EVENT_KIND_LABELS[e.kind]}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div>
              <span className="mb-1.5 block text-[12.5px] font-bold text-text-soft">Type</span>
              <div className="flex flex-wrap gap-1.5">
                {COVERAGE_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setCoverageType(t)}
                    className={`rounded-full px-3 py-1.5 text-[12.5px] font-bold transition-colors ${
                      coverageType === t ? "bg-brand-blue-electric text-white" : "bg-surface-sunken text-text-soft"
                    }`}
                  >
                    {COVERAGE_TYPE_LABELS[t]}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className="mb-1.5 block text-[12.5px] font-bold text-text-soft">Priorité</span>
              <div className="flex flex-wrap gap-1.5">
                {PRIORITIES.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriority(p)}
                    className={`rounded-full px-3 py-1.5 text-[12.5px] font-bold transition-colors ${
                      priority === p ? "bg-brand-blue-electric text-white" : "bg-surface-sunken text-text-soft"
                    }`}
                  >
                    {COVERAGE_PRIORITY_LABELS[p]}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-bold text-text-soft">Note (facultatif)</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="Précision utile pour SportVision (contexte, attente particulière…)"
                className="resize-none rounded-xl border border-border-strong bg-input-bg px-3.5 py-2.5 text-[13.5px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,84,255,.12)]"
              />
            </label>

            {error && <p className="text-[12.5px] font-bold text-danger-fg">{error}</p>}

            <div className="mt-1 flex justify-end gap-2">
              <Button variant="secondary" onClick={onClose}>
                Annuler
              </Button>
              <Button disabled={selected.size === 0 || submitting} loading={submitting} onClick={handleSubmit}>
                {selected.size > 1 ? `Demander une présence (${selected.size} événements)` : "Demander une présence"}
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
