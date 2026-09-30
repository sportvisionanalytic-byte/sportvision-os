// LES DEMANDES D'AFFILIATION, VUES PAR CELUI QUI LES TRAITE (30/09/2026).
//
// Fouka : « il faut qu'un coach puisse accepter un parent, accepter que c'est bien lui, ou
// accepter qu'il fait bien partie de son équipe ». C'est déjà son droit en base, et depuis
// longtemps — ce qui manquait, c'est de pouvoir le faire depuis le téléphone.
//
// == LE PÉRIMÈTRE EST TENU PAR LA RLS, ET C'EST LA BONNE PLACE ================================
//
// `mr_educateur_select` : `team_id IS NOT NULL AND is_team_educateur(team_id)`. Un coach ne reçoit
// QUE les demandes de ses équipes ; un administrateur reçoit celles de tout le club
// (`mr_admin_select`). Aucun filtre côté téléphone n'est donc nécessaire pour la lecture, et c'est
// préférable : sur les galeries et les équipes, c'est l'écran qui borne faute de mieux, ici c'est
// la base, et elle ne se contourne pas.
//
// == QUI VALIDE QUOI, SELON LE MODE DU CLUB ==================================================
//
// Lu dans `validate_team_membership`, pas deviné :
//   · `standard`  : un éducateur de l'équipe OU un dirigeant valide. Les deux clubs réels sont
//                   dans ce mode.
//   · `double`    : l'éducateur CONFIRME (étape 1), puis seul un dirigeant valide (étape 2).
//   · `controle`  : seul un dirigeant valide, l'éducateur ne fait rien.
//
// On ne recopie pas cette règle dans l'écran : on propose l'action, et la base tranche. Le seul
// endroit où l'écran décide, c'est pour ne pas proposer une action manifestement hors sujet.
import { supabase } from "./supabase";
import { ErreurChargement, refermerSiPerdue } from "./donnees";

export type StatutAffiliation =
  | "a_verifier" | "autorisation_manquante" | "en_attente_parent" | "pret_a_valider"
  | "validee" | "refusee" | "doublon_signale" | "transferee_admin";

export type ModeValidation = "standard" | "controle" | "double";

export interface DemandeAffiliation {
  id: string;
  equipe: string | null;
  equipeId: string | null;
  joueur: string;
  source: string;
  statut: StatutAffiliation;
  mode: ModeValidation | null;
  /** L'éducateur a déjà confirmé : en mode double, il ne reste plus que le dirigeant. */
  confirmeeParEducateur: boolean;
  motifRefus: string | null;
  creeLe: string;
}

const CHAMPS =
  "id, team_id, player_id, source, statut, validation_mode, educateur_confirme_at, admin_valide_at, refus_motif, created_at, club_teams(name), player_profiles(prenom, nom)";

export async function lireAffiliations(clubId: string): Promise<DemandeAffiliation[]> {
  const { data, error } = await supabase
    .from("membership_requests")
    .select(CHAMPS)
    .eq("club_id", clubId)
    .order("created_at", { ascending: false });

  if (error) {
    await refermerSiPerdue(error);
    throw new ErreurChargement(error);
  }

  type Ligne = {
    id: string; team_id: string | null; source: string | null; statut: StatutAffiliation;
    validation_mode: ModeValidation | null; educateur_confirme_at: string | null;
    refus_motif: string | null; created_at: string;
    club_teams: { name: string } | null;
    player_profiles: { prenom: string | null; nom: string | null } | null;
  };

  return ((data ?? []) as unknown as Ligne[]).map((r) => ({
    id: String(r.id),
    equipe: r.club_teams?.name ?? null,
    equipeId: r.team_id,
    joueur: `${r.player_profiles?.prenom ?? ""} ${r.player_profiles?.nom ?? ""}`.trim() || "Joueur",
    source: r.source ?? "",
    statut: r.statut,
    mode: r.validation_mode,
    confirmeeParEducateur: !!r.educateur_confirme_at,
    motifRefus: r.refus_motif ?? null,
    creeLe: r.created_at,
  }));
}

/** Traitée : elle ne demande plus rien à personne. */
export function estClose(d: DemandeAffiliation): boolean {
  return d.statut === "validee" || d.statut === "refusee";
}

/**
 * Accepter : confirmer (mode double, étape éducateur) ou valider (les autres cas).
 *
 * `p_par_code` reste FAUX. Ce drapeau sert à l'auto-validation d'une arrivée par code d'équipe,
 * décidée côté serveur au moment où le code est consommé ; le poser à la main depuis un téléphone
 * reviendrait à dire à la base « fais comme si un code valide avait été présenté », ce qui n'est
 * pas à nous de déclarer.
 */
export async function accepter(d: DemandeAffiliation): Promise<void> {
  const doubleEtapeEducateur = d.mode === "double" && !d.confirmeeParEducateur;
  const { error } = doubleEtapeEducateur
    ? await supabase.rpc("confirm_request_educateur", { p_request_id: d.id })
    : await supabase.rpc("validate_team_membership", { p_request_id: d.id, p_par_code: false });
  if (error) throw new Error(lisible(error.message));
}

export async function refuser(d: DemandeAffiliation, motif: string): Promise<void> {
  const { error } = await supabase.rpc("reject_team_membership", {
    p_request_id: d.id,
    p_motif: motif.trim() || null,
  });
  if (error) throw new Error(lisible(error.message));
}

/**
 * Les messages de la base sont déjà en français et déjà justes — « Seul un administrateur peut
 * valider sur ce club », « Cette demande a déjà été traitée ». On les montre tels quels : les
 * réécrire, ce serait entretenir une seconde version de la règle, en moins exacte.
 */
function lisible(brut: string): string {
  if (/network|fetch|failed to/i.test(brut)) return "Pas de connexion. Réessayez une fois le réseau revenu.";
  return brut || "L'opération n'a pas abouti.";
}
