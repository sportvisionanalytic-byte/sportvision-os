import { createClient } from "@/lib/supabase/server";
import { buildPlayerContext, requireJoueurAccount } from "@/lib/supabase/session";
import { AppShell } from "@/components/layout/AppShell";
import { CalendarView, type CalendarEventData } from "./CalendarView";

// Calendrier — voir design-connect-personnel-12-08/README.md § Espace joueur → Calendrier.
//
// SOURCE DE DONNÉES — écart volontaire par rapport à la liste initiale (`calendar_events`,
// `event_checklist_items`) : ces deux tables (migration-connect-v3-coach-academie-requests.sql,
// migration-connect-v22-event-checklist-items.sql) servent le calendrier générique des
// organisations B2B (coach/académie) et la checklist interne d'un événement Full Communication —
// aucune des deux n'a de policy RLS accessible à un compte Joueur. La table réellement construite
// et déjà exécutée pour l'Espace Joueur est `club_calendar_events`
// (migration-clubplus-v4.sql/v35), avec une policy dédiée "ccal_family_select"
// (migration-clubplus-v16.sql, commentaire : "sans cette migration, l'Espace Joueur ne peut
// littéralement rien lire") — scopée par équipe via team_memberships (is_family_of_team). Un
// joueur sans équipe assignée verra donc légitimement un calendrier vide (état normal, pas un
// bug) tant que le club ne l'a pas rattaché à une équipe.
//
// `rendez_vous` (dans le périmètre initial) est bien inclus ici, mais seulement si
// `player_profiles.client_id` est déjà renseigné : la policy actuelle ("rdv_client_own",
// migration-portail-v1.sql) ne reconnaît que `client_users`, pas encore le joueur — un correctif
// est décrit dans migration-connect-v45-rendez-vous-player-access.sql (à exécuter manuellement,
// voir le rapport final). Tant que ce n'est pas fait, cette page ne force jamais la création d'un
// client_id (effet de bord réservé à /messages) : elle se contente de lire la colonne si elle est
// déjà remplie, pour ne rien créer de fantôme depuis une simple consultation du calendrier.
export default async function CalendrierPage() {
  const supabase = await createClient();
  const { user } = await requireJoueurAccount(supabase);

  const player = await buildPlayerContext(supabase, user.id);
  const firstName = player?.firstName || user.email?.split("@")[0] || "";

  const events: CalendarEventData[] = [];

  if (player?.club) {
    const { data: calRows } = await supabase
      .from("club_calendar_events")
      .select("id, event_date, type, title, team, event_time, location")
      .eq("club_id", player.club.id)
      .order("event_date", { ascending: true });

    for (const row of calRows ?? []) {
      events.push({
        id: `cal-${row.id}`,
        kind: (row.type as string) || "contenu",
        title: row.title as string,
        date: row.event_date as string,
        time: (row.event_time as string | null) ?? null,
        location: (row.location as string | null) ?? null,
        clubName: player.club.nom,
        teamName: (row.team as string | null) ?? null,
      });
    }
  }

  if (player?.playerId) {
    const { data: profileRow } = await supabase
      .from("player_profiles")
      .select("client_id")
      .eq("id", player.playerId)
      .maybeSingle();
    const clientId = profileRow?.client_id as string | undefined;

    if (clientId) {
      const { data: rdvRows } = await supabase
        .from("rendez_vous")
        .select("id, date_demandee, heure_demandee, objet, type_rdv, statut")
        .eq("client_id", clientId)
        .order("date_demandee", { ascending: true });

      for (const row of rdvRows ?? []) {
        if (row.statut === "refuse" || row.statut === "annule") continue;
        events.push({
          id: `rdv-${row.id}`,
          kind: "rendez_vous",
          title: (row.objet as string) || (row.type_rdv as string) || "Rendez-vous SportVision",
          date: row.date_demandee as string,
          time: (row.heure_demandee as string | null) ?? null,
          location: null,
          clubName: player.club?.nom ?? null,
          teamName: null,
        });
      }
    }
  }

  return (
    <AppShell firstName={firstName}>
      <CalendarView events={events} hasClub={!!player?.club} />
    </AppShell>
  );
}
