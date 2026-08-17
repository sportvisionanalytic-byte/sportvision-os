import type { SupabaseClient } from "@supabase/supabase-js";

// event_editions (migration-clubplus-v43-events-sessions.sql) — objet central "Édition" d'un
// organisateur de tournoi/événement (Bible §14, organization.type === "tournament_organizer" —
// bascule 2 org types séparés, migration-clubplus-v44, 17/08/2026). Scope organization_id,
// plusieurs éditions possibles par organisation ("Mes événements" au pluriel). RLS :
// is_org_member (lecture) / is_org_admin (écriture) ou is_staff — voir header de la migration.
//
// Distinct de event_checklist_items (data/shared/event-checklist.ts) : la checklist suit la
// préparation d'UN événement (avant/jour J/après, écriture staff uniquement), l'édition est la
// fiche pilotée par l'organisateur lui-même (aperçu + bilan léger), sans notion de phase.

export type EventEditionStatut = "a_venir" | "en_cours" | "terminee" | "annulee";

export interface EventEdition {
  id: string;
  organizationId: string;
  nom: string;
  dateDebut: string | null;
  dateFin: string | null;
  lieu: string | null;
  sport: string | null;
  format: string | null;
  contactNom: string | null;
  contactEmail: string | null;
  contactTelephone: string | null;
  statut: EventEditionStatut;
  infosUtiles: string | null;
  /** Noms libres — pas de table de poules/inscriptions (Bible §14). */
  equipesParticipantes: string[];
  bilanVainqueur: string | null;
  bilanFinaliste: string | null;
  bilanScoreFinale: string | null;
  bilanMvp: string | null;
  bilanDistinctions: string | null;
  createdAt: string;
  updatedAt: string;
}

interface EventEditionRow {
  id: string;
  organization_id: string;
  nom: string;
  date_debut: string | null;
  date_fin: string | null;
  lieu: string | null;
  sport: string | null;
  format: string | null;
  contact_nom: string | null;
  contact_email: string | null;
  contact_telephone: string | null;
  statut: string;
  infos_utiles: string | null;
  equipes_participantes: unknown;
  bilan_vainqueur: string | null;
  bilan_finaliste: string | null;
  bilan_score_finale: string | null;
  bilan_mvp: string | null;
  bilan_distinctions: string | null;
  created_at: string;
  updated_at: string;
}

// Un seul littéral (pas de concaténation avec +) : supabase-js infère les colonnes du select()
// depuis le TYPE littéral de cette chaîne — une concaténation `+` élargit le type en `string`
// générique et casse cette inférence (TS2352 sur le cast de row plus bas).
const SELECT =
  "id, organization_id, nom, date_debut, date_fin, lieu, sport, format, contact_nom, contact_email, contact_telephone, statut, infos_utiles, equipes_participantes, bilan_vainqueur, bilan_finaliste, bilan_score_finale, bilan_mvp, bilan_distinctions, created_at, updated_at";

const STATUT_VALUES: EventEditionStatut[] = ["a_venir", "en_cours", "terminee", "annulee"];

