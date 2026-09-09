// Qui encadre une équipe, et où en est son accès à Club+.
//
// ── Pourquoi un module à part ──
// Deux vérités cohabitent aujourd'hui sur « le coach d'une équipe », et elles ne se parlent pas :
//
//   `club_teams.coach`   un texte libre, saisi à l'import ou à la main. Un NOM, pas un accès.
//                        Sur SF Villemomble : 0 des 43 équipes le renseigne.
//   `club_members.teams` un tableau de noms d'équipes porté par un vrai compte. C'est LUI que la
//                        RLS lit (`is_team_educateur`) pour décider ce que la personne voit.
//
// Un club qui a écrit « Karim B. » dans la première colonne croit avoir désigné son coach ; en
// base, personne n'a le moindre droit sur l'équipe. Ce module croise les deux et nomme l'état
// réel, pour que l'écran dise « renseigné mais sans compte » au lieu d'afficher un nom rassurant.
//
// ── La règle de comparaison ──
// Exacte, sensible à la casse et aux espaces, parce que c'est celle de la base :
// `cm.teams @> to_jsonb(ct.name::text)`. Une comparaison tolérante ici afficherait un coach
// « en place » à qui la RLS refuse pourtant l'équipe — le pire des deux mondes. Les quasi-
// correspondances ne sont pas ignorées pour autant : `perimetresApproximatifs` les remonte
// séparément, comme une anomalie à réparer.

import type { MembershipRole } from "@/lib/types";
import type { OrgUser } from "@/lib/types/settings";
import type { BadgeTone } from "@/components/ui/Badge";

/** Les rôles qui encadrent une équipe sur le terrain. `sports_director` en fait partie : il porte
 * un périmètre d'équipes chez plusieurs clubs, et `is_team_educateur` le reconnaît déjà en base. */
const ROLES_ENCADRANTS = new Set<MembershipRole>(["coach", "team_manager", "sports_director"]);

/** Au-delà, une invitation restée sans réponse n'est plus « en cours », c'est un oubli. Le lien
 * Supabase, lui, expire bien plus tôt — on ne prétend donc pas dire s'il est encore valide, on
 * dit seulement que personne n'a donné suite. */
const JOURS_AVANT_RELANCE = 7;

export type EtatEncadrement =
  | "absent" // ni nom, ni compte
  | "a_inviter" // un nom dans club_teams.coach, aucun compte rattaché
  | "invitation_envoyee"
  | "invitation_sans_reponse"
  | "actif";

export interface Encadrement {
  etat: EtatEncadrement;
  /** Les membres dont le périmètre contient exactement cette équipe. */
  membres: OrgUser[];
  /** Le nom écrit dans club_teams.coach, s'il en existe un d'exploitable. */
  nomDeclare: string | null;
  /** Depuis combien de jours la plus ancienne invitation en attente traîne. */
  joursDAttente: number | null;
}

/** `fetchClubTeams` remplace un coach vide par « — » : sans ce filtre, une équipe sans coach
 * passerait pour renseignée. */
export function nomDeclare(headCoachName: string | null | undefined): string | null {
  const nom = (headCoachName ?? "").trim();
  if (!nom || nom === "—" || nom === "-") return null;
  return nom;
}

export function encadrantsDeLEquipe(membres: OrgUser[], nomEquipe: string): OrgUser[] {
  return membres.filter(
    (m) =>
      m.status !== "disabled" &&
      ROLES_ENCADRANTS.has(m.role) &&
      m.teamScope.includes(nomEquipe),
  );
}

function joursEcoules(depuis: string, maintenant: Date): number {
  const t = Date.parse(depuis);
  if (Number.isNaN(t)) return 0;
  return Math.floor((maintenant.getTime() - t) / 86_400_000);
}

export function etatEncadrement(
  membres: OrgUser[],
  nomEquipe: string,
  headCoachName: string | null | undefined,
  maintenant: Date = new Date(),
): Encadrement {
  const rattaches = encadrantsDeLEquipe(membres, nomEquipe);
  const declare = nomDeclare(headCoachName);

  // Un seul membre actif suffit à considérer l'équipe encadrée : les invitations en attente des
  // autres sont un détail de gestion, pas l'état de l'équipe.
  if (rattaches.some((m) => m.status === "active")) {
    return { etat: "actif", membres: rattaches, nomDeclare: declare, joursDAttente: null };
  }

  const attentes = rattaches
    .filter((m) => m.status === "invited")
    .map((m) => (m.invitedAt ? joursEcoules(m.invitedAt, maintenant) : 0));

  if (attentes.length > 0) {
    const jours = Math.max(...attentes);
    return {
      etat: jours >= JOURS_AVANT_RELANCE ? "invitation_sans_reponse" : "invitation_envoyee",
      membres: rattaches,
      nomDeclare: declare,
      joursDAttente: jours,
    };
  }

  return {
    etat: declare ? "a_inviter" : "absent",
    membres: rattaches,
    nomDeclare: declare,
    joursDAttente: null,
  };
}

export function libelleEtat(e: Encadrement): string {
  switch (e.etat) {
    case "actif":
      return "Coach actif";
    case "invitation_envoyee":
      return "Invitation envoyée";
    case "invitation_sans_reponse":
      return `Sans réponse depuis ${e.joursDAttente} jours`;
    case "a_inviter":
      return "À inviter";
    default:
      return "Coach non renseigné";
  }
}

export function tonEtat(e: Encadrement): BadgeTone {
  switch (e.etat) {
    case "actif":
      return "success";
    case "invitation_envoyee":
      return "info";
    case "invitation_sans_reponse":
      return "warning";
    case "a_inviter":
      return "warning";
    default:
      return "neutral";
  }
}

function normaliser(nom: string): string {
  return nom
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Les membres qui CROIENT encadrer cette équipe sans que la base le reconnaisse : « u15 d1 »,
 * « U15  D1 », « U15 D1 » avec une espace insécable. Le club a fait le geste, la RLS ne le voit
 * pas. On les remonte pour pouvoir proposer la correction, jamais pour les traiter comme
 * rattachés. */
export function perimetresApproximatifs(
  membres: OrgUser[],
  nomEquipe: string,
): { membre: OrgUser; ecrit: string }[] {
  const cible = normaliser(nomEquipe);
  const resultat: { membre: OrgUser; ecrit: string }[] = [];
  for (const m of membres) {
    if (m.status === "disabled" || !ROLES_ENCADRANTS.has(m.role)) continue;
    if (m.teamScope.includes(nomEquipe)) continue;
    const ecrit = m.teamScope.find((t) => normaliser(t) === cible);
    if (ecrit) resultat.push({ membre: m, ecrit });
  }
  return resultat;
}

export function nomAffiche(m: OrgUser): string {
  const nom = `${m.firstName} ${m.lastName}`.trim();
  return nom || "Membre sans nom";
}
