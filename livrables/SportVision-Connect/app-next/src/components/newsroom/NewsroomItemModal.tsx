"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { NewsroomItemDetails, NewsroomItemInput, NewsroomItemPriority, NewsroomItemType } from "@/lib/data/club/newsroom";

// Modale « Nouvelle remontée / Modifier » — Newsroom (chantier 16/08/2026, voir data/club/
// newsroom.ts). Avant ce chantier, aucune remontée ne pouvait être créée ni éditée depuis Club+ ;
// la table (club_newsroom_items, RLS cni_member_insert) le permettait déjà pour tout membre actif.

const TYPE_OPTIONS: { value: NewsroomItemType; label: string }[] = [
  { value: "actualite", label: "Actualité" },
  { value: "resultat", label: "Résultat" },
];

const PRIORITY_OPTIONS: { value: NewsroomItemPriority; label: string }[] = [
  { value: "low", label: "Basse" },
  { value: "normal", label: "Normale" },
  { value: "high", label: "Haute" },
];

interface NewsroomItemModalProps {
  item?: NewsroomItemDetails;
  onClose: () => void;
  onSubmit: (input: NewsroomItemInput) => void;
}

export function NewsroomItemModal({ item, onClose, onSubmit }: NewsroomItemModalProps) {
  const [title, setTitle] = useState(item?.title ?? "");
  const [body, setBody] = useState(item?.body ?? "");
  const [teamName, setTeamName] = useState(item?.teamName ?? "");
  const [itemType, setItemType] = useState<NewsroomItemType>(item?.itemType ?? "actualite");
  const [priority, setPriority] = useState<NewsroomItemPriority>(item?.priority ?? "normal");

  const canSubmit = title.trim().length > 0;

  function handleSubmit() {
    if (!canSubmit) return;
    onSubmit({ title: title.trim(), body: body.trim(), teamName: teamName.trim(), itemType, priority });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="animate-svfade max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-sv-modal border border-border bg-elevated p-5 shadow-sv-modal sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="text-[16px] font-extrabold tracking-tight">{item ? "Modifier la remontée" : "Nouvelle remontée"}</div>
          <button
            aria-label="Fermer"
            onClick={onClose}
            className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-border-strong text-text-soft"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">Titre</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex. Portes ouvertes du 15 septembre"
            className="h-11 rounded-sv border border-border-strong bg-input-bg px-3 text-[13.5px] outline-none focus-visible:border-brand-blue"
          />
        </div>

        <div className="mt-3.5 flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">Description</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            placeholder="Détails utiles pour la communication…"
            className="rounded-sv border border-border-strong bg-input-bg px-3 py-2 text-[13.5px] outline-none focus-visible:border-brand-blue"
          />
        </div>

        <div className="mt-3.5 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-bold text-text-soft">Équipe (facultatif)</span>
            <input
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="Ex. U18 R2"
              className="h-11 rounded-sv border border-border-strong bg-input-bg px-3 text-[13.5px] outline-none focus-visible:border-brand-blue"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-bold text-text-soft">Type</span>
            <select
              value={itemType}
              onChange={(e) => setItemType(e.target.value as NewsroomItemType)}
              className="h-11 rounded-sv border border-border-strong bg-input-bg px-3 text-[13.5px] outline-none focus-visible:border-brand-blue"
            >
              {TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-3.5 flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">Priorité</span>
          <div className="grid grid-cols-3 gap-2">
            {PRIORITY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setPriority(opt.value)}
                className={`h-11 rounded-sv border text-[12.5px] font-bold transition-colors duration-sv ${
                  priority === opt.value
                    ? "border-transparent bg-gradient-to-br from-brand-blue to-brand-violet text-white"
                    : "border-border-strong bg-transparent text-text-soft hover:border-brand-blue-electric"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2.5 border-t border-divider pt-4">
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={!canSubmit}>
            {item ? "Enregistrer" : "Créer la remontée"}
          </Button>
        </div>
      </div>
    </div>
  );
}
