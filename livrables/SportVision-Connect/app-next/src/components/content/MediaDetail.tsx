"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Eye, Heart, LifeBuoy, Play, Share2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import type { MediaAsset, MediaAssetStatus, MediaComment, MediaVisibility } from "@/lib/types/content";
import { MEDIA_KIND_LABELS, MEDIA_STATUS_LABELS, MEDIA_STATUS_TONE, formatMediaDate, formatMediaDuration, formatMediaSize } from "@/lib/types/content";
import { MediaThumb } from "./MediaThumb";
import { VisibilityEditor } from "./VisibilityEditor";
import type { ContentVisibilityMode } from "@/lib/data/club/content";

// Visibilité vers Connect — Bible §17. Couvre les 5 valeurs de MediaVisibility par sûreté de
// typage, mais seules "organization"/"team"/"player" sont réellement produites par
// fetchClubMediaAssets (voir data/club/content.ts) : "private"/"public" n'apparaissent jamais en
// pratique aujourd'hui.
const VISIBILITY_LABEL: Record<MediaVisibility, string> = {
  private: "Privé",
  organization: "Privé Club+",
  team: "Affiliés du groupe",
  player: "Sportifs sélectionnés",
  public: "Automatique pour tous",
};

// Fiche média — voir ACTIONS.md § 13. Lecteur mock (les fichiers réels ne sont pas fournis,
// voir CHARTE.md § Imagerie) : la barre de progression et les chapitres restent fonctionnels sur
// un temps simulé, sans lecture vidéo réelle.
//
// Valider / Demander une correction / Publier un commentaire retirés le 09/08 (audit contenu) :
// club_media et club_creations (data/club/content.ts) n'exposent ni colonne de statut inscriptible
// depuis le client, ni table de commentaires réelle — les anciennes versions de ces actions
// faisaient un setState local (status/revisionCount/comments) suivi d'un toast de confirmation
// sans aucune écriture réelle, exactement l'anti-pattern documenté au README § Conventions n°9.
// Statut et commentaires restent donc affichés en lecture seule depuis `asset`.
interface MediaDetailProps {
  asset: MediaAsset;
  /** Espace Joueur uniquement (brief § 9) — voir content/[id]/page.tsx. `undefined` = pas de
   * coeur affiché, comportement inchangé pour club/générique. */
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  /** Admin/CM du club uniquement (Bible §17) — jamais pour l'espace Joueur ni l'espace Projet,
   * voir content/[id]/page.tsx (`canEditVisibility`). Le backend (RLS is_club_admin/
   * is_team_educateur) reste la vraie barrière si ce garde frontend était contourné. */
  canEditVisibility?: boolean;
}

