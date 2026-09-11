"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Plus, Upload } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess, canCreate, administreLeClub } from "@/lib/permissions";
import { CALENDAR_EVENT_KIND_LABELS, type CalendarEvent, type CalendarEventKind } from "@/lib/types/calendar";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { TeamSelector } from "@/components/ui/TeamSelector";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { LockedModule } from "@/components/ui/LockedModule";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { KIND_DOT } from "@/components/calendar/calendar-style";
import {
  aCouverture,
  descriptionEvenement,
  ecussonAdversaire,
  aBesoinDuLieu,
  lieuCourt,
  equipeParDefaut,
  lignesParCase,
  etatEvenement,
  libelleCompteur,
  libelleCourt,
  parPriorite,
  passeVueRapide,
  resumerJournee,
  VUES_RAPIDES,
  type VueRapide,
} from "@/components/calendar/synthese";
import { EventDetailPanel } from "@/components/calendar/EventDetailPanel";
import { AddEventModal } from "@/components/calendar/AddEventModal";
import { ImportMatchesModal } from "@/components/calendar/ImportMatchesModal";
import {
  CREATABLE_EVENT_TYPE_MAP,
  createClubCalendarEvent,
  fetchClubCalendrier,
  fetchPublicationsCalendrier,
  fetchSouhaitsParEvenement,
} from "@/lib/data/club/calendar";
import { Couverture } from "@/components/calendar/Couverture";
import { fetchOrgCalendarEvents } from "@/lib/data/shared/calendar-events";
import { createClient } from "@/lib/supabase/client";
import { parseDateOnly } from "@/lib/date-only";

// Filtre "Type" : les 6 valeurs réellement possibles pour club_calendar_events.type (contrainte
// check, migration-clubplus-v4.sql), pas les 10 CalendarEventKind du design — même restriction
// que le <select> de création (AddEventModal.tsx), qui utilise déjà cette même map.
const FILTERABLE_KINDS = Object.keys(CREATABLE_EVENT_TYPE_MAP) as CalendarEventKind[];

// /calendar — voir ACTIONS.md § 15. Calendrier central agrégé (mois/semaine/jour/liste) :
// « fusionne matchs, entraînements, prestations, tournages, réunions, publications, échéances de
// contrat, factures, événements, stages, tournois » (DATA_MODEL.md § CalendarEvent) sans
// duplication de composant selon le contexte.

type ViewMode = "month" | "week" | "day" | "list";

/** Les vues telles qu'elles s'écrivent dans une adresse (`/calendar?vue=semaine`). */
const VUE_PAR_PARAM: Record<string, ViewMode> = { mois: "month", semaine: "week", jour: "day", liste: "list" };

const WEEKDAY_LABELS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7; // 0 = lundi
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

// e.startsAt est soit une date pure ("YYYY-MM-DD", allDay=true, ex. club_matches.match_date ou
// club_calendar_events sans event_time), soit une chaîne datetime locale sans fuseau
// ("YYYY-MM-DDTHH:mm", allDay=false) — cette dernière est déjà correctement interprétée en heure
// locale par `new Date()` (aucun suffixe "Z"/offset). Seul le cas allDay doit passer par
// parseDateOnly (voir son docstring) pour éviter un décalage d'un jour hors fuseaux UTC+.
function parseEventStart(e: { startsAt: string; allDay: boolean }): Date {
  return e.allDay ? parseDateOnly(e.startsAt) : new Date(e.startsAt);
}

