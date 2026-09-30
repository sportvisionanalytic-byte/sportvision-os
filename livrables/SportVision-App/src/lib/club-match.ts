// LE RÉSULTAT D'UN MATCH, SAISI DEPUIS LE TÉLÉPHONE (30/09/2026).
//
// POURQUOI CET ÉCRAN EST LE PREMIER À PASSER EN NATIF. Fouka l'a choisi lui-même : c'est le seul
// écran de Club+ qu'on utilise DEBOUT, au bord d'un terrain, souvent en 4G. Une page web dans un
// cadre, à ce moment-là, c'est une saisie qu'on remet à plus tard — et un score qui n'arrive
// jamais.
//
// == DEUX COLONNES DE STATUT, ET C'EST LA BASE QUI LES ACCORDE ===============================
//
// `club_matches` en porte deux : `status` (a_venir / a_transmettre / recu / reportee / annulee) et
// `sport_status` (scheduled / postponed / cancelled / completed / unknown). L'application mobile
// lit `sport_status` pour annoncer « reporté » ou « annulé » aux familles ; Club+ écrit `status`.
//
// J'AI D'ABORD CRU À UN DÉFAUT, ET C'EN AURAIT ÉTÉ UN. `saveClubMatchResult` du site n'écrit que
// `status` : j'en ai conclu qu'un match reporté depuis Club+ laissait `sport_status` à
// « scheduled », donc que l'application continuait d'annoncer le match comme prévu, et qu'une
// famille se déplacerait pour rien. J'allais écrire les deux colonnes « pour réparer », et le dire
// à Fouka comme un bug.
//
// C'était faux, et c'est en lisant les déclencheurs de la table que ça s'est vu :
// `trg_club_matches_sport_status` accorde les deux colonnes DANS LES DEUX SENS depuis le
// 12/09/2026 — « ce que la saisie du Match Center écrit doit atteindre le calendrier et les
// familles », dit son propre commentaire. Écrire `status = 'reportee'` pose
// `sport_status = 'postponed'` tout seul.
//
// ON N'ÉCRIT DONC QU'UNE COLONNE, la même que le site. Deux écritures pour une règle, c'est deux
// endroits à corriger le jour où elle change, et la base la porte déjà mieux que nous.
//
// LES TROIS AUTRES DÉCLENCHEURS DE LA TABLE ONT ÉTÉ LUS AVANT D'ÉCRIRE, et aucun ne se déclenche
// sur un score : `protect_sensitive_club_match_fields` ne refuse qu'un changement de club,
// `signaler_evenement_modifie` ne prévient que sur une date, un horaire, un lieu ou un adversaire
// — et seulement si une couverture est prévue —, `match_retouche_humaine` ne verrouille que ces
// mêmes champs. Saisir un résultat n'envoie donc aucune notification à personne.
import { supabase } from "./supabase";
import { ErreurChargement, refermerSiPerdue } from "./donnees";

export type StatutMatch = "joue" | "reporte" | "annule";

/** La colonne qu'on écrit. `sport_status` suit tout seul, par le déclencheur de la table. */
const STATUTS: Record<StatutMatch, string> = {
  joue: "recu",
  reporte: "reportee",
  annule: "annulee",
};

export interface MatchClub {
  id: string;
  clubId: string;
  equipe: string | null;
  equipeId: string | null;
  adversaire: string | null;
  date: string | null;
  heure: string | null;
  lieu: string | null;
  domicile: boolean;
  competition: string | null;
  /** « pour-contre », du point de vue du club. Jamais inventé. */
  score: string | null;
  statut: StatutMatch | null;
  /** Les buteurs, tels que le club les a saisis : une liste de noms séparés par des virgules. */
  buteurs: string | null;
}

/** L'identifiant réel derrière l'identifiant d'affichage « match-<uuid> ». */
export function uuidDuMatch(id: string): string {
  return id.startsWith("match-") ? id.slice("match-".length) : id;
}

