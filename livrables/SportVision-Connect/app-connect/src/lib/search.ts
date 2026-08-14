import type { SupabaseClient } from "@supabase/supabase-js";

// Recherche globale — voir design-connect-personnel-12-08/README.md § Écrans → "Recherche
// (contenus, prestations, cotisations, équipes, affiliations — jamais de données Club+)" et
// MASTER-CONNECT-V1.md §30. Backend : RPC `connect_global_search` (SECURITY DEFINER, migration-
// connect-v52-topbar-notifications-recherche.sql §5) — le frontend ne fait jamais de select brut
// sur club_media/prestations/etc., toute la logique d'autorisation vit côté serveur.
//
// `space` distingue Espace joueur / Espace particulier : équipes et affiliations n'existent que
// côté joueur (absentes de la nav ParticularShell — voir ParticularShell.tsx), donc la RPC ne les
// renvoie pas pour 'particulier'. Les routes de destination sont construites ICI, côté frontend,
// PAS renvoyées par la RPC : chaque shell connaît déjà son propre préfixe de route
// (`/…` pour AppShell, `/particulier/…` pour ParticularShell), pas besoin de dupliquer cette
// logique côté serveur (contrairement aux notifications, où le href est fixé au moment de
// l'insertion en base et doit donc être résolu côté serveur une fois pour toutes).
export type SearchSpace = "joueur" | "particulier";

export interface SearchResultItem {
  id: string;
  title: string;
  subtitle: string;
}

export interface SearchResults {
  contenus: SearchResultItem[];
  prestations: SearchResultItem[];
  cotisations: SearchResultItem[];
  equipes: SearchResultItem[];
  affiliations: SearchResultItem[];
}

const EMPTY_RESULTS: SearchResults = { contenus: [], prestations: [], cotisations: [], equipes: [], affiliations: [] };

export interface SearchCategoryConfig {
  key: keyof SearchResults;
  label: string;
  icon: string;
  fg: string;
  bg: string;
  hrefFor: (space: SearchSpace, id: string) => string;
}

// Icônes/couleurs réutilisent les tokens "une couleur par pilier" déjà définis
// (tailwind.config.ts) — cohérent avec le reste de l'app (badges, cartes).
export const SEARCH_CATEGORIES: SearchCategoryConfig[] = [
  {
    key: "prestations",
    label: "Prestations",
    icon: "camera_alt",
    fg: "#8CA9FF",
    bg: "rgba(79,125,255,.16)",
    hrefFor: (space, id) => (space === "particulier" ? `/particulier/commandes/${id}` : `/commandes/${id}`),
  },
  {
    key: "cotisations",
    label: "Cotisations",
    icon: "savings",
    fg: "#F472B6",
    bg: "rgba(244,114,182,.14)",
    hrefFor: (space, id) => (space === "particulier" ? `/particulier/cotisations/${id}` : `/cotisations/${id}`),
  },
  {
    key: "contenus",
    label: "Contenus",
    icon: "photo_library",
    fg: "#C084FC",
    bg: "rgba(168,85,247,.16)",
    // Pas de deep-link par item (galerie sans route par id, vérifié le 14/08) — renvoie vers la
    // page du module, pas une fausse destination précise.
    hrefFor: (space) => (space === "particulier" ? "/particulier/contenus" : "/contenus"),
  },
  {
    key: "equipes",
    label: "Équipes",
    icon: "groups",
    fg: "#22D3EE",
    bg: "rgba(34,211,238,.14)",
    hrefFor: (_space, id) => `/equipes/${id}`,
  },
  {
    key: "affiliations",
    label: "Affiliations",
    icon: "shield",
    fg: "#22D3EE",
    bg: "rgba(34,211,238,.14)",
    hrefFor: () => "/affiliations",
  },
];

export async function runGlobalSearch(supabase: SupabaseClient, query: string, space: SearchSpace): Promise<SearchResults> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return EMPTY_RESULTS;

  const { data, error } = await supabase.rpc("connect_global_search", { p_query: trimmed, p_space: space });
  if (error) throw error;

  return {
    contenus: (data?.contenus ?? []) as SearchResultItem[],
    prestations: (data?.prestations ?? []) as SearchResultItem[],
    cotisations: (data?.cotisations ?? []) as SearchResultItem[],
    equipes: (data?.equipes ?? []) as SearchResultItem[],
    affiliations: (data?.affiliations ?? []) as SearchResultItem[],
  };
}

export function hasAnyResult(results: SearchResults): boolean {
  return Object.values(results).some((arr) => arr.length > 0);
}
