"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { GlobalSearch } from "./GlobalSearch";
import { NotificationBell } from "./NotificationBell";
import type { SearchSpace } from "@/lib/search";

// Topbar desktop — voir design-connect-personnel-12-08/README.md § Shell et navigation :
// "Topbar collante (hauteur 76 px avec padding) : recherche globale (max 420 px), notifications
// avec pastille, aide (`?`), avatar. L'aide n'est PAS dans la sidebar — le `?` de la topbar est
// son unique accès." Composant transverse construit UNE fois et appliqué aux deux espaces
// (AppShell.tsx et ParticularShell.tsx) — contrairement au reste du shell (sidebar, bottom nav),
// cloisonné par espace dans les chantiers précédents.
//
// Déplace le `?` : il vivait jusqu'ici en haut de la sidebar (les deux shells, avant cette
// migration) — retiré de la sidebar par ce même chantier pour respecter la règle "unique accès"
// du design, son seul emplacement restant est ici. Le header mobile garde son propre `?` (le
// README ne documente pas de topbar mobile à 76 px — pattern différent, hors périmètre de ce
// changement, voir AppShell.tsx/ParticularShell.tsx § HEADER MOBILE).
//
// Desktop uniquement (masqué par le parent sous 1024 px, `hidden lg:flex`) : la recherche mobile
// est plein écran (MobileSearchOverlay.tsx), la cloche mobile est un bouton séparé dans le header
// compact, le menu profil mobile réutilise le menu de nav existant (avatar → `menuOpen`).
export function Topbar({
  space,
  firstName,
  lastName,
  email,
  profileHref,
}: {
  space: SearchSpace;
  firstName: string;
  lastName?: string;
  email?: string;
  profileHref: string;
}) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/auth/login");
    router.refresh();
  }

  const monogram = (firstName[0] || "?").toUpperCase();
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();

  return (
    <div className="sticky top-0 z-20 hidden h-[76px] flex-none items-center gap-4 border-b border-border bg-bg/90 px-6 backdrop-blur-md lg:flex">
      <GlobalSearch space={space} />

      <div className="ml-auto flex items-center gap-1.5">
        <NotificationBell />

        <Link
          href="/aide"
          aria-label="Aide"
          className="flex h-10 w-10 items-center justify-center rounded-sv text-text-tertiary hover:bg-white/[.06] hover:text-text"
        >
          <span className="material-symbols-rounded !text-[20px]">help</span>
        </Link>

        <div ref={rootRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Menu profil"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-sv-gradient font-sora text-[13px] font-semibold text-white"
          >
            {monogram}
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-[240px] rounded-sv-card border border-border bg-bg-elevated p-2 shadow-[0_30px_70px_-20px_rgba(0,0,0,.75)] animate-sv-in">
              <div className="flex flex-col gap-0.5 px-2.5 py-2">
                <span className="truncate font-sora text-[14px] font-semibold text-text">{fullName || firstName}</span>
                {email && <span className="truncate text-[12px] text-text-tertiary">{email}</span>}
              </div>
              <div className="my-1 h-px bg-border" />
              <Link
                href={profileHref}
                onClick={() => setMenuOpen(false)}
                className="flex h-10 items-center gap-2.5 rounded-sv px-2.5 text-[13.5px] text-text-secondary hover:bg-white/5"
              >
                <span className="material-symbols-rounded !text-[18px]">person</span>
                Mon profil
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                className="flex h-10 w-full items-center gap-2.5 rounded-sv px-2.5 text-left text-[13.5px] text-danger hover:bg-white/5"
              >
                <span className="material-symbols-rounded !text-[18px]">logout</span>
                Se déconnecter
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
