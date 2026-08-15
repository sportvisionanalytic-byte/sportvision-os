import { createClient } from "@/lib/supabase/server";
import { resolveDisplayIdentity, buildPlayerContext, requireParticulierAccount } from "@/lib/supabase/session";
import { fetchMyAthletes, toNavItems } from "@/lib/supabase/particulier";
import { ParticularShell } from "@/components/layout/ParticularShell";
import { ContenusParticulierView, type ParticulierContentItem } from "./ContenusParticulierView";

// Mes contenus (Espace particulier) — voir design-connect-personnel-12-08/README.md § Listes
// multi-sportifs. Backend : connect_list_contents_for_athletes() (migration-connect-v51 §7),
// SECURITY DEFINER — vérifie le droit "voir" pour chaque sportif lié avant de lire club_media
// (RLS ne le permettrait pas directement à un particulier, cf. commentaire de tête de la RPC).
// Les profils gérés n'ont aucun contenu en V1 (aucun club réel associé, voir §2 de la migration).
export default async function ContenusParticulierPage({
  searchParams,
}: {
  searchParams: Promise<{ sportif?: string }>;
}) {
  const { sportif } = await searchParams;
  const supabase = await createClient();
  const { user } = await requireParticulierAccount(supabase);

  // player, athletes et l'appel RPC contenus sont indépendants (connect_list_contents_for_
  // athletes résout lui-même la liste de sportifs côté serveur) — voir rapport fluidité perçue
  // 15/08.
  const [player, athletes, contentsRes] = await Promise.all([
    buildPlayerContext(supabase, user.id),
    fetchMyAthletes(supabase).catch(() => []),
    supabase.rpc("connect_list_contents_for_athletes"),
  ]);
  const identity = resolveDisplayIdentity(user, player);
  const firstName = identity.firstName || user.email?.split("@")[0] || "";
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

  return (
    <ParticularShell firstName={firstName} athletes={toNavItems(athletes)}>
      <ContenusParticulierView items={items} athletes={athletes} initialSportif={sportif || null} />
    </ParticularShell>
  );
}
