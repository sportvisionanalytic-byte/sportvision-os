"use client";

import { useEffect, useState } from "react";
import { UserPlus } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import type { MembershipRole, OrgType } from "@/lib/types";
import { mockOrgUsers } from "@/lib/mock/settings";
import { ROLE_LABELS, type OrgUser } from "@/lib/types/settings";
import { fetchClubMembers, inviteClubMember, setClubMemberStatus } from "@/lib/data/club/users";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { LockedModule } from "@/components/ui/LockedModule";
import { InviteUserModal } from "@/components/users/InviteUserModal";
import { Toast, useToast } from "@/components/feedback/Toast";

// /users — voir ACTIONS.md § 15 « Utilisateurs » (juste après Équipes dans le document) et
// DATA_MODEL.md § Membership. Liste des membres avec rôle et statut, invitation. « Une
// organisation a exactement un owner, non désactivable sans transfert. »
const ROLES_BY_ORG_TYPE: Record<OrgType, MembershipRole[]> = {
  club: ["admin", "president", "communication_manager", "secretary", "coach", "team_manager", "sponsor_manager", "treasurer", "board_member", "viewer", "external_cm"],
  academy: ["admin", "manager", "coach", "internal_cm", "staff", "viewer"],
  event: ["event_admin", "communication_manager", "partner_manager", "staff", "volunteer", "partner"],
  coach: ["admin", "viewer"],
  player: ["viewer"],
  parent: ["viewer"],
  cm_agency: ["admin", "viewer"],
  sponsor: ["viewer"],
  generic: ["admin", "viewer"],
};

const STATUS_TONE: Record<OrgUser["status"], "success" | "warning" | "neutral"> = {
  active: "success",
  invited: "warning",
  disabled: "neutral",
};

const STATUS_LABEL: Record<OrgUser["status"], string> = {
  active: "Actif",
  invited: "Invitation envoyée",
  disabled: "Désactivé",
};

