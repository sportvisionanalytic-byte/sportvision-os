"use client";

import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { Card } from "@/components/ui/Card";
import { LockedModule } from "@/components/ui/LockedModule";
import { TeamCard } from "@/components/teams/TeamCard";
import { fetchClubTeams } from "@/lib/data/club/teams";
import { fetchAcademieGroups } from "@/lib/data/academie/groups";
import { fetchCoachPlayers, type CoachPlayer } from "@/lib/data/coach/players";
import { createClient } from "@/lib/supabase/client";
import type { Team } from "@/lib/types/teams";

// Écran Équipes — ACTIONS.md § 16. Pour une académie, « Groupes » (academie_groups, réutilise
// Team/TeamCard). Pour un coach, « Joueurs suivis » (coach_players, vue dédiée — pas de notion
// d'équipe côté coach, voir le plan Phase 4). Le composant reste unique, seul le contenu change
// selon le type d'organisation (voir README.md § Pas de duplication de pages).
// Note : la vue « Clubs suivis » pour un CM externe (`cm_agency`, ACTIONS.md § 16) a été retirée
// (code mort) — ORG_TYPE_MAP (src/lib/supabase/mappers.ts) ne produit jamais ce type pour une
// organisation réelle, cette branche n'était donc jamais atteignable.
export default function TeamsPage() {
  const { ctx } = useSession();
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const isAcademy = ctx.organization.type === "academy";
  const isCoach = ctx.organization.type === "coach";

  useEffect(() => {
    if (isCoach) return;
    let cancelled = false;
    const supabase = createClient();
    const fetcher = isAcademy ? fetchAcademieGroups(supabase, ctx.organization.id) : fetchClubTeams(supabase, ctx.organization.id);
    fetcher
      .then((rows) => {
        if (!cancelled) setTeams(rows);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.organization.id, isAcademy, isCoach]);

  if (!canAccess(ctx, "teams")) return <LockedModule />;

  if (isCoach) {
    return <CoachPlayersView organizationId={ctx.organization.id} />;
  }

  if (loadError) {
    return (
      <Card className="flex flex-col items-center gap-2 px-8 py-16 text-center">
        <div className="text-[15px] font-extrabold">Impossible de charger {isAcademy ? "les groupes" : "les équipes"}.</div>
        <p className="max-w-sm text-[13px] text-text-soft">Réessayez dans quelques instants.</p>
      </Card>
    );
  }

  if (teams === null) {
    return <div className="py-16 text-center text-[13px] text-text-soft">Chargement des équipes…</div>;
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[12px] font-bold text-text-soft">{isAcademy ? "Groupes" : "Équipes"}</div>
          <h1 className="mt-1.5 text-[29px] font-extrabold leading-tight tracking-tight">
            {teams.length} {isAcademy ? "groupe" : "équipe"}{teams.length > 1 ? "s" : ""} pour {ctx.organization.name}
          </h1>
        </div>
      </div>

      {teams.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 px-8 py-16 text-center">
          <Users className="h-6 w-6 text-text-faint" aria-hidden />
          <div className="mt-1 text-[15px] font-extrabold">
            {isAcademy ? "Aucun groupe pour le moment." : "Aucune équipe pour le moment."}
          </div>
          <p className="max-w-sm text-[13px] text-text-soft">
            Créez votre {isAcademy ? "premier groupe" : "première équipe"} pour commencer à gérer l&apos;effectif, le calendrier et les
            contenus.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {teams.map((team) => (
            <TeamCard key={team.id} team={team} />
          ))}
        </div>
      )}
    </div>
  );
}

function CoachPlayersView({ organizationId }: { organizationId: string }) {
  const [players, setPlayers] = useState<CoachPlayer[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    fetchCoachPlayers(supabase, organizationId)
      .then((rows) => {
        if (!cancelled) setPlayers(rows);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  if (loadError) {
    return (
      <Card className="flex flex-col items-center gap-2 px-8 py-16 text-center">
        <div className="text-[15px] font-extrabold">Impossible de charger les joueurs suivis.</div>
        <p className="max-w-sm text-[13px] text-text-soft">Réessayez dans quelques instants.</p>
      </Card>
    );
  }

  if (players === null) {
    return <div className="py-16 text-center text-[13px] text-text-soft">Chargement…</div>;
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="text-[12px] font-bold text-text-soft">Joueurs suivis</div>
        <h1 className="mt-1.5 text-[29px] font-extrabold leading-tight tracking-tight">
          {players.length} joueur{players.length > 1 ? "s" : ""} suivi{players.length > 1 ? "s" : ""}
        </h1>
      </div>

      {players.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 px-8 py-16 text-center">
          <Users className="h-6 w-6 text-text-faint" aria-hidden />
          <div className="mt-1 text-[15px] font-extrabold">Aucun joueur suivi pour le moment.</div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {players.map((p) => (
            <Card key={p.id} className="p-4">
              <div className="text-[14.5px] font-extrabold tracking-tight">
                {p.firstName} {p.lastName ?? ""}
              </div>
              {p.category && <div className="mt-1 text-[12px] font-semibold text-text-soft">{p.category}</div>}
              {p.notes && <p className="mt-2 text-[12.5px] leading-relaxed text-text-soft">{p.notes}</p>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
