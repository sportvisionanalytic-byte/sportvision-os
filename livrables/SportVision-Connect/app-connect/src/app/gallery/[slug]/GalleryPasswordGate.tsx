"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fetchGalleryPhotos, fetchGalleryProducts, openGallery, type GalleryHeader, type GalleryPhoto } from "@/lib/gallery/data";
import type { GalleryProduct } from "@/lib/gallery/pricing";
import { GalleryView } from "./GalleryView";

// Galerie protégée par mot de passe (§10 du socle). Le mot de passe n'est jamais mis dans l'URL :
// il vivrait alors dans l'historique du navigateur, dans les aperçus de lien et dans tout partage
// ultérieur — c'est-à-dire partout sauf là où il devrait être. Il reste en mémoire de l'onglet et
// accompagne chaque appel de pagination.
export function GalleryPasswordGate({ slug, token }: { slug: string; token: string }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState<{
    header: GalleryHeader;
    photos: GalleryPhoto[];
    total: number;
    products: GalleryProduct[];
  } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim()) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const result = await openGallery(supabase, slug, token, password);
    if (!result.ok) {
      setError(
        result.raison === "mot_de_passe_invalide" || result.raison === "mot_de_passe"
          ? "Mot de passe incorrect."
          : "Cette galerie n'est plus disponible.",
      );
      setBusy(false);
      return;
    }
    const [page, products] = await Promise.all([
      fetchGalleryPhotos(supabase, slug, token, { password, limit: 60 }),
      fetchGalleryProducts(supabase, slug, token, password),
    ]);
    setUnlocked({ header: result.header, photos: page.photos, total: page.total || result.header.photoCount, products });
    setBusy(false);
  }

  if (unlocked) {
    return (
      <GalleryView
        slug={slug}
        token={token}
        password={password}
        header={unlocked.header}
        initialPhotos={unlocked.photos}
        initialTotal={unlocked.total}
        initialProducts={unlocked.products}
      />
    );
  }

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center bg-bg px-6 text-text"
      style={{
        backgroundImage:
          "radial-gradient(820px 560px at 50% -12%, rgba(168,85,247,.2), transparent 70%), radial-gradient(620px 460px at 0% 100%, rgba(34,211,238,.08), transparent 70%)",
      }}
    >
      <div className="flex items-baseline gap-1.5">
        <span className="font-sora text-[15px] font-bold tracking-tight">SportVision</span>
        <span className="bg-sv-gradient bg-clip-text text-[10px] font-medium uppercase tracking-[.16em] text-transparent">
          Galerie
        </span>
      </div>
      <h1 className="mt-6 font-sora text-[21px] font-extrabold tracking-tight">Galerie protégée</h1>
      <p className="mt-2 max-w-[340px] text-center text-[13px] leading-relaxed text-text-tertiary">
        Saisissez le mot de passe transmis par votre club pour accéder aux photos.
      </p>

      <form onSubmit={submit} className="mt-6 w-full max-w-[340px]">
        <label htmlFor="gallery-password" className="sr-only">
          Mot de passe de la galerie
        </label>
        <input
          id="gallery-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          autoComplete="off"
          className="w-full rounded-sv border border-border-strong bg-surface px-4 py-3 text-[14px] outline-none focus:border-white/35"
          placeholder="Mot de passe"
        />
        {error && <p className="mt-2 text-[12.5px] font-semibold text-danger">{error}</p>}
        <button
          type="submit"
          disabled={busy || !password.trim()}
          className="mt-3 w-full rounded-sv-pill bg-sv-gradient py-3 text-[14px] font-bold text-white disabled:opacity-50"
        >
          {busy ? "Vérification…" : "Voir les photos"}
        </button>
      </form>
    </div>
  );
}
