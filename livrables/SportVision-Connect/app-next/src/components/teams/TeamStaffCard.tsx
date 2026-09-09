"use client";

// L'encadrement d'une équipe, depuis la fiche de cette équipe.
//
// ── Le trou que ça comble ──
// Toute la chaîne d'invitation existait déjà : l'edge function `clubplus-invite` acceptait un
// périmètre d'équipes, `club_members.teams` le stockait, `is_team_educateur` l'appliquait en RLS.
// Il manquait la seule chose qu'un club pouvait faire : partir d'une équipe et dire « c'est lui,
// le coach ». Passer par « Membres & accès » obligeait à retaper le nom de l'équipe à la main,
// dans un champ libre, avec une correspondance exacte attendue en base — autant dire jamais bon.
//
// ── Ce qu'on n'invente pas ──
// L'état affiché vient de `lib/teams/encadrement.ts`, qui croise le nom écrit dans
// `club_teams.coach` (un texte, pas un accès) et les vrais comptes rattachés. Aucun raccourci
// visuel : une équipe dont le coach est « renseigné » sans compte est annoncée comme telle.

import { useMemo, useState } from "react";
import { AlertTriangle, Link2, Mail, UserPlus, Wrench } from "lucide-react";
import type { OrgUser } from "@/lib/types/settings";
import { ROLE_LABELS } from "@/lib/types/settings";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { InviteUserModal } from "@/components/users/InviteUserModal";
import {
  etatEncadrement,
  libelleEtat,
  nomAffiche,
  perimetresApproximatifs,
  tonEtat,
} from "@/lib/teams/encadrement";
import { addTeamToClubMember, inviteClubMember, removeTeamFromClubMember } from "@/lib/data/club/users";
import { createClient } from "@/lib/supabase/client";

const ROLES_INVITABLES = ["coach", "team_manager", "sports_director"] as const;

const STATUT_MEMBRE: Record<OrgUser["status"], { libelle: string; ton: "success" | "info" | "neutral" }> = {
  active: { libelle: "Compte actif", ton: "success" },
  invited: { libelle: "Invitation en attente", ton: "info" },
  disabled: { libelle: "Suspendu", ton: "neutral" },
};

interface Props {
  clubId: string;
  teamName: string;
  /** `club_teams.coach` — un nom saisi à la main, qui ne vaut aucun droit. */
  headCoachName: string | null;
  members: OrgUser[];
  /** Seul un admin de club peut écrire sur `club_members` (RLS `cm_admin_update`). */
  canManage: boolean;
  onChanged: () => void;
}

