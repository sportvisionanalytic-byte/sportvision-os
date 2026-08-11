import type { SupabaseClient } from "@supabase/supabase-js";
import type { Sponsor, SponsorLevel, SponsorStatus } from "@/lib/types/sponsors";
import { parseSponsorCommitments } from "@/lib/data/shared/sponsor-commitments";

// club_sponsors filtré par sponsor_organization_id (migration-connect-v4-sponsor.sql) — un
// sponsor peut sponsoriser plusieurs clubs : traité comme une LISTE de partenariats, jamais une
// fiche unique (voir app/modules/sponsor-espace.js, commentaire d'architecture). `name` du
// design est ici réutilisé pour porter le nom du CLUB partenaire (pas le nom du sponsor
// lui-même, redondant depuis son propre espace). RLS : csp_sponsor_org_select
// (is_org_member(sponsor_organization_id)), lecture seule — c'est le club/staff qui gère la
// fiche, jamais le sponsor.

const LEVEL_MAP: Record<string, SponsorLevel> = {
  Or: "or",
  Argent: "argent",
  Bronze: "bronze",
};

interface SponsorshipRow {
  id: string;
  niveau: string;
  date_debut: string | null;
  date_fin: string | null;
  montant: number;
  commitments: unknown;
  clubs: { nom: string } | null;
}

function deriveStatus(dateFin: string | null): SponsorStatus {
  if (!dateFin) return "active";
  const end = new Date(dateFin).getTime();
  const now = Date.now();
  if (end < now) return "expired";
  if (end - now < 60 * 24 * 60 * 60 * 1000) return "to_renew";
  return "active";
}

export async function fetchSponsorPartnerships(supabase: SupabaseClient, sponsorOrganizationId: string): Promise<Sponsor[]> {
  const { data } = await supabase
    .from("club_sponsors")
    .select("id, niveau, date_debut, date_fin, montant, commitments, clubs:club_id(nom)")
    .eq("sponsor_organization_id", sponsorOrganizationId)
    .order("montant", { ascending: false });

  return ((data ?? []) as unknown as SponsorshipRow[]).map((row) => ({
    id: row.id,
    organizationId: sponsorOrganizationId,
    name: row.clubs?.nom ?? "Club partenaire",
    level: LEVEL_MAP[row.niveau] ?? "bronze",
    startsAt: row.date_debut ?? "",
    endsAt: row.date_fin ?? "",
    annualAmount: row.montant,
    paymentSchedule: null,
    status: deriveStatus(row.date_fin),
    signatories: [],
    commitments: parseSponsorCommitments(row.commitments),
  }));
}
