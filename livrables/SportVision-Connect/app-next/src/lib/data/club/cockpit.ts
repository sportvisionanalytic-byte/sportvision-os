import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompteursAFaire, ProblemeSante, StatutLancement } from "@/lib/cockpit/actions";
import { envoyerInvitationParEmail } from "@/lib/data/club/invitations";

// Le cockpit du CM (migration v117). Chaque fonction lit UNE fonction de la base, qui vérifie
// elle-même le périmètre (`peut_operer_club`) : l'écran n'a aucune règle d'accès à tenir.

export interface MatchDuJour {
  id: string;
  equipe: string | null;
  adversaire: string | null;
  heure: string | null;
  domicile: boolean | null;
  lieu: string | null;
  competition: string | null;
  couverture: boolean;
  type_couverture: string | null;
}

export interface EntrainementDuJour {
  equipe: string | null;
  debut: string | null;
  fin: string | null;
  lieu: string | null;
  annule: boolean;
  couverture: boolean;
}

export interface AutreDuJour {
  genre: string;
  titre: string | null;
  equipe: string | null;
  heure: string | null;
  lieu: string | null;
  couverture: boolean;
}

export interface PublicationDuJour {
  id: string;
  titre: string | null;
  statut: string | null;
  plateforme: string | null;
  heure: string | null;
}

export interface TableauDeBordCm {
  aujourdhui: {
    matchs: MatchDuJour[];
    entrainements: EntrainementDuJour[];
    autres?: AutreDuJour[];
    publications?: PublicationDuJour[];
  };
  a_faire: CompteursAFaire;
  semaine: {
    du: string;
    au: string;
    matchs: number;
    entrainements: number;
    presences: number;
    contenus_a_publier: number;
    demandes?: number;
  };
  mois?: { presences_prevues: number; presences_realisees: number; contenus_produits: number };
  adoption: { clubplus_total: number; clubplus_actifs: number; connect_total: number; connect_actifs: number };
}

export interface SanteClub {
  score: number;
  problemes: ProblemeSante[];
  equipes: number;
  joueurs: number;
  image: { valides: number; en_attente: number; refus: number };
}

export interface LigneJournal {
  quand: string;
  qui: string | null;
  texte: string;
  genre: string;
  lien: string | null;
}

export type EtatSection = "termine" | "incomplet" | "attention";

export interface SectionOnboarding {
  cle: string;
  libelle: string;
  obligatoire: boolean;
  etat: EtatSection;
  detail: string | null;
  derniere_at: string | null;
  derniere_par: string | null;
}

export interface StatutLancementClub extends StatutLancement {
  lance_at: string | null;
  lance_par: string | null;
}

export async function fetchTableauDeBordCm(supabase: SupabaseClient, clubId: string): Promise<TableauDeBordCm | null> {
  const { data, error } = await supabase.rpc("cm_tableau_de_bord", { p_club_id: clubId });
  if (error) throw error;
  return (data as TableauDeBordCm | null) ?? null;
}

export async function fetchSanteClub(supabase: SupabaseClient, clubId: string): Promise<SanteClub | null> {
  const { data, error } = await supabase.rpc("club_sante", { p_club_id: clubId });
  if (error) throw error;
  return (data as SanteClub | null) ?? null;
}

export async function fetchJournalClub(supabase: SupabaseClient, clubId: string, limite = 12): Promise<LigneJournal[]> {
  const { data, error } = await supabase.rpc("club_journal", { p_club_id: clubId, p_limite: limite });
  if (error) throw error;
  return (data as LigneJournal[] | null) ?? [];
}

export async function fetchSectionsOnboarding(supabase: SupabaseClient, clubId: string): Promise<SectionOnboarding[]> {
  const { data, error } = await supabase.rpc("club_onboarding_sections", { p_club_id: clubId });
  if (error) throw error;
  return (data as SectionOnboarding[] | null) ?? [];
}

export async function fetchStatutLancement(supabase: SupabaseClient, clubId: string): Promise<StatutLancementClub | null> {
  const { data, error } = await supabase.rpc("club_statut_lancement", { p_club_id: clubId });
  if (error) throw error;
  return (data as StatutLancementClub | null) ?? null;
}

export interface ResultatLancement {
  envoyees: string[];
  echecs: { email: string; message: string }[];
}

/** Lance le club, puis envoie une à une les invitations préparées, par la MÊME chaîne d'envoi
 *  que le bouton « Envoyer » (clubplus-envoyer-invitation) — il n'en existe pas une seconde.
 *  Séquentiel : un échec isolé n'empêche pas les autres, et le rapport dit lequel a échoué. */