export function TeamStaffCard({ clubId, teamName, headCoachName, members, canManage, onChanged }: Props) {
  const [inviteOuvert, setInviteOuvert] = useState(false);
  const [rattachement, setRattachement] = useState<string>("");
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const encadrement = useMemo(
    () => etatEncadrement(members, teamName, headCoachName),
    [members, teamName, headCoachName],
  );
  const anomalies = useMemo(() => perimetresApproximatifs(members, teamName), [members, teamName]);

  // Les encadrants du club qui ne sont pas (encore) sur cette équipe : un coach en encadre
  // souvent plusieurs, et le réinviter par e-mail ne lui donnerait rien de plus — la fonction
  // d'invitation est idempotente et n'élargit pas un périmètre existant.
  const rattachables = useMemo(
    () =>
      members.filter(
        (m) =>
          m.status !== "disabled" &&
          (ROLES_INVITABLES as readonly string[]).includes(m.role) &&
          !m.teamScope.includes(teamName),
      ),
    [members, teamName],
  );

  function agir(action: Promise<unknown>) {
    setEnCours(true);
    setErreur(null);
    action
      .then(() => {
        setRattachement("");
        onChanged();
      })
      .catch((e) => setErreur(e instanceof Error ? e.message : "Action impossible."))
      .finally(() => setEnCours(false));
  }

  function inviter(input: {
    email: string;
    firstName: string;
    lastName: string;
    role: (typeof ROLES_INVITABLES)[number] | string;
    team?: string;
    mode?: "email" | "direct";
  }) {
    const supabase = createClient();
    return inviteClubMember(supabase, clubId, {
      ...input,
      role: input.role as OrgUser["role"],
      team: teamName,
    }).then(async (resultat) => {
      // Déjà membre du club : `clubplus-invite` s'arrête là sans toucher à `teams`. Sans ce
      // rattrapage, l'écran annoncerait une invitation partie et l'équipe resterait sans coach.
      if (resultat.alreadyMember && resultat.membershipId) {
        await addTeamToClubMember(supabase, resultat.membershipId, teamName);
      }
      onChanged();
      return resultat;
    });
  }

  return (
    <Card className="p-4.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[14px] font-extrabold tracking-tight">Encadrement</div>
        <Badge tone={tonEtat(encadrement)}>{libelleEtat(encadrement)}</Badge>
      </div>

      {encadrement.membres.length > 0 ? (
        <ul className="mt-3.5 flex flex-col gap-2">
          {encadrement.membres.map((m) => (
            <li
              key={m.membershipId}
              className="flex flex-wrap items-center gap-2 rounded-xl bg-surface-sunken px-3 py-2.5"
            >
              <span className="flex-1 text-[13.5px] font-bold">{nomAffiche(m)}</span>
              <span className="text-[12px] font-semibold text-text-soft">{ROLE_LABELS[m.role] ?? m.role}</span>
              <Badge tone={STATUT_MEMBRE[m.status].ton}>{STATUT_MEMBRE[m.status].libelle}</Badge>
              {canManage && (
                <button
                  disabled={enCours}
                  onClick={() =>
                    agir(removeTeamFromClubMember(createClient(), m.membershipId, teamName))
                  }
                  className="text-[12px] font-bold text-text-faint underline-offset-2 hover:text-danger-fg hover:underline disabled:opacity-50"
                >
                  Retirer de l&apos;équipe
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-[12.5px] leading-relaxed text-text-soft">
          {encadrement.nomDeclare ? (
            <>
              <span className="font-bold text-text">{encadrement.nomDeclare}</span> est inscrit comme
              entraîneur, mais aucun compte Club+ n&apos;est rattaché à cette équipe : il ne peut ni
              voir le calendrier, ni saisir un résultat.
            </>
          ) : (
            <>
              Personne n&apos;encadre cette équipe dans Club+. Tant qu&apos;aucun compte n&apos;y est
              rattaché, ses résultats et ses convocations restent à la charge du club.
            </>
          )}
        </p>
      )}

      {anomalies.length > 0 && (
        <div className="mt-3 flex flex-col gap-2 rounded-xl bg-warning-bg px-3 py-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-warning-fg" aria-hidden />
            <p className="text-[12.5px] leading-relaxed text-warning-fg">
              Périmètre écrit différemment du nom de l&apos;équipe : la base compare à la lettre près,
              ces personnes n&apos;ont donc aucun accès à « {teamName} ».
            </p>
          </div>
          {anomalies.map(({ membre, ecrit }) => (
            <div key={membre.membershipId} className="flex flex-wrap items-center gap-2 pl-6">
              <span className="text-[12.5px] font-bold text-warning-fg">{nomAffiche(membre)}</span>
              <code className="rounded bg-surface px-1.5 py-0.5 text-[11.5px]">{ecrit}</code>
              {canManage && (
                <Button
                  variant="secondary"
                  disabled={enCours}
                  onClick={() =>
                    agir(
                      removeTeamFromClubMember(createClient(), membre.membershipId, ecrit).then(() =>
                        addTeamToClubMember(createClient(), membre.membershipId, teamName),
                      ),
                    )
                  }
                >
                  <Wrench className="h-3.5 w-3.5" aria-hidden />
                  Corriger
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {canManage && (
        <div className="mt-3.5 flex flex-col gap-2.5 border-t border-divider pt-3.5">
          <Button variant="primary" disabled={enCours} onClick={() => setInviteOuvert(true)}>
            <UserPlus className="h-3.5 w-3.5" aria-hidden />
            {encadrement.membres.length > 0 ? "Inviter un autre encadrant" : "Inviter le coach"}
          </Button>

          {rattachables.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor="rattacher-membre">
                Rattacher un membre existant à {teamName}
              </label>
              <select
                id="rattacher-membre"
                value={rattachement}
                onChange={(e) => setRattachement(e.target.value)}
                className="h-10 min-w-0 flex-1 rounded-xl border border-border-strong bg-input-bg px-3 text-[13px] outline-none focus-visible:border-brand-blue"
              >
                <option value="">Rattacher un membre déjà inscrit…</option>
                {rattachables.map((m) => (
                  <option key={m.membershipId} value={m.membershipId}>
                    {nomAffiche(m)} — {ROLE_LABELS[m.role] ?? m.role}
                  </option>
                ))}
              </select>
              <Button
                variant="secondary"
                disabled={!rattachement || enCours}
                onClick={() => agir(addTeamToClubMember(createClient(), rattachement, teamName))}
              >
                <Link2 className="h-3.5 w-3.5" aria-hidden />
                Rattacher
              </Button>
            </div>
          )}

          <p className="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-text-faint">
            <Mail className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden />
            Le coach invité arrive directement dans {teamName} : son club, son équipe et son rôle
            sont déjà connus, rien ne lui est redemandé.
          </p>
        </div>
      )}

      {erreur && <p className="mt-3 text-[12.5px] font-bold text-danger-fg">{erreur}</p>}

      {inviteOuvert && (
        <InviteUserModal
          roles={[...ROLES_INVITABLES]}
          allowDirectMode
          lockedTeam={teamName}
          title={`Inviter un encadrant — ${teamName}`}
          onClose={() => setInviteOuvert(false)}
          onInvite={inviter}
        />
      )}
    </Card>
  );
}
