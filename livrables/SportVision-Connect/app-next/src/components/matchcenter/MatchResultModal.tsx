"use client";

import { useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { scorersToText, textToScorers } from "@/lib/mock/studio";
import type { Match } from "@/lib/types/studio";
import type { MatchOutcome } from "@/lib/data/club/matches";

// Modale « Saisir un résultat / Reporter / Annuler » — voir ACTIONS.md § 8, DATA_MODEL.md § Match
// et CLUB-PLUS-PRODUCT-BIBLE.md § 7 (Saisie résultat : Score, Statut, Buteurs, Passeurs, Joueur du
// match, Commentaire communication, Média, Historique). Composant propre au module Match Center.
//
// Formulaire complet réintégré le 09/08/2026 : migration-clubplus-v34-match-champs-
// complementaires.sql (compétition/domicile-extérieur/affluence/passeurs/cartons/commentaire) a
// été exécutée par Fouka, saveClubMatchResult (data/club/matches.ts) écrit désormais ces champs
// réellement — voir ce fichier pour le détail. Équipe/adversaire restent non éditables : ils
// servent uniquement à identifier le match (sélecteur ci-dessous).
//
// 16/08/2026 (chantier Matchcenter/Newsroom) : ajout du champ Statut (Terminé/Reporté/Annulé), qui
// manquait entièrement — seul un affichage passif des statuts "reportee"/"annulee" existait
// (migration-clubplus-v37.sql), aucune action ne permettait de les déclencher. Les champs
// secondaires (compétition/lieu/domicile/buteurs/homme du match/affluence/passeurs/cartons) sont
// repliés sous « Plus de détails » : objectif Bible §7 — "le coach doit pouvoir ouvrir le match,
// saisir le score et confirmer en moins d'une minute, le mobile est prioritaire" — un statut +
// score visibles immédiatement, tout le reste facultatif et replié par défaut.
//
// 17/08/2026 (chantier "Autres rôles Club+") : prop `verifying` — réutilise ce même formulaire
// pour l'action "Vérifier le résultat" du Directeur sportif (Bible §8) plutôt que d'en dupliquer
// un : "le Directeur confirme/corrige si nécessaire" est exactement la même opération que "saisir
// un résultat" (mêmes champs, même risque de faute de frappe à corriger), seuls le titre et le
// libellé du bouton changent pour ne pas dire "Enregistrer" à quelqu'un qui vérifie plutôt que
// saisit. Le sélecteur de statut est masqué en mode vérification : un résultat déjà reçu
// (status='recu') n'a pas vocation à être reporté/annulé depuis cet écran-là. Voir matchcenter/
// page.tsx § handleVerifyResult pour l'appel à verifyClubMatchResult qui suit la sauvegarde.
//
// Champs Bible non couverts ici, volontairement non inventés :
// - "Média" : club_matches.contents (jsonb) existe en base mais aucun pattern d'upload Supabase
//   Storage n'existe nulle part dans app-next (aucune référence à supabase.storage dans le repo) —
//   construire un bucket + policies + UI d'upload à l'aveugle dépasse le cadre de ce chantier
//   frontend, à cadrer séparément (bucket, taille max, types acceptés).
// - "Historique (auteur, date, modifications)" : aucune colonne ni table d'audit n'existe pour
//   club_matches (seuls created_by/created_at/updated_at, pas d'updated_by ni de log de
//   modifications) — nécessite une migration dédiée (table match_history ou colonnes d'audit),
//   à faire séparément plutôt que d'inventer un stockage ad hoc ici.
// - "Buteurs/Passeurs — sélection joueurs affiliés" : `scorers`/`assists` restent des colonnes
//   texte libre, il n'existe aucune table de roster nominatif (pas de club_players, voir
//   data/club/teams.ts) pour proposer une vraie sélection — reste un champ texte tant que ce
//   roster n'existe pas côté backend.

const STATUS_OPTIONS: { value: MatchOutcome; label: string }[] = [
  { value: "completed", label: "Terminé" },
  { value: "postponed", label: "Reporté" },
  { value: "cancelled", label: "Annulé" },
];

const SUBMIT_LABEL: Record<MatchOutcome, string> = {
  completed: "Enregistrer le résultat",
  postponed: "Confirmer le report",
  cancelled: "Confirmer l'annulation",
};

const TITLE_LABEL: Record<MatchOutcome, string> = {
  completed: "Saisir un résultat",
  postponed: "Reporter le match",
  cancelled: "Annuler le match",
};

interface MatchResultModalProps {
  matches: Match[];
  initialMatchId: string;
  defaultStatus?: MatchOutcome;
  /** Directeur sportif (Bible §8) : même formulaire, titre/CTA "Vérifier"/"Confirmer" au lieu de
   * "Saisir"/"Enregistrer", sélecteur de statut masqué (un résultat déjà reçu ne se reporte pas
   * depuis cet écran) — voir le commentaire en tête de fichier. */
  verifying?: boolean;
  onClose: () => void;
  onSubmit: (
    matchId: string,
    matchStatus: MatchOutcome,
    patch: Partial<Match> & {
      competition?: string;
      venue?: string;
      isHome?: boolean;
      attendance?: number;
      assists?: string;
      cards?: string;
      comment?: string;
    },
  ) => void;
}

export function MatchResultModal({
  matches,
  initialMatchId,
  defaultStatus = "completed",
  verifying = false,
  onClose,
  onSubmit,
}: MatchResultModalProps) {
  const [matchId, setMatchId] = useState(initialMatchId);
  const match = matches.find((m) => m.id === matchId) ?? matches[0]!;

  const [matchStatus, setMatchStatus] = useState<MatchOutcome>(defaultStatus);
  const [showDetails, setShowDetails] = useState(false);

  const [scoreFor, setScoreFor] = useState(match.scoreFor?.toString() ?? "");
  const [scoreAgainst, setScoreAgainst] = useState(match.scoreAgainst?.toString() ?? "");
  const [scorersText, setScorersText] = useState(scorersToText(match.scorers));
  const [manOfTheMatch, setManOfTheMatch] = useState(match.manOfTheMatch ?? "");
  const [competition, setCompetition] = useState(match.competition ?? "");
  const [venue, setVenue] = useState(match.venue ?? "");
  const [isHome, setIsHome] = useState(match.isHome ?? true);
  const [attendance, setAttendance] = useState(match.extendedReport?.attendance?.toString() ?? "");
  const [assists, setAssists] = useState(match.extendedReport?.assists ?? "");
  const [cards, setCards] = useState(match.extendedReport?.cards ?? "");
  const [comment, setComment] = useState(match.extendedReport?.comment ?? "");

  function handleSelectMatch(id: string) {
    const m = matches.find((mm) => mm.id === id);
    if (!m) return;
    setMatchId(id);
    setScoreFor(m.scoreFor?.toString() ?? "");
    setScoreAgainst(m.scoreAgainst?.toString() ?? "");
    setScorersText(scorersToText(m.scorers));
    setManOfTheMatch(m.manOfTheMatch ?? "");
    setCompetition(m.competition ?? "");
    setVenue(m.venue ?? "");
    setIsHome(m.isHome ?? true);
    setAttendance(m.extendedReport?.attendance?.toString() ?? "");
    setAssists(m.extendedReport?.assists ?? "");
    setCards(m.extendedReport?.cards ?? "");
    setComment(m.extendedReport?.comment ?? "");
  }

  function buildPatch() {
    if (matchStatus !== "completed") {
      // Reporté/annulé : seul le commentaire (motif) a du sens, le reste du résultat sportif ne
      // doit pas être écrasé par des champs vides.
      return { comment };
    }
    return {
      scoreFor: scoreFor === "" ? undefined : Number(scoreFor),
      scoreAgainst: scoreAgainst === "" ? undefined : Number(scoreAgainst),
      scorers: textToScorers(scorersText),
      manOfTheMatch: manOfTheMatch || undefined,
      competition,
      venue,
      isHome,
      attendance: attendance === "" ? undefined : Number(attendance),
      assists,
      cards,
      comment,
    };
  }

  const canSubmit = matchStatus !== "completed" || (scoreFor !== "" && scoreAgainst !== "");

  function handleSubmit() {
    if (!canSubmit) return;
    onSubmit(matchId, matchStatus, buildPatch());
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="animate-svfade max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-sv-modal border border-border bg-elevated p-5 shadow-sv-modal sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[16px] font-extrabold tracking-tight">
              {verifying ? "Vérifier le résultat" : TITLE_LABEL[matchStatus]}
            </div>
            <p className="mt-1 text-[12.5px] text-text-soft">
              {match.teamName} vs {match.opponent}
              {match.kickoffAt ? ` · ${new Date(match.kickoffAt).toLocaleDateString("fr-FR")}` : ""}
            </p>
          </div>
          <button
            aria-label="Fermer"
            onClick={onClose}
            className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-border-strong text-text-soft"
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
              className="h-11 rounded-sv border border-border-strong bg-input-bg px-3 text-[13.5px] outline-none focus-visible:border-brand-blue"
            >
              {matches.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.teamName} vs {m.opponent}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Statut — champ prioritaire, en tête de formulaire (Bible §7). Masqué en mode
            vérification : un résultat déjà reçu ne se reporte/annule pas depuis cet écran. */}
        {!verifying && (
        <div className="mt-4 flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">Statut</span>
          <div className="grid grid-cols-3 gap-2">
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setMatchStatus(opt.value)}
                className={`h-11 rounded-sv border text-[12.5px] font-bold transition-colors duration-sv ${
                  matchStatus === opt.value
                    ? "border-transparent bg-gradient-to-br from-brand-blue to-brand-violet text-white"
                    : "border-border-strong bg-transparent text-text-soft hover:border-brand-blue-electric"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        )}

        {matchStatus === "completed" && (
          <>
            {/* Score — champ prioritaire, gros touch targets pour la saisie rapide mobile. */}
            <div className="mt-4 grid grid-cols-2 gap-3.5">
              <NumberField label="Score pour" value={scoreFor} onChange={setScoreFor} large />
              <NumberField label="Score contre" value={scoreAgainst} onChange={setScoreAgainst} large />
            </div>

            <button
              type="button"
              onClick={() => setShowDetails((v) => !v)}
              className="mt-4 flex w-full items-center justify-between rounded-sv border border-border-strong px-3.5 py-2.5 text-[12.5px] font-bold text-text-soft"
            >
              Plus de détails (facultatif)
              <ChevronDown className={`h-4 w-4 transition-transform duration-sv ${showDetails ? "rotate-180" : ""}`} aria-hidden />
            </button>

            {showDetails && (
              <div className="mt-3.5 flex flex-col gap-3.5">
                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                  <TextField label="Compétition" value={competition} onChange={setCompetition} />
                  <TextField label="Lieu" value={venue} onChange={setVenue} />
                </div>

                <div className="flex items-center gap-2">
                  <input
                    id="mrm-is-home"
                    type="checkbox"
                    checked={isHome}
                    onChange={(e) => setIsHome(e.target.checked)}
                    className="h-4 w-4 accent-brand-blue-electric"
                  />
                  <label htmlFor="mrm-is-home" className="text-[12.5px] font-bold text-text-soft">
                    Match à domicile
                  </label>
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-[12.5px] font-bold text-text-soft">Buteurs (séparés par une virgule, ex. « Yanis (23') »)</span>
                  <input
                    value={scorersText}
                    onChange={(e) => setScorersText(e.target.value)}
                    className="h-11 rounded-sv border border-border-strong bg-input-bg px-3 text-[13.5px] outline-none focus-visible:border-brand-blue"
                  />
                </div>

                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                  <TextField label="Homme du match" value={manOfTheMatch} onChange={setManOfTheMatch} />
                  <NumberField label="Affluence" value={attendance} onChange={setAttendance} />
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-[12.5px] font-bold text-text-soft">Passeurs décisifs</span>
                  <input
                    value={assists}
                    onChange={(e) => setAssists(e.target.value)}
                    className="h-11 rounded-sv border border-border-strong bg-input-bg px-3 text-[13.5px] outline-none focus-visible:border-brand-blue"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-[12.5px] font-bold text-text-soft">Cartons</span>
                  <input
                    value={cards}
                    onChange={(e) => setCards(e.target.value)}
                    className="h-11 rounded-sv border border-border-strong bg-input-bg px-3 text-[13.5px] outline-none focus-visible:border-brand-blue"
                  />
                </div>
              </div>
            )}
          </>
        )}

        <div className="mt-3.5 flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">
            {matchStatus === "completed" ? "Commentaire pour la communication" : "Motif (facultatif)"}
          </span>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={matchStatus === "completed" ? 3 : 2}
            placeholder={matchStatus === "completed" ? "" : "Ex. terrain impraticable, forfait adverse…"}
            className="rounded-sv border border-border-strong bg-input-bg px-3 py-2 text-[13.5px] outline-none focus-visible:border-brand-blue"
          />
        </div>

        <div className="sticky bottom-0 mt-5 flex justify-end gap-2.5 border-t border-divider bg-elevated pt-4">
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button variant={matchStatus === "cancelled" ? "danger" : "primary"} onClick={handleSubmit} disabled={!canSubmit}>
            {verifying ? "Confirmer la vérification" : SUBMIT_LABEL[matchStatus]}
          </Button>
        </div>
      </div>
    </div>
  );
}

function NumberField({ label, value, onChange, large }: { label: string; value: string; onChange: (v: string) => void; large?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-bold text-text-soft">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={
          large
            ? "h-14 rounded-sv border border-border-strong bg-input-bg px-3 text-center text-[22px] font-extrabold outline-none focus-visible:border-brand-blue"
            : "h-11 rounded-sv border border-border-strong bg-input-bg px-3 text-[13.5px] outline-none focus-visible:border-brand-blue"
        }
      />
    </div>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-bold text-text-soft">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 rounded-sv border border-border-strong bg-input-bg px-3 text-[13.5px] outline-none focus-visible:border-brand-blue"
      />
    </div>
  );
}