export default function UsersPage() {
  const { ctx } = useSession();
  const { toastMessage, showToast } = useToast();
  const isClub = ctx.organization.type === "club";
  const [users, setUsers] = useState<OrgUser[]>(() => (isClub ? [] : mockOrgUsers[ctx.organization.id] ?? []));
  const [inviteOpen, setInviteOpen] = useState(false);

  useEffect(() => {
    if (!isClub) return;
    const supabase = createClient();
    fetchClubMembers(supabase, ctx.organization.id).then(setUsers);
  }, [isClub, ctx.organization.id]);

  // club_members réel (Phase suivante) : seul le club a de vraies données ici — les autres
  // types d'organisation restent verrouillés ("users" hors READY_MODULES) plutôt que de montrer
  // mockOrgUsers sur un compte réel, même logique que /billing et /services.
  if (!isClub && !canAccess(ctx, "users")) return <LockedModule title="Utilisateurs" />;

  // Seul un admin de club a le droit d'inviter/désactiver côté RLS (is_club_admin) — la policy
  // laisse un coach/lecture_seule voir la liste mais refuse toute écriture. On reflète ça côté UI
  // plutôt que d'afficher des actions qui échoueront silencieusement.
  const isAdmin = !isClub || ctx.membership.role === "admin";

  const availableRoles = ROLES_BY_ORG_TYPE[ctx.organization.type] ?? ["viewer"];

  function handleInvite(input: { email: string; firstName: string; lastName: string; role: MembershipRole }) {
    if (isClub) {
      // clubplus-invite (edge function réelle) : crée le compte auth.users, envoie l'e-mail
      // d'invitation Supabase, insère la ligne club_members. On recharge la liste plutôt que
      // d'ajouter une ligne locale fabriquée, pour refléter l'id réel attribué par la base.
      const supabase = createClient();
      return inviteClubMember(supabase, ctx.organization.id, input).then(() =>
        fetchClubMembers(supabase, ctx.organization.id).then(setUsers),
      );
    }
    // Pas d'edge function d'invitation branchée pour ce type d'organisation dans cette phase
    // (org-invite existe pour coach/académie/sponsor, pas encore vérifiée/branchée ici) — reste
    // local-only, comme avant, pour ne pas prétendre envoyer une invitation qui ne part pas réellement.
    setUsers((prev) => [
      {
        id: `user-local-${Date.now()}`,
        membershipId: `m-local-${Date.now()}`,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        role: input.role,
        teamScope: [],
        status: "invited",
        invitedAt: new Date().toISOString(),
      },
      ...prev,
    ]);
    return Promise.resolve();
  }

  function handleDisable(user: OrgUser) {
    if (!isClub) {
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, status: u.status === "disabled" ? "active" : "disabled" } : u)));
      return;
    }
    const nextStatus = user.status === "disabled" ? "actif" : "suspendu";
    const supabase = createClient();
    setClubMemberStatus(supabase, user.membershipId, nextStatus)
      .then(() => {
        setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, status: nextStatus === "actif" ? "active" : "disabled" } : u)));
      })
      .catch(() => showToast("Action impossible, réessayez."));
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[29px] font-extrabold tracking-tight">Utilisateurs</h1>
          <p className="mt-1 text-[13.5px] text-text-soft">
            Membres de {ctx.organization.name} et leur rôle.
            {!isAdmin && " Seul un administrateur peut gérer les membres."}
          </p>
        </div>
        {isAdmin && (
          <Button onClick={() => setInviteOpen(true)}>
            <UserPlus className="h-4 w-4" aria-hidden />
            Inviter un utilisateur
          </Button>
        )}
      </div>

      <Card>
        {users.length === 0 ? (
          <div className="p-9 text-center text-[13.5px] text-text-soft">Aucun utilisateur pour le moment.</div>
        ) : (
          users.map((user) => {
            const initials = `${user.firstName[0] ?? ""}${user.lastName[0] ?? ""}`.toUpperCase() || "?";
            const isOwner = user.role === "owner";
            // Se désactiver soi-même coupe l'accès RLS à tout le club côté club_members
            // (is_club_member/is_club_admin exigent status='actif') sans porte de sortie en
            // libre-service — un membre ne peut alors être réactivé que par un autre admin déjà
            // actif ou le staff SportVision (protect_sensitive_club_member_fields, migration-
            // connect-v13). Trouvé en le déclenchant réellement sur le compte de test. Bouton
            // masqué sur sa propre ligne plutôt que de compter sur la prudence de l'utilisateur.
            const isSelf = user.id === ctx.user.id;
            return (
              <div
                key={user.id}
                className="flex flex-wrap items-center gap-3.5 border-b border-divider px-5 py-3.5 last:border-0 hover:bg-row-hover"
              >
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-gradient-to-br from-brand-violet to-brand-blue-electric text-[11px] font-extrabold text-white">
                  {initials}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-bold">
                    {user.firstName} {user.lastName}
                  </span>
                  <span className="mt-0.5 block truncate text-[12px] text-text-soft">{user.email}</span>
                </span>
                <span className="w-44 flex-none text-[12.5px] font-semibold text-text-soft">
                  {ROLE_LABELS[user.role] ?? user.role}
                </span>
                <Badge tone={STATUS_TONE[user.status]}>{STATUS_LABEL[user.status]}</Badge>
                {isSelf ? (
                  <span className="w-[92px] flex-none text-center text-[11.5px] font-semibold text-text-faint">Vous</span>
                ) : (
                  isAdmin && !isOwner && (
                    <Button
                      variant="secondary"
                      className="h-8 flex-none px-3 text-[12px]"
                      onClick={() => handleDisable(user)}
                    >
                      {user.status === "disabled" ? "Réactiver" : "Désactiver"}
                    </Button>
                  )
                )}
              </div>
            );
          })
        )}
      </Card>

      {inviteOpen && (
        <InviteUserModal roles={availableRoles} onClose={() => setInviteOpen(false)} onInvite={handleInvite} />
      )}

      <Toast message={toastMessage} />
    </div>
  );
}
