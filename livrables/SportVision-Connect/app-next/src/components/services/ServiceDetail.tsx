"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarPlus } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import type { Service, ServiceFile, ServiceHistoryEntry, ServiceMessage } from "@/lib/types/services";
import { SERVICE_STATUS_LABELS, SERVICE_STATUS_TONE, SERVICE_TYPE_LABELS } from "@/lib/types/services";
import { ResumeTab } from "./tabs/ResumeTab";
import { PlanningTab } from "./tabs/PlanningTab";
import { TeamTab } from "./tabs/TeamTab";
import { BriefTab } from "./tabs/BriefTab";
import { FilesTab } from "./tabs/FilesTab";
import { DeliverablesTab } from "./tabs/DeliverablesTab";
import { ValidationTab } from "./tabs/ValidationTab";
import { BillingTab } from "./tabs/BillingTab";
import { HistoryTab } from "./tabs/HistoryTab";
import { MessagesTab } from "./tabs/MessagesTab";

const TABS = [
  "Résumé",
  "Planning",
  "Équipe",
  "Brief",
  "Fichiers",
  "Livrables",
  "Validation",
  "Facturation",
  "Historique",
  "Messages",
] as const;
type TabLabel = (typeof TABS)[number];

let localSeq = 10_000;
function nextLocalId(prefix: string) {
  localSeq += 1;
  return `${prefix}-local-${localSeq}`;
}

// Fiche prestation — 10 onglets, voir ACTIONS.md § 12. Fichiers, historique et messages sont
// mutés en local uniquement (pas de backend branché, voir app-next/README.md) : les ajouts
// disparaissent au rechargement de la page, ce qui reste acceptable pour un mock d'interface.
export function ServiceDetail({ service }: { service: Service }) {
  const { ctx } = useSession();
  const [tab, setTab] = useState<TabLabel>("Résumé");
  const [horairesConfirmed, setHorairesConfirmed] = useState(service.horairesConfirmed);
  const [files, setFiles] = useState<ServiceFile[]>(service.files);
  const [history, setHistory] = useState<ServiceHistoryEntry[]>(service.history);
  const [messages, setMessages] = useState<ServiceMessage[]>(service.messages);
  const [toast, setToast] = useState<string | null>(null);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 3200);
  }

  function addHistory(label: string) {
    setHistory((h) => [
      ...h,
      { id: nextLocalId("hist"), serviceId: service.id, label, actorName: `${ctx.user.firstName} ${ctx.user.lastName}`, createdAt: new Date().toISOString() },
    ]);
  }

  function confirmHoraires() {
    if (horairesConfirmed) return;
    setHorairesConfirmed(true);
    addHistory("Horaires confirmés");
    showToast("Horaires confirmés.");
  }

  function addToCalendar() {
    showToast("Ajouté à votre calendrier.");
  }

  function proposeBriefChange(message: string) {
    addHistory("Modification de brief proposée");
    setMessages((m) => [
      ...m,
      {
        id: nextLocalId("msg"),
        serviceId: service.id,
        authorName: `${ctx.user.firstName} ${ctx.user.lastName}`,
        authorSide: "client",
        body: `Proposition de modification du brief : ${message}`,
        createdAt: new Date().toISOString(),
      },
    ]);
    showToast("Votre proposition a été envoyée.");
  }

  function addFile(file: { name: string; sizeBytes: number }) {
    setFiles((f) => [
      ...f,
      { id: nextLocalId("file"), serviceId: service.id, name: file.name, sizeBytes: file.sizeBytes, uploadedByName: `${ctx.user.firstName} ${ctx.user.lastName}`, uploadedAt: new Date().toISOString() },
    ]);
    addHistory(`Fichier ajouté — ${file.name}`);
  }

  function sendMessage(body: string) {
    setMessages((m) => [
      ...m,
      { id: nextLocalId("msg"), serviceId: service.id, authorName: `${ctx.user.firstName} ${ctx.user.lastName}`, authorSide: "client", body, createdAt: new Date().toISOString() },
    ]);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Link
            href="/services"
            aria-label="Retour aux prestations"
            className="mt-1 flex h-9 w-9 flex-none items-center justify-center rounded-[11px] border border-border-strong bg-input-bg text-text-soft"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Link>
          <div>
            <div className="flex items-center gap-2.5">
              <span className="font-mono text-[12px] text-text-faint">{service.reference}</span>
              <Badge tone={SERVICE_STATUS_TONE[service.status]}>{SERVICE_STATUS_LABELS[service.status]}</Badge>
            </div>
            <h1 className="mt-1 text-[24px] font-extrabold leading-tight tracking-tight">
              {SERVICE_TYPE_LABELS[service.serviceType]}
            </h1>
          </div>
        </div>
        <div className="flex flex-none items-center gap-2.5">
          <Button variant="secondary" onClick={addToCalendar}>
            <CalendarPlus className="h-3.5 w-3.5" aria-hidden />
            Ajouter au calendrier
          </Button>
          <Button variant="primary" onClick={confirmHoraires} disabled={horairesConfirmed}>
            {horairesConfirmed ? "Horaires confirmés" : "Confirmer les horaires"}
          </Button>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-divider">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "flex-none whitespace-nowrap border-b-2 px-3.5 py-2.5 text-[13px] font-bold transition-colors duration-sv",
              tab === t ? "border-brand-blue text-text" : "border-transparent text-text-faint hover:text-text-soft",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      <div>
        {tab === "Résumé" && <ResumeTab service={service} />}
        {tab === "Planning" && <PlanningTab service={service} />}
        {tab === "Équipe" && <TeamTab service={service} />}
        {tab === "Brief" && <BriefTab service={service} onProposeChange={proposeBriefChange} />}
        {tab === "Fichiers" && <FilesTab files={files} onAddFile={addFile} />}
        {tab === "Livrables" && <DeliverablesTab deliverables={service.deliverables} />}
        {tab === "Validation" && <ValidationTab service={service} horairesConfirmed={horairesConfirmed} onConfirm={confirmHoraires} />}
        {tab === "Facturation" && <BillingTab service={service} />}
        {tab === "Historique" && <HistoryTab history={history} />}
        {tab === "Messages" && <MessagesTab messages={messages} onSend={sendMessage} />}
      </div>

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 right-6 z-50 animate-svfade rounded-xl border border-border-strong bg-elevated px-4 py-3 text-[13px] font-semibold text-text shadow-sv-dropdown"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
