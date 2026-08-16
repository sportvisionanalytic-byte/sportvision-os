import { createClient } from "@/lib/supabase/server";
import { requireParticulierAccount } from "@/lib/supabase/session";
import { fetchMyAthletes } from "@/lib/supabase/particulier";
import { ContenusParticulierView, type ParticulierContentItem } from "./ContenusParticulierView";

// Mes contenus (Espace particulier) — voir design-connect-personnel-12-08/README.md § Listes
// multi-sportifs. Backend : connect_list_contents_for_athletes() (migration-connect-v51 §7),
// SECURITY DEFINER — vérifie le droit "voir" pour chaque sportif lié avant de lire club_media
// (RLS ne le permettrait pas directement à un particulier, cf. commentaire de tête de la RPC).
// Les profils gérés n'ont aucun contenu en V1 (aucun club réel associé, voir §2 de la migration).
//
// Shell (ParticularShell) rendu par le layout parent (src/app/particulier/layout.tsx) — cette
// page garde son propre fetch d'athletes car ContenusParticulierView en a besoin pour son filtre.
export default async function ContenusParticulierPage({
  searchParams,
}: {
  searchParams: Promise<{ sportif?: string }>;
}) {
  const { sportif } = await searchParams;
  const supabase = await createClient();
  await requireParticulierAccount(supabase);

  const [athletes, contentsRes] = await Promise.all([
    fetchMyAthletes(supabase).catch(() => []),
    supabase.rpc("connect_list_contents_for_athletes"),
  ]);
  const { data } = contentsRes;
  const items = ((data || []) as Array<{
    athlete_kind: string;
    athlete_ref_id: string;
    athlete_label: string;
    id: string;
    title: string;
    type: string;
    team: string | null;
    link: string | null;
    created_at: string;
  }>).map((r) => ({
    id: r.id,
    title: r.title,
    type: r.type,
    team: r.team,
    link: r.link,
    createdAt: r.created_at,
    athleteKey: `${r.athlete_kind}:${r.athlete_ref_id}`,
    athleteLabel: r.athlete_label,
  })) as ParticulierContentItem[];

  return <ContenusParticulierView items={items} athletes={athletes} initialSportif={sportif || null} />;
}
