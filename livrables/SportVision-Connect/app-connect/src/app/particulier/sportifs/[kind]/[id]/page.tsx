import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireParticulierAccount } from "@/lib/supabase/session";
import { AthleteDetailView, type AthleteDetail } from "./AthleteDetailView";

// Fiche sportif — voir design-connect-personnel-12-08/README.md § Espace particulier → Fiche
// sportif. Backend : connect_get_athlete_detail() (migration-connect-v51-espace-particulier.sql
// §5), null si l'appelant n'a pas cette relation => 404 (même convention que get_funding_detail :
// jamais une erreur technique exposée, MASTER-CONNECT-V1 §35).
//
// Shell (ParticularShell) rendu par le layout parent (src/app/particulier/layout.tsx).
export default async function AthleteDetailPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if (kind !== "linked" && kind !== "managed" && kind !== "club") notFound();

  const supabase = await createClient();
  await requireParticulierAccount(supabase);

  const { data } = await supabase.rpc("connect_get_athlete_detail", { p_kind: kind, p_ref_id: id });
  const detail = data as AthleteDetail | null;
  if (!detail) notFound();

  return <AthleteDetailView detail={detail} />;
}
