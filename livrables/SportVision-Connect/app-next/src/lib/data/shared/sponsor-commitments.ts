import type { SponsorCommitment } from "@/lib/types/sponsors";

// Parsing partagé de club_sponsors.commitments (jsonb, migration-clubplus-v5.sql) — utilisé côté
// club (data/club/sponsors.ts, lecture + écriture) et côté partenaire (data/sponsor/sponsorships.ts,
// lecture seule, RLS csp_sponsor_org_select). Colonne vide pour tous les sponsors réels au
// 11/08/2026 : tolérant à un contenu vide/malformé, ne fabrique jamais une contrepartie — retombe
// sur [] plutôt que de planter l'écran.
export function parseSponsorCommitments(raw: unknown): SponsorCommitment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => ({
      id: typeof item.id === "string" && item.id ? item.id : `commitment-${Date.now()}-${Math.round(Math.random() * 1000)}`,
      label: typeof item.label === "string" ? item.label : "",
      done: item.done === true,
    }))
    .filter((c) => c.label.trim().length > 0);
}
