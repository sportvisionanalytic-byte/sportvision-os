"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Tent } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess, canCreate } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/client";
import { createEventSession, fetchEventSessions, type EventSession, type EventSessionStatut } from "@/lib/data/shared/event-sessions";
import { LockedModule } from "@/components/ui/LockedModule";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonRow } from "@/components/ui/Skeleton";
import { Toast, useToast } from "@/components/feedback/Toast";

// /campsessions — "Mes sessions" (Bible §15, organisation.eventKind === "stage"). Objet central
// "Session" d'un organisateur de stage/camp (event_sessions, migration-clubplus-v43, NON
// EXÉCUTÉE) — distinct de /sessions (séances individuelles d'un coach indépendant) et de /camps
// (stages lus en lecture seule pour une académie, calendar_events), les deux hors périmètre ici.

const STATUT_LABELS: Record<EventSessionStatut, string> = {
  a_venir: "À venir",
  en_cours: "En cours",
  terminee: "Terminée",
  annulee: "Annulée",
};

const STATUT_TONES: Record<EventSessionStatut, BadgeTone> = {
  a_venir: "info",
  en_cours: "accent",
  terminee: "success",
  annulee: "neutral",
};

function fmtDateRange(debut: string | null, fin: string | null): string | null {
  if (!debut) return null;
  const d = new Date(debut);
  if (Number.isNaN(d.getTime())) return null;
  const start = d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  if (!fin || fin === debut) return start;
  const f = new Date(fin);
  if (Number.isNaN(f.getTime())) return start;
  return `${d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} – ${f.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}`;
}

export default function CampSessionsPage() {
  const { ctx } = useSession();
  const { toastMessage, toastTone, showToast } = useToast();

  const [sessions, setSessions] = useState<EventSession[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [nom, setNom] = useState("");
  const [dateDebut, setDateDebut] = useState("");
  const [lieu, setLieu] = useState("");

  const isStageOrg = ctx.organization.type === "event" && ctx.organization.eventKind === "stage";
  const allowed = isStageOrg && canAccess(ctx, "campsessions");
  const canWrite = canCreate(ctx, "event_session");

  function load() {
    const supabase = createClient();
    setLoadError(false);
    fetchEventSessions(supabase, ctx.organization.id)
      .then(setSessions)
      .catch(() => setLoadError(true));
  }

  useEffect(() => {
    if (!allowed) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.organization.id, allowed]);

  if (!allowed) return <LockedModule title="Mes sessions" />;

  function handleCreate() {
    if (!nom.trim() || submitting) return;
    setSubmitting(true);
    const supabase = createClient();
    createEventSession(supabase, ctx.organization.id, { nom: nom.trim(), dateDebut: dateDebut || undefined, lieu: lieu.trim() || undefined })
      .then((session) => {
        setSessions((prev) => [session, ...(prev ?? [])]);
        setNom("");
        setDateDebut("");
        setLieu("");
        setCreating(false);
        showToast("Session créée.");
      })
      .catch(() => showToast("Création impossible, réessayez.", "error"))
      .finally(() => setSubmitting(false));
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[29px] font-extrabold leading-tight tracking-tight">Mes sessions</h1>
          <p className="mt-1.5 max-w-xl text-[13.5px] text-text-soft">
            Les sessions de {ctx.organization.name} suivies par SportVision.
          </p>
        </div>
        {canWrite && !creating && (
          <Button variant="primary" className="h-10 px-4 text-[13px]" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            Nouvelle session
          </Button>
        )}
      </div>

      {creating && (
        <Card className="flex flex-col gap-3.5 p-5">
          <div className="text-[13.5px] font-extrabold">Nouvelle session</div>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
            <Field label="Nom">
              <input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Stage de Toussaint 2027" className={fieldClass} />
            </Field>
            <Field label="Date">
              <input type="date" value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} className={fieldClass} />
            </Field>
            <Field label="Lieu">
              <input value={lieu} onChange={(e) => setLieu(e.target.value)} className={fieldClass} />
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
          <ErrorState message="Impossible de charger vos sessions." onRetry={load} />
        </Card>
      )}

      {!loadError && sessions === null && (
        <Card>
          {[0, 1, 2].map((i) => (
            <SkeletonRow key={i} />
          ))}
        </Card>
      )}

      {!loadError && sessions !== null && sessions.length === 0 && !creating && (
        <Card>
          <EmptyState
            icon={Tent}
            title="Aucune session pour le moment"
            description="Créez votre première session pour la suivre avec SportVision."
            action={canWrite ? { label: "Nouvelle session", onClick: () => setCreating(true) } : undefined}
          />
        </Card>
      )}

      {!loadError && sessions !== null && sessions.length > 0 && (
        <Card>
          {sessions.map((session) => {
            const dateLabel = fmtDateRange(session.dateDebut, session.dateFin);
            return (
              <Link
                key={session.id}
                href={`/campsessions/${session.id}`}
                className="flex flex-wrap items-center gap-3.5 border-b border-divider px-5 py-4 last:border-0 hover:bg-row-hover"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-bold text-text">{session.nom}</div>
                  <div className="mt-0.5 truncate text-[12px] text-text-soft">
                    {[dateLabel, session.lieu, session.groupes.length > 0 ? `${session.groupes.length} groupe${session.groupes.length > 1 ? "s" : ""}` : null]
                      .filter(Boolean)
                      .join(" · ") || "Informations à compléter"}
                  </div>
                </div>
                <Badge tone={STATUT_TONES[session.statut]}>{STATUT_LABELS[session.statut]}</Badge>
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
