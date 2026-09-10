"use client";

import Link from "next/link";
import { MapPin, Users } from "lucide-react";
import { Card } from "@/components/ui/Card";
import type { Team } from "@/lib/types/teams";

// Carte d'équipe — ACTIONS.md § 16, écran /teams.
//
// 10/09/2026 — Deux corrections d'un coup, liées.
//
// Une équipe RÉELLE n'était pas cliquable : « un id réel n'a pas de fiche équipe consultable »,
// disait le commentaire d'origine. C'était vrai en août, ça ne l'est plus — teams/[id] sert
// désormais une vraie fiche (RealTeamDetail : effectif, calendrier, contenus, encadrement). Les
// 43 cartes de SF Villemomble étaient donc des culs-de-sac.
//
// Et le lien d'inscription des joueurs vivait ICI, répété sur chacune des 43 cartes, sur un écran
// dont le rôle est d'aider à TROUVER une équipe. Il est parti dans la fiche (TeamPlayerInvite),
// là où l'on est déjà quand on veut inviter SES joueurs.
//
// Ce qui reste : de quoi reconnaître l'équipe, et l'ouvrir.
export function TeamCard({ team }: { team: Team }) {
  const body = (
    <Card
      className="group h-full p-4.5 hover:-translate-y-0.5 hover:border-brand-blue-pale hover:shadow-sv-card-hover"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[15px] font-extrabold tracking-tight">{team.name}</div>
          <div className="mt-0.5 text-[12px] font-semibold text-text-soft">
            {team.category} · Saison {team.season}
          </div>
        </div>
        <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-info-bg text-[12px] font-extrabold text-info-fg">
          {team.playerCount}
        </span>
      </div>

      <div className="mt-3.5 flex flex-col gap-1.5 text-[12.5px] text-text-soft">
        <span className="flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5 flex-none" aria-hidden />
          {team.headCoachName} · Entraîneur principal
        </span>
        {team.venue && (
          <span className="flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 flex-none" aria-hidden />
            {team.venue}
          </span>
        )}
      </div>

      <div className="mt-4 border-t border-divider pt-3 text-[12.5px] font-bold text-brand-blue-electric group-hover:text-brand-violet">
        Ouvrir la fiche équipe →
      </div>
    </Card>
  );

  return <Link href={`/teams/${team.id}`}>{body}</Link>;
}
