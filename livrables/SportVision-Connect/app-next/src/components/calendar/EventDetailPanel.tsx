"use client";

import Link from "next/link";
import { CalendarClock, MapPin, Trophy, Users, X } from "lucide-react";
import type { CalendarEvent } from "@/lib/types/calendar";
import { CALENDAR_EVENT_KIND_LABELS } from "@/lib/types/calendar";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { KIND_TONE } from "./calendar-style";
import { couvertureLisible, lieuCourt, scoreDecompose, statutLisible } from "./synthese";
import { parseDateOnly } from "@/lib/date-only";
import { useSession } from "@/lib/session-context";
import { cn } from "@/lib/cn";

// Fiche latérale d'un événement du calendrier — voir ACTIONS.md § 15.
//
// ── Ce qui a changé le 09/09/2026 ──
// Fouka : « on a bien l'événement, mais on ne ressent pas assez le match ». La fiche affichait un
// titre brut (« Séniors R2 — Rueil Malmaison FC Seniors 1 »), une date, un lieu en capitales, et
// « Statut : scheduled ». Trois défauts en un : le titre ne montrait pas une rencontre, le lieu
// n'était pas lisible, et le statut demandait à l'utilisateur de traduire une convention
// technique qu'il n'a pas choisie.
//
// Un match a désormais son en-tête de rencontre : les deux équipes face à face, leurs écussons, et
// entre elles le score ou « vs ». Les autres natures d'événement gardent la présentation simple —
// un entraînement n'a pas d'adversaire, lui imposer une mise en page de match serait du décor.

interface EventDetailPanelProps {
  event: CalendarEvent;
  onClose: () => void;
}

/** Un écusson, ou les initiales à sa place. Le bloc garde la même taille dans les deux cas : une
 *  fiche qui se réorganise selon qu'un club a déposé son logo donne l'impression d'être cassée. */
function Ecusson({ url, nom }: { url?: string; nom: string }) {
  const initiales = nom
    .split(/\s+/)
    .filter((m) => /[a-zA-ZÀ-ÿ0-9]/.test(m))
    .slice(0, 2)
    .map((m) => m[0]!.toUpperCase())
    .join("");
  return (
    <span className="flex h-14 w-14 flex-none items-center justify-center overflow-hidden rounded-xl bg-surface-alt">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-contain" loading="lazy" />
      ) : (
        <span className="text-[15px] font-extrabold text-text-faint">{initiales || "—"}</span>
      )}
    </span>
  );
}

function Rubrique({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-[11px] font-extrabold uppercase tracking-[.06em] text-text-faint">{titre}</h3>
      {children}
    </div>
  );
}

