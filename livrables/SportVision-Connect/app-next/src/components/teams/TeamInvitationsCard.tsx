"use client";

// Les invitations d'une équipe, réunies là où elles ont un sens : dans sa fiche.
//
// ── Trois publics, trois mécanismes, et ce n'est pas de la complication ──
//
//   Joueurs, en nombre   un lien collectif réutilisable (`team_invite_codes`), à coller dans le
//                        groupe ou à afficher au vestiaire. Il mène vers CONNECT.
//   Un joueur précis     une invitation nominative, quand on connaît la personne.
//   Un parent            jamais le lien joueur avec un autre texte : un parent rejoint Connect
//                        pour SON enfant, le rattachement est le sujet (§23).
//
// Le coach, lui, n'est pas ici : il reçoit des droits d'administration sur l'équipe, donc une
// invitation nominative et jamais un lien affichable (§42). Il vit dans la carte « Encadrement ».
//
// ── Où mènent ces liens ──
// Joueur et parent vers Connect, encadrant vers Club+ (§38). Un joueur n'a rien à faire dans
// l'outil de gestion du club, et un coach n'a rien à faire dans l'espace personnel d'un joueur.

import { useState } from "react";
import { QrCode as QrCodeIcon, UserPlus, Users } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { TeamPlayerInvite } from "@/components/teams/TeamPlayerInvite";
import { InviteFamilyModal } from "@/components/teams/InviteFamilyModal";
import { inviteFamilyMember, type FamilyInviteTargetType } from "@/lib/data/club/family-invites";
import { createClient } from "@/lib/supabase/client";
import type { Team } from "@/lib/types/teams";

export function TeamInvitationsCard({ clubId, team }: { clubId: string; team: Team }) {
  const [cible, setCible] = useState<FamilyInviteTargetType | null>(null);

  return (
    <Card className="p-4.5">
      <div className="flex items-center gap-2">
        <QrCodeIcon className="h-4 w-4 flex-none text-text-faint" aria-hidden />
        <div className="text-[14px] font-extrabold tracking-tight">Inviter des joueurs</div>
      </div>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-text-soft">
        Un lien unique pour toute l&apos;équipe, à coller dans le groupe ou à afficher au vestiaire.
        Il mène vers SportVision Connect, l&apos;espace personnel du joueur.
      </p>
      <div className="mt-3.5">
        <TeamPlayerInvite clubId={clubId} teamId={team.id} />
      </div>

      <div className="mt-4 flex flex-col gap-2 border-t border-divider pt-3.5">
        <div className="text-[12px] font-bold text-text-soft">Inviter une personne en particulier</div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" className="h-9 px-3.5 text-[12.5px]" onClick={() => setCible("joueur")}>
            <Users className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            Un joueur
          </Button>
          <Button variant="secondary" className="h-9 px-3.5 text-[12.5px]" onClick={() => setCible("parent")}>
            <UserPlus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            Un parent
          </Button>
        </div>
      </div>

      {cible && (
        // L'équipe est déjà choisie : la modale n'en propose qu'une, celle d'où l'on vient. C'est
        // tout l'objet du déplacement de ces actions depuis l'écran Équipes, où il fallait la
        // retrouver dans une liste de 43.
        <InviteFamilyModal
          targetType={cible}
          teams={[team]}
          onClose={() => setCible(null)}
          onInvite={(input) =>
            inviteFamilyMember(createClient(), {
              targetType: cible,
              email: input.email,
              firstName: input.firstName,
              lastName: input.lastName,
              clubId,
              teamId: input.teamId ?? team.id,
              dateNaissance: input.dateNaissance,
            })
          }
        />
      )}
    </Card>
  );
}