export async function lancerLeClub(supabase: SupabaseClient, clubId: string): Promise<ResultatLancement> {
  const { data, error } = await supabase.rpc("lancer_club", { p_club_id: clubId });
  if (error) throw error;
  const invitations = ((data as { invitations?: { id: string; email: string }[] } | null)?.invitations ?? []);
  const resultat: ResultatLancement = { envoyees: [], echecs: [] };
  for (const inv of invitations) {
    try {
      await envoyerInvitationParEmail(supabase, inv.id);
      resultat.envoyees.push(inv.email);
    } catch (e) {
      resultat.echecs.push({ email: inv.email, message: e instanceof Error ? e.message : "Envoi impossible" });
    }
  }
  return resultat;
}

/** Les invitations qui partiront au lancement : le CM les voit AVANT de confirmer. */
export async function fetchInvitationsPreparees(
  supabase: SupabaseClient,
  clubId: string,
): Promise<{ id: string; email: string; prenom: string | null; nom: string | null; role: string; teams: string[] }[]> {
  const { data, error } = await supabase
    .from("club_invitations")
    .select("id, email, prenom, nom, role, teams")
    .eq("club_id", clubId)
    .eq("statut", "preparee")
    .gt("expire_at", new Date().toISOString())
    .order("role");
  if (error) throw error;
  return ((data ?? []) as { id: string; email: string; prenom: string | null; nom: string | null; role: string; teams: string[] | null }[])
    .map((r) => ({ ...r, teams: r.teams ?? [] }));
}

// ── Le contact du président ────────────────────────────────────────────────────────────────
// Le CM ne peut pas inviter le président (v116 : seuls l'Owner et SportVision nomment un
// président). Il peut en revanche noter ses coordonnées, dans l'organigramme du club — c'est ce
// qui fait passer « Informations du président » au vert, et ce que SportVision utilisera pour
// préparer son invitation.

export interface ContactPresident {
  id: string;
  prenom: string | null;
  nom: string | null;
  email: string | null;
  telephone: string | null;
}

export async function fetchContactPresident(
  supabase: SupabaseClient,
  portailClientId: string,
): Promise<ContactPresident | null> {
  const { data, error } = await supabase
    .from("client_organigramme")
    .select("id, prenom, nom, email, telephone, role")
    .eq("client_id", portailClientId)
    .ilike("role", "%sident%")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  const ligne = (data ?? [])[0] as (ContactPresident & { role: string }) | undefined;
  return ligne ? { id: ligne.id, prenom: ligne.prenom, nom: ligne.nom, email: ligne.email, telephone: ligne.telephone } : null;
}

export async function enregistrerContactPresident(
  supabase: SupabaseClient,
  portailClientId: string,
  existant: string | null,
  contact: Omit<ContactPresident, "id">,
): Promise<void> {
  const valeurs = {
    prenom: contact.prenom?.trim() || null,
    nom: contact.nom?.trim() || null,
    email: contact.email?.trim().toLowerCase() || null,
    telephone: contact.telephone?.trim() || null,
  };
  // `.select()` : un enregistrement que la RLS filtre revient sans erreur — sans lui, l'écran
  // dirait « enregistré » alors que rien ne l'est.
  const requete = existant
    ? supabase.from("client_organigramme").update(valeurs).eq("id", existant).select("id")
    : supabase.from("client_organigramme").insert({ client_id: portailClientId, role: "Président", ...valeurs }).select("id");
  const { data, error } = await requete;
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Enregistrement refusé : droits insuffisants sur ce club.");
}

// ── L'état de chaque équipe (club_equipes_etat) ─────────────────────────────────────────────

export type StatutEncadrant = "actif" | "invite" | "prepare" | "renseigne" | "aucun";

export interface EtatEquipe {
  team_id: string;
  nom: string;
  categorie: string | null;
  joueurs: number;
  encadrant: string | null;
  encadrant_statut: StatutEncadrant;
  creneaux: number;
  matchs_a_venir: number;
  prochain_match_date: string | null;
  prochain_match_adversaire: string | null;
  evenements: number;
  image_valides: number;
  image_en_attente: number;
  image_refus: number;
}

export async function fetchEquipesEtat(supabase: SupabaseClient, clubId: string): Promise<EtatEquipe[]> {
  const { data, error } = await supabase.rpc("club_equipes_etat", { p_club_id: clubId });
  if (error) throw error;
  return (data as EtatEquipe[] | null) ?? [];
}

export const ENCADRANT_LIBELLE: Record<StatutEncadrant, string> = {
  actif: "Coach connecté",
  invite: "Coach invité",
  prepare: "Invitation préparée",
  renseigne: "Coach renseigné",
  aucun: "Sans coach",
};
