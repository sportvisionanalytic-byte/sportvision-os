"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

// Modale "Créer une équipe" (19/08/2026, retour utilisateur : aucune UI ne permettait de créer
// une équipe alors que club_teams.coach existe déjà comme champ texte libre — même famille de
// champ que club_calendar_events.team). Même pattern que AddEventModal.tsx.
interface CreateTeamModalProps {
  onClose: () => void;
  onCreate: (input: { name: string; categorie?: string; coach?: string }) => Promise<unknown>;
}

export function CreateTeamModal({ onClose, onCreate }: CreateTeamModalProps) {
  const [name, setName] = useState("");
  const [categorie, setCategorie] = useState("");
  const [coach, setCoach] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = name.trim().length > 0;

  function handleSubmit() {
    setSubmitting(true);
    setError(null);
    onCreate({ name: name.trim(), categorie: categorie.trim() || undefined, coach: coach.trim() || undefined })
      .then(() => onClose())
      .catch(() => {
        setSubmitting(false);
        setError("Impossible de créer l'équipe. Réessayez.");
      });
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(7,10,23,.65)] p-4">
      <Card className="animate-svfade relative flex w-full max-w-[440px] flex-col gap-4 rounded-sv-modal p-6 shadow-sv-modal">
        <button
          aria-label="Fermer"
          onClick={onClose}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-text-faint hover:bg-surface-sunken hover:text-text"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>

        <h2 className="text-[19px] font-extrabold tracking-tight">Créer une équipe</h2>
        <p className="-mt-2 text-[12.5px] leading-relaxed text-text-soft">
          Une fois créée, générez un code d&apos;invitation depuis sa carte pour que les joueurs la rejoignent
          directement.
        </p>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">Nom de l&apos;équipe</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={fieldClass} placeholder="U17" />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">Catégorie (optionnel)</span>
          <input
            value={categorie}
            onChange={(e) => setCategorie(e.target.value)}
            className={fieldClass}
            placeholder="Jeunes, Seniors, Féminines…"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">Responsable (coach) · optionnel</span>
          <input value={coach} onChange={(e) => setCoach(e.target.value)} className={fieldClass} placeholder="Nom du coach" />
        </label>

        {error && <p className="text-[12.5px] font-bold text-danger-fg">{error}</p>}

        <div className="mt-1 flex justify-end">
          <Button disabled={!canSubmit || submitting} loading={submitting} onClick={handleSubmit}>
            Créer l&apos;équipe
          </Button>
        </div>
      </Card>
    </div>
  );
}

const fieldClass =
  "h-11 rounded-xl border border-border-strong bg-input-bg px-3.5 text-[14px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,84,255,.12)]";
