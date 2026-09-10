"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Check, Film, Mic, MoreHorizontal, Search, Video, X } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CalendarEvent, CalendarEventKind } from "@/lib/types/calendar";
import { CALENDAR_EVENT_KIND_LABELS } from "@/lib/types/calendar";
import { fetchClubCalendarEvents } from "@/lib/data/club/calendar";
import {
  createCoverageWishes,
  COVERAGE_TYPE_LABELS,
  COVERAGE_PRIORITY_LABELS,
  type CoverageType,
  type CoveragePriority,
} from "@/lib/data/club/coverageWishes";
import {
  FILTRES_RAPIDES,
  filtrerEvenements,
  grouperParJour,
  heure,
  libelleSelection,
  type FiltreRapide,
} from "@/lib/presences/demande";
import { Button } from "@/components/ui/Button";
import { useModalA11y } from "@/lib/useModalA11y";
import { useFermetureEchap } from "@/lib/use-fermeture-echap";

// Interface Club+ du souhait de présence (§26-33, priorité remontée par Fouka en post-audit
// 05/09/2026 — le backend E24/E25 existait depuis 4 jours sans aucun écran). Un souhait n'est
// jamais une mission : SELECTED côté CM crée une vraie planned_presences plus tard, cette modale
// ne fait qu'appeler create_coverage_wishes (bulk, idempotent par événement).
//
// Refonte du 10/09/2026, au premier usage réel (« la demande de présence est mal agencée ») :
// trois défilements imbriqués, une liste brute, le bouton d'envoi perdu tout en bas. Désormais :
// en-tête fixe, UN seul défilement, pied fixe qui récapitule et envoie ; filtres rapides,
// recherche et sélection par journée. Deux usages, une seule modale :
//   • demande groupée depuis Présences (liste à cocher) ;
//   • demande sur UN événement depuis le calendrier (`evenement` fourni : pas de liste).

/** Un événement déjà choisi, quand la demande part du calendrier. */
export interface EvenementDemande {
  matchId?: string;
  calendarEventId?: string;
  titre: string;
  startsAt: string;
  allDay?: boolean;
  kind?: CalendarEventKind;
  teamName?: string;
  location?: string;
}

interface RequestPresenceModalProps {
  supabase: SupabaseClient;
  clubId: string;
  onClose: () => void;
  onSubmitted: () => void;
  evenement?: EvenementDemande;
}

const COVERAGE_TYPES: { id: CoverageType; icone: typeof Camera }[] = [
  { id: "photo", icone: Camera },
  { id: "video", icone: Video },
  { id: "photo_video", icone: Film },
  { id: "interview", icone: Mic },
  { id: "autre", icone: MoreHorizontal },
];
const PRIORITIES: { id: CoveragePriority; aide: string }[] = [
  { id: "normale", aide: "SportVision la traite dans l'ordre habituel." },
  { id: "forte", aide: "Un temps fort à ne pas manquer." },
  { id: "optionnelle", aide: "Seulement si SportVision est disponible." },
];
// 20 d'abord : un club peut avoir des centaines d'événements à venir (375 à Villemomble le
// 10/09), et le type de couverture ne doit pas se retrouver sous soixante lignes.
const PAR_PAGE = 20;

function parseEventRef(id: string): { matchId?: string; calendarEventId?: string } {
  if (id.startsWith("match-")) return { matchId: id.slice(6) };
  if (id.startsWith("event-")) return { calendarEventId: id.slice(6) };
  return {};
}

function dateCourte(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
}

function Badge({ kind }: { kind?: CalendarEventKind }) {
  if (!kind) return null;
  const ton = kind === "match" ? "bg-info-bg text-info-fg" : "bg-neutral-bg text-neutral-fg";
  return (
    <span className={`flex-none rounded-full px-2 py-0.5 text-[11px] font-bold ${ton}`}>
      {CALENDAR_EVENT_KIND_LABELS[kind]}
    </span>
  );
}

/** Heure, équipe (si le titre ne la dit pas déjà) et lieu, sur une ligne. */
function Details({ titre, startsAt, allDay, teamName, location, avecDate }: {
  titre: string; startsAt: string; allDay?: boolean; teamName?: string; location?: string; avecDate?: boolean;
}) {
  const h = heure({ startsAt, allDay: allDay ?? false });
  const parts = [
    avecDate ? dateCourte(startsAt) : null,
    h,
    teamName && !titre.toLowerCase().includes(teamName.toLowerCase()) ? teamName : null,
    location,
  ].filter(Boolean);
  if (!parts.length) return null;
  return <span className="block truncate text-[12px] text-text-soft">{parts.join(" · ")}</span>;
}

