"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import type { Publication, PublicationFormat, PublicationPlatform } from "@/lib/types/communication";
import { FORMAT_LABELS, PLATFORM_LABELS } from "@/lib/types/communication";
import { Modal } from "./Modal";

// /communication — ACTIONS.md § 14 : « Ajouter une publication ». Crée une publication au
// statut `idea`, en tête de la chaîne de statuts (README.md § Chaînes de statuts).
export function NewPublicationModal({
  open,
  onClose,
  organizationId,
  ownerName,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  organizationId: string;
  ownerName: string;
  onCreate: (publication: Publication) => void;
}) {
  const [title, setTitle] = useState("");
  const [platform, setPlatform] = useState<PublicationPlatform>("instagram");
  const [format, setFormat] = useState<PublicationFormat>("post");
  const [scheduledAt, setScheduledAt] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [hashtags, setHashtags] = useState("");

  function reset() {
    setTitle("");
    setPlatform("instagram");
    setFormat("post");
    setScheduledAt("");
    setBodyText("");
    setHashtags("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !scheduledAt) return;
    onCreate({
      id: `pub-${Date.now()}`,
      organizationId,
      title: title.trim(),
      platform,
      format,
      scheduledAt: new Date(scheduledAt).toISOString(),
      bodyText: bodyText.trim() || undefined,
      hashtags: hashtags
        .split(/[,\s]+/)
        .map((h) => h.trim())
        .filter(Boolean)
        .map((h) => (h.startsWith("#") ? h : `#${h}`)),
      mediaCount: 0,
      ownerName,
      status: "idea",
      revisionCount: 0,
    });
    reset();
  }

  return (
    <Modal open={open} onClose={onClose} title="Ajouter une publication">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">Titre</span>
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex. Affiche Matchday — journée 4"
            className="h-11 rounded-xl border border-border-strong bg-surface px-3.5 text-[14px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,75,255,.12)]"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-bold text-text-soft">Plateforme</span>
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value as PublicationPlatform)}
              className="h-11 rounded-xl border border-border-strong bg-surface px-3.5 text-[14px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,75,255,.12)]"
            >
              {Object.entries(PLATFORM_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-bold text-text-soft">Format</span>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as PublicationFormat)}
              className="h-11 rounded-xl border border-border-strong bg-surface px-3.5 text-[14px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,75,255,.12)]"
            >
              {Object.entries(FORMAT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">Date de publication prévue</span>
          <input
            required
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className="h-11 rounded-xl border border-border-strong bg-surface px-3.5 text-[14px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,75,255,.12)]"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">Texte (optionnel)</span>
          <textarea
            rows={3}
            value={bodyText}
            onChange={(e) => setBodyText(e.target.value)}
            className="resize-none rounded-xl border border-border-strong bg-surface px-3.5 py-3 text-[14px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,75,255,.12)]"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">Hashtags (optionnel)</span>
          <input
            value={hashtags}
            onChange={(e) => setHashtags(e.target.value)}
            placeholder="USVarenne, Matchday"
            className="h-11 rounded-xl border border-border-strong bg-surface px-3.5 text-[14px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,75,255,.12)]"
          />
        </label>

        <div className="mt-1 flex justify-end gap-2.5">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" variant="primary">
            Ajouter au planning
          </Button>
        </div>
      </form>
    </Modal>
  );
}
