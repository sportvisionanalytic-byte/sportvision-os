import { createClient } from "@/lib/supabase/server";
import { resolveDisplayIdentity, buildPlayerContext, requireParticulierAccount } from "@/lib/supabase/session";
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
  const { user } = await requireParticulierAccount(supabase);

  // player, athletes et l'appel RPC calendrier sont indépendants (connect_list_calendar_for_
  // athletes résout lui-même la liste de sportifs côté serveur) — voir rapport fluidité perçue
  // 15/08.
  const [player, athletes, calendarRes] = await Promise.all([
    buildPlayerContext(supabase, user.id),
    fetchMyAthletes(supabase).catch(() => []),
    supabase.rpc("connect_list_calendar_for_athletes"),
  ]);
  const identity = resolveDisplayIdentity(user, player);
  const firstName = identity.firstName || user.email?.split("@")[0] || "";
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

  return (
    <ParticularShell firstName={firstName} athletes={toNavItems(athletes)}>
      <CalendrierParticulierView events={events} athletes={athletes} initialSportif={sportif || null} />
    </ParticularShell>
  );
}
