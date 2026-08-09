"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { scorersToText, textToScorers } from "@/lib/mock/studio";
import type { Match } from "@/lib/types/studio";

// Modale « Saisir un résultat » — voir ACTIONS.md § 8 et DATA_MODEL.md § Match. Composant propre
// au module Match Center.
//
// Le formulaire ne collecte que ce que saveClubMatchResult (data/club/matches.ts) écrit
// réellement : club_matches (migration-clubplus-v3.sql) n'a que 4 colonnes pertinentes ici
// (status, score, scorers, man_of_match) — compétition, lieu, domicile/extérieur, affluence,
// passeurs, cartons et commentaire n'ont pas de colonne réelle. Équipe/adversaire ne sont pas
// éditables ici : ils servent uniquement à identifier le match (sélecteur ci-dessous), les
// modifier n'aurait aucun effet en base. Voir migration-clubplus-v34-match-champs-
// complementaires.sql (additive, non exécutée) pour le chemin de réintroduction de ces champs.

interface MatchResultModalProps {
  matches: Match[];
  initialMatchId: string;
  onClose: () => void;
  onSubmit: (matchId: string, patch: Partial<Match>) => void;
}

export function MatchResultModal({ matches, initialMatchId, onClose, onSubmit }: MatchResultModalProps) {
  const [matchId, setMatchId] = useState(initialMatchId);
  const match = matches.find((m) => m.id === matchId) ?? matches[0]!;

  const [scoreFor, setScoreFor] = useState(match.scoreFor?.toString() ?? "");
  const [scoreAgainst, setScoreAgainst] = useState(match.scoreAgainst?.toString() ?? "");
  const [scorersText, setScorersText] = useState(scorersToText(match.scorers));
  const [manOfTheMatch, setManOfTheMatch] = useState(match.manOfTheMatch ?? "");

  function handleSelectMatch(id: string) {
    const m = matches.find((mm) => mm.id === id);
    if (!m) return;
    setMatchId(id);
    setScoreFor(m.scoreFor?.toString() ?? "");
    setScoreAgainst(m.scoreAgainst?.toString() ?? "");
    setScorersText(scorersToText(m.scorers));
    setManOfTheMatch(m.manOfTheMatch ?? "");
  }

  function buildPatch(): Partial<Match> {
    return {
      scoreFor: scoreFor === "" ? undefined : Number(scoreFor),
      scoreAgainst: scoreAgainst === "" ? undefined : Number(scoreAgainst),
      scorers: textToScorers(scorersText),
      manOfTheMatch: manOfTheMatch || undefined,
    };
  }

  function handleSubmit() {
    onSubmit(matchId, buildPatch());
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="animate-svfade max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-sv-modal border border-border bg-elevated p-6 shadow-sv-modal">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[16px] font-extrabold tracking-tight">Saisir un résultat</div>
            <p className="mt-1 text-[12.5px] text-text-soft">
              {match.teamName} vs {match.opponent}
              {match.kickoffAt ? ` · ${new Date(match.kickoffAt).toLocaleDateString("fr-FR")}` : ""}
            </p>
          </div>
          <button
            aria-label="Fermer"
            onClick={onClose}
            className="flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-border-strong text-text-soft"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {matches.length > 1 && (
          <div className="mt-4 flex flex-col gap-1.5">
            <span className="text-[12.5px] font-bold text-text-soft">Match</span>
            <select
              value={matchId}
              onChange={(e) => handleSelectMatch(e.target.value)}
              className="h-10 rounded-sv border border-border-strong bg-input-bg px-3 text-[13.5px] outline-none focus-visible:border-brand-blue"
            >
              {matches.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.teamName} vs {m.opponent}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-3.5">
          <NumberField label="Score pour" value={scoreFor} onChange={setScoreFor} />
          <NumberField label="Score contre" value={scoreAgainst} onChange={setScoreAgainst} />
        </div>

        <div className="mt-3.5 flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">Buteurs (séparés par une virgule, ex. « Yanis (23') »)</span>
          <input
            value={scorersText}
            onChange={(e) => setScorersText(e.target.value)}
            className="h-10 rounded-sv border border-border-strong bg-input-bg px-3 text-[13.5px] outline-none focus-visible:border-brand-blue"
          />
        </div>

        <div className="mt-3.5 flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">Homme du match</span>
          <input
            value={manOfTheMatch}
            onChange={(e) => setManOfTheMatch(e.target.value)}
            className="h-10 rounded-sv border border-border-strong bg-input-bg px-3 text-[13.5px] outline-none focus-visible:border-brand-blue"
          />
        </div>

        <div className="mt-5 flex justify-end gap-2.5 border-t border-divider pt-4">
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" onClick={handleSubmit}>
            Enregistrer le résultat
          </Button>
        </div>
      </div>
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-bold text-text-soft">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 rounded-sv border border-border-strong bg-input-bg px-3 text-[13.5px] outline-none focus-visible:border-brand-blue"
      />
    </div>
  );
}
