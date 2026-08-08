"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { COLLECTION_KIND_LABELS, type CollectionKind } from "@/lib/types/content";

const KINDS = Object.keys(COLLECTION_KIND_LABELS) as CollectionKind[];

// Modale « Créer une collection » — voir ACTIONS.md § 13.
export function CreateCollectionModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string, kind: CollectionKind) => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<CollectionKind>("custom");

  function submit() {
    if (!name.trim()) return;
    onCreate(name.trim(), kind);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
      <div className="w-full max-w-[420px] animate-svfade rounded-sv-modal border border-border bg-surface p-5 shadow-sv-modal">
        <div className="flex items-center justify-between">
          <h2 className="text-[16px] font-extrabold tracking-tight">Créer une collection</h2>
          <button
            type="button"
            aria-label="Fermer"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-text-soft hover:bg-surface-sunken"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <label className="mt-4 flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">Nom de la collection</span>
          <input
            type="text"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex. Match retour — 12 septembre"
            className="h-11 rounded-xl border border-border-strong bg-surface px-3.5 text-[14px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,84,255,.12)]"
          />
        </label>

        <label className="mt-4 flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">Type</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as CollectionKind)}
            className="h-11 rounded-xl border border-border-strong bg-surface px-3.5 text-[14px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,84,255,.12)]"
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {COLLECTION_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>

        <div className="mt-6 flex justify-end gap-2.5">
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" onClick={submit} disabled={!name.trim()}>
            Créer la collection
          </Button>
        </div>
      </div>
    </div>
  );
}
