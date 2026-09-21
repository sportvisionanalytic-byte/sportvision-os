"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { AthleteRow } from "@/lib/supabase/particulier";
import { AddManualMatchForm } from "./AddManualMatchForm";
import { downloadIcsEvent } from "@/lib/ics";

export interface ParticulierEvent {
  id: string;
  title: string;
  type: string;
  date: string;
  time: string | null;
  location: string | null;
  team: string | null;
  athleteKey: string;
  athleteLabel: string;
  // 'club' = événement SportVision réel (club_calendar_events) · 'manual' = match saisi à la main
  // par un agent/accompagnant (connect_manual_calendar_events, droit "modifier" —
  // migration-connect-v57-abonnement-agent.sql §3). Le badge ci-dessous est la seule chose qui
  // distingue les deux : ne JAMAIS laisser croire qu'un match saisi à la main est un événement
  // SportVision officiel (consigne explicite du brief).
  source: "club" | "manual";
  /** « 3 - 1 », tel que le club l'a saisi. Absent tant que le match n'est pas joué (v243). */
  score?: string | null;
}

/** Le score décomposé, pour l'afficher en gros. Rend null si rien n'est saisi : un match à venir
 *  n'a pas de résultat, et « 0 - 0 » en inventerait un. */
export function scoreDecompose(ev: ParticulierEvent): { nous: string; eux: string } | null {
  if (!ev.score) return null;
  const m = String(ev.score).match(/(\d+)\s*[-–:]\s*(\d+)/);
  return m ? { nous: m[1]!, eux: m[2]! } : null;
}

const TYPE_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  match: { label: "Match", color: "#8CA9FF", bg: "rgba(79,125,255,.16)" },
  match_reporte: { label: "Match reporté", color: "#FBBF24", bg: "rgba(251,191,36,.14)" },
  match_annule: { label: "Match annulé", color: "#F472B6", bg: "rgba(244,114,182,.14)" },
  entrainement: { label: "Entraînement", color: "#C7C7DE", bg: "rgba(255,255,255,.08)" },
  shooting: { label: "Shooting", color: "#C084FC", bg: "rgba(168,85,247,.16)" },
  tournoi: { label: "Événement SportVision", color: "#22D3EE", bg: "rgba(34,211,238,.14)" },
};

function formatDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
}

