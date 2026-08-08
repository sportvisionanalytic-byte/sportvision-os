import type { SupabaseClient } from "@supabase/supabase-js";
import type { Sponsor, SponsorLevel, SponsorStatus } from "@/lib/types/sponsors";

// club_sponsors (migration-clubplus-v5.sql) — pas de colonne `status` réelle ni de
// `paymentSchedule`/`contractId`/`signatories` : status dérivé de date_fin, le reste par défaut
// sûr documenté ci-dessous. Pas de table pour SponsorDeliverable/Publication/Operation/Document
// (voir le plan Phase 1) — ces onglets restent vides plutôt que d'inventer une donnée. RLS :
// is_club_member(club_id).

const LEVEL_MAP: Record<string, SponsorLevel> = {
  Or: "or",
  Argent: "argent",
  Bronze: "bronze",
};

interface ClubSponsorRow {
  id: string;
  name: string;
  secteur: string | null;
  niveau: string;
  date_debut: string | null;
  date_fin: string | null;
  montant: number;
}

function deriveStatus(dateFin: string | null): SponsorStatus {
  if (!dateFin) return "active";
  const end = new Date(dateFin).getTime();
  const now = Date.now();
  if (end < now) return "expired";
  if (end - now < 60 * 24 * 60 * 60 * 1000) return "to_renew";
  return "active";
}

export async function fetchClubSponsors(supabase: SupabaseClient, organizationId: string): Promise<Sponsor[]> {
  const { data } = await supabase
    .from("club_sponsors")
    .select("id, name, secteur, niveau, date_debut, date_fin, montant")
    .eq("club_id", organizationId)
    .order("montant", { ascending: false });

  return ((data ?? []) as ClubSponsorRow[]).map((row) => ({
    id: row.id,
    organizationId,
    name: row.name,
    level: LEVEL_MAP[row.niveau] ?? "bronze",
    startsAt: row.date_debut ?? "",
    endsAt: row.date_fin ?? "",
    annualAmount: row.montant,
    paymentSchedule: "annual",
    status: deriveStatus(row.date_fin),
    signatories: [],
    sector: row.secteur ?? undefined,
  }));
}