export default function CalendarPage() {
  const { ctx } = useSession();
  const today = useMemo(() => startOfToday(), []);
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [view, setView] = useState<ViewMode>("month");
  const [reference, setReference] = useState<Date>(today);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  // Point de depart selon le role, pas une restriction : le filtre est visible et se retire d'un
  // clic. Un educateur qui n'encadre qu'une equipe ouvre sur elle, plutot que de refiltrer chaque
  // jour parmi 38.
  const [teamFilter, setTeamFilter] = useState(() =>
    equipeParDefaut(ctx.membership.role, ctx.membership.teamScope),
  );
  const [typeFilter, setTypeFilter] = useState<CalendarEventKind | "">("");
  const [vueRapide, setVueRapide] = useState<VueRapide>("tout");
  // Jour ouvert depuis la vue Mois. C'est le second niveau de lecture : la case reste synthétique,
  // le détail complet vit ici — sinon on retombe sur la case-liste illisible qu'on veut éviter.
  const [jourOuvert, setJourOuvert] = useState<Date | null>(null);

  // 10/09/2026 — Arriver au bon endroit, et y rester (demande de Fouka).
  //   • Un lien du tableau de bord ouvre la bonne vue : `?vue=semaine&filtre=matchs`, `?date=`.
  //   • Les choix du CM (vue, filtre, équipe, type) sont gardés pour la session, par club : on
  //     revient au calendrier comme on l'a laissé. L'adresse l'emporte sur la mémoire.
  //   • Sans l'un ni l'autre, le CM ouvre sur la Semaine : sur 1 200 événements, c'est sa vue de
  //     travail ; le mois reste le point de départ des autres rôles.
  const cleSession = `sv-calendrier-${ctx.organization.id}`;
  const [restaure, setRestaure] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let memo: { vue?: ViewMode; filtre?: VueRapide; equipe?: string; type?: CalendarEventKind | "" } = {};
    try {
      memo = JSON.parse(window.sessionStorage.getItem(cleSession) ?? "{}");
    } catch {
      memo = {};
    }
    const vueParam = VUE_PAR_PARAM[params.get("vue") ?? ""];
    const filtreParam = params.get("filtre");
    const vue = vueParam ?? memo.vue ?? (ctx.membership.role === "external_cm" ? "week" : undefined);
    if (vue) setView(vue);
    if (filtreParam && VUES_RAPIDES.some((v) => v.id === filtreParam)) setVueRapide(filtreParam as VueRapide);
    else if (!filtreParam && memo.filtre) setVueRapide(memo.filtre);
    if (!params.has("vue") && !filtreParam) {
      if (memo.equipe !== undefined) setTeamFilter(memo.equipe);
      if (memo.type !== undefined) setTypeFilter(memo.type);
    }
    const date = params.get("date");
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) setReference(parseDateOnly(date));
    setRestaure(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleSession]);

  useEffect(() => {
    if (!restaure) return;
    try {
      window.sessionStorage.setItem(
        cleSession,
        JSON.stringify({ vue: view, filtre: vueRapide, equipe: teamFilter, type: typeFilter }),
      );
    } catch {
      /* stockage indisponible : le calendrier fonctionne, il ne se souvient simplement pas */
    }
  }, [restaure, cleSession, view, vueRapide, teamFilter, typeFilter]);

  // calendar_events générique (Coach/Académie/Sponsor, Phase 4) est en lecture seule côté membre
  // (écriture réservée au staff SportVision) — contrairement à club_calendar_events.
  const isGenericOrg = ["coach", "academy", "sponsor"].includes(ctx.organization.type);
  const isPlayer = ctx.organization.type === "player";
  // Un joueur n'a pas son propre calendrier : il lit celui de son club (brief Fouka § 11 — "voir
  // matchs, shootings SportVision, Media Days, tournages, événements du club"). club_calendar_events
  // /club_matches sont scopés par club_id, PAS par ctx.organization.id (= player_profiles.id pour
  // un joueur) — passer ctx.organization.id ici ne matchait jamais aucun club réel et affichait
  // toujours un calendrier vide, bug trouvé en construisant cette vue. parentOrganizationId est le
  // club_id réel (toujours renseigné pour un joueur, voir session.ts:buildPlayerActiveContext).
  const calendarOrgId = isPlayer ? ctx.organization.parentOrganizationId : ctx.organization.id;

  // Fenêtre chargée : la vue courante, élargie d'un mois de chaque côté pour que naviguer d'un
  // mois à l'autre ne déclenche pas une requête à chaque clic. Les entraînements étant projetés à
  // la demande, demander une fenêtre plus large que nécessaire coûterait pour rien.
  const fenetre = useMemo(() => {
    const debut = new Date(reference.getFullYear(), reference.getMonth() - 1, 1);
    const fin = new Date(reference.getFullYear(), reference.getMonth() + 2, 0);
    const ymd = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { du: ymd(debut), au: ymd(fin) };
  }, [reference]);

  const loadEvents = useCallback(() => {
    if (!calendarOrgId) return;
    let cancelled = false;
    setLoadError(false);
    const supabase = createClient();
    // 10/09/2026 — Au calendrier d'un club s'ajoutent les demandes « À couvrir » (posées sur
    // leur événement) et les publications prévues (filtre Communication). Les deux sont des
    // compléments : un refus ou une panne ne doit jamais vider le calendrier lui-même.
    const fetcher = isGenericOrg
      ? fetchOrgCalendarEvents(supabase, calendarOrgId)
      : Promise.all([
          fetchClubCalendrier(supabase, calendarOrgId, fenetre.du, fenetre.au),
          fetchSouhaitsParEvenement(supabase, calendarOrgId).catch(() => new Map()),
          fetchPublicationsCalendrier(supabase, calendarOrgId, fenetre.du, fenetre.au).catch(() => [] as CalendarEvent[]),
        ]).then(([lignes, souhaits, publications]) => [
          ...lignes.map((e) => (souhaits.has(e.id) ? { ...e, wish: souhaits.get(e.id) } : e)),
          ...publications,
        ]);
    fetcher
      .then((rows) => {
        if (!cancelled) setEvents(rows);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [calendarOrgId, isGenericOrg, fenetre.du, fenetre.au]);

  useEffect(() => loadEvents(), [loadEvents]);

  // Hooks appelés inconditionnellement avant tout `return` — sortedEvents doit être calculé ici,
  // pas après le early-return de canAccess ci-dessous (règle des Hooks React).
  const sortedEvents = useMemo(
    () => [...(events ?? [])].sort((a, b) => parseEventStart(a).getTime() - parseEventStart(b).getTime()),
    [events],
  );

  // Liste dérivée des valeurs `team` réellement présentes pour ce club (jamais une liste
  // inventée) — calculée sur `events` non filtré pour que les deux équipes restent proposables
  // même quand un filtre de type est déjà actif.
  const availableTeams = useMemo(
    () =>
      Array.from(new Set((events ?? []).map((e) => e.teamName).filter((t): t is string => Boolean(t)))).sort((a, b) =>
        a.localeCompare(b, "fr"),
      ),
    [events],
  );

  // Combien de lignes une case de mois peut porter : mesure sur ce que le club contient
  // reellement, plutot qu'un reglage que personne ne toucherait.
  const filteredEvents = useMemo(
    () =>
      sortedEvents.filter((e) => {
        if (teamFilter && e.teamName !== teamFilter) return false;
        if (typeFilter && e.kind !== typeFilter) return false;
        if (!passeVueRapide(e, vueRapide)) return false;
        return true;
      }),
    [sortedEvents, teamFilter, typeFilter, vueRapide],
  );

  if (!canAccess(ctx, "calendar")) return <LockedModule title="Calendrier" />;

  if (loadError) {
    return (
      <Card>
        <ErrorState message="Impossible de charger le calendrier." onRetry={loadEvents} />
      </Card>
    );
  }

  if (events === null) {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
          <Skeleton className="h-11 w-44 rounded-sv" />
        </div>
        <Card className="overflow-hidden p-0">
          <div className="grid grid-cols-7 gap-px bg-divider p-px">
            {Array.from({ length: 35 }).map((_, i) => (
              <Skeleton key={i} className="h-[104px] rounded-none" />
            ))}
          </div>
        </Card>
      </div>
    );
  }

  function eventsOnDay(day: Date): CalendarEvent[] {
    return filteredEvents.filter((e) => isSameDay(parseEventStart(e), day));
  }

  function navigate(direction: -1 | 1) {
    if (view === "month") {
      setReference((d) => new Date(d.getFullYear(), d.getMonth() + direction, 1));
    } else if (view === "week") {
      setReference((d) => addDays(d, direction * 7));
    } else if (view === "day") {
      setReference((d) => addDays(d, direction));
    }
  }

  function handleCreateEvent(input: { title: string; kind: CalendarEventKind; date: string; time?: string; location?: string; team?: string; competition?: string; isHome?: boolean }) {
    const supabase = createClient();
    return createClubCalendarEvent(supabase, ctx.organization.id, {
      title: input.title,
      kind: input.kind,
      date: input.date,
      time: input.time,
      location: input.location,
      team: input.team,
      competition: input.competition,
      isHome: input.isHome,
    }).then((created) => setEvents((prev) => (prev ? [...prev, created] : prev)));
  }

  function exportIcal() {
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//SportVision Club+//FR"];
    for (const e of sortedEvents) {
      // Journée entière : DTSTART;VALUE=DATE (pas d'heure ni de fuseau à convertir, donc aucun
      // risque de décalage de jour) — un événement horodaté garde DTSTART en UTC classique.
      if (e.allDay) {
        const ymd = e.startsAt.slice(0, 10).replace(/-/g, "");
        lines.push("BEGIN:VEVENT", `UID:${e.id}`, `DTSTART;VALUE=DATE:${ymd}`, `SUMMARY:${e.title}`, "END:VEVENT");
        continue;
      }
      const dt = `${new Date(e.startsAt).toISOString().slice(0, 19).replace(/[-:]/g, "")}Z`;
      lines.push("BEGIN:VEVENT", `UID:${e.id}`, `DTSTART:${dt}`, `SUMMARY:${e.title}`, "END:VEVENT");
    }
    lines.push("END:VCALENDAR");
    const blob = new Blob([lines.join("\r\n")], { type: "text/calendar" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sportvision-connect.ics";
    a.click();
    URL.revokeObjectURL(url);
  }

  const periodLabel = (() => {
    if (view === "month") return reference.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
    if (view === "day") return reference.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    if (view === "week") {
      const start = startOfWeek(reference);
      const end = addDays(start, 6);
      return `${start.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} – ${end.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}`;
    }
    return "Tous les événements à venir";
  })();

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[23px] font-extrabold tracking-tight sm:text-[29px]">Calendrier</h1>
          <p className="mt-1 text-[13.5px] text-text-soft">
            {isPlayer
              ? "Matchs, shootings SportVision et événements de votre club."
              : "Matchs, prestations, tournages, publications et échéances au même endroit."}
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <Button variant="secondary" onClick={exportIcal} aria-label="Exporter au format iCal">
            <Download className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">Exporter (iCal)</span>
          </Button>
          {/* Un joueur consulte le calendrier de son club, il ne le modifie pas (brief § 11 :
              "le joueur ne devrait pas modifier le planning officiel") — même retrait que pour
              coach/académie/sponsor (calendrier en lecture seule côté membre). */}
          {administreLeClub(ctx) && (
            <Button variant="secondary" onClick={() => setImportOpen(true)} aria-label="Importer un calendrier">
              <Upload className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">Importer un calendrier</span>
            </Button>
          )}
          {!isGenericOrg && !isPlayer && (
            <Button disabled={!canCreate(ctx, "calendar_event")} onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">Ajouter un événement</span>
              <span className="sm:hidden">Ajouter</span>
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-xl border border-border p-1">
          {(["month", "week", "day", "list"] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setView(mode)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-[12.5px] font-bold transition-colors duration-sv",
                view === mode ? "bg-gradient-to-r from-brand-blue to-brand-violet text-white" : "text-text-soft hover:text-text",
              )}
            >
              {{ month: "Mois", week: "Semaine", day: "Jour", list: "Liste" }[mode]}
            </button>
          ))}
        </div>

        {view !== "list" && (
          // Sur téléphone, la navigation prend sa propre ligne : partagée avec le sélecteur de vue,
          // elle poussait « Aujourd'hui » hors de l'écran et réduisait le nom du mois à néant.
          <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto sm:flex-none">
            <button
              aria-label="Période précédente"
              onClick={() => navigate(-1)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-strong text-text-soft hover:bg-surface-sunken"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </button>
            <span className="min-w-0 flex-1 truncate text-center text-[12.5px] font-extrabold capitalize sm:min-w-[160px] sm:flex-none sm:text-[13.5px]">
              {periodLabel}
            </span>
            <button
              aria-label="Période suivante"
              onClick={() => navigate(1)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-strong text-text-soft hover:bg-surface-sunken"
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
            <button onClick={() => setReference(today)} className="ml-1 text-[12px] font-bold text-brand-blue-electric">
              Aujourd&apos;hui
            </button>
          </div>
        )}
      </div>

      {/* Vues rapides — les questions qu'on se pose vraiment en ouvrant un calendrier de club.
          Elles ne remplacent pas les filtres ci-dessous, elles évitent d'avoir à les combiner à la
          main pour retrouver une intention courante (« qu'est-ce qu'on doit couvrir ? »). */}
      {!isGenericOrg && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Vues rapides">
          {VUES_RAPIDES.map((v) => (
            <button
              key={v.id}
              onClick={() => setVueRapide(v.id)}
              aria-pressed={vueRapide === v.id}
              className={cn(
                "rounded-full border px-3 py-1.5 text-[12px] font-bold transition-colors duration-sv",
                vueRapide === v.id
                  ? "border-brand-blue bg-brand-blue/10 text-brand-blue-electric"
                  : "border-border-strong text-text-soft hover:bg-surface-sunken",
              )}
            >
              {v.label}
            </button>
          ))}
        </div>
      )}

      {!isGenericOrg && (
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-[11px] font-extrabold uppercase tracking-[.04em] text-text-faint">Filtrer</span>
          {availableTeams.length > 0 && (
            // Une liste plate devient un annuaire dès qu'un club dépasse la vingtaine d'équipes :
            // chez Villemomble, trouver « U12 Espoir 2 » demandait de parcourir quarante lignes.
            // Le sélecteur est partagé — il servira aux résultats, aux galeries, aux invitations,
            // partout où l'on choisit une équipe.
            <TeamSelector
              equipes={availableTeams.map((name) => ({ name }))}
              valeur={teamFilter}
              onChange={setTeamFilter}
            />
          )}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as CalendarEventKind | "")}
            aria-label="Filtrer par type"
            className="h-9 rounded-lg border border-border-strong bg-input-bg px-2.5 text-[12.5px] font-bold text-text outline-none focus-visible:border-brand-blue"
          >
            <option value="">Tous les types</option>
            {FILTERABLE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {CALENDAR_EVENT_KIND_LABELS[kind]}
              </option>
            ))}
          </select>
          {(teamFilter || typeFilter || vueRapide !== "tout") && (
            <button
              onClick={() => {
                setTeamFilter("");
                setTypeFilter("");
                setVueRapide("tout");
              }}
              className="text-[12px] font-bold text-brand-blue-electric"
            >
              Réinitialiser
            </button>
          )}
          {/* Dire ce qu'on regarde. Un filtre actif qui ne se voit pas fait conclure à un
              calendrier vide plutôt qu'à une vue restreinte. */}
          <span className="text-[11.5px] font-bold text-text-faint">
            {filteredEvents.length} / {sortedEvents.length} événements
          </span>
        </div>
      )}

      {view === "month" && (
        <MonthView
          reference={reference}
          maxVisibles={lignesParCase(filteredEvents)}
          eventsOnDay={eventsOnDay}
          onSelect={setSelectedEvent}
          onOpenDay={setJourOuvert}
          today={today}
        />
      )}
      {view === "week" && (
        <WeekView reference={reference} eventsOnDay={eventsOnDay} onSelect={setSelectedEvent} today={today} />
      )}
      {view === "day" && <DayView reference={reference} events={eventsOnDay(reference)} onSelect={setSelectedEvent} />}
      {view === "list" && <ListView events={filteredEvents} onSelect={setSelectedEvent} today={today} onRecharger={loadEvents} />}

      {/* Le détail du jour s'efface dès qu'on ouvre un événement : deux panneaux superposés, c'est
          deux fois « Fermer » avant de revenir au calendrier. */}
      {jourOuvert && !selectedEvent && (
        <DayPanel
          day={jourOuvert}
          events={eventsOnDay(jourOuvert)}
          onSelect={(e) => {
            setJourOuvert(null);
            setSelectedEvent(e);
          }}
          onClose={() => setJourOuvert(null)}
        />
      )}

      {selectedEvent && (
        <EventDetailPanel
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
          onChanged={() => {
            setSelectedEvent(null);
            loadEvents();
          }}
        />
      )}
      {addOpen && <AddEventModal onClose={() => setAddOpen(false)} onCreate={handleCreateEvent} teamNames={availableTeams} />}
      {importOpen && calendarOrgId && (
        <ImportMatchesModal
          clubId={calendarOrgId}
          userId={ctx.user.id}
          onClose={() => setImportOpen(false)}
          onImported={loadEvents}
        />
      )}
    </div>
  );
}

