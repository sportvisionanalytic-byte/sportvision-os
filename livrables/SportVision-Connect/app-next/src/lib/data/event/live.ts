import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchContenusPubliesAvecStats, sumStat, type ContenuAvecStats } from "@/lib/data/shared/contenu-stats";

// /live — fil du jour + tuiles stats pour une organisation `event` (tournoi Full Communication).
// Plan Tier C § Phase 4. Réutilise directement data/shared/contenu-stats.ts (Phase 5) plutôt que
// dupliquer la logique d'agrégation : fetchContenusPubliesAvecStats(clientId) renvoie déjà tous
// les contenus PUBLIÉS du client lié, enrichis de leurs stats saisies manuellement par le CM
// (portee/engagement/vues, null si jamais saisi — jamais un 0 fabriqué). Ce module ne fait que
// filtrer sur `contenus.date_publication` (colonne `date`, sans heure — migration-contenus.sql)
// pour ne garder que le jour même.
//
// RLS : contenus_client_select et contenu_stats_select étendues à un membre actif d'une
// organisation `event` via `organizations.legacy_client_id` (migration-connect-v23-event-live-
// contenus-access.sql) — sans cette migration, ces deux requêtes renvoient silencieusement zéro
// ligne pour tout événement, RLS obligeant.
//
// « Photos livrées » (4e tuile du design) N'A PAS de source réelle et n'est donc PAS renvoyée par
// ce module — voir live/page.tsx pour l'état honnête affiché à la place. `club_media`/
// `club_creations` (data/club/content.ts, alimente /content) sont scopées `club_id`, sans aucun
// équivalent pour une organisation event ; réutiliser `contenus.type_contenu = 'Photo'`
// compterait des PUBLICATIONS de type photo (posts réseaux sociaux), pas des photos brutes
// livrées — un nombre différent sous le même intitulé, ce qui induirait en erreur plutôt que
// d'informer. Documenté aussi dans live/page.tsx.

export interface LiveStats {
  publicationsSorties: number;
  /** Somme des `portee` saisies manuellement sur les contenus publiés aujourd'hui. `null` si
   * aucune stat saisie pour aucun d'entre eux — à afficher "—", jamais 0. */
  porteeDuJour: number | null;
  interactionsDuJour: number | null;
}

export interface LiveDuJour {
  items: ContenuAvecStats[];
  stats: LiveStats;
}

function todayISODate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function fetchLiveDuJour(supabase: SupabaseClient, clientId: string): Promise<LiveDuJour> {
  const publies = await fetchContenusPubliesAvecStats(supabase, clientId);
  const today = todayISODate();
  const items = publies.filter((c) => c.datePublication === today);
  return {
    items,
    stats: {
      publicationsSorties: items.length,
      porteeDuJour: sumStat(items, "portee"),
      interactionsDuJour: sumStat(items, "engagement"),
    },
  };
}
