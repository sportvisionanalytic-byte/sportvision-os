"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Plus, Trophy, X } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess, canCreate } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/client";
import { fetchEventEdition, updateEventEdition, type EventEdition, type EventEditionStatut } from "@/lib/data/shared/event-editions";
import { LockedModule } from "@/components/ui/LockedModule";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { Toast, useToast } from "@/components/feedback/Toast";

// /events/[id] — fiche événement (Bible §14) : Aperçu + Bilan léger éditables, équipes
// participantes (noms libres). "Le bilan ne consomme aucun crédit ; demander un visuel est une
// action séparée" (§14) : aucun lien vers /requests/new n'est ajouté ici, hors périmètre de ce
// chantier (le CM demande un visuel depuis Communication comme pour un résultat de match, §18).

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
const STATUT_ORDER: EventEditionStatut[] = ["a_venir", "en_cours", "terminee", "annulee"];

export default function EventEditionPage() {
  const { ctx } = useSession();
  const params = useParams<{ id: string }>();
  const { toastMessage, toastTone, showToast } = useToast();

  const [edition, setEdition] = useState<EventEdition | null | undefined>(undefined);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");

  const isTournoiOrg = ctx.organization.type === "tournament_organizer";
  const allowed = isTournoiOrg && canAccess(ctx, "events");
  const canWrite = canCreate(ctx, "event_edition");

  function load() {
    const supabase = createClient();
    setLoadError(false);
    fetchEventEdition(supabase, params.id)
      .then(setEdition)
      .catch(() => setLoadError(true));
  }

  useEffect(() => {
    if (!allowed) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id, allowed]);

  if (!allowed) return <LockedModule title="Mes événements" />;

  function persist(patch: Parameters<typeof updateEventEdition>[2], successMessage = "Enregistré.") {
    if (!edition) return;
    setSaving(true);
    const supabase = createClient();
    updateEventEdition(supabase, edition.id, patch)
      .then((updated) => {
        setEdition(updated);
        showToast(successMessage);
      })
      .catch(() => showToast("Enregistrement impossible, réessayez.", "error"))
      .finally(() => setSaving(false));
  }

  return (
    <div className="flex flex-col gap-5">
      <Link href="/events" className="inline-flex w-fit items-center gap-1.5 text-[12.5px] font-bold text-brand-blue-electric">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        Mes événements
      </Link>

      {loadError && (
        <Card>
          <ErrorState message="Impossible de charger cet événement." onRetry={load} />
        </Card>
      )}

      {!loadError && edition === undefined && (
        <Card className="flex flex-col gap-3 p-5">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="mt-3 h-24 w-full" />
        </Card>
      )}

      {!loadError && edition === null && (
        <Card className="p-9 text-center text-[13.5px] text-text-soft">Cet événement n&apos;existe pas ou n&apos;est plus accessible.</Card>
      )}

      {!loadError && edition && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-[27px] font-extrabold leading-tight tracking-tight">{edition.nom}</h1>
            <Badge tone={STATUT_TONES[edition.statut]}>{STATUT_LABELS[edition.statut]}</Badge>
          </div>

          <Card className="flex flex-col gap-4 p-5">
            <div className="text-[13.5px] font-extrabold">Aperçu</div>
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <EditableField label="Nom" value={edition.nom} onSave={(v) => persist({ nom: v })} disabled={!canWrite || saving} />
              <EditableField
                label="Date de début"
                type="date"
                value={edition.dateDebut ?? ""}
                onSave={(v) => persist({ dateDebut: v || null })}
                disabled={!canWrite || saving}
              />
              <EditableField
                label="Date de fin"
                type="date"
                value={edition.dateFin ?? ""}
                onSave={(v) => persist({ dateFin: v || null })}
                disabled={!canWrite || saving}
              />
              <EditableField label="Lieu" value={edition.lieu ?? ""} onSave={(v) => persist({ lieu: v || null })} disabled={!canWrite || saving} />
              <EditableField label="Sport" value={edition.sport ?? ""} onSave={(v) => persist({ sport: v || null })} disabled={!canWrite || saving} />
              <EditableField label="Format" value={edition.format ?? ""} onSave={(v) => persist({ format: v || null })} disabled={!canWrite || saving} />
              <EditableField
                label="Contact"
                value={edition.contactNom ?? ""}
                onSave={(v) => persist({ contactNom: v || null })}
                disabled={!canWrite || saving}
              />
              <EditableField
                label="Email de contact"
                value={edition.contactEmail ?? ""}
                onSave={(v) => persist({ contactEmail: v || null })}
                disabled={!canWrite || saving}
              />
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
                        edition.statut === s ? "border-brand-blue-electric bg-info-bg text-info-fg" : "border-border-strong text-text-soft"
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
              placeholder="Volume participants/équipes, terrains, horaires clés, finale/remise des récompenses…"
              value={edition.infosUtiles ?? ""}
              onSave={(v) => persist({ infosUtiles: v || null })}
              disabled={!canWrite || saving}
            />
          </Card>

          <Card className="flex flex-col gap-3.5 p-5">
            <div>
              <div className="text-[13.5px] font-extrabold">Équipes participantes</div>
              <p className="mt-1 text-[12px] text-text-soft">Facultatif — pour identifier vos contenus et briefs, pas une inscription.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {edition.equipesParticipantes.length === 0 && <span className="text-[12.5px] text-text-faint">Aucune équipe ajoutée.</span>}
              {edition.equipesParticipantes.map((team, i) => (
                <span
                  key={`${team}-${i}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border-strong bg-surface-alt px-3 py-1.5 text-[12px] font-semibold text-text"
                >
                  {team}
                  {canWrite && (
                    <button
                      type="button"
                      disabled={saving}
                      aria-label={`Retirer ${team}`}
                      onClick={() =>
                        persist({ equipesParticipantes: edition.equipesParticipantes.filter((_, idx) => idx !== i) }, "Équipe retirée.")
                      }
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
                  value={newTeamName}
                  onChange={(e) => setNewTeamName(e.target.value)}
                  placeholder="Nom de l'équipe"
                  className="h-10 flex-1 rounded-sv border border-border-strong bg-input-bg px-3 text-[13px] outline-none focus-visible:border-brand-blue"
                />
                <Button
                  variant="secondary"
                  className="h-10 px-3.5 text-[12.5px]"
                  disabled={!newTeamName.trim() || saving}
                  onClick={() => {
                    persist({ equipesParticipantes: [...edition.equipesParticipantes, newTeamName.trim()] }, "Équipe ajoutée.");
                    setNewTeamName("");
                  }}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  Ajouter
                </Button>
              </div>
            )}
          </Card>

          <Card className="flex flex-col gap-4 p-5">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-accent-bg text-accent-fg">
                <Trophy className="h-4 w-4" aria-hidden />
              </span>
              <div>
                <div className="text-[13.5px] font-extrabold">Bilan léger</div>
                <p className="mt-0.5 text-[12px] text-text-soft">Vainqueur, finaliste, score, MVP — tout est facultatif.</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <EditableField label="Vainqueur" value={edition.bilanVainqueur ?? ""} onSave={(v) => persist({ bilanVainqueur: v || null })} disabled={!canWrite || saving} />
              <EditableField label="Finaliste" value={edition.bilanFinaliste ?? ""} onSave={(v) => persist({ bilanFinaliste: v || null })} disabled={!canWrite || saving} />
              <EditableField label="Score de la finale" value={edition.bilanScoreFinale ?? ""} onSave={(v) => persist({ bilanScoreFinale: v || null })} disabled={!canWrite || saving} />
              <EditableField label="MVP" value={edition.bilanMvp ?? ""} onSave={(v) => persist({ bilanMvp: v || null })} disabled={!canWrite || saving} />
            </div>
            <EditableField
              label="Autres distinctions"
              textarea
              value={edition.bilanDistinctions ?? ""}
              onSave={(v) => persist({ bilanDistinctions: v || null })}
              disabled={!canWrite || saving}
            />
          </Card>
        </>
      )}

      <Toast message={toastMessage} tone={toastTone} />
    </div>
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
