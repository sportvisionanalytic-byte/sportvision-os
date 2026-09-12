"use client";

import { useRef, useState } from "react";
import { X } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useModalA11y } from "@/lib/useModalA11y";

import { useFermetureEchap } from "@/lib/use-fermeture-echap";
// Modale "Ajouter un sponsor" (19/08/2026, retour utilisateur : aucune UI ne le permettait).
// Même pattern que AddEventModal.tsx / CreateTeamModal.tsx. Niveau limité à Or/Argent/Bronze
// (club_sponsors_niveau_check) — voir data/club/sponsors.ts.
export interface SponsorFormInput {
  name: string;
  niveau: "Or" | "Argent" | "Bronze";
  secteur?: string;
  montant?: number;
  dateDebut?: string;
  dateFin?: string;
}

interface CreateSponsorModalProps {
  onClose: () => void;
  onCreate: (input: SponsorFormInput) => Promise<unknown>;
  // Modification (12/09/2026, audit) : la même fenêtre sert à corriger un sponsor existant. On
  // savait créer, jamais modifier — une faute sur le nom ou le montant était définitive.
  initial?: SponsorFormInput;
}

export function CreateSponsorModal({ onClose, onCreate, initial }: CreateSponsorModalProps) {
  // Echap ferme la fenetre (audit du 10/09/2026 : aucune modale ne le faisait).
  useFermetureEchap(true, onClose);
  const modification = initial !== undefined;
  const [name, setName] = useState(initial?.name ?? "");
  const [niveau, setNiveau] = useState<"Or" | "Argent" | "Bronze">(initial?.niveau ?? "Bronze");
  const [secteur, setSecteur] = useState(initial?.secteur ?? "");
  const [montant, setMontant] = useState(initial?.montant != null ? String(initial.montant) : "");
  const [dateDebut, setDateDebut] = useState(initial?.dateDebut ?? "");
  const [dateFin, setDateFin] = useState(initial?.dateFin ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  useModalA11y(containerRef, onClose);

  const canSubmit = name.trim().length > 0;

  function handleSubmit() {
    setSubmitting(true);
    setError(null);
    const parsedMontant = montant.trim() ? Number(montant.replace(",", ".")) : undefined;
    onCreate({
      name: name.trim(),
      niveau,
      secteur: secteur.trim() || undefined,
      montant: parsedMontant,
      dateDebut: dateDebut || undefined,
      dateFin: dateFin || undefined,
    })
      .then(() => onClose())
      .catch((e: unknown) => {
        setSubmitting(false);
        setError(e instanceof Error ? e.message : "Impossible d'enregistrer le sponsor. Réessayez.");
      });
  }

  return (
    <div ref={containerRef} role="dialog" aria-modal="true" aria-label={modification ? "Modifier le sponsor" : "Ajouter un sponsor"} className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(7,10,23,.65)] p-4">
      <Card className="animate-svfade relative flex w-full max-w-[440px] flex-col gap-4 rounded-sv-modal p-6 shadow-sv-modal">
        <button
          aria-label="Fermer"
          onClick={onClose}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-text-faint hover:bg-surface-sunken hover:text-text"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>

        <h2 className="text-[19px] font-extrabold tracking-tight">{modification ? "Modifier le sponsor" : "Ajouter un sponsor"}</h2>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">Nom du sponsor</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={fieldClass} placeholder="Boulangerie Martin" />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">Niveau</span>
          <select value={niveau} onChange={(e) => setNiveau(e.target.value as typeof niveau)} className={fieldClass}>
            <option value="Or">Or</option>
            <option value="Argent">Argent</option>
            <option value="Bronze">Bronze</option>
          </select>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-bold text-text-soft">Secteur (optionnel)</span>
            <input value={secteur} onChange={(e) => setSecteur(e.target.value)} className={fieldClass} placeholder="Restauration" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-bold text-text-soft">Montant annuel (optionnel)</span>
            <input
              value={montant}
              onChange={(e) => setMontant(e.target.value)}
              className={fieldClass}
              placeholder="1500"
              inputMode="decimal"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-bold text-text-soft">Début du contrat</span>
            <input type="date" value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} className={fieldClass} />
          </label>
          <label className="flex flex-col gap-1.5">
            {/* Sans date de fin, le sponsor reste « Actif » à vie et « À renouveler » vaut
                toujours 0 : c'est cette date qui fait vivre le suivi. */}
            <span className="text-[12.5px] font-bold text-text-soft">Fin du contrat</span>
            <input type="date" value={dateFin} onChange={(e) => setDateFin(e.target.value)} className={fieldClass} />
          </label>
        </div>

        {error && <p className="text-[12.5px] font-bold text-danger-fg">{error}</p>}

        <div className="mt-1 flex justify-end">
          <Button disabled={!canSubmit || submitting} loading={submitting} onClick={handleSubmit}>
            {modification ? "Enregistrer" : "Ajouter le sponsor"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

const fieldClass =
  "h-11 rounded-xl border border-border-strong bg-input-bg px-3.5 text-[14px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,84,255,.12)]";
