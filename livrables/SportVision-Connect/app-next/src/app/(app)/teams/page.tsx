"use client";

import { Download, ShieldCheck, UserPlus, Users } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess, canCreate } from "@/lib/permissions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { LockedModule } from "@/components/teams/LockedModule";
import { TeamCard } from "@/components/teams/TeamCard";
import { FollowedClubCard } from "@/components/teams/FollowedClubCard";
import { mockFollowedClubs, teamsForOrganization } from "@/lib/mock/teams";

// Écran Équipes — ACTIONS.md § 16. Pour un CM externe (`cm_agency`), la même route devient
// « Clubs suivis » : 4 statistiques + une carte par club. Le composant reste unique, seul le
// contenu change selon le type d'organisation (voir README.md § Pas de duplication de pages).
export default function TeamsPage() {
  const { ctx } = useSession();

  if (!canAccess(ctx, "teams")) return <LockedModule ctx={ctx} />;

  if (ctx.organization.type === "cm_agency") {
    return <FollowedClubsView organizationId={ctx.organization.id} />;
  }

  const teams = teamsForOrganization(ctx.organization.id);
  const canAddPlayer = canCreate(ctx, "player");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[12px] font-bold text-text-soft">Équipes</div>
          <h1 className="mt-1.5 text-[29px] font-extrabold leading-tight tracking-tight">
            {teams.length} équipe{teams.length > 1 ? "s" : ""} pour {ctx.organization.name}
          </h1>
        </div>
        <div className="flex items-center gap-2.5">
          <Button variant="secondary">
            <Download className="h-3.5 w-3.5" aria-hidden />
            Exporter l&apos;effectif
          </Button>
          <Button variant="primary" disabled={!canAddPlayer}>
            <UserPlus className="h-3.5 w-3.5" aria-hidden />
            Ajouter un joueur
          </Button>
        </div>
      </div>

      {teams.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 px-8 py-16 text-center">
          <Users className="h-6 w-6 text-text-faint" aria-hidden />
          <div className="mt-1 text-[15px] font-extrabold">Aucune équipe pour le moment.</div>
          <p className="max-w-sm text-[13px] text-text-soft">
            Créez votre première équipe pour commencer à gérer l&apos;effectif, le calendrier et les
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

function FollowedClubsView({ organizationId }: { organizationId: string }) {
  const clubs = mockFollowedClubs[organizationId] ?? [];
  const totalPublications = clubs.reduce((sum, c) => sum + c.publicationsCount, 0);
  const totalToValidate = clubs.reduce((sum, c) => sum + c.toValidateCount, 0);
  const avgProgress = clubs.length
    ? Math.round(clubs.reduce((sum, c) => sum + c.progressPct, 0) / clubs.length)
    : 0;
  const activeAccess = clubs.filter((c) => c.accessStatus === "active").length;

  const stats = [
    { label: "Clubs suivis", value: String(clubs.length), icon: Users },
    { label: "Publications ce mois-ci", value: String(totalPublications), icon: Download },
    { label: "Contenus à valider", value: String(totalToValidate), icon: UserPlus },
    { label: "Accès actifs", value: `${activeAccess} / ${clubs.length}`, icon: ShieldCheck },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="text-[12px] font-bold text-text-soft">Clubs suivis</div>
        <h1 className="mt-1.5 text-[29px] font-extrabold leading-tight tracking-tight">
          Vos clubs accompagnés
        </h1>
      </div>

      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        {stats.map(({ label, value, icon: Icon }) => (
          <Card key={label} className="p-4">
            <div className="flex items-center gap-2 text-text-soft">
              <Icon className="h-3.5 w-3.5" aria-hidden />
              <span className="text-[11.5px] font-bold uppercase tracking-[.04em]">{label}</span>
            </div>
            <div className="mt-2 text-[22px] font-extrabold tracking-tight">{value}</div>
          </Card>
        ))}
      </div>

      {clubs.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 px-8 py-16 text-center">
          <Users className="h-6 w-6 text-text-faint" aria-hidden />
          <div className="mt-1 text-[15px] font-extrabold">Aucun club suivi pour le moment.</div>
          <p className="max-w-sm text-[13px] text-text-soft">
            Votre interlocuteur SportVision peut vous donner accès à un club.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {clubs.map((club) => (
            <FollowedClubCard key={club.organizationId} club={club} />
          ))}
        </div>
      )}
    </div>
  );
}
