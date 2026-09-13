"use client";

import { useRef, useState } from "react";
import { X } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useModalA11y } from "@/lib/useModalA11y";
import { useFermetureEchap } from "@/lib/use-fermeture-echap";

// Renommer une équipe (13/09/2026). Le geste n'existait sur aucun écran, alors que la base le
// gère entièrement : un déclencheur propage le nouveau nom sur les onze tables qui gardent le
// libellé en texte — matchs, calendrier, contenus, actualités, périmètres d'encadrants. On le dit
// ici, parce que renommer une équipe en cours de saison fait peur quand on ne sait pas ce que ça
// touche.
export function RenommerEquipeModal({
  valeur,
  onClose,
  onValider,
}: {
  valeur: string;
  onClose: () => void;
  onValider: (nom: string) => Promise<unknown>;
}) {
  useFermetureEchap(true, onClose);
  const [nom, setNom] = useState(valeur);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  useModalA11y(containerRef, onClose);

  function valider() {
    setBusy(true);
    setError(null);
    onValider(nom.trim())
      .catch((e: unknown) => {
        setBusy(false);
        setError(e instanceof Error ? e.message : "Renommage impossible pour le moment.");
      });
  }

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label="Renommer l'équipe"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(7,10,23,.65)] p-4"
    >
      <Card className="animate-svfade relative flex w-full max-w-[440px] flex-col gap-4 rounded-sv-modal p-6 shadow-sv-modal">
        <button
          aria-label="Fermer"
          onClick={onClose}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-text-faint hover:bg-surface-sunken hover:text-text"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>

        <h2 className="text-[19px] font-extrabold tracking-tight">Renommer l&apos;équipe</h2>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">Nom de l&apos;équipe</span>
          <input
            value={nom}
            onChange={(e) => setNom(e.target.value)}
            className="h-11 rounded-xl border border-border-strong bg-input-bg px-3.5 text-[14px] outline-none focus-visible:border-brand-blue"
            placeholder="U15 A"
          />
        </label>

        <p className="text-[12px] leading-relaxed text-text-soft">
          Le nouveau nom suit l&apos;équipe partout : ses matchs, son calendrier, ses contenus, ses
          actualités et le périmètre de ses encadrants. Rien n&apos;est perdu, rien n&apos;est à
          refaire ailleurs.
        </p>

        {error && <p className="text-[12.5px] font-bold text-danger-fg">{error}</p>}

        <div className="mt-1 flex justify-end">
          <Button disabled={nom.trim().length < 2 || busy} loading={busy} onClick={valider}>
            Renommer
          </Button>
        </div>
      </Card>
    </div>
  );
}
