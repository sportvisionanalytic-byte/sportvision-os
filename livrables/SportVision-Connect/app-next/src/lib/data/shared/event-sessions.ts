import type { SupabaseClient } from "@supabase/supabase-js";

// event_sessions (migration-clubplus-v43-events-sessions.sql) — objet central "Session" d'un
// organisateur de stage/camp (Bible §15, organization.type === "camp" — bascule 2 org types
// séparés, migration-clubplus-v44, 17/08/2026). Scope organization_id. RLS : is_org_member
// (lecture) / is_org_admin (écriture) ou is_staff.
//
// Groupes et participants sont des listes de NOMS LIBRES (jsonb), jamais une table de personnes
// ou d'inscriptions — Bible §15 : "Participants... uniquement pour organiser contenus, albums et
// intervention SportVision", "Ne pas construire la gestion complète des inscriptions et paiements
// du camp".

export type EventSessionStatut = "a_venir" | "en_cours" | "terminee" | "annulee";

export interface EventSession {
  id: string;
  organizationId: string;
  nom: string;
  dateDebut: string | null;
  dateFin: string | null;
  lieu: string | null;
  statut: EventSessionStatut;
  infosUtiles: string | null;
  groupes: string[];
  participants: string[];
  createdAt: string;
  updatedAt: string;
}

interface EventSessionRow {
  id: string;
  organization_id: string;
  nom: string;
  date_debut: string | null;
  date_fin: string | null;
  lieu: string | null;
  statut: string;
  infos_utiles: string | null;
  groupes: unknown;
  participants: unknown;
  created_at: string;
  updated_at: string;
}

const SELECT = "id, organization_id, nom, date_debut, date_fin, lieu, statut, infos_utiles, groupes, participants, created_at, updated_at";

const STATUT_VALUES: EventSessionStatut[] = ["a_venir", "en_cours", "terminee", "annulee"];

function toNameList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function toEventSession(row: EventSessionRow): EventSession {
  return {
    id: row.id,
    organizationId: row.organization_id,
    nom: row.nom,
    dateDebut: row.date_debut,
    dateFin: row.date_fin,
    lieu: row.lieu,
    statut: STATUT_VALUES.includes(row.statut as EventSessionStatut) ? (row.statut as EventSessionStatut) : "a_venir",
    infosUtiles: row.infos_utiles,
    groupes: toNameList(row.groupes),
    participants: toNameList(row.participants),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function fetchEventSessions(supabase: SupabaseClient, organizationId: string): Promise<EventSession[]> {
  const { data, error } = await supabase
    .from("event_sessions")
    .select(SELECT)
    .eq("organization_id", organizationId)
    .order("date_debut", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as EventSessionRow[]).map(toEventSession);
}

export async function fetchEventSession(supabase: SupabaseClient, sessionId: string): Promise<EventSession | null> {
  const { data, error } = await supabase.from("event_sessions").select(SELECT).eq("id", sessionId).maybeSingle();
  if (error) throw error;
  return data ? toEventSession(data as unknown as EventSessionRow) : null;
}

export async function createEventSession(
  supabase: SupabaseClient,
  organizationId: string,
  input: { nom: string; dateDebut?: string; dateFin?: string; lieu?: string },
): Promise<EventSession> {
  const { data, error } = await supabase
    .from("event_sessions")
    .insert({
      organization_id: organizationId,
      nom: input.nom,
      date_debut: input.dateDebut || null,
      date_fin: input.dateFin || null,
      lieu: input.lieu || null,
    })
    .select(SELECT)
    .single();
  if (error || !data) throw error ?? new Error("Création de la session impossible.");
  return toEventSession(data as unknown as EventSessionRow);
}

export async function updateEventSession(
  supabase: SupabaseClient,
  sessionId: string,
  patch: Partial<{
    nom: string;
    dateDebut: string | null;
    dateFin: string | null;
    lieu: string | null;
    statut: EventSessionStatut;
    infosUtiles: string | null;
    groupes: string[];
    participants: string[];
  }>,
): Promise<EventSession> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.nom !== undefined) payload.nom = patch.nom;
  if (patch.dateDebut !== undefined) payload.date_debut = patch.dateDebut;
  if (patch.dateFin !== undefined) payload.date_fin = patch.dateFin;
  if (patch.lieu !== undefined) payload.lieu = patch.lieu;
  if (patch.statut !== undefined) payload.statut = patch.statut;
  if (patch.infosUtiles !== undefined) payload.infos_utiles = patch.infosUtiles;
  if (patch.groupes !== undefined) payload.groupes = patch.groupes;
  if (patch.participants !== undefined) payload.participants = patch.participants;

  const { data, error } = await supabase.from("event_sessions").update(payload).eq("id", sessionId).select(SELECT).single();
  if (error || !data) throw error ?? new Error("Mise à jour de la session impossible.");
  return toEventSession(data as unknown as EventSessionRow);
}
