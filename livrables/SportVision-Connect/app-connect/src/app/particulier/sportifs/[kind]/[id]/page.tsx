import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveDisplayIdentity, buildPlayerContext } from "@/lib/supabase/session";
import { fetchMyAthletes, toNavItems } from "@/lib/supabase/particulier";
import { ParticularShell } from "@/components/layout/ParticularShell";
import { AthleteDetailView, type AthleteDetail } from "./AthleteDetailView";

// Fiche sportif — voir design-connect-personnel-12-08/README.md § Espace particulier → Fiche
// sportif. Backend : connect_get_athlete_detail() (migration-connect-v51-espace-particulier.sql
// §5), null si l'appelant n'a pas cette relation => 404 (même convention que get_funding_detail :
// jamais une erreur technique exposée, MASTER-CONNECT-V1 §35).
export default async function AthleteDetailPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if (kind !== "linked" && kind !== "managed") notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const player = await buildPlayerContext(supabase, user.id);
  const identity = resolveDisplayIdentity(user, player);
  const firstName = identity.firstName || user.email?.split("@")[0] || "";
  const athletes = await fetchMyAthletes(supabase).catch(() => []);

  const { data } = await supabase.rpc("connect_get_athlete_detail", { p_kind: kind, p_ref_id: id });
  const detail = data as AthleteDetail | null;
  if (!detail) notFound();

  return (
    <ParticularShell firstName={firstName} athletes={toNavItems(athletes)}>
      <AthleteDetailView detail={detail} />
    </ParticularShell>
  );
}
