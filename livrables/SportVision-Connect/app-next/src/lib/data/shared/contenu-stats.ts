import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchContenus, type Contenu } from "@/lib/data/shared/contenus";

// `contenu_stats` (migration-cm-contenu-stats.sql, livrables/SportVision-TV/) — Phase 5 du plan
// Tier C : « Saisie manuelle de statistiques (remplace Metricool pour l'instant) ». Décidé avec
// Fouka (10/08) : pas d'intégration Metricool réelle tant que le plan payant + le token ne sont
// pas en place. Une ligne par CONTENU PUBLIÉ (jamais par mois/globalement — changement de
// granularité assumé par rapport à l'ancien formulaire OS qui écrivait 3 chiffres en
// localStorage) : portee/engagement/vues sont nullables et un contenu jamais renseigné n'a AUCUNE
// ligne dans la table — jamais un 0 fabriqué à la place d'une vraie mesure absente.
// saisi_par/saisi_le sont posés côté serveur (trigger), jamais lus depuis ce module. RLS :
// écriture réservée au CM propriétaire du contenu ou au Lead CM ; lecture pour le CM avec accès
// au contenu et pour le client avec accès légitime (même condition que contenus_client_select) —
// jamais d'écriture côté client, ce module ne l'expose donc qu'en lecture.

export interface ContenuStat {
  contenuId: string;
  portee: number | null;
  engagement: number | null;
  vues: number | null;
  /** Toujours posé côté serveur (trigger set_contenu_stats_saisi) — jamais confié au payload client. */
  saisiLe: string | null;
}

interface ContenuStatRow {
  contenu_id: string;
  portee: number | null;
  engagement: number | null;
  vues: number | null;
  saisi_le: string | null;
}

/** Contenu réel (data/shared/contenus.ts) enrichi de ses stats si elles ont été saisies.
 * `stats: null` = jamais renseigné par le CM — à afficher "—" partout, jamais 0. */
export interface ContenuAvecStats extends Contenu {
  stats: ContenuStat | null;
}

export async function fetchContenuStatsByIds(
  supabase: SupabaseClient,
  contenuIds: string[],
): Promise<Map<string, ContenuStat>> {
  const map = new Map<string, ContenuStat>();
  if (contenuIds.length === 0) return map;
  const { data, error } = await supabase
    .from("contenu_stats")
    .select("contenu_id, portee, engagement, vues, saisi_le")
    .in("contenu_id", contenuIds);
  if (error) throw error;
  ((data ?? []) as ContenuStatRow[]).forEach((row) => {
    map.set(row.contenu_id, {
      contenuId: row.contenu_id,
      portee: row.portee,
      engagement: row.engagement,
      vues: row.vues,
      saisiLe: row.saisi_le,
    });
  });
  return map;
}

/** Contenus PUBLIÉS du client, enrichis de leurs stats saisies manuellement (si elles existent) —
 * source unique réutilisée par /analytics, /reports et les colonnes Portée/Interactions de
 * /publications. Un contenu "programme" (pas encore publié) n'a jamais de stats possibles : ce
 * helper les exclut d'emblée. */
export async function fetchContenusPubliesAvecStats(
  supabase: SupabaseClient,
  clientId: string,
): Promise<ContenuAvecStats[]> {
  const all = await fetchContenus(supabase, clientId);
  const publies = all.filter((c) => c.statut === "publie");
  const statsById = await fetchContenuStatsByIds(
    supabase,
    publies.map((c) => c.id),
  );
  return publies.map((c) => ({ ...c, stats: statsById.get(c.id) ?? null }));
}

/**
 * Total agrégé d'un champ de stats sur un ensemble de contenus. Renvoie `null` si AUCUN contenu
 * du lot n'a de valeur saisie pour ce champ — distingue "pas encore mesuré" de "mesuré à zéro",
 * pour ne jamais afficher un 0 comme s'il s'agissait d'une vraie donnée.
 */
export function sumStat(items: ContenuAvecStats[], field: "portee" | "engagement" | "vues"): number | null {
  let total = 0;
  let hasValue = false;
  for (const item of items) {
    const value = item.stats?.[field];
    if (value !== null && value !== undefined) {
      total += value;
      hasValue = true;
    }
  }
  return hasValue ? total : null;
}
