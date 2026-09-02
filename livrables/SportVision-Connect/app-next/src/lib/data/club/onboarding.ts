import type { SupabaseClient } from "@supabase/supabase-js";

// Onboarding Communication club (migration-clubplus-v48-onboarding-club.sql, 02/09/2026) —
// centralise ce que le club doit fournir à SportVision avant que la communication démarre
// vraiment. Réutilise systématiquement les tables déjà réelles (clubs/club_members/club_teams/
// club_sponsors/club_calendar_events) via les fonctions déjà existantes ailleurs dans ce dossier
// (organization.ts, teams.ts, sponsors.ts, calendar.ts, users.ts) — ce fichier ne couvre QUE les
// entités qui n'avaient encore aucune fonction : lieux, créneaux d'entraînement, réseaux sociaux,
// droit à l'image niveau club, et le suivi de progression lui-même.

export interface OnboardingCompletion {
  identite: boolean;
  responsables: boolean;
  equipes: boolean;
  entrainements: boolean;
  calendrier: boolean;
  branding: boolean;
  sponsors: boolean;
  communication: boolean;
  droit_image: boolean;
  sections_completees: number;
  sections_total: number;
  pourcentage: number;
}

/** club_onboarding_completion() — toujours recalculée depuis les vraies données, jamais un
 * pourcentage stocké séparément (voir commentaire de la migration). */
export async function fetchOnboardingCompletion(supabase: SupabaseClient, clubId: string): Promise<OnboardingCompletion> {
  const { data, error } = await supabase.rpc("club_onboarding_completion", { p_club_id: clubId });
  if (error) throw error;
  return data as OnboardingCompletion;
}

export type OnboardingStatus = "not_started" | "in_progress" | "submitted" | "needs_information" | "validated";

export interface OnboardingProgress {
  statut: OnboardingStatus;
  startedAt: string | null;
  submittedAt: string | null;
  validatedAt: string | null;
  needsInformationNotes: string | null;
}

export async function fetchOnboardingProgress(supabase: SupabaseClient, clubId: string): Promise<OnboardingProgress | null> {
  const { data, error } = await supabase
    .from("club_onboarding_progress")
    .select("statut, started_at, submitted_at, validated_at, needs_information_notes")
    .eq("club_id", clubId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    statut: data.statut,
    startedAt: data.started_at,
    submittedAt: data.submitted_at,
    validatedAt: data.validated_at,
    needsInformationNotes: data.needs_information_notes,
  };
}

/** Premier contact avec l'onboarding : crée la ligne de suivi en 'in_progress' si elle n'existe
 * pas encore. `ignoreDuplicates: true` est essentiel ici — une ligne existante ne doit JAMAIS être
 * touchée (bug trouvé en QA le 02/09 : un `ON CONFLICT DO UPDATE` remettait 'submitted'/'validated'
 * à 'in_progress' à chaque simple ouverture de la page par n'importe qui). */
export async function ensureOnboardingStarted(supabase: SupabaseClient, clubId: string): Promise<void> {
  const { error } = await supabase
    .from("club_onboarding_progress")
    .upsert({ club_id: clubId, statut: "in_progress", started_at: new Date().toISOString() }, { onConflict: "club_id", ignoreDuplicates: true });
  if (error) throw error;
}

/** "Envoyer à SportVision" — passe le statut à 'submitted'. Toujours possible même si la
 * progression n'est pas à 100% (le club peut compléter le reste plus tard, la Secrétaire voit
 * ce qui manque) : aucun blocage à ce niveau, cohérent avec "le club ou SportVision peut remplir
 * la fiche" (master prompt). */
export async function submitOnboarding(supabase: SupabaseClient, clubId: string): Promise<void> {
  const { error } = await supabase
    .from("club_onboarding_progress")
    .update({ statut: "submitted", submitted_at: new Date().toISOString() })
    .eq("club_id", clubId);
  if (error) throw error;
}

// ── Lieux / installations ──

export interface ClubVenue {
  id: string;
  nom: string;
  adresse: string | null;
  ville: string | null;
  terrainPrincipal: boolean;
}

