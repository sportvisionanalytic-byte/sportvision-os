// INVITER UN JOUEUR OU UN PARENT (30/09/2026).
//
// == CE QUE LA BASE AUTORISE, ET QUI N'EST PAS CE QUE L'ON CROIT =============================
//
// Fouka : « que le coach puisse inviter ses joueurs, parents ». Mesuré avant d'écrire une ligne
// d'interface, avec le jeton d'un vrai coach : `peut_operer_club` rend FALSE pour lui. Or c'est
// exactement ce que l'edge function `clubplus-family-invite` exige — « une seule autorité, celle
// de la base », dit son propre commentaire. Un coach ne peut donc PAS inviter aujourd'hui, et
// aucun écran ne peut lui donner ce droit : il se décide en base, pas ici.
//
// Club+ lui montre pourtant un bouton « Ajouter un joueur » actif (`canCreate` n'exclut que
// `viewer` et `sponsor_manager`). C'est une promesse cassée, signalée à Fouka.
//
// CET ÉCRAN NE MENT PAS. On demande le droit à la base AVANT de proposer quoi que ce soit, et la
// carte d'équipe change de sous-titre en conséquence. Le jour où la décision est prise d'ouvrir
// l'invitation aux coachs, elle se prendra par une migration, et cet écran s'ouvrira tout seul.
//
// ON N'APPELLE QUE L'EDGE FUNCTION, jamais les tables. Elle crée le compte (ou réutilise
// l'existant) et la ligne `player_invitations` / `parent_invitations` ; c'est l'invité qui crée sa
// fiche en acceptant. Refaire cette chaîne ici, ce serait en entretenir deux.
import { supabase } from "./supabase";
import { ErreurChargement, refermerSiPerdue } from "./donnees";

export type CibleInvitation = "joueur" | "parent";

/** Le droit d'inviter, demandé à la base. En cas de doute, on dit non. */
export async function peutInviter(clubId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("peut_operer_club", { p_club_id: clubId });
  if (error) return false;
  return data === true;
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
      team_id: d.cible === "joueur" ? d.equipeId ?? null : null,
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
