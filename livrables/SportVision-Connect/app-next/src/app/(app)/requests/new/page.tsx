"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, UploadCloud } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess, canCreate } from "@/lib/permissions";
import { PLANS } from "@/lib/plans";
import { LockedModule } from "@/components/locked/LockedModule";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Toast, useToast } from "@/components/feedback/Toast";
import { cn } from "@/lib/cn";
import { FCF_TEAM_NAMES, addVisualRequest, buildAttachment, generateRequestReference } from "@/lib/mock/studio";
import {
  URGENCY_META,
  VISUAL_FORMAT_LABELS,
  VISUAL_PLATFORM_LABELS,
  VISUAL_TYPE_LABELS,
  type RequestAttachment,
  type VisualFormat,
  type VisualPlatform,
  type VisualRequestUrgency,
  type VisualType,
} from "@/lib/types/studio";
import { VISUAL_FORMAT_OPTIONS, VISUAL_PLATFORM_OPTIONS, VISUAL_TYPE_OPTIONS } from "@/lib/mock/studio";

// Nouvelle demande de visuel — modale de la maquette implémentée en page dédiée (route explicite
// /requests/new dans README.md § Arborescence des routes). Voir ACTIONS.md § 11.
export default function NewRequestPage() {
  return (
    <Suspense fallback={null}>
      <NewRequestContent />
    </Suspense>
  );
}

