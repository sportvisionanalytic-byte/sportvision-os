"use client";

import { useCallback, useEffect, useState } from "react";
import { UserPlus } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess, isClubCommunicationOrEducateur } from "@/lib/permissions";
import type { MembershipRole, OrgType } from "@/lib/types";
import { mockOrgUsers } from "@/lib/mock/settings";
import { ROLE_LABELS, type OrgUser } from "@/lib/types/settings";
import { fetchClubMembers, inviteClubMember, setClubMemberStatus } from "@/lib/data/club/users";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { LockedModule } from "@/components/ui/LockedModule";
import { SkeletonRow } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { InviteUserModal } from "@/components/users/InviteUserModal";
import { Toast, useToast } from "@/components/feedback/Toast";

// /users — voir ACTIONS.md § 15 « Utilisateurs » (juste après Équipes dans le document) et
// DATA_MODEL.md § Membership. Liste des membres avec rôle et statut, invitation. « Une
// organisation a exactement un owner, non désactivable sans transfert. » — règle du design
// jamais applicable ici : club_members.role (check constraint, migration-clubplus-v1.sql) n'a
// pas de valeur 'owner', donc pas de mapping possible côté CLUB_ROLE_MAP (mappers.ts). Un club
// n'a réellement que des admins (potentiellement plusieurs), pas un owner unique protégé.
const ROLES_BY_ORG_TYPE: Record<OrgType, MembershipRole[]> = {
  club: ["admin", "president", "communication_manager", "secretary", "coach", "team_manager", "sports_director", "admin_staff", "sponsor_manager", "treasurer", "board_member", "viewer", "external_cm"],
  academy: ["admin", "manager", "coach", "internal_cm", "staff", "viewer"],
  // structure_coaching (migration-connect-v78-signup-unifie-clubplus.sql, 17/08/2026) : 3 rôles
  // réels (organization_role_catalog) — responsable(admin)/coach(défaut)/intervenant, mappés sur
  // "admin"/"coach"/"staff" (mapOrgRole, mappers.ts). "viewer" ajouté pour rester cohérent avec
  // les autres types génériques (coach/cm_agency) qui listent toujours un rôle de repli.
  coaching_structure: ["admin", "coach", "staff", "viewer"],
  // Bascule 2 org types séparés (migration-clubplus-v44, 17/08/2026) : mêmes rôles pour tournoi
  // et stage/camp qu'auparavant pour l'unique OrgType `event` (organization_role_catalog partage
  // aussi le même catalogue responsable/partenaire pour les deux, voir mappers.ts).
  tournament_organizer: ["event_admin", "communication_manager", "partner_manager", "staff", "volunteer", "partner"],
  camp: ["event_admin", "communication_manager", "partner_manager", "staff", "volunteer", "partner"],
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
  const { toastMessage, toastTone, showToast } = useToast();
  const isClub = ctx.organization.type === "club";
  const [users, setUsers] = useState<OrgUser[] | null>(() => (isClub ? null : mockOrgUsers[ctx.organization.id] ?? []));
  const [inviteOpen, setInviteOpen] = useState(false);
  const [loadError, setLoadError] = useState(false);

  // Communication et Éducateur ne voient jamais Utilisateurs (§11 du master doc, les deux =
  // "Non") — club_members reste lisible par tout membre actif côté RLS (cm_same_club_select,
  // migration-clubplus-v1.sql, aucune restriction de rôle), donc rien n'empêcherait la requête de
  // renvoyer la liste : c'est ce garde côté frontend qui l'arrête avant même de la lancer.
  const isRestrictedClubRole = isClubCommunicationOrEducateur(ctx);

  const loadUsers = useCallback(() => {
    if (!isClub || isRestrictedClubRole) return;
    setLoadError(false);
    const supabase = createClient();
    fetchClubMembers(supabase, ctx.organization.id)
      .then(setUsers)
      .catch(() => setLoadError(true));
  }, [isClub, isRestrictedClubRole, ctx.organization.id]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  if (isRestrictedClubRole) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="mx-auto flex max-w-lg flex-col items-center gap-3 p-9 text-center">
          <h1 className="text-[20px] font-extrabold tracking-tight">Membres & accès</h1>
          <p className="max-w-md text-[13.5px] leading-relaxed text-text-soft">
            La gestion des membres et des accès est réservée à l&apos;administrateur du club. Contactez-le si vous
            avez besoin d&apos;un accès supplémentaire.
          </p>
        </Card>
      </div>
    );
  }

  // club_members réel (Phase suivante) : seul le club a de vraies données ici — les autres
  // types d'organisation restent verrouillés ("users" hors READY_MODULES) plutôt que de montrer
  // mockOrgUsers sur un compte réel, même logique que /billing et /services.
  if (!isClub && !canAccess(ctx, "users")) return <LockedModule title="Membres & accès" />;

  // Seul un admin de club a le droit d'inviter/désactiver côté RLS (is_club_admin) — la policy
  // laisse un coach/lecture_seule voir la liste mais refuse toute écriture. On reflète ça côté UI
  // plutôt que d'afficher des actions qui échoueront silencieusement.
  const isAdmin = !isClub || ctx.membership.role === "admin";

  const availableRoles = ROLES_BY_ORG_TYPE[ctx.organization.type] ?? ["viewer"];

  function handleInvite(input: { email: string; firstName: string; lastName: string; role: MembershipRole; team?: string; mode?: "email" | "direct" }) {
    if (isClub) {
      // clubplus-invite (edge function réelle) : crée le compte auth.users (par e-mail ou
      // directement selon `mode`, voir InviteUserModal), insère la ligne club_members. On
      // recharge la liste plutôt que d'ajouter une ligne locale fabriquée, pour refléter l'id
      // réel attribué par la base. Le résultat (mot de passe en mode direct) remonte tel quel à
      // la modale, qui décide de l'afficher.
      const supabase = createClient();
      return inviteClubMember(supabase, ctx.organization.id, input).then((result) =>
        fetchClubMembers(supabase, ctx.organization.id)
          .then(setUsers)
          .then(() => result),
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
        teamScope: input.team?.trim() ? [input.team.trim()] : [],
        status: "invited",
        invitedAt: new Date().toISOString(),
      },
      ...(prev ?? []),
    ]);
    return Promise.resolve();
  }

  function handleDisable(user: OrgUser) {
    if (!isClub) {
      setUsers((prev) => (prev ?? []).map((u) => (u.id === user.id ? { ...u, status: u.status === "disabled" ? "active" : "disabled" } : u)));
      return;
    }
    const nextStatus = user.status === "disabled" ? "actif" : "suspendu";
    const supabase = createClient();
    setClubMemberStatus(supabase, user.membershipId, nextStatus)
      .then(() => {
        setUsers((prev) => (prev ?? []).map((u) => (u.id === user.id ? { ...u, status: nextStatus === "actif" ? "active" : "disabled" } : u)));
      })
      .catch(() => showToast("Action impossible, réessayez.", "error"));
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[29px] font-extrabold tracking-tight">Membres & accès</h1>
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
        {loadError ? (
          <ErrorState message="Impossible de charger les membres." onRetry={loadUsers} />
        ) : users === null ? (
          <div>
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonRow key={i} />
            ))}
          </div>
        ) : users.length === 0 ? (
          <EmptyState title="Aucun membre pour le moment" />
        ) : (
          users.map((user) => {
            const initials = `${user.firstName[0] ?? ""}${user.lastName[0] ?? ""}`.toUpperCase() || "?";
            // Se désactiver soi-même coupe l'accès RLS à tout le club côté club_members
            // (is_club_member/is_club_admin exigent status='actif') sans porte de sortie en
            // libre-service — un membre ne peut alors être réactivé que par un autre admin déjà
            // actif ou le staff SportVision. Trouvé en le déclenchant réellement sur le compte de
            // test. Bouton masqué sur sa propre ligne (UX) ; bloqué aussi côté base depuis le
            // 09/08/2026 (migration-connect-v15-fix-club-admin-self-demote.sql, exécutée) — un
            // appel API direct qui contournerait ce masquage échoue désormais aussi.
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
                  {user.email && (
                    <span className="mt-0.5 block truncate text-[12px] text-text-soft">{user.email}</span>
                  )}
                </span>
                <span className="w-44 flex-none text-[12.5px] font-semibold text-text-soft">
                  {ROLE_LABELS[user.role] ?? user.role}
                  {user.teamScope.length > 0 && ` · ${user.teamScope.join(", ")}`}
                </span>
                <Badge tone={STATUS_TONE[user.status]}>{STATUS_LABEL[user.status]}</Badge>
                {isSelf ? (
                  <span className="w-[92px] flex-none text-center text-[11.5px] font-semibold text-text-faint">Vous</span>
                ) : (
                  isAdmin && (
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
        <InviteUserModal
          roles={availableRoles}
          allowDirectMode={isClub}
          onClose={() => setInviteOpen(false)}
          onInvite={handleInvite}
        />
      )}

      <Toast message={toastMessage} tone={toastTone} />
    </div>
  );
}
