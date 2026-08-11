import type { SupabaseClient } from "@supabase/supabase-js";
import type { Sponsor, SponsorCommitment, SponsorLevel, SponsorStatus } from "@/lib/types/sponsors";
import { parseSponsorCommitments } from "@/lib/data/shared/sponsor-commitments";

// club_sponsors (migration-clubplus-v5.sql) — pas de colonne `status` réelle ni de
// `paymentSchedule`/`contractId`/`signatories` : status dérivé de date_fin, le reste laissé
// honnêtement absent (`null`/`[]`/`undefined`) plutôt que comblé par une valeur par défaut
// affichée comme un fait (corrigé lors de l'audit du 09/08 — `paymentSchedule: "annual"` en dur
// était affiché comme réel dans /sponsors/:id § Contrat pour TOUT sponsor réel). Pas de table
// pour SponsorDeliverable/Publication/Operation/Document (voir le plan Phase 1) — ces onglets
// restent vides plutôt que d'inventer une donnée. RLS : is_club_member(club_id).
//
// `commitments` (jsonb, colonne réelle) : vide pour tous les sponsors en prod au 11/08/2026,
// contrairement aux champs ci-dessus il n'y a pas de table absente — juste aucune UI d'écriture
// nulle part (ni Connect legacy, ni OS, qui la garde en lecture seule). Lu et écrit ici, voir
// updateSponsorCommitments ci-dessous et l'onglet Contreparties de /sponsors/:id.

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
  commitments: unknown;
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
    .select("id, name, secteur, niveau, date_debut, date_fin, montant, commitments")
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
    paymentSchedule: null,
    status: deriveStatus(row.date_fin),
    signatories: [],
    sector: row.secteur ?? undefined,
    commitments: parseSponsorCommitments(row.commitments),
  }));
}

/** Écrit la liste complète des contreparties (jsonb, remplacement total — pas de RPC dédiée,
 * cohérent avec la taille attendue « une liste courte », voir migration-clubplus-v5.sql
 * commentaire d'en-tête). RLS : csp_member_update (is_club_member). */
export async function updateSponsorCommitments(
  supabase: SupabaseClient,
  sponsorId: string,
  commitments: SponsorCommitment[],
): Promise<void> {
  const { error } = await supabase.from("club_sponsors").update({ commitments }).eq("id", sponsorId);
  if (error) throw error;
}
