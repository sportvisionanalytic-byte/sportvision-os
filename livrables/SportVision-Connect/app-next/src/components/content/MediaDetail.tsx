"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, MessageSquarePlus, Play, Share2 } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import type { MediaAsset, MediaAssetStatus, MediaComment } from "@/lib/types/content";
import { MEDIA_KIND_LABELS, MEDIA_STATUS_LABELS, MEDIA_STATUS_TONE, formatMediaDate, formatMediaDuration, formatMediaSize } from "@/lib/types/content";
import { MediaThumb } from "./MediaThumb";

let localSeq = 0;
function nextId(prefix: string) {
  localSeq += 1;
  return `${prefix}-local-${localSeq}`;
}

// Fiche média — voir ACTIONS.md § 13. Lecteur mock (les fichiers réels ne sont pas fournis,
// voir CHARTE.md § Imagerie) : la barre de progression, les chapitres et les commentaires
// horodatés restent fonctionnels sur un temps simulé, sans lecture vidéo réelle.
export function MediaDetail({ asset }: { asset: MediaAsset }) {
  const { ctx } = useSession();
  const isTimeBased = asset.durationSeconds !== undefined;
  const duration = asset.durationSeconds ?? 0;

  const [currentTime, setCurrentTime] = useState(0);
  const [selectedVersionId, setSelectedVersionId] = useState(asset.versions.find((v) => v.isFinalVersion)?.id ?? asset.versions[0]?.id);
  const [status, setStatus] = useState<MediaAssetStatus>(asset.status);
  const [revisionCount, setRevisionCount] = useState(asset.revisionCount);
  const [comments, setComments] = useState<MediaComment[]>(asset.comments);
  const [commentDraft, setCommentDraft] = useState("");
  const [showCorrectionForm, setShowCorrectionForm] = useState(false);
  const [correctionDraft, setCorrectionDraft] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  const selectedVersion = useMemo(
    () => asset.versions.find((v) => v.id === selectedVersionId) ?? asset.versions[0],
    [asset.versions, selectedVersionId],
  );

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 3200);
  }

  function publishComment() {
    if (!commentDraft.trim()) return;
    setComments((c) => [
      ...c,
      {
        id: nextId("com"),
        mediaAssetId: asset.id,
        authorName: `${ctx.user.firstName} ${ctx.user.lastName}`,
        body: commentDraft.trim(),
        videoTimestampSeconds: isTimeBased ? Math.round(currentTime) : undefined,
        createdAt: new Date().toISOString(),
      },
    ]);
    setCommentDraft("");
  }

  function validate() {
    setStatus("validated");
    showToast("Contenu validé.");
  }

  function submitCorrection() {
    if (!correctionDraft.trim()) return;
    setStatus("revision_requested");
    setRevisionCount((n) => n + 1);
    setComments((c) => [
      ...c,
      {
        id: nextId("com"),
        mediaAssetId: asset.id,
        authorName: `${ctx.user.firstName} ${ctx.user.lastName}`,
        body: correctionDraft.trim(),
        videoTimestampSeconds: isTimeBased ? Math.round(currentTime) : undefined,
        createdAt: new Date().toISOString(),
      },
    ]);
    setCorrectionDraft("");
    setShowCorrectionForm(false);
    showToast("Correction demandée.");
  }

  function download() {
    if (!asset.downloadAllowed) {
      showToast("Le téléchargement de ce contenu n'est pas autorisé.");
      return;
    }
    showToast("Téléchargement lancé.");
  }

  function share() {
    showToast("Lien de partage sécurisé copié.");
  }

  return (
    <div className="mx-auto flex max-w-[880px] flex-col gap-5">
      <div className="flex items-start gap-3">
        <Link
          href="/content"
          aria-label="Retour à la bibliothèque"
          className="mt-1 flex h-9 w-9 flex-none items-center justify-center rounded-[11px] border border-border-strong bg-input-bg text-text-soft"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <span className="text-[11.5px] font-bold uppercase tracking-[.03em] text-text-faint">
              {MEDIA_KIND_LABELS[asset.kind]}
            </span>
            <Badge tone={MEDIA_STATUS_TONE[status]}>{MEDIA_STATUS_LABELS[status]}</Badge>
          </div>
          <h1 className="mt-1 truncate text-[22px] font-extrabold tracking-tight">{asset.name}</h1>
        </div>
      </div>

      <Card className="overflow-hidden">
        <MediaThumb kind={asset.kind} className="aspect-video w-full">
          {isTimeBased && (
            <span className="absolute flex h-14 w-14 items-center justify-center rounded-full bg-black/40 text-white">
              <Play className="h-6 w-6" aria-hidden />
            </span>
          )}
        </MediaThumb>

        {isTimeBased && (
          <div className="p-4">
            <div className="relative h-2 rounded-full bg-surface-sunken">
              <div
                className="h-full rounded-full bg-gradient-to-r from-brand-cyan to-brand-violet"
                style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
              />
              {comments
                .filter((c) => c.videoTimestampSeconds !== undefined)
                .map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    title={`${c.authorName} — ${formatMediaDuration(c.videoTimestampSeconds ?? 0)}`}
                    onClick={() => setCurrentTime(c.videoTimestampSeconds ?? 0)}
                    style={{ left: `${duration ? ((c.videoTimestampSeconds ?? 0) / duration) * 100 : 0}%` }}
                    className={cn(
                      "absolute -top-1 h-4 w-4 -translate-x-1/2 rounded-full border-2 border-surface",
                      c.resolvedAt ? "bg-success-fg" : "bg-warning-fg",
                    )}
                  />
                ))}
              <input
                type="range"
                min={0}
                max={duration}
                value={currentTime}
                onChange={(e) => setCurrentTime(Number(e.target.value))}
                aria-label="Position de lecture"
                className="absolute inset-0 h-2 w-full cursor-pointer opacity-0"
              />
            </div>
            <div className="mt-1.5 flex justify-between font-mono text-[11px] text-text-faint">
              <span>{formatMediaDuration(currentTime)}</span>
              <span>{formatMediaDuration(duration)}</span>
            </div>
          </div>
        )}
      </Card>

      {asset.chapters.length > 0 && (
        <div>
          <div className="text-[13px] font-extrabold tracking-tight">Chapitres</div>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {asset.chapters.map((ch) => (
              <button
                key={ch.id}
                type="button"
                onClick={() => setCurrentTime(ch.startSeconds)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-[12px] font-bold transition-colors duration-sv",
                  currentTime >= ch.startSeconds &&
                    (duration === 0 || currentTime < (asset.chapters.find((c2) => c2.startSeconds > ch.startSeconds)?.startSeconds ?? duration + 1))
                    ? "border-transparent bg-gradient-to-br from-brand-blue to-brand-violet text-white"
                    : "border-border-strong bg-surface text-text-soft hover:border-brand-blue-pale",
                )}
              >
                {formatMediaDuration(ch.startSeconds)} · {ch.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="text-[12.5px] font-bold text-text-soft">Version</span>
          <select
            value={selectedVersion?.id}
            onChange={(e) => setSelectedVersionId(e.target.value)}
            className="h-9 rounded-[10px] border border-border-strong bg-surface px-2.5 text-[12.5px] font-semibold outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,84,255,.12)]"
          >
            {asset.versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.version} — {v.label}
              </option>
            ))}
          </select>
        </div>
        <span className="text-[12px] text-text-faint">
          {formatMediaDate(asset.createdAt)} · {formatMediaSize(asset.sizeBytes)}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <Button variant="primary" onClick={validate} disabled={status === "validated"}>
          {status === "validated" ? "Contenu validé" : "Valider"}
        </Button>
        <Button variant="secondary" onClick={() => setShowCorrectionForm((v) => !v)}>
          Demander une correction
        </Button>
        <Button variant="secondary" onClick={download}>
          Télécharger
        </Button>
        <Button variant="tertiary" onClick={share}>
          <Share2 className="h-3.5 w-3.5" aria-hidden />
          Partager par lien sécurisé
        </Button>
      </div>
      <p className="text-[11.5px] text-text-faint">
        Deux corrections incluses, la troisième facturée. {revisionCount > 0 && `${revisionCount} déjà demandée${revisionCount > 1 ? "s" : ""}.`}
      </p>

      {showCorrectionForm && (
        <Card className="p-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-bold text-text-soft">Décrivez la correction souhaitée</span>
            <textarea
              rows={3}
              autoFocus
              value={correctionDraft}
              onChange={(e) => setCorrectionDraft(e.target.value)}
              className="resize-none rounded-xl border border-border-strong bg-surface px-3.5 py-2.5 text-[14px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,84,255,.12)]"
            />
          </label>
          <div className="mt-3 flex justify-end gap-2.5">
            <Button variant="secondary" onClick={() => setShowCorrectionForm(false)}>
              Annuler
            </Button>
            <Button variant="primary" onClick={submitCorrection} disabled={!correctionDraft.trim()}>
              Envoyer la demande
            </Button>
          </div>
        </Card>
      )}

      <div>
        <div className="text-[13px] font-extrabold tracking-tight">Commentaires</div>
        <div className="mt-2.5 flex flex-col gap-2.5">
          {comments.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border-strong px-3 py-5 text-center text-[12px] text-text-faint">
              Aucun commentaire pour le moment
            </div>
          ) : (
            comments.map((c) => (
              <div key={c.id} className="rounded-xl border border-border bg-surface-alt p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[12.5px] font-bold text-text">{c.authorName}</span>
                  {c.videoTimestampSeconds !== undefined && (
                    <button
                      type="button"
                      onClick={() => setCurrentTime(c.videoTimestampSeconds ?? 0)}
                      className="font-mono text-[11px] font-bold text-brand-blue-electric"
                    >
                      {formatMediaDuration(c.videoTimestampSeconds)}
                    </button>
                  )}
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-text-soft">{c.body}</p>
              </div>
            ))
          )}
        </div>

        <div className="mt-3 flex items-center gap-2.5">
          <input
            type="text"
            value={commentDraft}
            onChange={(e) => setCommentDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && publishComment()}
            placeholder={isTimeBased ? `Commenter à ${formatMediaDuration(currentTime)}…` : "Ajouter un commentaire…"}
            className="h-11 flex-1 rounded-xl border border-border-strong bg-surface px-3.5 text-[14px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,84,255,.12)]"
          />
          <Button variant="secondary" onClick={publishComment} disabled={!commentDraft.trim()}>
            <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden />
            Publier
          </Button>
        </div>
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
