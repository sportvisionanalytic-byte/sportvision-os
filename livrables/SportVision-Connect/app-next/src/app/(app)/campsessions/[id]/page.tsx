"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Plus, X } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess, canCreate } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/client";
import { fetchEventSession, updateEventSession, type EventSession, type EventSessionStatut } from "@/lib/data/shared/event-sessions";
import { LockedModule } from "@/components/ui/LockedModule";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { Toast, useToast } from "@/components/feedback/Toast";

// /campsessions/[id] — fiche session (Bible §15) : Aperçu éditable + Groupes/Participants légers
// (noms libres, "uniquement pour organiser contenus, albums et intervention SportVision" — aucune
// gestion d'inscription/paiement de camp construite ici, exclue explicitement par la Bible).

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
const STATUT_ORDER: EventSessionStatut[] = ["a_venir", "en_cours", "terminee", "annulee"];

export default function EventSessionPage() {
  const { ctx } = useSession();
  const params = useParams<{ id: string }>();
  const { toastMessage, toastTone, showToast } = useToast();

  const [session, setSession] = useState<EventSession | null | undefined>(undefined);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newParticipantName, setNewParticipantName] = useState("");

  const isStageOrg = ctx.organization.type === "event" && ctx.organization.eventKind === "stage";
  const allowed = isStageOrg && canAccess(ctx, "campsessions");
  const canWrite = canCreate(ctx, "event_session");

  function load() {
    const supabase = createClient();
    setLoadError(false);
    fetchEventSession(supabase, params.id)
      .then(setSession)
      .catch(() => setLoadError(true));
  }

  useEffect(() => {
    if (!allowed) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id, allowed]);

  if (!allowed) return <LockedModule title="Mes sessions" />;

  function persist(patch: Parameters<typeof updateEventSession>[2], successMessage = "Enregistré.") {
    if (!session) return;
    setSaving(true);
    const supabase = createClient();
    updateEventSession(supabase, session.id, patch)
      .then((updated) => {
        setSession(updated);
        showToast(successMessage);
      })
      .catch(() => showToast("Enregistrement impossible, réessayez.", "error"))
      .finally(() => setSaving(false));
  }

  return (
    <div className="flex flex-col gap-5">
      <Link href="/campsessions" className="inline-flex w-fit items-center gap-1.5 text-[12.5px] font-bold text-brand-blue-electric">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        Mes sessions
      </Link>

      {loadError && (
        <Card>
          <ErrorState message="Impossible de charger cette session." onRetry={load} />
        </Card>
      )}

      {!loadError && session === undefined && (
        <Card className="flex flex-col gap-3 p-5">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="mt-3 h-24 w-full" />
        </Card>
      )}

      {!loadError && session === null && (
        <Card className="p-9 text-center text-[13.5px] text-text-soft">Cette session n&apos;existe pas ou n&apos;est plus accessible.</Card>
      )}

      {!loadError && session && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-[27px] font-extrabold leading-tight tracking-tight">{session.nom}</h1>
            <Badge tone={STATUT_TONES[session.statut]}>{STATUT_LABELS[session.statut]}</Badge>
          </div>

          <Card className="flex flex-col gap-4 p-5">
            <div className="text-[13.5px] font-extrabold">Aperçu</div>
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <EditableField label="Nom" value={session.nom} onSave={(v) => persist({ nom: v })} disabled={!canWrite || saving} />
              <EditableField
                label="Date de début"
                type="date"
                value={session.dateDebut ?? ""}
                onSave={(v) => persist({ dateDebut: v || null })}
                disabled={!canWrite || saving}
              />
              <EditableField
                label="Date de fin"
                type="date"
                value={session.dateFin ?? ""}
                onSave={(v) => persist({ dateFin: v || null })}
                disabled={!canWrite || saving}
              />
              <EditableField label="Lieu" value={session.lieu ?? ""} onSave={(v) => persist({ lieu: v || null })} disabled={!canWrite || saving} />
            </div>

            {canWrite && (
              <div>
                <span className="text-[12.5px] font-bold text-text-soft">Statut</span>
                <div className="mt-2 flex flex-wrap gap-2">
                  {STATUT_ORDER.map((s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={saving}
                      onClick={() => persist({ statut: s })}
                      className={`rounded-full border px-3 py-1.5 text-[12px] font-bold transition-colors duration-sv ${
                        session.statut === s ? "border-brand-blue-electric bg-info-bg text-info-fg" : "border-border-strong text-text-soft"
                      }`}
                    >
                      {STATUT_LABELS[s]}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <EditableField
              label="Informations utiles SportVision"
              textarea
              placeholder="Contexte utile pour la production, le CM ou l'intervention SportVision…"
              value={session.infosUtiles ?? ""}
              onSave={(v) => persist({ infosUtiles: v || null })}
              disabled={!canWrite || saving}
            />
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <NameListCard
              title="Groupes"
              description="Pour organiser contenus et albums par groupe."
              names={session.groupes}
              canWrite={canWrite}
              saving={saving}
              draft={newGroupName}
              onDraftChange={setNewGroupName}
              onAdd={() => {
                persist({ groupes: [...session.groupes, newGroupName.trim()] }, "Groupe ajouté.");
                setNewGroupName("");
              }}
              onRemove={(i) => persist({ groupes: session.groupes.filter((_, idx) => idx !== i) }, "Groupe retiré.")}
              placeholder="Nom du groupe"
            />
            <NameListCard
              title="Participants"
              description="Noms libres, pas une inscription — pour briefer SportVision."
              names={session.participants}
              canWrite={canWrite}
              saving={saving}
              draft={newParticipantName}
              onDraftChange={setNewParticipantName}
              onAdd={() => {
                persist({ participants: [...session.participants, newParticipantName.trim()] }, "Participant ajouté.");
                setNewParticipantName("");
              }}
              onRemove={(i) => persist({ participants: session.participants.filter((_, idx) => idx !== i) }, "Participant retiré.")}
              placeholder="Nom du participant"
            />
          </div>
        </>
      )}

      <Toast message={toastMessage} tone={toastTone} />
    </div>
  );
}

function NameListCard({
  title,
  description,
  names,
  canWrite,
  saving,
  draft,
  onDraftChange,
  onAdd,
  onRemove,
  placeholder,
}: {
  title: string;
  description: string;
  names: string[];
  canWrite: boolean;
  saving: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
  placeholder: string;
}) {
  return (
    <Card className="flex flex-col gap-3.5 p-5">
      <div>
        <div className="text-[13.5px] font-extrabold">{title}</div>
        <p className="mt-1 text-[12px] text-text-soft">{description}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {names.length === 0 && <span className="text-[12.5px] text-text-faint">Aucun·e {title.toLowerCase()} ajouté·e.</span>}
        {names.map((name, i) => (
          <span
            key={`${name}-${i}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-border-strong bg-surface-alt px-3 py-1.5 text-[12px] font-semibold text-text"
          >
            {name}
            {canWrite && (
              <button
                type="button"
                disabled={saving}
                aria-label={`Retirer ${name}`}
                onClick={() => onRemove(i)}
                className="text-text-faint hover:text-danger-fg"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            )}
          </span>
        ))}
      </div>
      {canWrite && (
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            placeholder={placeholder}
            className="h-10 flex-1 rounded-sv border border-border-strong bg-input-bg px-3 text-[13px] outline-none focus-visible:border-brand-blue"
          />
          <Button variant="secondary" className="h-10 px-3.5 text-[12.5px]" disabled={!draft.trim() || saving} onClick={onAdd}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Ajouter
          </Button>
        </div>
      )}
    </Card>
  );
}

function EditableField({
  label,
  value,
  onSave,
  disabled,
  type = "text",
  textarea = false,
  placeholder,
}: {
  label: string;
  value: string;
  onSave: (value: string) => void;
  disabled?: boolean;
  type?: string;
  textarea?: boolean;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  function commit() {
    setEditing(false);
    if (draft !== value) onSave(draft);
  }

  const fieldClass =
    "h-10 rounded-sv border border-border-strong bg-input-bg px-3 text-[13.5px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,84,255,.12)]";

  if (disabled) {
    return (
      <label className={`flex flex-col gap-1.5 ${textarea ? "sm:col-span-2" : ""}`}>
        <span className="text-[12.5px] font-bold text-text-soft">{label}</span>
        <span className="text-[13.5px] text-text">{value || "—"}</span>
      </label>
    );
  }

  return (
    <label className={`flex flex-col gap-1.5 ${textarea ? "sm:col-span-2" : ""}`}>
      <span className="text-[12.5px] font-bold text-text-soft">{label}</span>
      {textarea ? (
        <textarea
          value={draft}
          placeholder={placeholder}
          onFocus={() => setEditing(true)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          rows={3}
          className="rounded-sv border border-border-strong bg-input-bg px-3 py-2 text-[13.5px] outline-none focus-visible:border-brand-blue"
        />
      ) : (
        <input
          type={type}
          value={draft}
          placeholder={placeholder}
          onFocus={() => setEditing(true)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          className={fieldClass}
        />
      )}
      {editing && <span className="text-[11px] text-text-faint">Enregistré à la sortie du champ.</span>}
    </label>
  );
}