function EventChip({ event, onSelect }: { event: CalendarEvent; onSelect: (e: CalendarEvent) => void }) {
  return (
    <button
      onClick={() => onSelect(event)}
      className="flex w-full items-center gap-1.5 rounded-md bg-surface-alt px-1.5 py-1 text-left text-[10.5px] font-bold text-text hover:bg-row-hover"
    >
      <span className={cn("h-1.5 w-1.5 flex-none rounded-full", KIND_DOT[event.kind])} aria-hidden />
      <span className="truncate">{event.title}</span>
    </button>
  );
}

/**
 * Une ligne de la vue Mois : compacte, mais qui dit l'essentiel.
 *
 * Pour un match, l'adversaire prime sur le nom de l'équipe : dans une case de mois on cherche
 * « contre qui », le « qui » se lit à la couleur et se retrouve au clic. Le score remplace
 * l'heure dès que le match est joué — l'heure d'un match terminé n'intéresse plus personne.
 */
function LigneMois({
  event,
  onSelect,
  memeJour = [],
}: {
  event: CalendarEvent;
  onSelect: (e: CalendarEvent) => void;
  /** Les autres événements du même jour : servent uniquement à savoir s'il faut préciser le lieu
   *  pour distinguer deux séances de la même équipe. */
  memeJour?: CalendarEvent[];
}) {
  const heure = event.allDay
    ? null
    : new Date(event.startsAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  // L'écusson remplace la pastille de couleur quand il existe : il dit la même chose (« c'est un
  // match ») en disant en plus contre qui. Quand il manque, la pastille reprend sa place — la
  // ligne ne doit jamais se décaler selon qu'un club a déposé son logo ou non.
  const ecusson = ecussonAdversaire(event);
  return (
    <button
      onClick={(ev) => {
        ev.stopPropagation();
        onSelect(event);
      }}
      title={event.title}
      className={cn(
        "flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left text-[10.5px] font-bold text-text hover:bg-row-hover",
        event.kind === "match" ? "bg-info-bg" : "bg-surface-alt",
      )}
    >
      {ecusson ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={ecusson} alt="" className="h-3.5 w-3.5 flex-none rounded-[3px] object-contain" loading="lazy" />
      ) : (
        <span className={cn("h-1.5 w-1.5 flex-none rounded-full", KIND_DOT[event.kind])} aria-hidden />
      )}
      <span className="truncate">
        {libelleCourt(event)}
        {/* Deux séances de la même équipe le même jour ne sont un doublon que pour qui ne voit ni
            l'heure ni le lieu. Le lieu n'apparaît QUE dans ce cas : l'afficher partout mangerait
            la place sans rien apprendre. */}
        {aBesoinDuLieu(event, memeJour) && (
          <span className="font-bold text-text-faint"> · {lieuCourt(event.location)}</span>
        )}
      </span>
      {event.score ? (
        <span className="ml-auto flex-none font-extrabold tabular-nums text-text">{event.score}</span>
      ) : heure ? (
        <span className="ml-auto flex-none text-[9.5px] font-bold tabular-nums text-text-faint">{heure}</span>
      ) : null}
      {aCouverture(event) && (
        <span className="ml-0.5 flex-none text-[9px]" aria-label="Couverture SportVision" title="Couverture SportVision">
          📸
        </span>
      )}
    </button>
  );
}

