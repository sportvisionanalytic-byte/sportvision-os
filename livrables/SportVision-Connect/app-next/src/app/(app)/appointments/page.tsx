"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Phone, Users } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { useClientId } from "@/lib/data/shared/use-client-id";
import { LockedModule } from "@/components/ui/LockedModule";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Toast, useToast } from "@/components/feedback/Toast";
import { cn } from "@/lib/cn";
import { createClient } from "@/lib/supabase/client";
import { createRdv, fetchRdv, type Rdv, type RdvType } from "@/lib/data/projet/rdv";
import { fetchClientServices } from "@/lib/data/projet/services";
import { SERVICE_TYPE_LABELS } from "@/lib/types/services";
import { RDV_STATUT_LABEL, RDV_STATUT_TONE, RDV_TYPE_LABEL, formatRdvDate } from "@/components/appointments/format";

// /appointments — équivalent Next.js de ProjetModules.rdv (app/modules/projet-demandes-
// livrables-messagerie-compte.js, lignes 297-389). Ce module n'existe QUE pour l'Espace Projet
// dans le vanilla (espace: 'projet') : aucun club/coach/académie n'a de policy RLS équivalente
// sur `rendez_vous` aujourd'hui (voir data/projet/rdv.ts) — le périmètre reste identique ici,
// pas de bascule club comme /billing ou /messages. "appointments" est donc volontairement absent
// de READY_MODULES (voir entitlements.ts) : le gate se fait uniquement sur le type d'organisation,
// même pattern que /services (services/page.tsx).
export default function AppointmentsPage() {
  const { ctx } = useSession();
  if (ctx.organization.type !== "generic") return <LockedModule title="Rendez-vous" />;
  return <AppointmentsView />;
}

interface PrestationOption {
  id: string;
  label: string;
}

function AppointmentsView() {
  const { ctx } = useSession();
  const resolution = useClientId();

  if (resolution.status === "locked") return <LockedModule title="Rendez-vous" />;
  if (resolution.status === "loading") {
    return <div className="py-16 text-center text-[13px] text-text-soft">Chargement…</div>;
  }
  if (resolution.status === "not_linked") {
    return (
      <div className="flex flex-col gap-5">
        <h1 className="text-[29px] font-extrabold tracking-tight">Rendez-vous</h1>
        <Card className="flex flex-col items-center gap-2 px-8 py-16 text-center">
          <div className="max-w-md text-[13.5px] text-text-soft">
            SportVision n&apos;a pas encore relié {ctx.organization.name} à un espace Rendez-vous. Contactez votre
            interlocuteur SportVision pour l&apos;activer.
          </div>
        </Card>
      </div>
    );
  }

  return <AppointmentsContent clientId={resolution.clientId} />;
}