export function EventDetailPanel({ event, onClose }: EventDetailPanelProps) {
  const { ctx } = useSession();
  // event.startsAt est une date pure ("YYYY-MM-DD") quand allDay=true — voir le docstring de
  // parseDateOnly pour le décalage d'un jour que `new Date()` provoquerait hors fuseaux UTC+.
  const start = event.allDay ? parseDateOnly(event.startsAt) : new Date(event.startsAt);
  const end = event.endsAt ? (event.allDay ? parseDateOnly(event.endsAt) : new Date(event.endsAt)) : null;

  const estMatch = event.kind === "match" && Boolean(event.opponent);
  const score = scoreDecompose(event);
  const statut = statutLisible(event);
  const couverture = couvertureLisible(event);
  const equipe = event.teamName ?? "Notre équipe";
  const heure = event.allDay
    ? null
    : `${start.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}${end ? ` – ${end.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : ""}`;

  return (
    <div className="fixed inset-0 z-[100] flex justify-end bg-[rgba(7,10,23,.55)]">
      <Card className="animate-svfade flex h-full w-full max-w-[420px] flex-col gap-5 overflow-y-auto rounded-none p-5 shadow-sv-panel sm:rounded-l-sv-panel sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={KIND_TONE[event.kind]}>{CALENDAR_EVENT_KIND_LABELS[event.kind]}</Badge>
            <Badge
              tone={statut.ton === "neutral" ? "neutral" : statut.ton === "success" ? "success" : statut.ton === "danger" ? "danger" : "warning"}
            >
              {statut.label}
            </Badge>
          </div>
          <button
            aria-label="Fermer"
            onClick={onClose}
            className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-text-faint hover:bg-surface-sunken hover:text-text"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {estMatch ? (
          // ── En-tête de rencontre ──
          // Les deux équipes face à face, à égalité de traitement, et entre elles ce qui les
          // sépare : le score, ou « vs » tant que la rencontre n'a pas eu lieu.
          <div className="flex flex-col gap-3 rounded-2xl bg-surface-alt p-4">
            <div className="flex items-center gap-3">
              <div className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
                <Ecusson url={ctx.organization.logoUrl} nom={equipe} />
                <span className="line-clamp-2 text-[13px] font-extrabold leading-tight">{equipe}</span>
              </div>

              <div className="flex flex-none flex-col items-center gap-1 px-1">
                {score ? (
                  <span className="text-[28px] font-extrabold leading-none tabular-nums">
                    {score.domicile}<span className="mx-1 text-text-faint">–</span>{score.exterieur}
                  </span>
                ) : (
                  <span className="text-[15px] font-extrabold text-text-faint">vs</span>
                )}
                {event.isHome !== undefined && (
                  <span className="text-[10.5px] font-bold uppercase tracking-[.06em] text-text-faint">
                    {event.isHome ? "À domicile" : "À l'extérieur"}
                  </span>
                )}
              </div>

              <div className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
                <Ecusson url={event.opponentLogoUrl} nom={event.opponent!} />
                <span className="line-clamp-2 text-[13px] font-extrabold leading-tight">{event.opponent}</span>
              </div>
            </div>
            {event.competition && (
              <div className="flex items-center justify-center gap-1.5 border-t border-divider pt-2.5 text-[12px] font-bold text-text-soft">
                <Trophy className="h-3.5 w-3.5 flex-none" aria-hidden />
                {event.competition}
              </div>
            )}
          </div>
        ) : (
          <h2 className="text-[20px] font-extrabold leading-tight tracking-tight">{event.title}</h2>
        )}

        <Rubrique titre="Informations">
          <div className="flex flex-col gap-2.5 text-[13px]">
            <div className="flex items-start gap-2.5 text-text-soft">
              <CalendarClock className="mt-[1px] h-4 w-4 flex-none" aria-hidden />
              <span>
                <span className="block capitalize text-text">
                  {start.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
                </span>
                {heure && <span className="block text-[12.5px]">{heure}</span>}
              </span>
            </div>
            {event.location && (
              <div className="flex items-start gap-2.5 text-text-soft">
                <MapPin className="mt-[1px] h-4 w-4 flex-none" aria-hidden />
                {/* « STADE GEORGES POMPIDOU 1 - VILLEMOMBLE » se lit mal ; le nom propre suffit à
                    situer, la ville est la même pour tous les terrains du club. */}
                <span>{lieuCourt(event.location) ?? event.location}</span>
              </div>
            )}
            {event.teamName && !estMatch && (
              <div className="flex items-center gap-2.5 text-text-soft">
                <Users className="h-4 w-4 flex-none" aria-hidden />
                {event.teamName}
              </div>
            )}
          </div>
        </Rubrique>

        {/* Le bloc SportVision n'apparaît que s'il y a quelque chose à dire. Un « Aucune couverture »
            sur chacun des 80 entraînements de la semaine serait du bruit, pas de l'information. */}
        {couverture && (
          <Rubrique titre="SportVision">
            <div className="flex items-center gap-2.5 rounded-xl bg-cyan-bg px-3.5 py-3">
              <span className="text-[15px]" aria-hidden>{couverture.icone}</span>
              <span className="text-[12.5px] font-extrabold text-cyan-fg">{couverture.label}</span>
            </div>
          </Rubrique>
        )}

        {/* Feuille de match. Chaque ligne n'existe que si le club l'a renseignée : une rubrique
            vide fait croire à une donnée perdue. */}
        {(event.scorers || event.assists || event.manOfMatch || event.cards) && (
          <Rubrique titre="Feuille de match">
            <div className="flex flex-col gap-2 text-[12.5px]">
              {[
                { label: "Buteurs", valeur: event.scorers },
                { label: "Passeurs décisifs", valeur: event.assists },
                { label: "Homme du match", valeur: event.manOfMatch },
                { label: "Cartons", valeur: event.cards },
              ]
                .filter((l) => l.valeur)
                .map((l) => (
                  <div key={l.label} className="flex flex-col gap-0.5 rounded-lg bg-surface-alt px-3 py-2">
                    <span className="text-[10.5px] font-extrabold uppercase tracking-[.05em] text-text-faint">{l.label}</span>
                    <span className={cn("font-bold text-text")}>{l.valeur}</span>
                  </div>
                ))}
            </div>
          </Rubrique>
        )}

        {event.sourceHref && (
          <div className="mt-auto">
            <Link href={event.sourceHref}>
              <Button className="w-full">Voir la ressource liée</Button>
            </Link>
          </div>
        )}
      </Card>
    </div>
  );
}