/**
 * Vue Mois — une vue de SYNTHÈSE, pas une vue détaillée.
 *
 * Elle répond à trois questions et à trois seulement : quels jours sont chargés, où sont les
 * matchs, où SportVision intervient. Le reste s'obtient en cliquant sur le jour.
 *
 * Deux événements en toutes lettres au maximum, choisis par importance et non par heure (voir
 * synthese.ts) ; le reste en compteurs groupés par nature. « 8 entraînements » se lit plus vite
 * que huit lignes tronquées, et surtout laisse le match visible.
 */
function MonthView({
  reference,
  eventsOnDay,
  onSelect,
  onOpenDay,
  today,
  maxVisibles,
}: {
  reference: Date;
  eventsOnDay: (d: Date) => CalendarEvent[];
  onSelect: (e: CalendarEvent) => void;
  onOpenDay: (d: Date) => void;
  today: Date;
  maxVisibles: number;
}) {
  const firstOfMonth = new Date(reference.getFullYear(), reference.getMonth(), 1);
  const gridStart = startOfWeek(firstOfMonth);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));

  return (
    <Card className="overflow-hidden">
      <div className="grid grid-cols-7 border-b border-divider bg-surface-alt">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="px-1 py-2 text-center text-[9.5px] font-extrabold uppercase tracking-[.04em] text-text-faint sm:px-2 sm:text-[10.5px]">
            {/* Une lettre sur telephone : « L M M J V S D » se lit aussi bien et laisse la place
                au contenu, qui est ce qu'on vient regarder. */}
            <span className="sm:hidden">{label[0]}</span>
            <span className="hidden sm:inline">{label}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const inMonth = day.getMonth() === reference.getMonth();
          const dayEvents = eventsOnDay(day);
          const isToday = isSameDay(day, today);
          const resume = resumerJournee(dayEvents, maxVisibles);
          const couverturesRepliees = resume.couvertures - resume.visibles.filter(aCouverture).length;
          return (
            <div
              key={day.toISOString()}
              role={dayEvents.length ? "button" : undefined}
              tabIndex={dayEvents.length ? 0 : undefined}
              onClick={() => dayEvents.length && onOpenDay(day)}
              onKeyDown={(e) => {
                if (dayEvents.length && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  onOpenDay(day);
                }
              }}
              aria-label={dayEvents.length ? `${day.getDate()} — ${resume.total} événements, ouvrir le détail` : undefined}
              className={cn(
                // Sur telephone, sept colonnes font 50 px de large : aucun texte n'y tient. La case
                // se reduit alors au numero et a des pastilles de couleur, et tout le detail passe
                // par le panneau du jour, qui s'ouvre en plein ecran. C'est le meme principe qu'en
                // grand format — synthetiser plutot que tronquer — pousse plus loin.
                "flex min-h-[62px] flex-col gap-1 border-b border-r border-divider p-1 last:border-r-0 sm:min-h-[104px] sm:p-1.5",
                !inMonth && "bg-surface-alt/40",
                dayEvents.length && "cursor-pointer hover:bg-row-hover/40",
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-[10.5px] font-bold sm:h-6 sm:w-6 sm:text-[11.5px]",
                  isToday ? "bg-brand-blue text-white" : inMonth ? "text-text" : "text-text-faint",
                )}
              >
                {day.getDate()}
              </span>

              {/* Telephone : une pastille par nature presente, et le total. On voit d'un coup
                  quels jours sont charges et lesquels ont un match, ce qui est exactement ce
                  qu'on demande a une vue Mois. */}
              {dayEvents.length > 0 && (
                <div className="flex flex-wrap items-center gap-0.5 sm:hidden">
                  {[...new Set(resume.visibles.concat(dayEvents).map((e) => e.kind))].slice(0, 3).map((k) => (
                    <span key={k} className={cn("h-1.5 w-1.5 rounded-full", KIND_DOT[k])} aria-hidden />
                  ))}
                  <span className="ml-0.5 text-[9px] font-bold tabular-nums text-text-faint">{resume.total}</span>
                  {resume.couvertures > 0 && <span className="text-[8px]" aria-hidden>📸</span>}
                </div>
              )}

              <div className="hidden flex-col gap-1 sm:flex">
                {resume.visibles.map((e) => (
                  <LigneMois key={e.id} event={e} onSelect={onSelect} memeJour={dayEvents} />
                ))}
                {/* Les compteurs. Ils disent le volume sans détailler — c'est la différence entre
                    « ce jour est chargé » et une liste qu'on ne lit pas. */}
                {resume.compteurs.length > 0 && (
                  <div className="flex flex-wrap gap-1 px-0.5">
                    {resume.compteurs.map(({ kind, n }) => (
                      <span
                        key={kind}
                        className="inline-flex items-center gap-1 rounded-full bg-surface-alt px-1.5 py-[1px] text-[9.5px] font-bold text-text-soft"
                      >
                        <span className={cn("h-1.5 w-1.5 rounded-full", KIND_DOT[kind])} aria-hidden />
                        {libelleCompteur(kind, n)}
                      </span>
                    ))}
                  </div>
                )}
                {/* La couverture SportVision ne se perd jamais dans un compteur : c'est elle qui
                    engage un déplacement d'équipe. */}
                {couverturesRepliees > 0 && (
                  <span className="px-0.5 text-[9.5px] font-bold text-cyan-fg">
                    📸 {couverturesRepliees} couverture{couverturesRepliees > 1 ? "s" : ""}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/**
 * Le second niveau de lecture : tout ce que la case du mois a résumé.
 *
 * Groupé par nature et non par heure, dans l'ordre de priorité : on vient y chercher « quels
 * matchs » et « qui s'entraîne », pas une frise chronologique — la vue Jour existe pour ça.
 */
function DayPanel({
  day,
  events,
  onSelect,
  onClose,
}: {
  day: Date;
  events: CalendarEvent[];
  onSelect: (e: CalendarEvent) => void;
  onClose: () => void;
}) {
  const groupes = useMemo(() => {
    const parNature = new Map<CalendarEventKind, CalendarEvent[]>();
    for (const e of [...events].sort(parPriorite)) {
      const liste = parNature.get(e.kind) ?? [];
      liste.push(e);
      parNature.set(e.kind, liste);
    }
    return [...parNature.entries()];
  }, [events]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose} role="presentation">
      <aside
        className="flex h-full w-full flex-col overflow-y-auto bg-surface p-4 shadow-xl sm:max-w-md sm:p-5"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Détail du ${day.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[19px] font-extrabold capitalize tracking-tight">
              {day.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
            </h2>
            <p className="mt-0.5 text-[12.5px] text-text-soft">
              {events.length} événement{events.length > 1 ? "s" : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-border-strong px-2.5 py-1 text-[12px] font-bold text-text-soft hover:bg-surface-sunken"
          >
            Fermer
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-4">
          {groupes.map(([kind, liste]) => (
            <div key={kind} className="flex flex-col gap-1.5">
              <h3 className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-[.04em] text-text-faint">
                <span className={cn("h-2 w-2 rounded-full", KIND_DOT[kind])} aria-hidden />
                {CALENDAR_EVENT_KIND_LABELS[kind]}
                <span className="text-text-faint/70">· {liste.length}</span>
              </h3>
              {liste.map((e) => {
                const heure = e.allDay
                  ? "Journée"
                  : new Date(e.startsAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
                return (
                  <button
                    key={e.id}
                    onClick={() => onSelect(e)}
                    className="flex items-start gap-2.5 rounded-lg border border-border px-3 py-2 text-left hover:bg-row-hover"
                  >
                    <span className="w-11 flex-none pt-[1px] text-[12px] font-extrabold tabular-nums text-text-soft">
                      {heure}
                    </span>
                    {ecussonAdversaire(e) && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={ecussonAdversaire(e)!} alt="" className="h-6 w-6 flex-none rounded object-contain" loading="lazy" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-bold text-text">{e.title}</span>
                      <span className="mt-0.5 block truncate text-[11.5px] text-text-soft">
                        {[e.competition, e.location].filter(Boolean).join(" · ") || (e.teamName ?? "")}
                      </span>
                    </span>
                    {e.score && <span className="flex-none text-[13px] font-extrabold tabular-nums">{e.score}</span>}
                    {aCouverture(e) && <span className="flex-none text-[12px]" title="Couverture SportVision">📸</span>}
                    {!aCouverture(e) && e.wish && (
                      <span className="flex-none rounded-full border border-brand-violet/60 px-1 text-[9.5px] font-extrabold text-accent-fg" title="À couvrir par SportVision">
                        À couvrir
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

function WeekView({
  reference,
  eventsOnDay,
  onSelect,
  today,
}: {
  reference: Date;
  eventsOnDay: (d: Date) => CalendarEvent[];
  onSelect: (e: CalendarEvent) => void;
  today: Date;
}) {
  const start = startOfWeek(reference);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
      {days.map((day) => {
        const dayEvents = eventsOnDay(day);
        const isToday = isSameDay(day, today);
        return (
          <Card key={day.toISOString()} className={cn("flex flex-col gap-2 p-3", isToday && "border-brand-blue")}>
            <div className="text-[11px] font-extrabold uppercase tracking-[.04em] text-text-faint">
              {day.toLocaleDateString("fr-FR", { weekday: "short" })}
            </div>
            <div className={cn("text-[15px] font-extrabold", isToday && "text-brand-blue-electric")}>{day.getDate()}</div>
            {/* La semaine est la vue de coordination : elle montre plus que le mois, mais garde le
                même ordre de priorité. Sans lui, une colonne de 12 entraînements repousserait les
                matchs hors de l'écran, exactement le défaut corrigé sur la vue Mois. */}
            <div className="flex flex-col gap-1.5">
              {dayEvents.length === 0 && <span className="text-[11px] text-text-faint">—</span>}
              {[...dayEvents].sort(parPriorite).map((e) => (
                <LigneMois key={e.id} event={e} onSelect={onSelect} memeJour={dayEvents} />
              ))}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function DayView({ reference, events, onSelect }: { reference: Date; events: CalendarEvent[]; onSelect: (e: CalendarEvent) => void }) {
  return (
    <Card className="flex flex-col divide-y divide-divider">
      {events.length === 0 && (
        <EmptyState title="Aucun événement" description={`Aucun événement le ${reference.toLocaleDateString("fr-FR")}.`} />
      )}
      {/* La vue Jour est la plus précise : elle garde l'ordre chronologique, qui est ici le bon —
          on y lit le déroulé d'une journée, pas une hiérarchie d'importance. */}
      {events.map((e) => {
        const etat = etatEvenement(e);
        return (
          <button key={e.id} onClick={() => onSelect(e)} className="flex items-center gap-2.5 px-3.5 py-3 text-left hover:bg-row-hover sm:gap-3.5 sm:px-5 sm:py-3.5">
            <span className="w-10 flex-none text-[11.5px] font-extrabold tabular-nums text-text-soft sm:w-14 sm:text-[12.5px]">
              {e.allDay ? "Journée" : new Date(e.startsAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
            </span>
            {ecussonAdversaire(e) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={ecussonAdversaire(e)!} alt="" className="h-6 w-6 flex-none rounded object-contain" loading="lazy" />
            ) : (
              <span className={cn("h-2 w-2 flex-none rounded-full", KIND_DOT[e.kind])} aria-hidden />
            )}
            <span className="min-w-0 flex-1">
              <span className={cn("block truncate text-[13.5px] font-bold", e.status === "annulee" && "text-text-faint line-through")}>
                {e.title}
              </span>
              <span className="block truncate text-[12px] text-text-soft">
                {[CALENDAR_EVENT_KIND_LABELS[e.kind], descriptionEvenement(e)].filter(Boolean).join(" · ")}
              </span>
            </span>
            {aCouverture(e) && (
              <span className="flex-none text-[13px]" title="Couverture SportVision" aria-label="Couverture SportVision">
                📸
              </span>
            )}
            {!aCouverture(e) && e.wish && (
              <span className="flex-none rounded-full border border-brand-violet/60 px-1.5 text-[10.5px] font-extrabold text-accent-fg" title="À couvrir par SportVision">
                À couvrir
              </span>
            )}
            {e.score && <span className="flex-none text-[15px] font-extrabold tabular-nums">{e.score}</span>}
            {etat && (
              <Badge tone={etat.ton === "success" ? "success" : etat.ton === "danger" ? "danger" : "warning"}>
                {etat.label}
              </Badge>
            )}
          </button>
        );
      })}
    </Card>
  );
}

function ListView({
  events,
  onSelect,
  today,
  onRecharger,
}: {
  events: CalendarEvent[];
  onSelect: (e: CalendarEvent) => void;
  today: Date;
  onRecharger: () => void;
}) {
  const upcoming = events.filter((e) => parseEventStart(e).getTime() >= today.getTime() - 86_400_000);
  const groups = new Map<string, CalendarEvent[]>();
  for (const e of upcoming) {
    const label = parseEventStart(e).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    groups.set(label, [...(groups.get(label) ?? []), e]);
  }

  if (upcoming.length === 0) {
    return (
      <Card>
        <EmptyState title="Aucun événement à venir" description="Les prochains événements de votre calendrier apparaîtront ici." />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {Array.from(groups.entries()).map(([label, dayEvents]) => (
        <div key={label} className="flex flex-col gap-2">
          <div className="text-[11px] font-extrabold uppercase tracking-[.09em] text-text-faint">{label}</div>
          <Card className="divide-y divide-divider">
            {dayEvents.map((e) => (
              <div key={e.id} className="flex w-full items-start gap-2.5 px-3.5 py-3 text-left sm:gap-3.5 sm:px-5 sm:py-3.5">
                <span className="w-10 flex-none pt-0.5 text-[11.5px] font-extrabold tabular-nums text-text-soft sm:w-14 sm:text-[12.5px]">
                  {e.allDay ? "Journée" : new Date(e.startsAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                </span>
                {ecussonAdversaire(e) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={ecussonAdversaire(e)!} alt="" className="mt-0.5 h-7 w-7 flex-none rounded object-contain" loading="lazy" />
                ) : (
                  <span className={cn("mt-1.5 h-2 w-2 flex-none rounded-full", KIND_DOT[e.kind])} aria-hidden />
                )}
                <span className="min-w-0 flex-1">
                  {/* Un bouton ne peut pas en contenir un autre : le navigateur remonte les boutons
                      internes hors de leur parent, le clic n'atteint plus sa cible et l'hydratation
                      diverge. Seule la partie descriptive est donc cliquable ; la couverture est sa
                      voisine, pas son enfant. */}
                  <button type="button" onClick={() => onSelect(e)} className="block w-full text-left hover:opacity-80">
                  <span
                    className={cn(
                      "block truncate text-[13.5px] font-bold",
                      // Une séance annulée reste visible, barrée : la masquer ferait croire
                      // qu'elle n'a jamais existé et personne ne comprendrait le trou.
                      e.status === "annulee" && "text-text-faint line-through",
                    )}
                  >
                    {e.title}
                  </span>
                  <span className="block text-[12px] text-text-soft">
                    {CALENDAR_EVENT_KIND_LABELS[e.kind]}
                    {e.endsAt && !e.allDay
                      ? ` · ${new Date(e.startsAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}–${new Date(e.endsAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`
                      : ""}
                    {descriptionEvenement(e) ? ` · ${descriptionEvenement(e)}` : ""}
                  </span>
                  </button>
                  {/* Matchs ET entraînements peuvent être couverts. Pour un entraînement, la
                      référence porte la DATE de l'occurrence : couvrir le 17 décembre ne couvre
                      pas tous les jeudis. */}
                  {(e.kind === "match" || e.kind === "training") && e.status !== "annulee" && (
                    <Couverture evenement={e} onFait={onRecharger} />
                  )}
                </span>
                {/* Le score et l'état à droite de la ligne, pas noyés sous la description : sur un
                    match joué, le score EST l'information. Il était rendu en 11,5 px après le
                    bouton de couverture, là où l'œil ne va pas. */}
                <span className="flex flex-none items-center gap-2 pt-0.5">
                  {e.score && <span className="text-[15px] font-extrabold tabular-nums text-text">{e.score}</span>}
                  {(() => {
                    const etat = etatEvenement(e);
                    return etat ? <Badge tone={etat.ton}>{etat.label}</Badge> : null;
                  })()}
                </span>
              </div>
            ))}
          </Card>
        </div>
      ))}
    </div>
  );
}
