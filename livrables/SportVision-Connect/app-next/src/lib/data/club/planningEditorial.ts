import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContenuPlanning, StatutContenu } from "@/lib/communication/planning";

// Le planning éditorial du CM (11/09/2026) : la table `contenus`, telle que l'OS et la fiche
// /communication/publications/[id] la lisent déjà — aucune seconde base. Les droits sont ceux de la
// base (v141) : le CM du club crée et modifie, tout CM du club supprime un contenu non publié, un
// contenu publié ne se réécrit plus. Une écriture qui ne touche aucune ligne est une ERREUR, jamais
// un succès affiché (règle du 10/09) : PostgREST rend [] sans erreur quand la RLS refuse.

export interface ContenuCm extends ContenuPlanning {
  description: string | null;
  teamId: string | null;
  matchId: string | null;
  calendarEventId: string | null;
  occurrenceRef: string | null;
  requestId: string | null;
  cmId: string;
  datePublication: string | null;
}

const SELECT =
  "id, titre, description, statut, type_contenu, plateforme, date_prevue, heure_prevue, team_id, match_id, calendar_event_id, occurrence_ref, request_id, cm_id, date_publication, club_teams(name)";

interface Ligne {
  id: string; titre: string; description: string | null; statut: string; type_contenu: string | null; plateforme: string | null;
  date_prevue: string | null; heure_prevue: string | null; team_id: string | null; match_id: string | null;
  calendar_event_id: string | null; occurrence_ref: string | null; request_id: string | null; cm_id: string;
  date_publication: string | null; club_teams: { name: string } | { name: string }[] | null;
}

function versContenu(l: Ligne): ContenuCm {
  const equipe = Array.isArray(l.club_teams) ? l.club_teams[0]?.name ?? null : l.club_teams?.name ?? null;
  return {
    id: l.id, titre: l.titre, description: l.description, statut: l.statut as StatutContenu,
    typeContenu: l.type_contenu, plateforme: l.plateforme, datePrevue: l.date_prevue,
    heurePrevue: l.heure_prevue ? l.heure_prevue.slice(0, 5) : null, equipe, teamId: l.team_id,
    matchId: l.match_id, calendarEventId: l.calendar_event_id, occurrenceRef: l.occurrence_ref,
    requestId: l.request_id, cmId: l.cm_id, datePublication: l.date_publication,
  };
}

export async function fetchPlanning(supabase: SupabaseClient, clientId: string): Promise<ContenuCm[]> {
  const { data, error } = await supabase.from("contenus").select(SELECT).eq("client_id", clientId);
  if (error) throw error;
  return ((data ?? []) as unknown as Ligne[]).map(versContenu);
}

export interface SaisieContenu {
  titre: string;
  typeContenu: string | null;
  plateforme: string | null;
  datePrevue: string | null;
  heurePrevue: string | null;
  teamId: string | null;
  description: string | null;
  /** `match:<id>`, `evenement:<id>`, `entrainement:<créneau>:<date>`, ou rien. */
  evenement: string | null;
}

function colonnes(s: SaisieContenu) {
  const [genre, id] = (s.evenement ?? "").split(":");
  return {
    titre: s.titre.trim(),
    type_contenu: s.typeContenu,
    plateforme: s.plateforme,
    date_prevue: s.datePrevue,
    heure_prevue: s.heurePrevue,
    team_id: s.teamId,
    description: s.description?.trim() || null,
    match_id: genre === "match" && id ? id : null,
    calendar_event_id: genre === "evenement" && id ? id : null,
    occurrence_ref: genre === "entrainement" ? s.evenement : null,
  };
}

const RIEN = "Rien n'a été enregistré : ce contenu n'existe plus ou n'est pas modifiable depuis votre compte.";

export async function creerContenu(supabase: SupabaseClient, clientId: string, cmId: string, s: SaisieContenu): Promise<ContenuCm> {
  const { data, error } = await supabase
    .from("contenus")
    .insert({ client_id: clientId, cm_id: cmId, statut: "brouillon", ...colonnes(s) })
    .select(SELECT)
    .single();
  if (error) throw error;
  return versContenu(data as unknown as Ligne);
}

export async function modifierContenu(supabase: SupabaseClient, id: string, s: SaisieContenu): Promise<ContenuCm> {
  const { data, error } = await supabase.from("contenus").update(colonnes(s)).eq("id", id).select(SELECT);
  if (error) throw error;
  const l = (data ?? [])[0];
  if (!l) throw new Error(RIEN);
  return versContenu(l as unknown as Ligne);
}

export async function changerStatutContenu(supabase: SupabaseClient, id: string, statut: StatutContenu): Promise<ContenuCm> {
  const { data, error } = await supabase.from("contenus").update({ statut }).eq("id", id).select(SELECT);
  if (error) throw error;
  const l = (data ?? [])[0];
  if (!l) throw new Error(RIEN);
  return versContenu(l as unknown as Ligne);
}

export async function supprimerContenu(supabase: SupabaseClient, id: string): Promise<void> {
  const { data, error } = await supabase.from("contenus").delete().eq("id", id).select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Rien n'a été supprimé : un contenu publié s'archive, il ne se supprime pas.");
}

/** Une copie en brouillon, même date et même réseau : le CM la décale ensuite. */
export async function dupliquerContenu(supabase: SupabaseClient, clientId: string, cmId: string, source: ContenuCm): Promise<ContenuCm> {
  return creerContenu(supabase, clientId, cmId, {
    titre: `${source.titre} (copie)`,
    typeContenu: source.typeContenu,
    plateforme: source.plateforme,
    datePrevue: source.datePrevue,
    heurePrevue: source.heurePrevue,
    teamId: source.teamId,
    description: source.description,
    evenement: source.matchId ? `match:${source.matchId}` : source.calendarEventId ? `evenement:${source.calendarEventId}` : source.occurrenceRef,
  });
}