export async function lireMatchClub(id: string): Promise<MatchClub | null> {
  const { data, error } = await supabase
    .from("club_matches")
    .select("id, club_id, team, team_id, opponent, match_date, kickoff_time, lieu, is_home, competition, score, scorers, status, sport_status")
    .eq("id", uuidDuMatch(id))
    .maybeSingle();

  if (error) {
    await refermerSiPerdue(error);
    throw new ErreurChargement(error);
  }
  if (!data) return null;

  return {
    id: String(data.id),
    clubId: String(data.club_id),
    equipe: data.team ?? null,
    equipeId: data.team_id ? String(data.team_id) : null,
    adversaire: data.opponent ?? null,
    date: data.match_date ?? null,
    heure: data.kickoff_time ?? null,
    lieu: data.lieu ?? null,
    domicile: data.is_home !== false,
    competition: data.competition ?? null,
    score: data.score ?? null,
    buteurs: data.scorers ?? null,
    statut: data.sport_status === "postponed" ? "reporte"
      : data.sport_status === "cancelled" ? "annule"
      : data.status === "recu" || data.sport_status === "completed" ? "joue"
      : null,
  };
}

/**
 * Cette personne a-t-elle le droit d'écrire le résultat de CE match ?
 *
 * ON DEMANDE À LA BASE, ON NE REDEVINE PAS. La policy `cma_member_update` dit :
 * `is_club_member(club_id) AND (team_id IS NULL OR is_team_educateur(team_id))`, et
 * `club_matches_sans_exploitation_upd` ferme en plus les rôles sans exploitation (lecture seule,
 * responsable sponsors). Les deux fonctions sont exécutables par un compte connecté : on les
 * appelle, plutôt que de recopier la règle ici et de la voir diverger au premier changement.
 *
 * C'est la leçon du 10/09, « vérifier par le chemin réel » : un bouton qui mène à un refus de la
 * base est une promesse cassée, et une règle recopiée est une promesse qui se cassera plus tard.
 *
 * EN CAS DE DOUTE, ON DIT NON. Une fonction qui ne répond pas rend un écran en lecture, jamais un
 * formulaire qui échouera à l'enregistrement.
 */
export async function peutSaisirResultat(m: MatchClub): Promise<boolean> {
  const sansExploitation = await supabase.rpc("club_role_sans_exploitation", { p_club_id: m.clubId });
  if (sansExploitation.error || sansExploitation.data === true) return false;
  // Un match sans équipe rattachée n'est borné par aucun périmètre : tout membre actif peut le
  // saisir, c'est ce que dit la policy. Six matchs sur 699 sont dans ce cas.
  if (!m.equipeId) return true;
  const educateur = await supabase.rpc("is_team_educateur", { p_team_id: m.equipeId });
  if (educateur.error) return false;
  return educateur.data === true;
}

/**
 * Enregistrer le résultat.
 *
 * `.select("id")` N'EST PAS DÉCORATIF. Sans lui, une écriture refusée par la RLS rend zéro ligne
 * ET zéro erreur : l'écran annoncerait « enregistré » alors que rien n'a changé. C'est la règle
 * posée le 10/09 après le « ça n'enregistre pas » de Villemomble — aucune action n'affiche un
 * succès si la ligne n'a pas bougé.
 */
export async function enregistrerResultat(
  m: MatchClub,
  statut: StatutMatch,
  score: { pour: number; contre: number } | null,
): Promise<void> {
  const maj: Record<string, unknown> = { status: STATUTS[statut] };
  // Un match reporté ou annulé n'a pas de score : en garder un d'une saisie précédente ferait
  // afficher « Match · reporté » à côté d'un « 3-1 ».
  maj.score = statut === "joue" && score ? `${score.pour}-${score.contre}` : null;

  const { data, error } = await supabase
    .from("club_matches")
    .update(maj)
    .eq("id", m.id)
    .select("id");

  if (error) {
    await refermerSiPerdue(error);
    throw new ErreurChargement(error);
  }
  if (!data || !data.length) {
    throw new Error("Enregistrement refusé : ce match n'est pas dans votre périmètre.");
  }
}
