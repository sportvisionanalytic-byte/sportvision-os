import type { SupabaseClient } from "@supabase/supabase-js";

// calendar_events (migration-connect-v3-coach-academie-requests.sql), filtré type='stage' pour
// l'espace Académie. `type` n'a pas de contrainte CHECK en base (texte libre, valeur par défaut
// 'contenu') — 'stage' est la valeur exacte déjà utilisée par le catalogue d'affichage de la
// vitrine Connect vanilla (app/modules/academie-espace.js, eventTypeLabel et REQUEST_TYPES :
// stage → "Stage"), donc celle que SportVision (staff, seul à pouvoir écrire cette table —
// policy cal_staff_write) est censé employer pour distinguer un stage des autres types
// d'événement (tournage, réunion, contenu...). Lecture seule ici : cal_member_select autorise la
// lecture aux membres de l'organisation, l'écriture reste réservée au staff — le staff planifie,
// l'académie consulte.
//
// calendar_events ne porte qu'une seule event_date (pas de startsAt/endsAt), ni lieu, groupes,
// capacité ou nombre d'inscrits (contrairement au mock qu'il remplace, qui inventait ces champs) :
// ce que cette fonction renvoie est honnêtement limité à date/titre/contexte. Le contexte
// (context) porte le nom du groupe concerné quand SportVision le renseigne, voir le commentaire
// d'origine de la migration ("context = nom du joueur/groupe").

const STAGE_TYPE = "stage";

export interface AcademieCampEvent {
  id: string;
  eventDate: string;
  title: string;
  context: string | null;
}

interface CalendarEventRow {
  id: string;
  event_date: string;
  title: string;
  context: string | null;
}

export async function fetchAcademieCamps(supabase: SupabaseClient, organizationId: string): Promise<AcademieCampEvent[]> {
  const { data } = await supabase
    .from("calendar_events")
    .select("id, event_date, title, context")
    .eq("organization_id", organizationId)
    .eq("type", STAGE_TYPE)
    .order("event_date", { ascending: true });

  return ((data ?? []) as CalendarEventRow[]).map((row) => ({
    id: row.id,
    eventDate: row.event_date,
    title: row.title,
    context: row.context,
  }));
}
