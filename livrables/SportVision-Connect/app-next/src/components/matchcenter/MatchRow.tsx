"use client";

// Une ligne de match dans le Match Center.
//
// Extraite de la page le 10/09/2026 : celle-ci passait 200 lignes à décrire une carte, et la
// hiérarchie des files (lib/matches/etat.ts) devenait illisible au milieu. Le composant ne décide
// de rien — quelle file, quelle action possible, quel tri : tout lui arrive en props. Il dessine.

import Link from "next/link";
import { CalendarClock, MoreVertical, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { issue, peutSaisirResultat, retardEnJours, scoreAffiche } from "@/lib/matches/etat";
import { requestVisualHref } from "@/lib/data/club/matches";
import type { MatchOutcome } from "@/lib/data/club/matches";
import type { Match } from "@/lib/types/studio";
import type { Team } from "@/lib/types/teams";
import { parseDateOnly } from "@/lib/date-only";
import { cn } from "@/lib/cn";

/** Le liseré d'issue, pour lire une série de résultats sans lire chaque score. Jamais seul :
 *  le score reste écrit à côté (CHARTE.md § Badges — couleur + libellé, jamais la couleur seule). */
const LISERE: Record<"gagne" | "perdu" | "nul", string> = {
  gagne: "border-l-success-fg",
  perdu: "border-l-danger-fg",
  nul: "border-l-border-strong",
};

function Ecusson({ url, nom }: { url: string | null; nom: string }) {
  // Taille fixe : un écusson est tantôt carré, tantôt un blason haut et étroit. Sans contenant
  // de dimension fixe, une liste de matchs fait onduler ses lignes d'une hauteur à l'autre.
  if (!url) {
    const initiales = nom
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((mot) => mot[0]?.toUpperCase() ?? "")
      .join("");
    return (
      <span
        aria-hidden
        className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-surface-sunken text-[11px] font-extrabold text-text-faint"
      >
        {initiales || "?"}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      aria-hidden
      loading="lazy"
      className="h-8 w-8 flex-none rounded-full bg-surface object-contain"
    />
  );
}

interface Props {
  match: Match;
  ecussonUrl: string | null;
  aujourdhui: Date;
  canWrite: boolean;
  canRequestVisual: boolean;
  canAssignTeam: boolean;
  canVerifyResults: boolean;
  requiresVerification: boolean;
  assignableTeams: Team[];
  teamsLoaded: boolean;
  assigning: boolean;
  menuOuvert: boolean;
  onToggleMenu: () => void;
  onAssignTeam: (teamId: string) => void;
  onOpenModal: (matchId: string, outcome: MatchOutcome, mode: "edit" | "verify") => void;
}

export function MatchRow({
  match: m,
  ecussonUrl,
  aujourdhui,
  canWrite,
  canRequestVisual,
  canAssignTeam,
  canVerifyResults,
  requiresVerification,
  assignableTeams,
  teamsLoaded,
  assigning,
  menuOuvert,
  onToggleMenu,
  onAssignTeam,
  onOpenModal,
}: Props) {
  const score = scoreAffiche(m);
  const resultat = issue(m);
  const retard = retardEnJours(m, aujourdhui);
  const saisissable = peutSaisirResultat(m, aujourdhui);

  return (
    <Card
      className={cn(
        "flex flex-wrap items-center gap-3.5 p-4",
        resultat && `border-l-4 ${LISERE[resultat]}`,
      )}
    >
      <Ecusson url={ecussonUrl} nom={m.opponent} />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[14px] font-extrabold tracking-tight">
            {m.teamName} {m.isHome ? "vs" : "@"} {m.opponent}
          </span>
          {score && (
            <span className="font-mono text-[13px] font-bold text-brand-blue-pale tabular-nums">
              {score.gauche} - {score.droite}
            </span>
          )}
          {/* Le retard est l'information qui déclenche l'action : il passe devant le statut, qui
              lui ne dit rien de plus qu'« à venir » sur un match d'il y a trois semaines. */}
          {retard > 0 && !score && (
            <Badge tone={retard > 14 ? "danger" : "warning"}>
              Joué il y a {retard} jour{retard > 1 ? "s" : ""}
            </Badge>
          )}
          {requiresVerification && m.verifiedAt && <Badge tone="success">Vérifié</Badge>}
        </div>

        <div className="mt-1 flex items-center gap-1.5 text-[12px] font-semibold text-text-faint">
          <CalendarClock className="h-3.5 w-3.5 flex-none" aria-hidden />
          <span className="truncate">
            {m.kickoffAt
              ? parseDateOnly(m.kickoffAt).toLocaleDateString("fr-FR", {
                  weekday: "short",
                  day: "numeric",
                  month: "long",
                })
              : "Date à confirmer"}
            {m.competition ? ` · ${m.competition}` : ""}
            {m.venue ? ` · ${m.venue}` : ""}
          </span>
        </div>

        {/* Assignation d'équipe (team_id) — réservée Admin/Directeur sportif. Purement un scope
            RLS, indépendant du nom d'équipe texte affiché ci-dessus.
            Le sélecteur reste présent sur un match DÉJÀ assigné : c'est le seul endroit d'où
            corriger une assignation fausse, et la retirer aurait fermé cette porte. Seule
            l'étiquette change de ton — une équipe manquante se voit, une équipe posée s'efface. */}
        {canAssignTeam && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <span
              className={cn(
                "text-[10.5px] font-bold uppercase tracking-[.04em]",
                m.teamId ? "text-text-faint" : "text-warning-fg",
              )}
            >
              {m.teamId ? "Équipe (scope)" : "Équipe non assignée"}
            </span>
            <select
              value={m.teamId}
              disabled={!teamsLoaded || assigning}
              onChange={(e) => onAssignTeam(e.target.value)}
              aria-label={`Assigner une équipe à ${m.teamName} contre ${m.opponent}`}
              className="h-7 rounded-md border border-border-strong bg-input-bg px-1.5 text-[11.5px] font-semibold outline-none focus-visible:border-brand-blue disabled:opacity-60"
            >
              <option value="">{m.teamId ? "Non assignée" : "Choisir…"}</option>
              {assignableTeams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {saisissable && (
        <Button
          variant={retard > 0 ? "primary" : "secondary"}
          className="h-9 px-3.5 text-[12.5px]"
          disabled={!canWrite}
          onClick={() => onOpenModal(m.id, "completed", "edit")}
        >
          Saisir le résultat
        </Button>
      )}

      {/* Vérification (Bible §8) : match déjà reçu, non encore vérifié, club utilisant ce
          workflow, réservé Admin/Directeur sportif. */}
      {m.status === "result_received" && requiresVerification && canVerifyResults && !m.verifiedAt && (
        <Button
          variant="secondary"
          className="h-9 px-3.5 text-[12.5px]"
          disabled={!canWrite}
          onClick={() => onOpenModal(m.id, "completed", "verify")}
        >
          Vérifier le résultat
        </Button>
      )}

      {/* « Résultat -> Visuel » (Bible §9/§18) : brief pré-rempli depuis le match. */}
      {(score || m.status === "result_received") && canRequestVisual && (
        <Link href={requestVisualHref(m)}>
          <Button variant="secondary" className="h-9 px-3.5 text-[12.5px]">
            <Sparkles className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            Demander un visuel
          </Button>
        </Link>
      )}

      {/* Reporter/annuler : pas de « dé-annulation » dans ce chantier, mais un match déjà reporté
          peut l'être à nouveau, ou finalement être annulé. */}
      {m.status !== "cancelled" && !score && (
        <div className="relative">
          <button
            type="button"
            aria-label={`Autres actions pour ${m.teamName} contre ${m.opponent}`}
            disabled={!canWrite}
            onClick={onToggleMenu}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border-strong text-text-soft transition-colors duration-sv hover:border-brand-blue-electric disabled:cursor-not-allowed disabled:opacity-50"
          >
            <MoreVertical className="h-4 w-4" aria-hidden />
          </button>
          {menuOuvert && (
            <>
              <button
                type="button"
                aria-hidden
                tabIndex={-1}
                className="fixed inset-0 z-40 cursor-default"
                onClick={onToggleMenu}
              />
              <div className="absolute right-0 top-11 z-50 w-52 overflow-hidden rounded-sv border border-border-strong bg-elevated shadow-sv-modal">
                <button
                  type="button"
                  onClick={() => onOpenModal(m.id, "postponed", "edit")}
                  className="block w-full px-3.5 py-2.5 text-left text-[12.5px] font-bold text-text-soft hover:bg-hover"
                >
                  Reporter le match
                </button>
                <button
                  type="button"
                  onClick={() => onOpenModal(m.id, "cancelled", "edit")}
                  className="block w-full border-t border-divider px-3.5 py-2.5 text-left text-[12.5px] font-bold text-danger-fg hover:bg-hover"
                >
                  Annuler le match
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