export async function fetchClubVenues(supabase: SupabaseClient, clubId: string): Promise<ClubVenue[]> {
  const { data, error } = await supabase
    .from("club_venues")
    .select("id, nom, adresse, ville, terrain_principal")
    .eq("club_id", clubId)
    .order("terrain_principal", { ascending: false })
    .order("nom");
  if (error) throw error;
  return (data ?? []).map((r) => ({ id: r.id, nom: r.nom, adresse: r.adresse, ville: r.ville, terrainPrincipal: r.terrain_principal }));
}

export async function createClubVenue(
  supabase: SupabaseClient,
  clubId: string,
  input: { nom: string; adresse?: string; ville?: string; terrainPrincipal?: boolean },
): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from("club_venues")
    .insert({ club_id: clubId, nom: input.nom, adresse: input.adresse || null, ville: input.ville || null, terrain_principal: !!input.terrainPrincipal })
    .select("id")
    .single();
  if (error) throw error;
  return data as { id: string };
}

// ── Créneaux d'entraînement récurrents ──

const JOURS_LABELS: Record<string, string> = {
  lundi: "Lundi",
  mardi: "Mardi",
  mercredi: "Mercredi",
  jeudi: "Jeudi",
  vendredi: "Vendredi",
  samedi: "Samedi",
  dimanche: "Dimanche",
};
export const JOURS_ORDER = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"] as const;
export { JOURS_LABELS };

export interface TrainingSlot {
  id: string;
  teamId: string;
  jour: string;
  heureDebut: string;
  heureFin: string | null;
  venueId: string | null;
  venueNom: string | null;
}

export async function fetchTrainingSlotsForClub(supabase: SupabaseClient, teamIds: string[]): Promise<TrainingSlot[]> {
  if (teamIds.length === 0) return [];
  const { data, error } = await supabase
    .from("club_team_training_slots")
    .select("id, team_id, jour, heure_debut, heure_fin, venue_id, club_venues(nom)")
    .in("team_id", teamIds)
    .order("jour");
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    teamId: r.team_id,
    jour: r.jour,
    heureDebut: r.heure_debut,
    heureFin: r.heure_fin,
    venueId: r.venue_id,
    venueNom: (Array.isArray(r.club_venues) ? r.club_venues[0]?.nom : (r.club_venues as { nom: string } | null)?.nom) ?? null,
  }));
}

export async function createTrainingSlot(
  supabase: SupabaseClient,
  input: { teamId: string; jour: string; heureDebut: string; heureFin?: string; venueId?: string },
): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from("club_team_training_slots")
    .insert({ team_id: input.teamId, jour: input.jour, heure_debut: input.heureDebut, heure_fin: input.heureFin || null, venue_id: input.venueId || null })
    .select("id")
    .single();
  if (error) throw error;
  return data as { id: string };
}

export async function deleteTrainingSlot(supabase: SupabaseClient, slotId: string): Promise<void> {
  const { error } = await supabase.from("club_team_training_slots").delete().eq("id", slotId);
  if (error) throw error;
}

// ── Réseaux sociaux (jamais de mot de passe — voir migration-clubplus-v48) ──

export type SocialPlatform = "instagram" | "tiktok" | "facebook" | "linkedin" | "youtube" | "autre";

export interface ClubSocialAccount {
  id: string;
  plateforme: SocialPlatform;
  handleOuUrl: string;
  accesSportvision: boolean;
}

export async function fetchClubSocialAccounts(supabase: SupabaseClient, clubId: string): Promise<ClubSocialAccount[]> {
  const { data, error } = await supabase
    .from("club_social_accounts")
    .select("id, plateforme, handle_ou_url, acces_sportvision")
    .eq("club_id", clubId)
    .order("plateforme");
  if (error) throw error;
  return (data ?? []).map((r) => ({ id: r.id, plateforme: r.plateforme, handleOuUrl: r.handle_ou_url, accesSportvision: r.acces_sportvision }));
}

