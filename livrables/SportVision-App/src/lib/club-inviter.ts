// INVITER UN JOUEUR OU UN PARENT (30/09/2026).
//
// == CE QUE LA BASE AUTORISE, ET CE QUE J'AVAIS MAL LU ======================================
//
// Fouka : « il faut qu'un coach puisse inviter uniquement ses joueurs et ses parents, mais
// uniquement pour sa catégorie ».
//
// C'EST DÉJÀ LE CAS, ET J'AI DIT LE CONTRAIRE. J'avais mesuré `peut_operer_club` — faux pour un
// coach — et lu l'en-tête de l'edge function, qui annonce « une seule autorité, celle de la base :
// peut_operer_club ». J'en ai conclu qu'un coach ne pouvait pas inviter, je l'ai écrit dans le
// code, dans un commit et à Fouka. En lisant le bloc d'autorisation EN ENTIER, il y a un repli
// explicite juste en dessous : si `peut_operer_club` est faux, la fonction exige un `team_id` et
// vérifie `is_team_educateur(team_id)`. Un coach peut donc inviter, pour ses équipes seulement —
// exactement ce que Fouka demande.
//
// La leçon est la même que d'habitude, et elle se répète : un en-tête décrit une intention, le
// corps décrit le comportement. J'ai cru l'en-tête.
//
// LE DROIT SE DEMANDE DONC PAR ÉQUIPE, PAS PAR CLUB :
//   `peut_operer_club(club)`  — direction, président, délégation d'agence, super-accès CM ;
//   OU `is_team_educateur(equipe)` — coach, responsable d'équipe, directeur sportif, et seulement
//   pour une équipe présente dans son `club_members.teams`.
//
// POUR UN PARENT AUSSI, ON ENVOIE L'ÉQUIPE. Sans `team_id`, un coach reçoit « Vous ne pouvez
// inviter que pour vos propres équipes : précisez laquelle ». Vérifié dans la fonction : sur le
// chemin « parent », `teamId` ne sert QU'À l'autorisation — l'invitation est créée avec le
// `player_id`, et l'e-mail part avec `teamId: null` écrit en dur. L'envoyer n'a donc aucun autre
// effet, et c'est ce qui permet au coach d'inviter le parent d'un enfant de son équipe.
//
// ON N'APPELLE QUE L'EDGE FUNCTION, jamais les tables. Elle crée le compte (ou réutilise
// l'existant) et la ligne `player_invitations` / `parent_invitations` ; c'est l'invité qui crée sa
// fiche en acceptant. Refaire cette chaîne ici, ce serait en entretenir deux.
import { supabase } from "./supabase";
import { ErreurChargement, refermerSiPerdue } from "./donnees";

export type CibleInvitation = "joueur" | "parent";

/**
 * Le droit d'inviter DANS CETTE ÉQUIPE, demandé à la base. En cas de doute, on dit non.
 *
 * Les deux questions sont posées dans l'ordre de la fonction : d'abord le club, puis l'équipe.
 * Recopier la règle ici, ce serait la voir diverger au premier changement.
 */
export async function peutOpererClub(clubId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("peut_operer_club", { p_club_id: clubId });
  return !error && data === true;
}

export async function peutInviterDansEquipe(clubId: string, equipeId: string): Promise<boolean> {
  const club = await supabase.rpc("peut_operer_club", { p_club_id: clubId });
  if (!club.error && club.data === true) return true;
  const equipe = await supabase.rpc("is_team_educateur", { p_team_id: equipeId });
  if (equipe.error) return false;
  return equipe.data === true;
}

export interface JoueurDeLEquipe {
  id: string;
  nom: string;
}

/**
 * L'effectif d'une équipe, pour désigner l'enfant d'un parent.
 *
 * Une invitation « parent » sans `player_id` crée bien le compte, mais AUCUN lien parent/enfant :
 * c'est le défaut corrigé côté site le 12/09/2026, où Club+ ne l'envoyait jamais. On rend donc la
 * liste, et l'écran oblige à choisir.
 */
export async function lireEffectif(teamId: string): Promise<JoueurDeLEquipe[]> {
  const { data, error } = await supabase
    .from("team_memberships")
    .select("player_id, player_profiles(id, prenom, nom)")
    .eq("team_id", teamId)
    .eq("statut", "active");

  if (error) {
    await refermerSiPerdue(error);
    throw new ErreurChargement(error);
  }

  type Ligne = { player_id: string; player_profiles: { id: string; prenom: string | null; nom: string | null } | null };
  return ((data ?? []) as unknown as Ligne[])
    .filter((r) => r.player_profiles)
    .map((r) => ({
      id: String(r.player_profiles!.id),
      nom: `${r.player_profiles!.prenom ?? ""} ${r.player_profiles!.nom ?? ""}`.trim() || "Joueur",
    }))
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
}

export interface DemandeInvitation {
  cible: CibleInvitation;
  email: string;
  prenom: string;
  nom: string;
  clubId: string;
  /** Joueur : l'équipe qu'il rejoint. */
  equipeId?: string | null;
  /** Joueur : sa date de naissance, au format AAAA-MM-JJ. */
  dateNaissance?: string | null;
  /** Parent : l'enfant qu'il suivra. Sans lui, aucun lien parent/enfant n'est créé. */
  joueurId?: string | null;
}

/** Vrai si la personne était déjà invitée : ce n'est pas une erreur, c'est une information. */
export async function inviter(d: DemandeInvitation): Promise<{ dejaInvitee: boolean }> {
  const { data, error } = await supabase.functions.invoke("clubplus-family-invite", {
    body: {
      target_type: d.cible,
      email: d.email.trim(),
      prenom: d.prenom.trim(),
      nom: d.nom.trim(),
      club_id: d.clubId,
      // L'équipe part DANS LES DEUX CAS : sur le chemin « parent » elle ne sert qu'à
      // l'autorisation d'un éducateur, et n'est écrite nulle part.
      team_id: d.equipeId ?? null,
      date_naissance: d.cible === "joueur" ? d.dateNaissance || null : null,
      player_id: d.cible === "parent" ? d.joueurId ?? null : null,
    },
  });

  // L'edge function répond en deux temps : une erreur de transport, ou un corps qui porte
  // `error`. Les deux doivent remonter, sinon l'écran annonce un envoi qui n'a pas eu lieu.
  if (error) throw new Error(messageLisible(error.message ?? ""));
  const corps = data as { error?: string; already_invited?: boolean } | null;
  if (corps?.error) throw new Error(corps.error);
  return { dejaInvitee: corps?.already_invited === true };
}

function messageLisible(brut: string): string {
  if (/network|fetch|failed/i.test(brut)) return "Pas de connexion. Réessayez une fois le réseau revenu.";
  if (/429|rate/i.test(brut)) return "Trop d'invitations d'affilée. Réessayez dans quelques minutes.";
  return "L'invitation n'est pas partie. Réessayez dans un instant.";
}
