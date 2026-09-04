"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarClock, CheckCircle2 } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { createClient } from "@/lib/supabase/client";
import { fetchClubTeams } from "@/lib/data/club/teams";
import {
  commitSeasonTransition,
  fetchClubCurrentSaison,
  fetchSeasonTransitionCandidates,
  suggestNextSaison,
  type SeasonTransitionAction,
  type SeasonTransitionCandidate,
  type SeasonTransitionResult,
} from "@/lib/data/club/season-transition";
import type { Team } from "@/lib/types/teams";

// Transition de saison — réservée à l'admin d'un club (même garde que /settings/organization :
// clubs_admin_update, RLS is_club_admin, rejetterait de toute façon toute autre écriture).
// 3 étapes : choisir la saison de destination -> décider pour chaque joueur actif (renouveler
// par défaut, jamais silencieux) -> valider. Construite sur renew_season_membership
// (migration-clubplus-v22.sql), jamais réécrite ici.

const ACTION_LABEL: Record<SeasonTransitionAction, string> = {
  renouvele: "Renouveler (même équipe)",
  deplace: "Changer d'équipe",
  archive: "Archiver",
  mis_en_attente: "Mettre en attente",
  quitte_club: "A quitté le club",
};

type Stage = "start" | "review" | "done";

export default function SeasonTransitionPage() {
  const { ctx } = useSession();
  const canUse = ctx.organization.type === "club" && ctx.membership.role === "admin";

  if (!canUse) {
    return (
      <Card className="p-8 text-center text-[13.5px] text-text-soft">
        La transition de saison est réservée à l&apos;administrateur du club.
      </Card>
    );
  }

  return <SeasonTransitionFlow clubId={ctx.organization.id} />;
}

