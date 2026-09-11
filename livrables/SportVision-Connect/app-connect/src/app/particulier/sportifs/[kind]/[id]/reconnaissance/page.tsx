import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireParticulierAccount } from "@/lib/supabase/session";
import { ReconnaissanceView } from "./ReconnaissanceView";
import type { AthleteDetail } from "../AthleteDetailView";
import type { EtatConsentement } from "@/lib/supabase/reconnaissance";

// Reconnaissance du visage de l'enfant, option facultative (migration v159 pour le socle, v161 pour
// les trois gestes de la famille). Réservée à un enfant affilié à un club (kind='club') : c'est le
// seul cas où des galeries d'équipe existent. Le refus n'enlève rien, la galerie de l'équipe reste
// accessible et achetable comme avant.
export default async function ReconnaissancePage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if (kind !== "club") notFound();

  const supabase = await createClient();
  await requireParticulierAccount(supabase);

  const { data } = await supabase.rpc("connect_get_athlete_detail", { p_kind: kind, p_ref_id: id });
  const detail = data as AthleteDetail | null;
  if (!detail) notFound();

  const { data: etat } = await supabase.rpc("mon_consentement_biometrie", { p_player_id: id });

  return <ReconnaissanceView detail={detail} etatInitial={(etat as EtatConsentement | null) ?? null} />;
}
