"use client";

import { useState } from "react";
import { X } from "lucide-react";
import type { SupportTicketCategory, SupportTicketPriority } from "@/lib/types/settings";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

// Modale « Nouveau ticket » — voir ACTIONS.md § 24. Propre au module Support.
const CATEGORY_LABELS: Record<SupportTicketCategory, string> = {
  content: "Contenus",
  billing: "Facturation",
  technical: "Technique",
  contract: "Contrat",
  account: "Compte",
  other: "Autre",
};

const PRIORITY_LABELS: Record<SupportTicketPriority, string> = {
  low: "Basse",
  normal: "Normale",
  high: "Haute",
  urgent: "Urgente",
};

/**
 * Contexte repris automatiquement quand le ticket est ouvert depuis une fiche existante — Bible
 * §21 : "Contexte automatiquement repris : référence demande, facture, album ou visuel." `label`
 * est un texte déjà lisible (ex. "Facture FAC-2026-0142", "Demande REQ-2026-0031") : cette modale
 * ne va pas chercher elle-même le libellé, l'appelant le connaît déjà.
 */
export interface NewTicketInitialContext {
  type: "request" | "invoice" | "album" | "visual";
  id: string;
  label: string;
}

const CONTEXT_TYPE_LABEL: Record<NewTicketInitialContext["type"], string> = {
  request: "demande",
  invoice: "facture",
  album: "album",
  visual: "visuel",
};

const CONTEXT_TYPE_CATEGORY: Record<NewTicketInitialContext["type"], SupportTicketCategory> = {
  request: "other",
  invoice: "billing",
  album: "content",
  visual: "content",
};

interface NewTicketModalProps {
  onClose: () => void;
  onSubmit: (ticket: { subject: string; category: SupportTicketCategory; priority: SupportTicketPriority; description: string }) => Promise<unknown>;
  initialContext?: NewTicketInitialContext;
}

export function NewTicketModal({ onClose, onSubmit, initialContext }: NewTicketModalProps) {
  const [subject, setSubject] = useState(initialContext ? `À propos de : ${initialContext.label}` : "");
  const [category, setCategory] = useState<SupportTicketCategory>(initialContext ? CONTEXT_TYPE_CATEGORY[initialContext.type] : "content");
  const [priority, setPriority] = useState<SupportTicketPriority>("normal");
  const [description, setDescription] = useState(
    initialContext ? `Référence ${CONTEXT_TYPE_LABEL[initialContext.type]} : ${initialContext.label}\n\n` : "",
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = subject.trim().length > 0 && description.trim().length > 0;

  function handleSubmit() {
    setSubmitting(true);
    setError(null);
    onSubmit({ subject, category, priority, description })
      .then(() => onClose())
      .catch(() => {
        setSubmitting(false);
        setError("Impossible d'envoyer le ticket. Réessayez.");
      });
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(7,10,23,.65)] p-4">
      <Card className="animate-svfade relative flex w-full max-w-[520px] flex-col gap-4 rounded-sv-modal p-6 shadow-sv-modal">
        <button
          aria-label="Fermer"
          onClick={onClose}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-text-faint hover:bg-surface-sunken hover:text-text"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>

        <h2 className="text-[19px] font-extrabold tracking-tight">Nouveau ticket</h2>

        {initialContext && (
          <div className="rounded-xl border border-brand-blue-pale/40 bg-info-bg px-3.5 py-2.5 text-[12px] font-semibold text-info-fg">
            Contexte repris : {CONTEXT_TYPE_LABEL[initialContext.type]} {initialContext.label}
          </div>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">Sujet</span>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className={fieldClass}
            placeholder="Ex. Erreur sur mon affiche Matchday"
          />
        </label>

        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-bold text-text-soft">Catégorie</span>
            <select value={category} onChange={(e) => setCategory(e.target.value as SupportTicketCategory)} className={fieldClass}>
              {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-bold text-text-soft">Priorité</span>
            <select value={priority} onChange={(e) => setPriority(e.target.value as SupportTicketPriority)} className={fieldClass}>
              {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="min-h-[110px] resize-none rounded-xl border border-border-strong bg-input-bg px-3.5 py-3 text-[14px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,84,255,.12)]"
            placeholder="Décrivez votre demande le plus précisément possible."
          />
        </label>

        {error && <p className="text-[12.5px] font-bold text-danger-fg">{error}</p>}

        <div className="mt-1 flex justify-end">
          <Button disabled={!canSubmit || submitting} loading={submitting} onClick={handleSubmit}>
            Envoyer le ticket
          </Button>
        </div>
      </Card>
    </div>
  );
}

const fieldClass =
  "h-11 rounded-xl border border-border-strong bg-input-bg px-3.5 text-[14px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,84,255,.12)]";
