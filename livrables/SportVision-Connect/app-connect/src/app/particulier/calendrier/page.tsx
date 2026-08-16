import { createClient } from "@/lib/supabase/server";
import { requireParticulierAccount } from "@/lib/supabase/session";
import { fetchMyAthletes } from "@/lib/supabase/particulier";
import { CalendrierParticulierView, type ParticulierEvent } from "./CalendrierParticulierView";

// Calendrier (Espace particulier) — backend : connect_list_calendar_for_athletes()
// (migration-connect-v51 §7), vérifie le droit "calendrier" pour chaque sportif lié avant de
// lire club_calendar_events.
//
// Shell (ParticularShell) rendu par le layout parent (src/app/particulier/layout.tsx) — cette
// page garde son propre fetch d'athletes car CalendrierParticulierView en a besoin pour son
// filtre.
export default async function CalendrierParticulierPage({
  searchParams,
}: {
  searchParams: Promise<{ sportif?: string }>;
}) {
  const { sportif } = await searchParams;
  const supabase = await createClient();
  await requireParticulierAccount(supabase);

  const [athletes, calendarRes] = await Promise.all([
    fetchMyAthletes(supabase).catch(() => []),
    supabase.rpc("connect_list_calendar_for_athletes"),
  ]);
  const { data } = calendarRes;
  const events = ((data || []) as Array<{
    athlete_kind: string;
    athlete_ref_id: string;
    athlete_label: string;
    id: string;
    event_date: string;
    type: string;
    title: string;
    team: string | null;
    event_time: string | null;
    location: string | null;
    source: "club" | "manual";
  }>).map((r) => ({
    id: r.id,
    title: r.title,
    type: r.type,
    date: r.event_date,
    time: r.event_time,
    location: r.location,
    team: r.team,
    athleteKey: `${r.athlete_kind}:${r.athlete_ref_id}`,
    athleteLabel: r.athlete_label,
    source: r.source,
  })) as ParticulierEvent[];

  return <CalendrierParticulierView events={events} athletes={athletes} initialSportif={sportif || null} />;
}