function AppointmentsContent({ clientId }: { clientId: string }) {
  const { toastMessage, toastTone, showToast } = useToast();

  const [rdvList, setRdvList] = useState<Rdv[] | null>(null);
  const [prestations, setPrestations] = useState<PrestationOption[]>([]);
  const [loadError, setLoadError] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [type, setType] = useState<RdvType | null>(null);
  const [date, setDate] = useState("");
  const [heure, setHeure] = useState("");
  const [objet, setObjet] = useState("");
  const [prestationId, setPrestationId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  async function reload() {
    setLoadError(false);
    try {
      const supabase = createClient();
      const [rdvRows, services] = await Promise.all([
        fetchRdv(supabase, clientId),
        fetchClientServices(supabase, clientId),
      ]);
      setRdvList(rdvRows);
      setPrestations(services.map((s) => ({ id: s.id, label: `${SERVICE_TYPE_LABELS[s.serviceType]} — ${s.reference}` })));
    } catch {
      setLoadError(true);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  function resetForm() {
    setType(null);
    setDate("");
    setHeure("");
    setObjet("");
    setPrestationId("");
    setFormError("");
  }

  function handleSubmit() {
    if (submitting) return;
    if (!type) {
      setFormError("Merci de choisir un type de rendez-vous.");
      return;
    }
    if (!date || !heure) {
      setFormError("Merci de choisir une date et un horaire.");
      return;
    }
    if (heure < "07:00" || heure > "22:00") {
      setFormError("Merci de choisir un horaire entre 7h et 22h.");
      return;
    }
    setFormError("");
    setSubmitting(true);
    const supabase = createClient();
    createRdv(supabase, clientId, {
      typeRdv: type,
      date,
      heure,
      objet: objet.trim() || undefined,
      prestationId: prestationId || null,
    })
      .then(() => {
        setFormOpen(false);
        resetForm();
        showToast("Demande de rendez-vous envoyée.");
        return reload();
      })
      .catch(() => setFormError("Impossible d'envoyer la demande de rendez-vous. Réessayez."))
      .finally(() => setSubmitting(false));
  }

  const list = rdvList ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[12px] font-bold text-text-soft">SportVision</div>
          <h1 className="mt-1.5 text-[29px] font-extrabold leading-tight tracking-tight">Mes rendez-vous</h1>
        </div>
        {!formOpen && (
          <Button
            variant="primary"
            onClick={() => {
              resetForm();
              setFormOpen(true);
            }}
          >
            + Nouveau rendez-vous
          </Button>
        )}
      </div>

      {loadError && (
        <Card className="flex flex-wrap items-center gap-3 border-danger-fg/30 bg-danger-bg px-5 py-4">
          <span className="min-w-0 flex-1 text-[13px] font-semibold text-danger-fg">
            Impossible de charger vos rendez-vous.
          </span>
          <Button variant="secondary" className="h-8 flex-none px-3 text-[12px]" onClick={reload}>
            Réessayer
          </Button>
        </Card>
      )}

      {formOpen && (
        <Card className="flex flex-col gap-4 p-5">
          <Field label="Type de rendez-vous">
            <div className="flex flex-wrap gap-2">
              <TypePill icon={Phone} label="Appel téléphonique" active={type === "appel"} onClick={() => setType("appel")} />
              <TypePill icon={Users} label="Rendez-vous physique" active={type === "physique"} onClick={() => setType("physique")} />
            </div>
          </Field>

          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field label="Date">
              <input
                type="date"
                value={date}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setDate(e.target.value)}
                className="h-10 rounded-sv border border-border-strong bg-input-bg px-3 text-[13.5px] outline-none focus-visible:border-brand-blue"
              />
            </Field>
            <Field label="Horaire (entre 7h et 22h)">
              <input
                type="time"
                value={heure}
                min="07:00"
                max="22:00"
                onChange={(e) => setHeure(e.target.value)}
                className="h-10 rounded-sv border border-border-strong bg-input-bg px-3 text-[13.5px] outline-none focus-visible:border-brand-blue"
              />
            </Field>
          </div>

          <Field label="Objet (facultatif)">
            <input
              type="text"
              value={objet}
              onChange={(e) => setObjet(e.target.value)}
              placeholder="Ex : point sur la prestation"
              className="h-10 rounded-sv border border-border-strong bg-input-bg px-3 text-[13.5px] outline-none focus-visible:border-brand-blue"
            />
          </Field>

          {prestations.length > 0 && (
            <Field label="Concerne une demande en cours ?">
              <select
                value={prestationId}
                onChange={(e) => setPrestationId(e.target.value)}
                className="h-10 rounded-sv border border-border-strong bg-input-bg px-3 text-[13.5px] outline-none focus-visible:border-brand-blue"
              >
                <option value="">Aucune — nouveau projet</option>
                {prestations.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {formError && <p className="text-[12.5px] font-semibold text-danger-fg">{formError}</p>}

          <div className="flex flex-wrap gap-2.5">
            <Button variant="primary" loading={submitting} onClick={handleSubmit}>
              Confirmer la demande
            </Button>
            <Button
              variant="secondary"
              disabled={submitting}
              onClick={() => {
                setFormOpen(false);
                resetForm();
              }}
            >
              Annuler
            </Button>
          </div>
        </Card>
      )}

      {rdvList === null ? (
        <div className="py-16 text-center text-[13px] text-text-soft">Chargement des rendez-vous…</div>
      ) : list.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 px-8 py-16 text-center">
          <CalendarClock className="h-6 w-6 text-text-faint" aria-hidden />
          <div className="mt-1 text-[15px] font-extrabold">Aucun rendez-vous pour le moment.</div>
        </Card>
      ) : (
        <Card>
          {list.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3.5 border-b border-divider px-5 py-3.5 last:border-0">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-bold text-text">{r.objet || "Rendez-vous"}</span>
                <span className="mt-0.5 block truncate text-[12px] text-text-soft">
                  {RDV_TYPE_LABEL[r.typeRdv]} · {formatRdvDate(r.dateDemandee, r.heureDemandee)}
                </span>
              </span>
              <Badge tone={RDV_STATUT_TONE[r.statut]}>{RDV_STATUT_LABEL[r.statut]}</Badge>
            </div>
          ))}
        </Card>
      )}

      <Toast message={toastMessage} tone={toastTone} />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-bold text-text-soft">{label}</span>
      {children}
    </label>
  );
}

function TypePill({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: typeof Phone;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[12.5px] font-bold transition-colors duration-sv",
        active
          ? "border-transparent bg-gradient-to-br from-brand-blue to-brand-violet text-white"
          : "border-border-strong bg-transparent text-text-soft hover:border-brand-blue-electric",
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label}
    </button>
  );
}
