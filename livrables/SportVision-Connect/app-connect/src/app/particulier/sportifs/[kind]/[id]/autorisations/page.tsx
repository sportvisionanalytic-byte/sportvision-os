import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireParticulierAccount } from "@/lib/supabase/session";
import { fetchAutorisations } from "@/lib/supabase/autorisations";
import { AutorisationsView } from "./AutorisationsView";
import type { AthleteDetail } from "../AthleteDetailView";

// Autorisations parentales d'un enfant affilié à un club (migration v176).
// Sans le droit à l'image signé ici, les médias où l'enfant est identifié restent masqués : c'est
// l'écran qui manquait à toute la chaîne.
export default async function AutorisationsPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if (kind !== "club") notFound();

  const supabase = await createClient();
  await requireParticulierAccount(supabase);

  const { data } = await supabase.rpc("connect_get_athlete_detail", { p_kind: kind, p_ref_id: id });
  const detail = data as AthleteDetail | null;
  if (!detail) notFound();

  const autorisations = await fetchAutorisations(supabase, id).catch(() => []);

  return <AutorisationsView detail={detail} initiales={autorisations} />;
}