function toNameList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function toEventEdition(row: EventEditionRow): EventEdition {
  return {
    id: row.id,
    organizationId: row.organization_id,
    nom: row.nom,
    dateDebut: row.date_debut,
    dateFin: row.date_fin,
    lieu: row.lieu,
    sport: row.sport,
    format: row.format,
    contactNom: row.contact_nom,
    contactEmail: row.contact_email,
    contactTelephone: row.contact_telephone,
    statut: STATUT_VALUES.includes(row.statut as EventEditionStatut) ? (row.statut as EventEditionStatut) : "a_venir",
    infosUtiles: row.infos_utiles,
    equipesParticipantes: toNameList(row.equipes_participantes),
    bilanVainqueur: row.bilan_vainqueur,
    bilanFinaliste: row.bilan_finaliste,
    bilanScoreFinale: row.bilan_score_finale,
    bilanMvp: row.bilan_mvp,
    bilanDistinctions: row.bilan_distinctions,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function fetchEventEditions(supabase: SupabaseClient, organizationId: string): Promise<EventEdition[]> {
  const { data, error } = await supabase
    .from("event_editions")
    .select(SELECT)
    .eq("organization_id", organizationId)
    .order("date_debut", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as EventEditionRow[]).map(toEventEdition);
}

export async function fetchEventEdition(supabase: SupabaseClient, editionId: string): Promise<EventEdition | null> {
  const { data, error } = await supabase.from("event_editions").select(SELECT).eq("id", editionId).maybeSingle();
  if (error) throw error;
  return data ? toEventEdition(data as unknown as EventEditionRow) : null;
}

export async function createEventEdition(
  supabase: SupabaseClient,
  organizationId: string,
  input: { nom: string; dateDebut?: string; dateFin?: string; lieu?: string; sport?: string; format?: string },
): Promise<EventEdition> {
  const { data, error } = await supabase
    .from("event_editions")
    .insert({
      organization_id: organizationId,
      nom: input.nom,
      date_debut: input.dateDebut || null,
      date_fin: input.dateFin || null,
      lieu: input.lieu || null,
      sport: input.sport || null,
      format: input.format || null,
    })
    .select(SELECT)
    .single();
  if (error || !data) throw error ?? new Error("Création de l'événement impossible.");
  return toEventEdition(data as unknown as EventEditionRow);
}

/** Aperçu + bilan léger éditables (Bible §14) — un seul point d'update, toutes les valeurs
 * passées en `undefined` restent inchangées côté serveur (patch partiel). */
export async function updateEventEdition(
  supabase: SupabaseClient,
  editionId: string,
  patch: Partial<{
    nom: string;
    dateDebut: string | null;
    dateFin: string | null;
    lieu: string | null;
    sport: string | null;
    format: string | null;
    contactNom: string | null;
    contactEmail: string | null;
    contactTelephone: string | null;
    statut: EventEditionStatut;
    infosUtiles: string | null;
    equipesParticipantes: string[];
    bilanVainqueur: string | null;
    bilanFinaliste: string | null;
    bilanScoreFinale: string | null;
    bilanMvp: string | null;
    bilanDistinctions: string | null;
  }>,
): Promise<EventEdition> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.nom !== undefined) payload.nom = patch.nom;
  if (patch.dateDebut !== undefined) payload.date_debut = patch.dateDebut;
  if (patch.dateFin !== undefined) payload.date_fin = patch.dateFin;
  if (patch.lieu !== undefined) payload.lieu = patch.lieu;
  if (patch.sport !== undefined) payload.sport = patch.sport;
  if (patch.format !== undefined) payload.format = patch.format;
  if (patch.contactNom !== undefined) payload.contact_nom = patch.contactNom;
  if (patch.contactEmail !== undefined) payload.contact_email = patch.contactEmail;
  if (patch.contactTelephone !== undefined) payload.contact_telephone = patch.contactTelephone;
  if (patch.statut !== undefined) payload.statut = patch.statut;
  if (patch.infosUtiles !== undefined) payload.infos_utiles = patch.infosUtiles;
  if (patch.equipesParticipantes !== undefined) payload.equipes_participantes = patch.equipesParticipantes;
  if (patch.bilanVainqueur !== undefined) payload.bilan_vainqueur = patch.bilanVainqueur;
  if (patch.bilanFinaliste !== undefined) payload.bilan_finaliste = patch.bilanFinaliste;
  if (patch.bilanScoreFinale !== undefined) payload.bilan_score_finale = patch.bilanScoreFinale;
  if (patch.bilanMvp !== undefined) payload.bilan_mvp = patch.bilanMvp;
  if (patch.bilanDistinctions !== undefined) payload.bilan_distinctions = patch.bilanDistinctions;

  const { data, error } = await supabase.from("event_editions").update(payload).eq("id", editionId).select(SELECT).single();
  if (error || !data) throw error ?? new Error("Mise à jour de l'événement impossible.");
  return toEventEdition(data as unknown as EventEditionRow);
}