// Vue "À venir" (README § Mobile : liste par défaut) — pas de grille mensuelle complète en V1
// pour l'Espace particulier (simplification documentée, cf. rapport final) : la liste couvre
// déjà le besoin réel (événements SportVision à venir, filtrables par sportif).
export function CalendrierParticulierView({
  events,
  athletes,
  initialSportif,
}: {
  events: ParticulierEvent[];
  athletes: AthleteRow[];
  initialSportif: string | null;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<string | null>(initialSportif);
  const [addingMatch, setAddingMatch] = useState(false);
  // BUGFIX (audit Espace particulier 30-31/08/2026) : contrairement à l'Espace joueur
  // ((joueur)/calendrier/CalendarView.tsx), cette page n'offrait aucun moyen d'exporter un
  // événement vers son propre calendrier (.ics) — les lignes n'étaient que des <div> sans aucun
  // clic possible. Le brief de mission liste explicitement "export calendrier" parmi les
  // fonctionnalités à tester pour l'Espace particulier. Réutilise lib/ics.ts (downloadIcsEvent),
  // déjà utilisé côté Espace joueur — aucune synchronisation, un simple fichier .ics local (voir
  // son en-tête, MASTER-CONNECT-V1 §22).
  const [selectedEvent, setSelectedEvent] = useState<ParticulierEvent | null>(null);

  const filterOptions = useMemo(
    () => [{ key: null, label: "Tous" }, ...athletes.filter((a) => a.rights.calendrier).map((a) => ({ key: `${a.kind}:${a.refId}`, label: `${a.firstName} ${a.lastName}`.trim() }))],
    [athletes],
  );

  // Sportifs pour lesquels l'ajout manuel de match est possible — droit "modifier"
  // (migration-connect-v57-abonnement-agent.sql §3, right_modifier, premier branchement réel de
  // ce droit). Un profil géré a toujours ce droit (rights.modifier = true par construction, cf.
  // connect_list_my_athletes()) ; un sportif lié doit l'avoir explicitement accordé.
  const modifiableAthletes = useMemo(() => athletes.filter((a) => a.rights.modifier), [athletes]);

  const today = new Date().toISOString().slice(0, 10);
  // 21/09/2026, Fouka : « qu'il puisse voir vraiment sous forme de calendrier, à la semaine, au
  // mois, bien étalé, voir les résultats ». La liste « à venir » était la seule vue, et elle
  // masquait tout le passé — donc tous les résultats. Le mois affiche la période entière,
  // matchs joués compris.
  const [vue, setVue] = useState<"liste" | "mois">("liste");
  const [moisCurseur, setMoisCurseur] = useState(() => new Date());

  const duSportif = events.filter((e) => !filter || e.athleteKey === filter);
  const visible = duSportif.filter((e) => e.date >= today).sort((a, b) => (a.date < b.date ? -1 : 1));

  return (
    <div className="flex flex-col gap-6 animate-sv-in">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="font-sora text-[27px] font-bold tracking-tight lg:text-[33px]">Calendrier</h1>
          <p className="max-w-[560px] text-[15px] text-text-tertiary">Les événements SportVision à venir pour les sportifs que vous accompagnez.</p>
        </div>
        {/* Jamais un bouton décoratif : n'apparaît que si au moins un sportif accorde réellement
            le droit "modifier" — cf. le principe déjà établi ailleurs dans ce projet ("une
            fonction existe et fonctionne, ou elle n'est pas présentée"). */}
        {modifiableAthletes.length > 0 && (
          <button
            type="button"
            onClick={() => setAddingMatch((v) => !v)}
            className="flex h-[46px] flex-none items-center gap-2 rounded-sv border border-border-strong bg-white/[.06] px-[18px] font-sora text-[15px] font-semibold hover:bg-white/[.12]"
          >
            <span className="material-symbols-rounded !text-[20px]" aria-hidden="true">add</span>
            Ajouter un match
          </button>
        )}
      </div>

      {addingMatch && (
        <AddManualMatchForm
          athletes={modifiableAthletes}
          onDone={() => {
            setAddingMatch(false);
            router.refresh();
          }}
          onCancel={() => setAddingMatch(false)}
        />
      )}

      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {([{ k: "liste", l: "À venir" }, { k: "mois", l: "Mois" }] as const).map((t) => {
          const actif = vue === t.k;
          return (
            <button
              key={t.k}
              type="button"
              onClick={() => setVue(t.k)}
              className="flex-none rounded-sv-pill px-4 py-2.5 text-[14px] font-medium transition-colors duration-150"
              style={{
                color: actif ? "#8CA9FF" : "#C7C7DE",
                background: actif ? "rgba(79,125,255,.16)" : "rgba(255,255,255,.05)",
                border: `1px solid ${actif ? "rgba(140,169,255,.4)" : "rgba(255,255,255,.09)"}`,
              }}
            >
              {t.l}
            </button>
          );
        })}
      </div>

      {athletes.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {filterOptions.map((f) => (
            <button
              key={f.key ?? "all"}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`rounded-sv-pill border px-3.5 py-2 text-[14px] font-medium transition-colors duration-150 lg:text-[13px] ${
                filter === f.key ? "border-[rgba(140,169,255,.65)] bg-[rgba(79,125,255,.2)] text-text" : "border-border text-text-tertiary hover:text-text"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {vue === "mois" ? (
        <VueMois
          events={duSportif}
          curseur={moisCurseur}
          onCurseur={setMoisCurseur}
          onSelect={setSelectedEvent}
        />
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-sv-card border border-dashed border-border-strong bg-surface p-8 text-center">
          <span className="material-symbols-rounded !text-[24px] text-text-tertiary" aria-hidden="true">event_busy</span>
          <span className="text-[14px] text-text-tertiary">Aucun événement SportVision prévu sur cette période.</span>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((event) => {
            const meta = TYPE_LABEL[event.type] || { label: "Événement", color: "#9A9AB8", bg: "rgba(255,255,255,.07)" };
            return (
              <button
                type="button"
                key={event.id}
                onClick={() => setSelectedEvent(event)}
                className="flex flex-wrap items-center gap-4 rounded-sv-card border border-border bg-surface p-[18px] text-left hover:bg-white/[.06]"
              >
                <div className="flex h-[54px] w-[54px] flex-none flex-col items-center justify-center rounded-sv" style={{ background: "linear-gradient(150deg,rgba(79,125,255,.3),rgba(34,211,238,.14))" }}>
                  <span className="font-sora text-[17px] font-bold leading-none">{new Date(`${event.date}T00:00:00`).getDate()}</span>
                  <span className="text-[10px] font-medium uppercase text-prestations">
                    {new Date(`${event.date}T00:00:00`).toLocaleDateString("fr-FR", { month: "short" })}
                  </span>
                </div>
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-sora text-[15.5px] font-semibold">{event.title}</span>
                    <span className="rounded-sv-pill px-2 py-0.5 text-[11px] font-medium" style={{ color: meta.color, background: meta.bg }}>
                      {meta.label}
                    </span>
                    {/* Jamais confondu avec un événement SportVision officiel — consigne
                        explicite du brief (migration-connect-v57 §3). */}
                    {event.source === "manual" && (
                      <span className="rounded-sv-pill bg-white/[.08] px-2 py-0.5 text-[11px] font-medium text-text-faint">
                        Ajouté manuellement
                      </span>
                    )}
                  </div>
                  <span className="text-[14px] text-text-tertiary lg:text-[13px]">
                    {formatDate(event.date)}
                    {event.time ? ` · ${event.time.slice(0, 5)}` : ""}
                    {event.location ? ` · ${event.location}` : ""}
                  </span>
                </div>
                <div className="ml-auto flex flex-none items-center gap-2.5">
                  {/* Le résultat, quand il existe (v243). C'est ce qu'un parent cherche en
                      rouvrant l'appli le lundi matin. */}
                  {scoreDecompose(event) && (
                    <span className="font-sora text-[18px] font-bold tabular-nums">
                      {scoreDecompose(event)!.nous}
                      <span className="mx-1 text-text-tertiary">–</span>
                      {scoreDecompose(event)!.eux}
                    </span>
                  )}
                  <span className="rounded-sv-pill bg-white/[.07] px-2.5 py-1 text-[11px] font-medium text-text-tertiary">
                    Pour {event.athleteLabel}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selectedEvent && <EventDetail event={selectedEvent} onClose={() => setSelectedEvent(null)} />}
    </div>
  );
}

function EventDetail({ event, onClose }: { event: ParticulierEvent; onClose: () => void }) {
  const meta = TYPE_LABEL[event.type] || { label: "Événement", color: "#9A9AB8", bg: "rgba(255,255,255,.07)" };
  const facts: { icon: string; label: string; value: string }[] = [
    { icon: "calendar_today", label: "Date", value: formatDate(event.date) },
  ];
  if (event.time) facts.push({ icon: "schedule", label: "Horaire", value: event.time.slice(0, 5) });
  if (event.location) facts.push({ icon: "location_on", label: "Lieu", value: event.location });
  if (event.team) facts.push({ icon: "groups", label: "Équipe", value: event.team });
  facts.push({ icon: "person", label: "Pour", value: event.athleteLabel });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/66 p-4 sm:p-6" onClick={onClose}>
      <div
        className="flex w-full max-w-[520px] max-h-[85vh] flex-col gap-5 overflow-y-auto rounded-sv-modal border border-border bg-bg-elevated p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span className="rounded-sv-pill px-2.5 py-1 text-[11px] font-medium" style={{ color: meta.color, background: meta.bg }}>
            {meta.label}
          </span>
          <button type="button" onClick={onClose} className="ml-auto flex h-10 w-10 items-center justify-center rounded-sv bg-white/[.06] hover:bg-white/[.12]">
            <span className="material-symbols-rounded !text-[19px]" aria-hidden="true">close</span>
          </button>
        </div>
        <h2 className="font-sora text-[22px] font-bold tracking-tight">{event.title}</h2>
        <div className="flex flex-col gap-3">
          {facts.map((f) => (
            <div key={f.label} className="flex items-center gap-3">
              <span className="flex h-9 w-9 flex-none items-center justify-center rounded-sv bg-white/[.06]">
                <span className="material-symbols-rounded !text-[18px] text-prestations" aria-hidden="true">{f.icon}</span>
              </span>
              <div className="flex flex-col gap-0.5">
                <span className="text-[11px] text-text-faint">{f.label}</span>
                <span className="text-[14px] font-medium">{f.value}</span>
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() =>
            downloadIcsEvent({
              uid: event.id,
              title: event.title,
              date: event.date,
              time: event.time,
              location: event.location,
              description: `SportVision · Pour ${event.athleteLabel}`,
            })
          }
          className="flex h-[50px] items-center justify-center gap-2 self-start rounded-sv border border-border-strong bg-surface px-5 font-sora text-[15px] font-semibold hover:bg-surface-hover"
        >
          <span className="material-symbols-rounded !text-[19px]" aria-hidden="true">event</span>
          Ajouter à mon calendrier
        </button>
      </div>
    </div>
  );
}

/** La grille du mois : chaque case porte ses événements, et le résultat d'un match joué s'y lit
 *  directement. Volontairement sobre — c'est un calendrier de famille consulté sur un téléphone,
 *  pas un outil de planification. */
function VueMois({
  events,
  curseur,
  onCurseur,
  onSelect,
}: {
  events: ParticulierEvent[];
  curseur: Date;
  onCurseur: (d: Date) => void;
  onSelect: (e: ParticulierEvent) => void;
}) {
  const annee = curseur.getFullYear();
  const mois = curseur.getMonth();
  const premier = new Date(annee, mois, 1);
  // Lundi en premier jour, comme partout en France.
  const decalage = (premier.getDay() + 6) % 7;
  const debut = new Date(annee, mois, 1 - decalage);
  const cases = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(debut);
    d.setDate(d.getDate() + i);
    return d;
  });
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const parJour = new Map<string, ParticulierEvent[]>();
  for (const e of events) parJour.set(e.date, [...(parJour.get(e.date) ?? []), e]);
  const aujourdhui = iso(new Date());

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => onCurseur(new Date(annee, mois - 1, 1))}
          className="rounded-sv border border-border px-3 py-2 text-[13px] text-text-tertiary hover:text-text"
        >
          ← Mois précédent
        </button>
        <span className="font-sora text-[16px] font-semibold capitalize">
          {curseur.toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}
        </span>
        <button
          type="button"
          onClick={() => onCurseur(new Date(annee, mois + 1, 1))}
          className="rounded-sv border border-border px-3 py-2 text-[13px] text-text-tertiary hover:text-text"
        >
          Mois suivant →
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[10.5px] uppercase tracking-[.06em] text-text-tertiary">
        {["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((j) => (
          <span key={j}>{j}</span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cases.map((d) => {
          const cle = iso(d);
          const duJour = parJour.get(cle) ?? [];
          const horsMois = d.getMonth() !== mois;
          return (
            <div
              key={cle}
              className={`flex min-h-[74px] flex-col gap-1 rounded-sv border p-1.5 ${
                cle === aujourdhui ? "border-[rgba(140,169,255,.65)]" : "border-border"
              } ${horsMois ? "opacity-40" : ""} bg-surface`}
            >
              <span className="text-[11px] font-semibold text-text-tertiary">{d.getDate()}</span>
              {duJour.slice(0, 2).map((e) => {
                const sc = scoreDecompose(e);
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => onSelect(e)}
                    className="rounded bg-white/[.07] px-1 py-0.5 text-left text-[10px] leading-tight text-text hover:bg-white/[.14]"
                  >
                    <span className="block truncate">{e.title}</span>
                    {sc && (
                      <span className="block font-sora font-bold tabular-nums">
                        {sc.nous} – {sc.eux}
                      </span>
                    )}
                  </button>
                );
              })}
              {duJour.length > 2 && (
                <span className="text-[10px] text-text-tertiary">+{duJour.length - 2}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