export function MediaDetail({ asset, isFavorite, onToggleFavorite, canEditVisibility }: MediaDetailProps) {
  const isTimeBased = asset.durationSeconds !== undefined;
  const duration = asset.durationSeconds ?? 0;
  const status: MediaAssetStatus = asset.status;
  const revisionCount = asset.revisionCount;
  const comments: MediaComment[] = asset.comments;

  const [currentTime, setCurrentTime] = useState(0);
  const [selectedVersionId, setSelectedVersionId] = useState(asset.versions.find((v) => v.isFinalVersion)?.id ?? asset.versions[0]?.id);
  const [toast, setToast] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<MediaVisibility>(asset.visibility);
  const [visibilityEditorOpen, setVisibilityEditorOpen] = useState(false);

  const selectedVersion = useMemo(
    () => asset.versions.find((v) => v.id === selectedVersionId) ?? asset.versions[0],
    [asset.versions, selectedVersionId],
  );

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 3200);
  }

  // Ouvre le vrai fichier (fileUrl réel, colonne `link`/`lien_url` en base) plutôt que d'afficher
  // un faux "Téléchargement lancé." sans rien déclencher.
  function download() {
    if (!asset.downloadAllowed) {
      showToast("Le téléchargement de ce contenu n'est pas autorisé.");
      return;
    }
    if (!asset.fileUrl) {
      showToast("Aucun fichier disponible pour ce contenu.");
      return;
    }
    window.open(asset.fileUrl, "_blank", "noopener,noreferrer");
  }

  // Copie le vrai lien (pas de mécanisme de lien sécurisé à expiration côté backend, voir
  // data/club/content.ts) plutôt que de prétendre à un lien "sécurisé" qui n'existe pas.
  function share() {
    if (!asset.fileUrl) {
      showToast("Aucun lien disponible pour ce contenu.");
      return;
    }
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(asset.fileUrl).catch(() => undefined);
    }
    showToast("Lien copié dans le presse-papiers.");
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
          {canEditVisibility ? (
            <button
              type="button"
              onClick={() => setVisibilityEditorOpen(true)}
              className="mt-1.5 flex items-center gap-1.5 text-[12px] font-bold text-text-soft hover:text-info-fg"
            >
              <Eye className="h-3.5 w-3.5" aria-hidden />
              {VISIBILITY_LABEL[visibility]} · Modifier la visibilité
            </button>
          ) : (
            <span className="mt-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-text-faint">
              <Eye className="h-3.5 w-3.5" aria-hidden />
              {VISIBILITY_LABEL[visibility]}
            </span>
          )}
        </div>
        {onToggleFavorite && (
          <button
            type="button"
            aria-label={isFavorite ? "Retirer des favoris" : "Ajouter aux favoris"}
            aria-pressed={isFavorite}
            onClick={onToggleFavorite}
            className={cn(
              "mt-1 flex h-9 w-9 flex-none items-center justify-center rounded-[11px] border border-border-strong bg-input-bg transition-colors",
              isFavorite ? "text-[#FF6B81]" : "text-text-soft hover:text-[#FF6B81]",
            )}
          >
            <Heart className="h-4 w-4" fill={isFavorite ? "currentColor" : "none"} aria-hidden />
          </button>
        )}
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
        {asset.versions.length > 0 ? (
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
        ) : (
          <span />
        )}
        <span className="text-[12px] text-text-faint">
          {formatMediaDate(asset.createdAt)} · {formatMediaSize(asset.sizeBytes)}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <Button variant="secondary" onClick={download}>
          Télécharger
        </Button>
        <Button variant="tertiary" onClick={share}>
          <Share2 className="h-3.5 w-3.5" aria-hidden />
          Copier le lien
        </Button>
        {/* Contexte repris automatiquement sur le ticket — Bible §21, voir NewTicketModal.tsx
            (initialContext) et support/page.tsx (lecture de ctx_type/ctx_id/ctx_label). */}
        <Link
          href={`/support?ctx_type=visual&ctx_id=${encodeURIComponent(asset.id)}&ctx_label=${encodeURIComponent(asset.name)}`}
          className="ml-auto flex h-9 items-center gap-1.5 rounded-[10px] border border-border-strong bg-input-bg px-3 text-[12.5px] font-bold text-text-soft hover:border-brand-blue-pale hover:text-text"
        >
          <LifeBuoy className="h-3.5 w-3.5" aria-hidden />
          Contacter le support
        </Link>
      </div>
      <p className="text-[11.5px] text-text-faint">
        Deux corrections incluses, la troisième facturée. {revisionCount > 0 && `${revisionCount} déjà demandée${revisionCount > 1 ? "s" : ""}.`}
        {" "}Pour valider ce contenu ou demander une correction, contactez votre Community Manager.
      </p>

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

      {visibilityEditorOpen && (
        <VisibilityEditor
          asset={asset}
          organizationId={asset.organizationId}
          onClose={() => setVisibilityEditorOpen(false)}
          onSaved={(mode: ContentVisibilityMode) => {
            setVisibility(mode);
            showToast("Visibilité mise à jour.");
          }}
        />
      )}
    </div>
  );
}
