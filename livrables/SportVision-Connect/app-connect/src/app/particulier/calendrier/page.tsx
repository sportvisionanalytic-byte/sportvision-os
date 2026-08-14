import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveDisplayIdentity, buildPlayerContext } from "@/lib/supabase/session";
import { fetchMyAthletes, toNavItems } from "@/lib/supabase/particulier";
import { ParticularShell } from "@/components/layout/ParticularShell";
import { CalendrierParticulierView, type ParticulierEvent } from "./CalendrierParticulierView";

// Calendrier (Espace particulier) — backend : connect_list_calendar_for_athletes()
// (migration-connect-v51 §7), vérifie le droit "calendrier" pour chaque sportif lié avant de
// lire club_calendar_events.
export default async function CalendrierParticulierPage({
  searchParams,
}: {
  searchParams: Promise<{ sportif?: string }>;
}) {
  const { sportif } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const player = await buildPlayerContext(supabase, user.id);
  const identity = resolveDisplayIdentity(user, player);
  const firstName = identity.firstName || user.email?.split("@")[0] || "";
  const athletes = await fetchMyAthletes(supabase).catch(() => []);

  const { data } = await supabase.rpc("connect_list_calendar_for_athletes");
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
  })) as ParticulierEvent[];

  return (
    <ParticularShell firstName={firstName} athletes={toNavItems(athletes)}>
      <CalendrierParticulierView events={events} athletes={athletes} initialSportif={sportif || null} />
    </ParticularShell>
  );
}
