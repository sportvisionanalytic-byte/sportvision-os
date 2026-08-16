"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { runGlobalSearch, type SearchResults, type SearchSpace } from "@/lib/search";
import { SearchResultsList } from "./GlobalSearch";

// Recherche mobile plein écran — voir design-connect-personnel-12-08/README.md § Shell et
// navigation ("Mobile (< 860 px) ... recherche (icône → plein écran)"). Déclenchée par l'icône
// loupe du header mobile (AppShell/ParticularShell), remplace tout l'écran (pas une bottom sheet
// — le README distingue explicitement les deux : la recherche est "plein écran", les autres
// overlays mobiles sont des bottom sheets `sv-sheet`).
export function MobileSearchOverlay({ space, onClose }: { space: SearchSpace; onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
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
    onClose();
    router.push(href);
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg animate-sv-fade">
      <div className="flex flex-none items-center gap-2.5 border-b border-border px-4 py-3.5 pt-[max(14px,env(safe-area-inset-top))]">
        <div className="relative flex-1">
          <span className="material-symbols-rounded pointer-events-none absolute left-3.5 top-1/2 !text-[19px] -translate-y-1/2 text-text-faint" aria-hidden="true">
            search
          </span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher…"
            className="h-11 w-full rounded-sv border border-border-strong bg-surface pl-10 pr-4 font-sans text-[15px] text-text outline-none placeholder:text-text-label focus:border-[#8CA9FF]"
          />
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-11 flex-none items-center justify-center rounded-sv px-3 text-[14px] font-medium text-text-secondary hover:bg-white/5"
        >
          Annuler
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {query.trim().length < 2 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
            <span className="material-symbols-rounded !text-[26px] text-text-faint" aria-hidden="true">search</span>
            <p className="text-[13px] text-text-tertiary">Contenus, prestations, cotisations, équipes, affiliations.</p>
          </div>
        ) : (
          <SearchResultsList loading={loading} results={results} space={space} onSelect={goTo} query={query.trim()} />
        )}
      </div>
    </div>
  );
}
