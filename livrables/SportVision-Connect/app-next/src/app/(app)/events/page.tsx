"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarDays, Plus } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess, canCreate } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/client";
import { createEventEdition, fetchEventEditions, type EventEdition, type EventEditionStatut } from "@/lib/data/shared/event-editions";
import { LockedModule } from "@/components/ui/LockedModule";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonRow } from "@/components/ui/Skeleton";
import { Toast, useToast } from "@/components/feedback/Toast";
import { parseDateOnly } from "@/lib/date-only";

// /events — "Mes événements" (Bible §14, organisation.type === "tournament_organizer" — bascule
// 2 org types séparés, migration-clubplus-v44, 17/08/2026). Liste des éditions pilotées par
// l'organisateur (event_editions, migration-clubplus-v43) — plusieurs éditions possibles,
// contrairement à /eventtimeline (checklist de préparation d'UN événement, laissée telle quelle
// en complément).

const STATUT_LABELS: Record<EventEditionStatut, string> = {
  a_venir: "À venir",
  en_cours: "En cours",
  terminee: "Terminée",
  annulee: "Annulée",
};

const STATUT_TONES: Record<EventEditionStatut, BadgeTone> = {
  a_venir: "info",
  en_cours: "accent",
  terminee: "success",
  annulee: "neutral",
};

function fmtDateRange(debut: string | null, fin: string | null): string | null {
  if (!debut) return null;
  const d = parseDateOnly(debut);
  if (Number.isNaN(d.getTime())) return null;
  const start = d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  if (!fin || fin === debut) return start;
  const f = parseDateOnly(fin);
  if (Number.isNaN(f.getTime())) return start;
  return `${d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} – ${f.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}`;
}

export default function EventsPage() {
  const { ctx } = useSession();
  const { toastMessage, toastTone, showToast } = useToast();

  const [editions, setEditions] = useState<EventEdition[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [nom, setNom] = useState("");
  const [dateDebut, setDateDebut] = useState("");
  const [lieu, setLieu] = useState("");
  const [sport, setSport] = useState("");

  const isTournoiOrg = ctx.organization.type === "tournament_organizer";
  const allowed = isTournoiOrg && canAccess(ctx, "events");
  const canWrite = canCreate(ctx, "event_edition");

  function load() {
    const supabase = createClient();
    setLoadError(false);
    fetchEventEditions(supabase, ctx.organization.id)
      .then(setEditions)
      .catch(() => setLoadError(true));
  }

  useEffect(() => {
    if (!allowed) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.organization.id, allowed]);

  if (!allowed) return <LockedModule title="Mes événements" />;

  function handleCreate() {
    if (!nom.trim() || submitting) return;
    setSubmitting(true);
    const supabase = createClient();
    createEventEdition(supabase, ctx.organization.id, {
      nom: nom.trim(),
      dateDebut: dateDebut || undefined,
      lieu: lieu.trim() || undefined,
      sport: sport.trim() || undefined,
    })
      .then((edition) => {
        setEditions((prev) => [edition, ...(prev ?? [])]);
        setNom("");
        setDateDebut("");
        setLieu("");
        setSport("");
        setCreating(false);
        showToast("Événement créé.");
      })
      .catch(() => showToast("Création impossible, réessayez.", "error"))
      .finally(() => setSubmitting(false));
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[29px] font-extrabold leading-tight tracking-tight">Mes événements</h1>
          <p className="mt-1.5 max-w-xl text-[13.5px] text-text-soft">
            Les éditions de {ctx.organization.name} suivies par SportVision.
          </p>
        </div>
        {canWrite && !creating && (
          <Button variant="primary" className="h-10 px-4 text-[13px]" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            Nouvel événement
          </Button>
        )}
      </div>

      {creating && (
        <Card className="flex flex-col gap-3.5 p-5">
          <div className="text-[13.5px] font-extrabold">Nouvel événement</div>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field label="Nom">
              <input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Tournoi de printemps 2027" className={fieldClass} />
            </Field>
            <Field label="Date">
              <input type="date" value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} className={fieldClass} />
            </Field>
            <Field label="Lieu">
              <input value={lieu} onChange={(e) => setLieu(e.target.value)} className={fieldClass} />
            </Field>
            <Field label="Sport">
              <input value={sport} onChange={(e) => setSport(e.target.value)} className={fieldClass} />
            </Field>
          </div>
          <div className="flex gap-2.5">
            <Button variant="primary" className="h-9 px-4 text-[12.5px]" disabled={!nom.trim()} loading={submitting} onClick={handleCreate}>
              Créer
            </Button>
            <Button variant="tertiary" className="h-9 px-4 text-[12.5px]" onClick={() => setCreating(false)}>
              Annuler
            </Button>
          </div>
        </Card>
      )}

      {loadError && (
        <Card>
          <ErrorState message="Impossible de charger vos événements." onRetry={load} />
        </Card>
      )}

      {!loadError && editions === null && (
        <Card>
          {[0, 1, 2].map((i) => (
            <SkeletonRow key={i} />
          ))}
        </Card>
      )}

      {!loadError && editions !== null && editions.length === 0 && !creating && (
        <Card>
          <EmptyState
            icon={CalendarDays}
            title="Aucun événement pour le moment"
            description="Créez votre premier événement pour le suivre avec SportVision."
            action={canWrite ? { label: "Nouvel événement", onClick: () => setCreating(true) } : undefined}
          />
        </Card>
      )}

      {!loadError && editions !== null && editions.length > 0 && (
        <Card>
          {editions.map((edition) => {
            const dateLabel = fmtDateRange(edition.dateDebut, edition.dateFin);
            return (
              <Link
                key={edition.id}
                href={`/events/${edition.id}`}
                className="flex flex-wrap items-center gap-3.5 border-b border-divider px-5 py-4 last:border-0 hover:bg-row-hover"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-bold text-text">{edition.nom}</div>
                  <div className="mt-0.5 truncate text-[12px] text-text-soft">
                    {[dateLabel, edition.lieu, edition.sport].filter(Boolean).join(" · ") || "Informations à compléter"}
                  </div>
                </div>
                <Badge tone={STATUT_TONES[edition.statut]}>{STATUT_LABELS[edition.statut]}</Badge>
              </Link>
            );
          })}
        </Card>
      )}

      <Toast message={toastMessage} tone={toastTone} />
    </div>
  );
}

const fieldClass =
  "h-10 rounded-sv border border-border-strong bg-input-bg px-3 text-[13.5px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,84,255,.12)]";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-bold text-text-soft">{label}</span>
      {children}
    </label>
  );
}