function CaseACocher({ coche }: { coche: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex h-5 w-5 flex-none items-center justify-center rounded-md border-2 transition-colors ${
        coche ? "border-brand-blue bg-brand-blue text-white" : "border-border-strong bg-surface"
      }`}
    >
      {coche && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
    </span>
  );
}

function Section({ titre, aside, children }: { titre: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[13px] font-extrabold uppercase tracking-[.06em] text-text-soft">{titre}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function RequestPresenceModal({ supabase, clubId, onClose, onSubmitted, evenement }: RequestPresenceModalProps) {
  // Echap ferme la fenetre (audit du 10/09/2026 : aucune modale ne le faisait).
  useFermetureEchap(true, onClose);
  const unique = Boolean(evenement);
  const [events, setEvents] = useState<CalendarEvent[] | null>(unique ? [] : null);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filtre, setFiltre] = useState<FiltreRapide>("tous");
  const [recherche, setRecherche] = useState("");
  const [limite, setLimite] = useState(PAR_PAGE);
  const [coverageType, setCoverageType] = useState<CoverageType>("photo_video");
  const [priority, setPriority] = useState<CoveragePriority>("normale");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useModalA11y(containerRef, onClose);

  // La page derrière ne défile plus : un seul défilement, celui de la modale.
  useEffect(() => {
    const avant = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = avant;
    };
  }, []);

  useEffect(() => {
    if (unique) return;
    fetchClubCalendarEvents(supabase, clubId)
      .then(setEvents)
      .catch(() => {
        setLoadError(true);
        setEvents([]);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubId, unique]);

  const maintenant = useMemo(() => new Date(), []);
  const upcoming = useMemo(() => {
    const seuil = maintenant.getTime() - 24 * 60 * 60 * 1000;
    return (events ?? [])
      .filter((e) => new Date(e.startsAt).getTime() >= seuil)
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  }, [events, maintenant]);
  const visibles = useMemo(
    () => filtrerEvenements(upcoming, filtre, recherche, maintenant),
    [upcoming, filtre, recherche, maintenant],
  );
  const journees = useMemo(() => grouperParJour(visibles.slice(0, limite), maintenant), [visibles, limite, maintenant]);

  useEffect(() => setLimite(PAR_PAGE), [filtre, recherche]);

  const nbChoisis = unique ? 1 : selected.size;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function basculerJournee(ids: string[]) {
    setSelected((prev) => {
      const next = new Set(prev);
      const toutes = ids.every((id) => next.has(id));
      for (const id of ids) {
        if (toutes) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  async function handleSubmit() {
    if (nbChoisis === 0) return;
    setSubmitting(true);
    setError(null);
    const commun = { coverageType, priority, note: note.trim() || undefined };
    const items = evenement
      ? [{ matchId: evenement.matchId, calendarEventId: evenement.calendarEventId, ...commun }]
      : Array.from(selected).map((id) => ({ ...parseEventRef(id), ...commun }));
    try {
      await createCoverageWishes(supabase, clubId, items);
      setDone(true);
      onSubmitted();
    } catch (e) {
      const message = (e as { message?: string } | null)?.message ?? "";
      setError(
        /offre/i.test(message)
          ? message
          : "Impossible d'envoyer votre demande pour le moment. Réessayez.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const recap = `${COVERAGE_TYPE_LABELS[coverageType]} · Priorité ${COVERAGE_PRIORITY_LABELS[priority].toLowerCase()}`;

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="demande-presence-titre"
      className="fixed inset-0 z-[100] flex items-end justify-center bg-[rgba(7,10,23,.65)] sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="animate-svfade flex h-[100dvh] w-full flex-col overflow-hidden bg-surface shadow-sv-modal sm:h-auto sm:max-h-[88vh] sm:max-w-[640px] sm:rounded-sv-modal">
        {/* ── En-tête fixe ── */}
        <header className="flex flex-none items-start gap-3 border-b border-border px-5 pb-4 pt-5 sm:px-6">
          <div className="min-w-0 flex-1">
            <h2 id="demande-presence-titre" className="text-[19px] font-extrabold tracking-tight text-text">
              {done ? "Demande envoyée" : "Demander une présence SportVision"}
            </h2>
            {!done && (
              <p className="mt-1 text-[13px] leading-snug text-text-soft">
                {unique
                  ? "Choisissez le type de présence pour cet événement, puis envoyez la demande."
                  : "Sélectionnez les événements à couvrir, puis choisissez le type de présence."}
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label="Fermer"
            onClick={onClose}
            className="flex h-9 w-9 flex-none items-center justify-center rounded-full text-text-faint hover:bg-surface-sunken hover:text-text"
          >
            <X className="h-4.5 w-4.5" aria-hidden />
          </button>
        </header>

        {done ? (
          <>
            <div className="flex-1 overflow-y-auto px-5 py-6 sm:px-6">
              <p className="text-[14px] leading-relaxed text-text-soft">
                Votre demande a été transmise à SportVision. La présence n&apos;est pas encore confirmée : vous suivrez son
                avancement dans vos présences.
              </p>
            </div>
            <footer className="flex flex-none justify-end border-t border-border px-5 py-3.5 pb-[max(14px,env(safe-area-inset-bottom))] sm:px-6">
              <Button onClick={onClose} className="h-11 w-full sm:w-auto">
                Fermer
              </Button>
            </footer>
          </>
        ) : (
          <>
            {/* ── Le seul défilement ── */}
            <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
              <div className="flex flex-col gap-7">
                {evenement ? (
                  <Section titre="Événement">
                    <div className="flex items-center gap-3 rounded-xl border border-brand-blue bg-accent-bg px-4 py-3">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-bold text-text">{evenement.titre}</span>
                        <Details {...evenement} avecDate />
                      </span>
                      <Badge kind={evenement.kind} />
                    </div>
                  </Section>
                ) : (
                  <Section
                    titre="Événements"
                    aside={
                      <span className={`text-[12.5px] font-bold ${selected.size ? "text-accent-fg" : "text-text-faint"}`}>
                        {libelleSelection(selected.size)}
                      </span>
                    }
                  >
                    <div className="-mx-5 flex gap-1.5 overflow-x-auto px-5 pb-0.5 sm:mx-0 sm:flex-wrap sm:px-0">
                      {FILTRES_RAPIDES.map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          aria-pressed={filtre === f.id}
                          onClick={() => setFiltre(f.id)}
                          className={`h-9 flex-none rounded-full px-3.5 text-[13px] font-bold transition-colors ${
                            filtre === f.id
                              ? "bg-text text-surface"
                              : "border border-border-strong bg-surface text-text-soft hover:text-text"
                          }`}
                        >
                          {f.libelle}
                        </button>
                      ))}
                    </div>

                    <label className="relative block">
                      <span className="sr-only">Rechercher un événement</span>
                      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" aria-hidden />
                      <input
                        type="search"
                        value={recherche}
                        onChange={(e) => setRecherche(e.target.value)}
                        placeholder="Équipe, adversaire, lieu…"
                        className="h-11 w-full rounded-xl border border-border-strong bg-input-bg pl-10 pr-3.5 text-[14px] text-text outline-none placeholder:text-text-faint focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,84,255,.12)]"
                      />
                    </label>

                    {events === null ? (
                      <div className="rounded-xl bg-surface-sunken px-4 py-8 text-center text-[13px] text-text-faint">Chargement du calendrier…</div>
                    ) : loadError || upcoming.length === 0 ? (
                      <div className="rounded-xl bg-surface-sunken px-4 py-8 text-center text-[13px] text-text-faint">
                        {loadError ? "Impossible de charger le calendrier." : "Aucun événement à venir dans votre calendrier."}
                      </div>
                    ) : visibles.length === 0 ? (
                      <div className="flex flex-col items-center gap-2 rounded-xl bg-surface-sunken px-4 py-8 text-center text-[13px] text-text-faint">
                        Aucun événement ne correspond.
                        <button
                          type="button"
                          onClick={() => {
                            setFiltre("tous");
                            setRecherche("");
                          }}
                          className="font-bold text-accent-fg hover:underline"
                        >
                          Voir tous les événements
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] font-bold">
                          <button
                            type="button"
                            onClick={() => setSelected((prev) => new Set([...prev, ...visibles.map((e) => e.id)]))}
                            className="text-accent-fg hover:underline"
                          >
                            Tout sélectionner{visibles.length < upcoming.length ? ` (${visibles.length})` : ""}
                          </button>
                          {selected.size > 0 && (
                            <button type="button" onClick={() => setSelected(new Set())} className="text-text-soft hover:text-text hover:underline">
                              Tout désélectionner
                            </button>
                          )}
                        </div>

                        <div className="flex flex-col gap-4">
                          {journees.map((j) => {
                            const ids = j.evenements.map((e) => e.id);
                            const toutes = ids.every((id) => selected.has(id));
                            return (
                              <div key={j.cle} className="flex flex-col gap-1.5">
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-[12.5px] font-extrabold text-text">{j.libelle}</span>
                                  {ids.length > 1 && (
                                    <button
                                      type="button"
                                      onClick={() => basculerJournee(ids)}
                                      className="text-[12px] font-bold text-text-soft hover:text-accent-fg"
                                    >
                                      {toutes ? "Retirer la journée" : "Toute la journée"}
                                    </button>
                                  )}
                                </div>
                                {j.evenements.map((e) => {
                                  const coche = selected.has(e.id);
                                  return (
                                    <button
                                      key={e.id}
                                      type="button"
                                      role="checkbox"
                                      aria-checked={coche}
                                      onClick={() => toggle(e.id)}
                                      className={`flex min-h-[56px] w-full items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors ${
                                        coche ? "border-brand-blue bg-accent-bg" : "border-border hover:border-border-strong hover:bg-row-hover"
                                      }`}
                                    >
                                      <CaseACocher coche={coche} />
                                      <span className="min-w-0 flex-1">
                                        <span className="block truncate text-[14px] font-semibold text-text">{e.title}</span>
                                        <Details titre={e.title} startsAt={e.startsAt} allDay={e.allDay} teamName={e.teamName} location={e.location} />
                                      </span>
                                      <Badge kind={e.kind} />
                                    </button>
                                  );
                                })}
                              </div>
                            );
                          })}
                        </div>

                        {visibles.length > limite && (
                          <button
                            type="button"
                            onClick={() => setLimite((l) => l + PAR_PAGE)}
                            className="h-10 rounded-xl border border-border-strong text-[13px] font-bold text-text-soft hover:text-text"
                          >
                            Afficher les événements suivants ({visibles.length - limite})
                          </button>
                        )}
                      </>
                    )}
                  </Section>
                )}

                <Section titre="Type de couverture">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {COVERAGE_TYPES.map(({ id, icone: Icone }) => {
                      const actif = coverageType === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          aria-pressed={actif}
                          onClick={() => setCoverageType(id)}
                          className={`flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-xl border-2 px-2 py-3 text-center transition-colors ${
                            id === "autre" ? "col-span-2 sm:col-span-1" : ""
                          } ${
                            actif
                              ? "border-brand-blue bg-accent-bg text-accent-fg"
                              : "border-border bg-surface text-text-soft hover:border-border-strong hover:text-text"
                          }`}
                        >
                          <Icone className="h-5 w-5" aria-hidden />
                          <span className="text-[12.5px] font-bold leading-tight">{COVERAGE_TYPE_LABELS[id]}</span>
                        </button>
                      );
                    })}
                  </div>
                </Section>

                <Section titre="Priorité">
                  <div className="flex w-full rounded-xl bg-surface-sunken p-1 sm:w-auto sm:self-start">
                    {PRIORITIES.map(({ id }) => (
                      <button
                        key={id}
                        type="button"
                        aria-pressed={priority === id}
                        onClick={() => setPriority(id)}
                        className={`h-10 flex-1 rounded-lg px-4 text-[13px] font-bold transition-colors sm:flex-none ${
                          priority === id ? "bg-surface text-text shadow-sv-card" : "text-text-soft hover:text-text"
                        }`}
                      >
                        {COVERAGE_PRIORITY_LABELS[id]}
                      </button>
                    ))}
                  </div>
                  <p className="text-[12px] text-text-faint">{PRIORITIES.find((p) => p.id === priority)?.aide}</p>
                </Section>

                <Section titre="Note (facultatif)">
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={3}
                    aria-label="Note pour SportVision"
                    placeholder="Contexte, besoin particulier, joueur à suivre, information utile…"
                    className="resize-none rounded-xl border border-border-strong bg-input-bg px-3.5 py-3 text-[14px] text-text outline-none placeholder:text-text-faint focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,84,255,.12)]"
                  />
                </Section>
              </div>
            </div>

            {/* ── Pied fixe : le récapitulatif et l'envoi, toujours visibles ── */}
            <footer className="flex flex-none flex-col gap-3 border-t border-border bg-surface px-5 py-3.5 pb-[max(14px,env(safe-area-inset-bottom))] sm:flex-row sm:items-center sm:px-6">
              <div className="min-w-0 flex-1">
                <span className={`block truncate text-[13.5px] font-extrabold ${nbChoisis ? "text-text" : "text-text-faint"}`}>
                  {unique ? evenement?.titre : libelleSelection(nbChoisis)}
                </span>
                <span className="block truncate text-[12.5px] text-text-soft">{recap}</span>
                {error && <span className="mt-1 block text-[12.5px] font-bold text-danger-fg">{error}</span>}
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={onClose} className="h-11 flex-1 sm:flex-none">
                  Annuler
                </Button>
                <Button
                  disabled={nbChoisis === 0 || submitting}
                  loading={submitting}
                  onClick={handleSubmit}
                  className="h-11 flex-[2] sm:flex-none"
                >
                  Envoyer la demande
                </Button>
              </div>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
