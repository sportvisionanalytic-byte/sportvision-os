import type { SupabaseClient } from "@supabase/supabase-js";

// calendar_events (migration-connect-v3-coach-academie-requests.sql), filtré type='seance' pour
// l'espace Coach. `type` n'a pas de contrainte CHECK en base (texte libre, valeur par défaut
// 'contenu') — 'seance' est la valeur exacte déjà utilisée par le catalogue d'affichage de la
// vitrine Connect vanilla (app/modules/coach-espace.js, eventTypeLabel/eventTypeColor : seance →
// "Séance"), donc celle que SportVision (staff, seul à pouvoir écrire cette table — policy
// cal_staff_write) est censé employer pour distinguer une séance des autres types d'événement
// (tournage, contenu, match...). Lecture seule ici : cal_member_select autorise la lecture aux
// membres de l'organisation, l'écriture reste réservée au staff — le staff planifie, le coach
// consulte, cohérent avec le reste de l'écosystème Connect construit cette semaine.
//
// calendar_events ne porte que event_date/title/context (pas d'heure, de lieu ni de statut —
// contrairement au mock qu'il remplace) : ce que cette fonction renvoie est honnêtement limité à
// ces 3 champs, rien n'est inventé pour compléter l'affichage.

const SEANCE_TYPE = "seance";

export interface CoachSessionEvent {
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

export async function fetchCoachSessions(supabase: SupabaseClient, organizationId: string): Promise<CoachSessionEvent[]> {
  const { data } = await supabase
    .from("calendar_events")
    .select("id, event_date, title, context")
    .eq("organization_id", organizationId)
    .eq("type", SEANCE_TYPE)
    .order("event_date", { ascending: true });

  return ((data ?? []) as CalendarEventRow[]).map((row) => ({
    id: row.id,
    eventDate: row.event_date,
    title: row.title,
    context: row.context,
  }));
}
