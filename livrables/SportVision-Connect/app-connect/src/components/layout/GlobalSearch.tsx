"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { runGlobalSearch, hasAnyResult, SEARCH_CATEGORIES, type SearchResults, type SearchSpace } from "@/lib/search";

// Recherche globale desktop — voir design-connect-personnel-12-08/README.md § Shell et
// navigation ("recherche globale (max 420 px)"). Champ inline dans la topbar + panneau de
// résultats groupés par catégorie ancré sous le champ. Debounce 260 ms (évite un appel RPC à
// chaque frappe), requête ignorée sous 2 caractères (voir connect_global_search, même seuil côté
// serveur).
//
// Version plein écran mobile : MobileSearchOverlay.tsx (composant séparé, déclenché par l'icône
// loupe du header mobile — README § Mobile : "recherche (icône → plein écran)"). Ce fichier reste
// desktop-only (masqué par le parent sous 1024 px), pour ne pas dupliquer visuellement le champ.
export function GlobalSearch({ space }: { space: SearchSpace }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => {
      const supabase = createClient();
      runGlobalSearch(supabase, trimmed, space)
        .then((r) => setResults(r))
        .catch(() => setResults(null))
        .finally(() => setLoading(false));
    }, 260);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, space]);

  function goTo(href: string) {
    setOpen(false);
    setQuery("");
    setResults(null);
    router.push(href);
  }

  const showPanel = open && query.trim().length >= 2;

  return (
    <div ref={rootRef} className="relative hidden w-full max-w-[420px] lg:block">
      <div className="relative">
        <span className="material-symbols-rounded pointer-events-none absolute left-3.5 top-1/2 !text-[19px] -translate-y-1/2 text-text-faint" aria-hidden="true">
          search
        </span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder="Rechercher un contenu, une prestation…"
          className="h-11 w-full rounded-sv border border-border-strong bg-surface pl-10 pr-4 font-sans text-[16px] text-text outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-text-label focus:border-[#8CA9FF] focus:shadow-[0_0_0_3px_rgba(79,125,255,.28)]"
        />
      </div>

      {showPanel && (
        <div className="absolute left-0 top-[calc(100%+8px)] z-50 max-h-[70vh] w-full min-w-[360px] overflow-y-auto rounded-sv-card border border-border bg-bg-elevated p-2 shadow-[0_30px_70px_-20px_rgba(0,0,0,.75)] animate-sv-in">
          <SearchResultsList loading={loading} results={results} space={space} onSelect={goTo} query={query.trim()} />
        </div>
      )}
    </div>
  );
}

// Corps de la liste des résultats — partagé entre GlobalSearch (desktop) et MobileSearchOverlay
// (plein écran mobile), pour ne jamais faire diverger le rendu des deux formats.
export function SearchResultsList({
  loading,
  results,
  space,
  query,
  onSelect,
}: {
  loading: boolean;
  results: SearchResults | null;
  space: SearchSpace;
  query: string;
  onSelect: (href: string) => void;
}) {
  if (loading && !results) {
    return (
      <div className="flex flex-col gap-2 p-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-[52px] animate-pulse rounded-sv bg-white/[.05]" style={{ animationDelay: `${i * 100}ms` }} />
        ))}
      </div>
    );
  }

  if (!results || !hasAnyResult(results)) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
        <span className="material-symbols-rounded !text-[26px] text-text-faint" aria-hidden="true">search_off</span>
        <p className="text-[14px] text-text-tertiary lg:text-[13px]">
          Aucun résultat pour « {query} ».
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {SEARCH_CATEGORIES.map((cat) => {
        const items = results[cat.key];
        if (!items || items.length === 0) return null;
        return (
          <div key={cat.key} className="flex flex-col gap-1">
            <span className="px-2.5 pb-0.5 text-[10px] font-semibold uppercase tracking-[.1em] text-text-faint">{cat.label}</span>
            {items.map((item) => (
              <button
                key={`${cat.key}-${item.id}`}
                type="button"
                onClick={() => onSelect(cat.hrefFor(space, item.id))}
                className="flex items-center gap-3 rounded-sv px-2.5 py-2.5 text-left hover:bg-white/[.05]"
              >
                <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full" style={{ background: cat.bg, color: cat.fg }}>
                  <span className="material-symbols-rounded !text-[16px]" aria-hidden="true">{cat.icon}</span>
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[14px] font-medium text-text lg:text-[13.5px]">{item.title}</span>
                  {item.subtitle && <span className="truncate text-[12px] text-text-tertiary">{item.subtitle}</span>}
                </span>
                <span className="material-symbols-rounded !text-[17px] text-text-faint" aria-hidden="true">chevron_right</span>
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
