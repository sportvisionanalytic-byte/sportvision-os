// La composition d'un match (v242, 21/09/2026).
//
// Fouka : « s'il y a un match à venir, qu'il puisse mettre la composition en avance. Les joueurs
// ne doivent pas la voir, mais moi, community manager, je dois pouvoir voir la composition ou
// alors les 14 convoqués. »
//
// La discrétion n'est pas assurée ici : elle l'est par la RLS de match_convocations, qu'un joueur
// et un parent n'atteignent par aucun chemin. Ce fichier ne fait que relayer — s'il venait à
// oublier un filtre, la base refuserait quand même.

import type { SupabaseClient } from "@supabase/supabase-js";

export type RoleConvocation = "titulaire" | "remplacant" | "reserve";

export interface JoueurConvoque {
  playerId: string;
  prenom: string;
  nom: string;
  role: RoleConvocation;
  poste?: string;
  ordre: number;
}

export interface EntreeComposition {
  player_id: string;
  role: RoleConvocation;
  poste?: string;
  ordre: number;
}

export async function fetchComposition(supabase: SupabaseClient, matchId: string): Promise<JoueurConvoque[]> {
  const { data, error } = await supabase.rpc("match_composition", { p_match_id: matchId });
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).map((l) => ({
    playerId: String(l.player_id),
    prenom: (l.prenom as string) ?? "",
    nom: (l.nom as string) ?? "",
    role: ((l.role as string) ?? "titulaire") as RoleConvocation,
    poste: (l.poste as string) ?? undefined,
    ordre: Number(l.ordre ?? 0),
  }));
}

/** Enregistre le groupe entier. Envoyer une liste vide efface la composition, et c'est voulu :
 *  un coach qui décoche tout revient sur sa décision. */
export async function enregistrerComposition(
  supabase: SupabaseClient,
  matchId: string,
  groupe: EntreeComposition[],
): Promise<void> {
  const { error } = await supabase.rpc("match_composer", { p_match_id: matchId, p_groupe: groupe });
  if (error) throw error;
}

export interface CompteConvocations {
  titulaires: number;
  remplacants: number;
  total: number;
}

/** Un compte par match pour tout le club, en une requête : l'écran affiche une pastille par
 *  match, et interroger chaque match séparément ferait une requête par ligne de liste. */
export async function fetchComptesConvocations(
  supabase: SupabaseClient,
  clubId: string,
): Promise<Map<string, CompteConvocations>> {
  const { data, error } = await supabase.rpc("matchs_convocations_compte", { p_club_id: clubId });
  if (error) throw error;
  const carte = new Map<string, CompteConvocations>();
  for (const l of (data ?? []) as Array<Record<string, unknown>>) {
    carte.set(String(l.match_id), {
      titulaires: Number(l.titulaires ?? 0),
      remplacants: Number(l.remplacants ?? 0),
      total: Number(l.total ?? 0),
    });
  }
  return carte;
}