function SeasonTransitionFlow({ clubId }: { clubId: string }) {
  const [stage, setStage] = useState<Stage>("start");
  const [currentSaison, setCurrentSaison] = useState<string | null>(null);
  const [toSaison, setToSaison] = useState("");
  const [teams, setTeams] = useState<Team[]>([]);
  const [candidates, setCandidates] = useState<SeasonTransitionCandidate[] | null>(null);
  const [actions, setActions] = useState<Record<string, { action: SeasonTransitionAction; newTeamId?: string }>>({});
  const [loadError, setLoadError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SeasonTransitionResult | null>(null);

  useEffect(() => {
    const supabase = createClient();
    Promise.all([fetchClubCurrentSaison(supabase, clubId), fetchClubTeams(supabase, clubId)]).then(([saison, teamRows]) => {
      setCurrentSaison(saison);
      setToSaison(suggestNextSaison(saison));
      setTeams(teamRows);
    });
  }, [clubId]);

  async function startReview() {
    if (!currentSaison || !toSaison.trim()) return;
    setLoadError(false);
    setCandidates(null);
    setStage("review");
    try {
      const supabase = createClient();
      const rows = await fetchSeasonTransitionCandidates(supabase, clubId, currentSaison);
      setCandidates(rows);
      setActions(Object.fromEntries(rows.map((r) => [r.membershipId, { action: "renouvele" as SeasonTransitionAction }])));
    } catch {
      setLoadError(true);
    }
  }

  function setAction(membershipId: string, action: SeasonTransitionAction) {
    setActions((prev) => ({ ...prev, [membershipId]: { action, newTeamId: prev[membershipId]?.newTeamId } }));
  }

  function setNewTeam(membershipId: string, newTeamId: string) {
    setActions((prev) => ({ ...prev, [membershipId]: { action: "deplace", newTeamId } }));
  }

  async function commit() {
    if (!candidates) return;
    setSubmitting(true);
    try {
      const supabase = createClient();
      const decisions = candidates.map((c) => ({
        membershipId: c.membershipId,
        action: actions[c.membershipId]?.action ?? "renouvele",
        newTeamId: actions[c.membershipId]?.newTeamId,
      }));
      const res = await commitSeasonTransition(supabase, clubId, toSaison.trim(), decisions);
      setResult(res);
      setStage("done");
    } finally {
      setSubmitting(false);
    }
  }

  if (currentSaison === null) {
    return <div className="py-16 text-center text-[13px] text-text-soft">Chargement…</div>;
  }

  if (stage === "start") {
    return (
      <Card className="mx-auto flex max-w-xl flex-col gap-4 p-6">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-info-bg text-info-fg">
            <CalendarClock className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <div className="text-[15px] font-extrabold tracking-tight">Transition de saison</div>
            <div className="text-[12.5px] text-text-soft">Saison actuelle : {currentSaison || "non renseignée"}</div>
          </div>
        </div>
        <p className="text-[12.5px] leading-relaxed text-text-soft">
          Chaque joueur actif de la saison actuelle recevra une décision explicite (renouvelé, changé d&apos;équipe,
          archivé, mis en attente ou parti). Rien n&apos;est reconduit automatiquement sans validation. L&apos;historique
          des saisons précédentes n&apos;est jamais modifié.
        </p>
        <div>
          <label className="text-[11px] font-bold uppercase tracking-[.04em] text-text-faint" htmlFor="to-saison">
            Nouvelle saison
          </label>
          <input
            id="to-saison"
            value={toSaison}
            onChange={(e) => setToSaison(e.target.value)}
            placeholder="Ex : 2027-2028"
            className="mt-1.5 h-11 w-full rounded-lg border border-border-strong bg-input-bg px-3 text-[13.5px] font-bold outline-none focus-visible:border-brand-blue"
          />
        </div>
        <Button variant="primary" disabled={!toSaison.trim() || toSaison.trim() === currentSaison} onClick={startReview}>
          Voir l&apos;effectif à traiter
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </Card>
    );
  }

  if (stage === "review") {
    if (loadError) {
      return (
        <Card>
          <ErrorState message="Impossible de charger l'effectif." onRetry={startReview} />
        </Card>
      );
    }
    if (candidates === null) {
      return <div className="py-16 text-center text-[13px] text-text-soft">Chargement de l&apos;effectif…</div>;
    }
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[12px] font-bold text-text-soft">
              {currentSaison} <ArrowRight className="mx-1 inline h-3 w-3" aria-hidden /> {toSaison}
            </div>
            <h1 className="mt-1 text-[22px] font-extrabold tracking-tight">
              {candidates.length} joueur{candidates.length > 1 ? "s" : ""} à traiter
            </h1>
          </div>
          <Button variant="primary" disabled={submitting || candidates.length === 0} onClick={commit}>
            {submitting ? "Validation…" : `Valider la transition (${candidates.length})`}
          </Button>
        </div>

        {candidates.length === 0 ? (
          <Card>
            <EmptyState icon={CheckCircle2} title="Aucun joueur actif sur la saison actuelle" />
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="hidden grid-cols-[1.4fr_1fr_1.4fr_1fr] gap-3 border-b border-divider bg-surface-alt px-5 py-3 text-[11px] font-extrabold uppercase tracking-[.04em] text-text-faint sm:grid">
              <span>Joueur</span>
              <span>Équipe actuelle</span>
              <span>Décision</span>
              <span>Équipe de destination</span>
            </div>
            {candidates.map((c) => {
              const current = actions[c.membershipId]?.action ?? "renouvele";
              return (
                <div
                  key={c.membershipId}
                  className="grid grid-cols-2 items-center gap-2.5 border-b border-divider px-5 py-3.5 last:border-0 sm:grid-cols-[1.4fr_1fr_1.4fr_1fr]"
                >
                  <span className="text-[13.5px] font-bold text-text">
                    {c.playerFirstName} {c.playerLastName}
                  </span>
                  <span className="text-[12.5px] text-text-soft">{c.teamName}</span>
                  <select
                    value={current}
                    onChange={(e) => setAction(c.membershipId, e.target.value as SeasonTransitionAction)}
                    className="h-9 rounded-lg border border-border-strong bg-input-bg px-2.5 text-[12.5px] font-semibold outline-none focus-visible:border-brand-blue"
                  >
                    {(Object.keys(ACTION_LABEL) as SeasonTransitionAction[]).map((action) => (
                      <option key={action} value={action}>
                        {ACTION_LABEL[action]}
                      </option>
                    ))}
                  </select>
                  {current === "deplace" ? (
                    <select
                      value={actions[c.membershipId]?.newTeamId ?? ""}
                      onChange={(e) => setNewTeam(c.membershipId, e.target.value)}
                      className="h-9 rounded-lg border border-border-strong bg-input-bg px-2.5 text-[12.5px] font-semibold outline-none focus-visible:border-brand-blue"
                    >
                      <option value="">Choisir une équipe</option>
                      {teams
                        .filter((t) => t.id !== c.teamId)
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                    </select>
                  ) : (
                    <span className="text-[12px] text-text-faint">—</span>
                  )}
                </div>
              );
            })}
          </Card>
        )}
      </div>
    );
  }

  return (
    <Card className="mx-auto flex max-w-xl flex-col items-center gap-3 p-8 text-center">
      <CheckCircle2 className="h-8 w-8 text-success-fg" aria-hidden />
      <div className="text-[16px] font-extrabold tracking-tight">Transition vers {toSaison} effectuée</div>
      <div className="text-[13px] text-text-soft">
        {result?.succeeded ?? 0} décision{(result?.succeeded ?? 0) > 1 ? "s" : ""} appliquée{(result?.succeeded ?? 0) > 1 ? "s" : ""}
        {result && result.failed.length > 0 && ` · ${result.failed.length} échec${result.failed.length > 1 ? "s" : ""}`}
      </div>
      {result && result.failed.length > 0 && (
        <Badge tone="danger">Certaines décisions n&apos;ont pas pu être appliquées, réessayez-les depuis Équipes.</Badge>
      )}
      <Link href="/teams">
        <Button variant="secondary">Retour aux équipes</Button>
      </Link>
    </Card>
  );
}