export async function createClubSocialAccount(
  supabase: SupabaseClient,
  clubId: string,
  input: { plateforme: SocialPlatform; handleOuUrl: string; accesSportvision: boolean },
): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from("club_social_accounts")
    .insert({ club_id: clubId, plateforme: input.plateforme, handle_ou_url: input.handleOuUrl, acces_sportvision: input.accesSportvision })
    .select("id")
    .single();
  if (error) throw error;
  return data as { id: string };
}

export async function deleteClubSocialAccount(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("club_social_accounts").delete().eq("id", id);
  if (error) throw error;
}

// ── Objectifs / ton de communication ──

export interface ClubCommunicationPrefs {
  objectifsCommunication: string[];
  tonCommunication: string | null;
  sujetsSensibles: string | null;
}

export async function fetchClubCommunicationPrefs(supabase: SupabaseClient, clubId: string): Promise<ClubCommunicationPrefs> {
  const { data, error } = await supabase
    .from("clubs")
    .select("objectifs_communication, ton_communication, sujets_sensibles")
    .eq("id", clubId)
    .single();
  if (error) throw error;
  return {
    objectifsCommunication: data.objectifs_communication ?? [],
    tonCommunication: data.ton_communication,
    sujetsSensibles: data.sujets_sensibles,
  };
}

export async function updateClubCommunicationPrefs(supabase: SupabaseClient, clubId: string, input: ClubCommunicationPrefs): Promise<void> {
  const { error } = await supabase
    .from("clubs")
    .update({
      objectifs_communication: input.objectifsCommunication,
      ton_communication: input.tonCommunication,
      sujets_sensibles: input.sujetsSensibles?.trim() || null,
    })
    .eq("id", clubId);
  if (error) throw error;
}

export const OBJECTIFS_COMMUNICATION_OPTIONS = [
  { value: "notoriete", label: "Développer la notoriété" },
  { value: "recrutement_licencies", label: "Attirer de nouveaux licenciés" },
  { value: "valoriser_equipes", label: "Valoriser les équipes" },
  { value: "football_feminin", label: "Développer le sport féminin" },
  { value: "valoriser_jeunes", label: "Valoriser les jeunes" },
  { value: "sponsors", label: "Renforcer les sponsors" },
  { value: "benevoles", label: "Valoriser les bénévoles" },
  { value: "image_pro", label: "Professionnaliser l'image" },
  { value: "recrutement_educateurs", label: "Recruter des éducateurs" },
] as const;

export const TON_COMMUNICATION_OPTIONS = [
  "Dynamique",
  "Premium",
  "Institutionnel",
  "Familial",
  "Jeune",
  "Éducatif",
  "Communautaire",
  "Humoristique",
  "Sportif / performance",
] as const;

// ── Droit à l'image (niveau club — distinct des autorisations individuelles par joueur) ──

export type DroitImageMode = "inscription" | "papier" | "numerique" | "aucune" | "autre";

export interface ClubImageRights {
  mode: DroitImageMode | null;
  licenciesExclus: boolean;
  notes: string | null;
}

export async function fetchClubImageRights(supabase: SupabaseClient, clubId: string): Promise<ClubImageRights> {
  const { data, error } = await supabase
    .from("clubs")
    .select("droit_image_mode, droit_image_licencies_exclus, droit_image_notes")
    .eq("id", clubId)
    .single();
  if (error) throw error;
  return { mode: data.droit_image_mode, licenciesExclus: data.droit_image_licencies_exclus, notes: data.droit_image_notes };
}

export async function updateClubImageRights(supabase: SupabaseClient, clubId: string, input: ClubImageRights): Promise<void> {
  const { error } = await supabase
    .from("clubs")
    .update({
      droit_image_mode: input.mode,
      droit_image_licencies_exclus: input.licenciesExclus,
      droit_image_notes: input.notes?.trim() || null,
    })
    .eq("id", clubId);
  if (error) throw error;
}

export const DROIT_IMAGE_MODE_LABELS: Record<DroitImageMode, string> = {
  inscription: "Autorisations collectées à l'inscription",
  papier: "Autorisations papier",
  numerique: "Système numérique dédié",
  aucune: "Aucune procédure centralisée",
  autre: "Autre",
};
