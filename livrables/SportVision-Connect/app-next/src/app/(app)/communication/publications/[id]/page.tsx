"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Send } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { LockedModule } from "@/components/ui/LockedModule";
import { StatusStepper } from "@/components/communication/StatusStepper";
import { ToastViewport } from "@/components/communication/ToastViewport";
import { useToast } from "@/components/communication/useToast";
import { publicationStatusTone } from "@/components/communication/statusTone";
import { getCommentsForPublication, getHistoryForPublication, getPublicationById } from "@/lib/mock/communication";
import {
  FORMAT_LABELS,
  PLATFORM_LABELS,
  PUBLICATION_STATUS_LABELS,
  type PublicationComment,
  type PublicationHistoryEntry,
  type PublicationStatus,
} from "@/lib/types/communication";

export default function PublicationDetailPage({ params }: { params: { id: string } }) {
  const { ctx } = useSession();
  if (!canAccess(ctx, "communication")) return <LockedModule />;
  return <PublicationDetail id={params.id} />;
}

function PublicationDetail({ id }: { id: string }) {
  const { ctx } = useSession();
  const router = useRouter();
  const { toasts, showToast } = useToast();

  const initial = useMemo(() => getPublicationById(id), [id]);
  const [publication, setPublication] = useState(initial);
  const [comments, setComments] = useState<PublicationComment[]>(() => getCommentsForPublication(id));
  const [history, setHistory] = useState<PublicationHistoryEntry[]>(() => getHistoryForPublication(id));
  const [commentDraft, setCommentDraft] = useState("");
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionDraft, setCorrectionDraft] = useState("");

  if (!publication) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <p className="text-[15px] font-bold text-text-soft">Cette publication est introuvable.</p>
        <Button variant="secondary" onClick={() => router.push("/communication")}>
          Retour au planning
        </Button>
      </div>
    );
  }

  const authorName = `${ctx.user.firstName} ${ctx.user.lastName}`;

  function addHistory(toStatus: PublicationStatus) {
    setHistory((prev) => [
      ...prev,
      { id: `h-${Date.now()}`, publicationId: publication!.id, toStatus, actorName: authorName, at: new Date().toISOString() },
    ]);
  }

  function handleValidate() {
    setPublication((p) => (p ? { ...p, status: "validated" } : p));
    addHistory("validated");
    showToast("Publication validée, elle part en programmation.");
  }

  function handleSubmitCorrection(e: React.FormEvent) {
    e.preventDefault();
    if (!correctionDraft.trim()) return;
    setComments((prev) => [
      ...prev,
      { id: `c-${Date.now()}`, publicationId: publication!.id, authorName, authorSide: "client", body: correctionDraft.trim(), createdAt: new Date().toISOString() },
    ]);
    setPublication((p) => (p ? { ...p, status: "corrections", revisionCount: p.revisionCount + 1 } : p));
    addHistory("corrections");
    setCorrectionDraft("");
    setCorrectionOpen(false);
    showToast("Correction demandée à votre Community Manager.");
  }

  function handleAddComment(e: React.FormEvent) {
    e.preventDefault();
    if (!commentDraft.trim()) return;
    setComments((prev) => [
      ...prev,
      { id: `c-${Date.now()}`, publicationId: publication!.id, authorName, authorSide: "client", body: commentDraft.trim(), createdAt: new Date().toISOString() },
    ]);
    setCommentDraft("");
  }

  const infoItems: { label: string; value: string }[] = [
    { label: "Plateforme", value: PLATFORM_LABELS[publication.platform] },
    { label: "Format", value: FORMAT_LABELS[publication.format] },
    { label: "Date de publication prévue", value: formatDateTime(publication.scheduledAt) },
    { label: "Objectif", value: publication.objective ?? "Non renseigné" },
    { label: "Sponsor associé", value: publication.sponsorId ? "Oui" : "Aucun" },
    { label: "Corrections", value: `${publication.revisionCount} / 2 incluses` },
  ];

  return (
    <div className="flex flex-col gap-5">
      <button
        onClick={() => router.push("/communication")}
        className="inline-flex w-fit items-center gap-1.5 text-[12.5px] font-bold text-text-soft hover:text-text"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        Retour au planning
      </button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-bold text-text-soft">
              {PLATFORM_LABELS[publication.platform]} · {FORMAT_LABELS[publication.format]}
            </span>
            <Badge tone={publicationStatusTone(publication.status)}>{PUBLICATION_STATUS_LABELS[publication.status]}</Badge>
          </div>
          <h1 className="mt-1.5 text-[24px] font-extrabold tracking-tight">{publication.title}</h1>
        </div>
        <div className="flex flex-wrap gap-2.5">
          {publication.status === "to_validate" && (
            <>
              <Button
                variant="secondary"
                onClick={() => setCorrectionOpen((v) => !v)}
              >
                Demander une correction
              </Button>
              <Button
                variant="primary"
                className="bg-[linear-gradient(135deg,#28C995,#00C8FF)]"
                onClick={handleValidate}
              >
                Valider la publication
              </Button>
            </>
          )}
        </div>
      </div>

      <Card className="p-5">
        <StatusStepper status={publication.status} />
      </Card>

      {correctionOpen && (
        <Card className="p-5">
          <form onSubmit={handleSubmitCorrection} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-bold text-text-soft">Que faut-il corriger ?</span>
              <textarea
                required
                rows={3}
                value={correctionDraft}
                onChange={(e) => setCorrectionDraft(e.target.value)}
                placeholder="Décrivez la correction attendue…"
                className="resize-none rounded-xl border border-border-strong bg-surface px-3.5 py-3 text-[14px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,75,255,.12)]"
              />
            </label>
            <div className="flex justify-end gap-2.5">
              <Button type="button" variant="secondary" onClick={() => setCorrectionOpen(false)}>
                Annuler
              </Button>
              <Button type="submit" variant="dark">
                Envoyer la demande de correction
              </Button>
            </div>
          </form>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="flex flex-col gap-4">
          <Card className="p-5">
            <div className="text-[13px] font-extrabold uppercase tracking-[.06em] text-text-faint">Texte</div>
            <p className="mt-2 text-[14px] leading-relaxed text-text">{publication.bodyText || "Aucun texte renseigné pour cette publication."}</p>
            {publication.hashtags.length > 0 && (
              <div className="mt-3.5 flex flex-wrap gap-1.5">
                {publication.hashtags.map((h) => (
                  <span key={h} className="rounded-full bg-info-bg px-2.5 py-1 text-[11.5px] font-bold text-info-fg">
                    {h}
                  </span>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-5">
            <div className="text-[13px] font-extrabold uppercase tracking-[.06em] text-text-faint">Commentaires</div>
            <div className="mt-3 flex flex-col gap-3">
              {comments.length === 0 && <p className="text-[13px] text-text-soft">Aucun commentaire pour l&apos;instant.</p>}
              {comments.map((c) => (
                <div key={c.id} className="rounded-xl border border-border bg-surface-alt p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[12.5px] font-extrabold text-text">{c.authorName}</span>
                    <span className="text-[11px] text-text-faint">{formatDateTime(c.createdAt)}</span>
                  </div>
                  <p className="mt-1 text-[13px] leading-relaxed text-text-soft">{c.body}</p>
                </div>
              ))}
            </div>
            <form onSubmit={handleAddComment} className="mt-3.5 flex items-end gap-2.5">
              <textarea
                rows={1}
                value={commentDraft}
                onChange={(e) => setCommentDraft(e.target.value)}
                placeholder="Ajouter un commentaire…"
                className="flex-1 resize-none rounded-xl border border-border-strong bg-surface px-3.5 py-2.5 text-[13.5px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,75,255,.12)]"
              />
              <Button type="submit" variant="secondary" disabled={!commentDraft.trim()}>
                <Send className="h-3.5 w-3.5" aria-hidden />
                Envoyer
              </Button>
            </form>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card className="p-5">
            <div className="text-[13px] font-extrabold uppercase tracking-[.06em] text-text-faint">Informations</div>
            <dl className="mt-3 flex flex-col gap-2.5">
              {infoItems.map((item) => (
                <div key={item.label} className="flex items-center justify-between gap-3 border-b border-divider pb-2.5 last:border-0 last:pb-0">
                  <dt className="text-[12.5px] font-semibold text-text-soft">{item.label}</dt>
                  <dd className="text-[12.5px] font-bold text-text">{item.value}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card className="p-5">
            <div className="text-[13px] font-extrabold uppercase tracking-[.06em] text-text-faint">Historique</div>
            <div className="mt-3 flex flex-col gap-3">
              {history.map((h) => (
                <div key={h.id} className="flex gap-2.5">
                  <span className="mt-1 h-1.5 w-1.5 flex-none rounded-full bg-brand-blue-electric" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-bold text-text">{PUBLICATION_STATUS_LABELS[h.toStatus]}</div>
                    <div className="text-[11.5px] text-text-faint">
                      {h.actorName} · {formatDateTime(h.at)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <ToastViewport toasts={toasts} />
    </div>
  );
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}
