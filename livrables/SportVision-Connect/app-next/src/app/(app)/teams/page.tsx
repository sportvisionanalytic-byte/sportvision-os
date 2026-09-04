"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, Plus, Users } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { LockedModule } from "@/components/ui/LockedModule";
import { TeamCard } from "@/components/teams/TeamCard";
import { CreateTeamModal } from "@/components/teams/CreateTeamModal";
import { InviteFamilyModal } from "@/components/teams/InviteFamilyModal";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { createClubTeam, fetchClubTeams } from "@/lib/data/club/teams";
import { inviteFamilyMember, type FamilyInviteTargetType } from "@/lib/data/club/family-invites";
import { fetchAcademieGroups } from "@/lib/data/academie/groups";
import { fetchCoachPlayers, type CoachPlayer } from "@/lib/data/coach/players";
import { fetchDelegatedClubAccess, type DelegatedClubAccess } from "@/lib/data/shared/cm-agency-access";
import { createClient } from "@/lib/supabase/client";
import type { Team } from "@/lib/types/teams";

// Écran Équipes — ACTIONS.md § 16. Pour une académie, « Groupes » (academie_groups, réutilise
// Team/TeamCard). Pour un coach, « Joueurs suivis » (coach_players, vue dédiée — pas de notion
// d'équipe côté coach, voir le plan Phase 4). Pour une agence CM (`cm_agency`), « Clubs suivis »
// (cm_agency_club_access, voir CmAgencyClubsView plus bas). Le composant reste unique, seul le
// contenu change selon le type d'organisation (voir README.md § Pas de duplication de pages).
// 17/08/2026 — la branche cm_agency avait été retirée par un agent antérieur avec le commentaire
// "ORG_TYPE_MAP ne produit jamais ce type pour une organisation réelle" : FAUX, vérifié en
// relisant mappers.ts (ORG_TYPE_MAP.cm_agency = "cm_agency", ligne 19) — cm_agency est un type
// réel et atteignable (NAV_CM_AGENCY pointe justement ici). Trouvé lors de l'audit complet Club+ :
// "Clubs suivis" était donc bien cassé pour un vrai compte agence CM, pas du code mort. Reconstruit
// avec la même source que le dashboard Studio (fetchDelegatedClubAccess).
export default function TeamsPage() {
  const { ctx } = useSession();
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [inviteTarget, setInviteTarget] = useState<FamilyInviteTargetType | null>(null);
  const isAcademy = ctx.organization.type === "academy";
  const isCoach = ctx.organization.type === "coach";
  const isCmAgency = ctx.organization.type === "cm_agency";
  // Un club "réel" au sens de cet écran couvre aussi un CM délégué (bascule d'espace
  // delegated_club, session.ts buildDelegatedClubActiveContext) : ctx.organization.type est déjà
  // forcé à "club" pour lui — même écran, mêmes boutons, jamais de logique de rôle séparée ici.
  const isClub = !isAcademy && !isCoach && !isCmAgency;

  // Coach/Directeur sportif de club (Bible §7/§8, 17/08/2026) : à ne pas confondre avec `isCoach`
  // ci-dessus, qui teste le TYPE d'organisation "Coach indépendant" (KD Performance), pas le RÔLE
  // dans un club. myTeams reste vide (pas de filtrage) si le rôle n'est ni coach ni sports_director,
  // ou si teamScope est vide (scope non renseigné : mieux vaut montrer tout que cacher à tort).
  const isClubEducateurRole = ctx.organization.type === "club" && (ctx.membership.role === "coach" || ctx.membership.role === "sports_director");
  const myTeams = isClubEducateurRole ? (teams ?? []).filter((t) => ctx.membership.teamScope.includes(t.name)) : [];
  const otherTeams = myTeams.length > 0 ? (teams ?? []).filter((t) => !ctx.membership.teamScope.includes(t.name)) : [];

  const loadTeams = useCallback(() => {
    if (isCoach || isCmAgency) return;
    let cancelled = false;
    const supabase = createClient();
    setLoadError(false);
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
  }, [ctx.organization.id, isAcademy, isCoach, isCmAgency]);

  useEffect(() => loadTeams(), [loadTeams]);

  if (!canAccess(ctx, "teams")) return <LockedModule />;

  if (isCoach) {
    return <CoachPlayersView organizationId={ctx.organization.id} />;
  }

  if (isCmAgency) {
    return <CmAgencyClubsView organizationId={ctx.organization.id} />;
  }

  if (loadError) {
    return (
      <Card>
        <ErrorState message={`Impossible de charger ${isAcademy ? "les groupes" : "les équipes"}.`} onRetry={loadTeams} />
      </Card>
    );
  }

  if (teams === null) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} className="h-[120px]" />
        ))}
      </div>
    );
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
        {/* academie_groups n'a pas encore d'équivalent createClubTeam — bouton réservé au club
            (club_teams), pas de promesse pour l'académie. */}
        <div className="flex flex-wrap gap-2">
          {isClub && ctx.membership.role === "admin" && (
            <Link href="/season-transition">
              <Button variant="secondary" className="h-10 gap-1.5 px-4 text-[13px]">
                <CalendarClock className="h-3.5 w-3.5" aria-hidden />
                Transition de saison
              </Button>
            </Link>
          )}
          {isClub && (
            <>
              <Button variant="secondary" className="h-10 gap-1.5 px-4 text-[13px]" onClick={() => setInviteTarget("parent")}>
                + Inviter un parent
              </Button>
              <Button className="h-10 gap-1.5 px-4 text-[13px]" onClick={() => setInviteTarget("joueur")}>
                + Inviter un joueur
              </Button>
            </>
          )}
          {!isAcademy && (
            <Button className="h-10 gap-1.5 px-4 text-[13px]" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              Créer une équipe
            </Button>
          )}
        </div>
      </div>

      {showCreate && (
        <CreateTeamModal
          clubId={ctx.organization.id}
          existingNames={(teams ?? []).map((t) => t.name)}
          onClose={() => setShowCreate(false)}
          onCreate={(input) => createClubTeam(createClient(), ctx.organization.id, input).then(() => loadTeams())}
        />
      )}

      {inviteTarget && (
        <InviteFamilyModal
          targetType={inviteTarget}
          teams={teams ?? []}
          onClose={() => setInviteTarget(null)}
          onInvite={(input) =>
            inviteFamilyMember(createClient(), {
              targetType: inviteTarget,
              email: input.email,
              firstName: input.firstName,
              lastName: input.lastName,
              clubId: ctx.organization.id,
              teamId: input.teamId,
              dateNaissance: input.dateNaissance,
            })
          }
        />
      )}

      {teams.length === 0 ? (
        <Card>
          <EmptyState
            icon={Users}
            title={isAcademy ? "Aucun groupe pour le moment" : "Aucune équipe pour le moment"}
            description={`Créez votre ${isAcademy ? "premier groupe" : "première équipe"} pour commencer à gérer l'effectif, le calendrier et les contenus.`}
            action={!isAcademy ? { label: "Créer une équipe", onClick: () => setShowCreate(true) } : undefined}
          />
        </Card>
      ) : myTeams.length > 0 ? (
        // Coach/Directeur sportif (Bible §7/§8, 17/08/2026) : la liste complète du club reste
        // chargée (RLS is_club_member volontairement non restreinte par équipe, voir
        // data/club/teams.ts) mais l'expérience met en avant SON/SES équipe(s) plutôt que de les
        // noyer dans tout l'effectif du club — le reste reste accessible, replié sous <details>.
        <div className="flex flex-col gap-5">
          <div>
            <div className="mb-2.5 text-[13px] font-extrabold tracking-tight">
              {myTeams.length === 1 ? `Mon équipe ${myTeams[0]!.name}` : "Mes équipes"}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {myTeams.map((team) => (
                <TeamCard key={team.id} team={team} />
              ))}
            </div>
          </div>
          {otherTeams.length > 0 && (
            <details>
              <summary className="cursor-pointer text-[12.5px] font-bold text-text-soft">
                Voir les {otherTeams.length} autre{otherTeams.length > 1 ? "s" : ""} équipe{otherTeams.length > 1 ? "s" : ""} du club
              </summary>
              <div className="mt-3.5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {otherTeams.map((team) => (
                  <TeamCard key={team.id} team={team} />
                ))}
              </div>
            </details>
          )}
        </div>
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