function NewRequestContent() {
  const { ctx } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toastMessage, showToast } = useToast();

  const allowed = canAccess(ctx, "visual_requests");
  const canWrite = canCreate(ctx, "visual_request");

  const [visualType, setVisualType] = useState<VisualType>("other");
  const [teamName, setTeamName] = useState("");
  const [eventName, setEventName] = useState("");
  const [publishDate, setPublishDate] = useState("");
  const [format, setFormat] = useState<VisualFormat>("post_1_1");
  const [platform, setPlatform] = useState<VisualPlatform>("instagram");
  const [bodyText, setBodyText] = useState("");
  const [urgency, setUrgency] = useState<VisualRequestUrgency>("standard");
  const [attachments, setAttachments] = useState<RequestAttachment[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const prefillBody = searchParams.get("prefillBody");
    const team = searchParams.get("teamName");
    if (prefillBody) setBodyText(prefillBody);
    if (team) setTeamName(team);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!allowed) return <LockedModule title="Demandes de visuels" />;

  const plan = PLANS[ctx.subscription.planCode];
  const cost = URGENCY_META[urgency].creditCost;
  const available = ctx.subscription.creditsRemaining;
  const remainingAfter = plan.monthlyCredits === null ? null : available - cost;
  const hasEnoughCredits = plan.monthlyCredits === null || available >= cost;

  function addFiles(files: FileList | null) {
    if (!files) return;
    const next = Array.from(files).map((f) => buildAttachment(f.name, f.size));
    setAttachments((prev) => [...prev, ...next]);
  }

  function buildRequest(status: "Envoyée" | "Brouillon") {
    const reference = generateRequestReference();
    return {
      id: `req-${reference}`,
      reference,
      organizationId: ctx.organization.id,
      requestedById: ctx.user.id,
      requestedByName: `${ctx.user.firstName} ${ctx.user.lastName}`,
      visualType,
      teamName: teamName || undefined,
      eventName: eventName || undefined,
      publishDate: publishDate || new Date().toISOString().slice(0, 10),
      format,
      platform,
      bodyText: bodyText || undefined,
      urgency,
      creditsReserved: status === "Envoyée" ? cost : 0,
      status,
      revisionCount: 0,
      dueAt: publishDate || new Date().toISOString().slice(0, 10),
      attachments,
      createdAt: new Date().toISOString(),
    };
  }

  function handleSubmit() {
    if (!canWrite || !hasEnoughCredits) return;
    setSubmitting(true);
    const request = buildRequest("Envoyée");
    addVisualRequest(request);
    showToast(`Demande ${request.reference} envoyée · ${cost} crédit${cost > 1 ? "s" : ""} réservé${cost > 1 ? "s" : ""}.`);
    setTimeout(() => router.push("/requests"), 650);
  }

  function handleSaveDraft() {
    if (!canWrite) return;
    const request = buildRequest("Brouillon");
    addVisualRequest(request);
    showToast(`Brouillon ${request.reference} enregistré.`);
    setTimeout(() => router.push("/requests"), 650);
  }

  return (
    <div className="flex flex-col gap-5">
      <Link href="/requests" className="inline-flex w-fit items-center gap-1.5 text-[12.5px] font-bold text-brand-blue-electric">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        Retour aux demandes
      </Link>

      <div>
        <div className="text-[12px] font-bold text-text-soft">Communication</div>
        <h1 className="mt-1.5 text-[27px] font-extrabold leading-tight tracking-tight">Nouvelle demande de visuel</h1>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.3fr_1fr]">
        <Card className="flex flex-col gap-4 p-5">
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field label="Type de visuel">
              <select
                value={visualType}
                onChange={(e) => setVisualType(e.target.value as VisualType)}
                className="h-10 rounded-sv border border-border-strong bg-input-bg px-3 text-[13.5px] outline-none focus-visible:border-brand-blue"
              >
                {VISUAL_TYPE_OPTIONS.map((v) => (
                  <option key={v} value={v}>
                    {VISUAL_TYPE_LABELS[v]}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Équipe">
              <input
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                list="sv-new-request-teams"
                className="h-10 rounded-sv border border-border-strong bg-input-bg px-3 text-[13.5px] outline-none focus-visible:border-brand-blue"
              />
              <datalist id="sv-new-request-teams">
                {FCF_TEAM_NAMES.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </Field>

            <Field label="Événement (optionnel)">
              <input
                value={eventName}
                onChange={(e) => setEventName(e.target.value)}
                className="h-10 rounded-sv border border-border-strong bg-input-bg px-3 text-[13.5px] outline-none focus-visible:border-brand-blue"
              />
            </Field>

            <Field label="Date de publication">
              <input
                type="date"
                value={publishDate}
                onChange={(e) => setPublishDate(e.target.value)}
                className="h-10 rounded-sv border border-border-strong bg-input-bg px-3 text-[13.5px] outline-none focus-visible:border-brand-blue"
              />
            </Field>

            <Field label="Format">
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as VisualFormat)}
                className="h-10 rounded-sv border border-border-strong bg-input-bg px-3 text-[13.5px] outline-none focus-visible:border-brand-blue"
              >
                {VISUAL_FORMAT_OPTIONS.map((f) => (
                  <option key={f} value={f}>
                    {VISUAL_FORMAT_LABELS[f]}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Plateforme">
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value as VisualPlatform)}
                className="h-10 rounded-sv border border-border-strong bg-input-bg px-3 text-[13.5px] outline-none focus-visible:border-brand-blue"
              >
                {VISUAL_PLATFORM_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {VISUAL_PLATFORM_LABELS[p]}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Texte à intégrer">
            <textarea
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              rows={3}
              className="rounded-sv border border-border-strong bg-input-bg px-3 py-2 text-[13.5px] outline-none focus-visible:border-brand-blue"
            />
          </Field>

          <div className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-bold text-text-soft">Pièces jointes</span>
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragActive(false);
                addFiles(e.dataTransfer.files);
              }}
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed px-4 py-7 text-center transition-colors duration-sv",
                dragActive ? "border-brand-blue-electric bg-info-bg" : "border-border-strong bg-surface-alt",
              )}
            >
              <UploadCloud className="h-5 w-5 text-text-faint" aria-hidden />
              <span className="text-[12.5px] font-bold text-text-soft">Glissez vos fichiers ou cliquez pour en choisir</span>
              <input type="file" multiple className="sr-only" onChange={(e) => addFiles(e.target.files)} />
            </label>
            {attachments.length > 0 && (
              <ul className="mt-1 flex flex-col gap-1 text-[12.5px] text-text-soft">
                {attachments.map((a) => (
                  <li key={a.id}>{a.fileName}</li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <span className="text-[12.5px] font-bold text-text-soft">Urgence</span>
            <div className="mt-2 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              {(Object.keys(URGENCY_META) as VisualRequestUrgency[]).map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => setUrgency(u)}
                  className={cn(
                    "rounded-xl border px-3.5 py-3 text-left transition-colors duration-sv",
                    urgency === u ? "border-brand-blue-electric bg-info-bg" : "border-border-strong bg-surface-alt",
                  )}
                >
                  <div className="text-[13px] font-extrabold tracking-tight">{URGENCY_META[u].label}</div>
                  <div className="mt-0.5 text-[12px] text-text-soft">
                    {URGENCY_META[u].creditCost} crédit{URGENCY_META[u].creditCost > 1 ? "s" : ""} · {URGENCY_META[u].delayLabel}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </Card>

        <Card className="h-fit border-brand-blue-electric/40 p-5">
          <div className="text-[13px] font-extrabold tracking-tight text-brand-blue-pale">Récapitulatif</div>
          <dl className="mt-3 flex flex-col gap-2.5 text-[13px]">
            <SummaryRow label="Type" value={VISUAL_TYPE_LABELS[visualType]} />
            <SummaryRow label="Urgence" value={URGENCY_META[urgency].label} />
            <SummaryRow label="Délai" value={URGENCY_META[urgency].delayLabel} />
            <SummaryRow label="Crédits nécessaires" value={`${cost}`} />
            <SummaryRow label="Crédits disponibles" value={plan.monthlyCredits === null ? "Sur mesure" : `${available}`} />
            <SummaryRow
              label="Solde restant"
              value={remainingAfter === null ? "Suivi avec votre CM" : `${Math.max(0, remainingAfter)}`}
              emphasis
            />
          </dl>
          {!hasEnoughCredits && (
            <p className="mt-3 text-[12.5px] font-bold text-danger-fg">
              Crédits insuffisants ce mois-ci. Gérez votre offre ou attendez le renouvellement du {ctx.subscription.renewsAt}.
            </p>
          )}
          {!canWrite && (
            <p className="mt-3 text-[12.5px] font-bold text-warning-fg">
              Votre rôle ne vous permet pas d&apos;effectuer cette action. Contactez l&apos;administrateur du club.
            </p>
          )}
          <div className="mt-4 flex flex-col gap-2.5">
            <Button
              variant="primary"
              className="w-full"
              loading={submitting}
              disabled={!canWrite || !hasEnoughCredits}
              onClick={handleSubmit}
            >
              Envoyer la demande
            </Button>
            <Button variant="secondary" className="w-full" disabled={!canWrite} onClick={handleSaveDraft}>
              Enregistrer en brouillon
            </Button>
          </div>
        </Card>
      </div>

      <Toast message={toastMessage} />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-bold text-text-soft">{label}</span>
      {children}
    </div>
  );
}

function SummaryRow({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-divider pb-2 last:border-0">
      <dt className="font-semibold text-text-soft">{label}</dt>
      <dd className={cn("text-right", emphasis ? "text-[14px] font-extrabold text-text" : "font-bold text-text")}>{value}</dd>
    </div>
  );
}
