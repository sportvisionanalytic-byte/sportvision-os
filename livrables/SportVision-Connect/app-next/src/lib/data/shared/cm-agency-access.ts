import type { SupabaseClient } from "@supabase/supabase-js";

// `cm_agency_club_access` (migration-cm-agency-club-access.sql, Tier C Phase 3, 10/08/2026) —
// périmètre qu'un club délègue à une agence CM externe (organizations.organization_type=
// 'cm_agency'), remplace le mock `delegatedAccessByCmOrg` (src/lib/mock/persona.ts) pour la
// branche « Mes accès délégués » de /accompagnement. RLS : lecture par les membres actifs de
// l'agence (is_org_member(cm_agency_org_id)) ou du club concerné (is_org_member(club_id)), ou le
// staff — jamais d'écriture côté Connect (réservée au staff via l'écran OS dédié,
// SportVision-OS-Full.html, fonction _cmAgencyAccessView), cette page reste donc en lecture seule
// ici, cohérent avec le reste de l'écosystème (staff délègue, l'agence consulte son périmètre).

export interface DelegatedClubAccess {
  id: string;
  clubId: string;
  clubName: string;
  allowed: string[];
  denied: string[];
  /** null = pas de date d'expiration renseignée par le staff. */
  expiresAt: string | null;
}

interface CmAgencyClubAccessRow {
  id: string;
  club_id: string;
  allowed: string[] | null;
  denied: string[] | null;
  expires_at: string | null;
  clubs: { nom: string } | null;
}

export async function fetchDelegatedClubAccess(
  supabase: SupabaseClient,
  cmAgencyOrgId: string,
): Promise<DelegatedClubAccess[]> {
  const { data, error } = await supabase
    .from("cm_agency_club_access")
    .select("id, club_id, allowed, denied, expires_at, clubs(nom)")
    .eq("cm_agency_org_id", cmAgencyOrgId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as CmAgencyClubAccessRow[]).map((row) => ({
    id: row.id,
    clubId: row.club_id,
    clubName: row.clubs?.nom ?? "Club",
    allowed: row.allowed ?? [],
    denied: row.denied ?? [],
    expiresAt: row.expires_at,
  }));
}