function CmAgencyClubsView({ organizationId }: { organizationId: string }) {
  const [clubs, setClubs] = useState<DelegatedClubAccess[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  const loadClubs = useCallback(() => {
    let cancelled = false;
    const supabase = createClient();
    setLoadError(false);
    fetchDelegatedClubAccess(supabase, organizationId)
      .then((rows) => {
        if (!cancelled) setClubs(rows);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  useEffect(() => loadClubs(), [loadClubs]);

  if (loadError) {
    return (
      <Card>
        <ErrorState message="Impossible de charger les clubs suivis." onRetry={loadClubs} />
      </Card>
    );
  }

  if (clubs === null) {
    return (
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonCard key={i} className="h-[120px]" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="text-[12px] font-bold text-text-soft">Clubs suivis</div>
        <h1 className="mt-1.5 text-[29px] font-extrabold leading-tight tracking-tight">
          {clubs.length} club{clubs.length > 1 ? "s" : ""} délégué{clubs.length > 1 ? "s" : ""}
        </h1>
      </div>

      {clubs.length === 0 ? (
        <Card>
          <EmptyState
            icon={Users}
            title="Aucun club délégué pour le moment"
            description="SportVision vous donne accès à un club dès qu'une délégation est activée."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {clubs.map((c) => (
            <Card key={c.id} className="p-4">
              <div className="text-[14.5px] font-extrabold tracking-tight">{c.clubName}</div>
              {c.allowed.length > 0 && (
                <div className="mt-2 text-[12.5px] leading-relaxed text-text-soft">
                  <span className="font-bold text-text">Autorisé : </span>
                  {c.allowed.join(", ")}
                </div>
              )}
              {c.denied.length > 0 && (
                <div className="mt-1.5 text-[12.5px] leading-relaxed text-text-faint">
                  <span className="font-bold">Non autorisé : </span>
                  {c.denied.join(", ")}
                </div>
              )}
              {c.expiresAt && <div className="mt-2 text-[11.5px] font-semibold text-text-faint">Expire le {c.expiresAt}</div>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function CoachPlayersView({ organizationId }: { organizationId: string }) {
  const [players, setPlayers] = useState<CoachPlayer[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  const loadPlayers = useCallback(() => {
    let cancelled = false;
    const supabase = createClient();
    setLoadError(false);
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

  useEffect(() => loadPlayers(), [loadPlayers]);

  if (loadError) {
    return (
      <Card>
        <ErrorState message="Impossible de charger les joueurs suivis." onRetry={loadPlayers} />
      </Card>
    );
  }

  if (players === null) {
    return (
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} className="h-[92px]" />
        ))}
      </div>
    );
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
        <Card>
          <EmptyState icon={Users} title="Aucun joueur suivi pour le moment" />
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
