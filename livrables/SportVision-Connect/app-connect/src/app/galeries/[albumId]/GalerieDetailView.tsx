"use client";

/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { MyGallery, OrderPhoto } from "@/lib/gallery/data";

// Mes photos.
//
// Le téléchargement passe par EXACTEMENT la même fonction que pour un invité : gallery-download,
// qui revérifie le droit et signe une URL de cinq minutes au clic. Connect ne reçoit jamais de
// chemin d'original, et un accès permanent n'est PAS une URL permanente — c'est le droit d'en
// redemander une tant que le droit existe.

export function GalerieDetailView({ galerie, photos }: { galerie: MyGallery; photos: OrderPhoto[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download(assetId: string, filename: string) {
    setBusy(assetId);
    setError(null);
    // On demande le jeton de la commande qui couvre cette photo côté serveur : le navigateur n'a
    // pas à savoir laquelle de ses commandes la contient.
    const { data, error: fnError } = await createClient().functions.invoke("gallery-download", {
      body: { assetId, albumId: galerie.albumId },
    });
    const payload = data as { url?: string; error?: string } | null;
    if (fnError || !payload?.url) {
      setError(payload?.error ?? "Téléchargement momentanément indisponible. Réessayez.");
      setBusy(null);
      return;
    }
    const a = document.createElement("a");
    a.href = payload.url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setBusy(null);
  }

  return (
    <div className="min-h-screen bg-bg pb-16 text-text">
      <header className="mx-auto max-w-[900px] px-5 pt-7 sm:px-6">
        <Link href="/galeries" className="text-[12.5px] text-text-tertiary underline underline-offset-2">
          ← Mes galeries
        </Link>
        <h1 className="mt-4 font-sora text-[24px] font-extrabold leading-tight tracking-tight sm:text-[30px]">
          {galerie.titre}
        </h1>
        <p className="mt-1.5 text-[13px] text-text-tertiary">
          {[galerie.clubNom, galerie.equipe].filter(Boolean).join(" · ")}
          {photos.length > 0 && ` · ${photos.length} photo${photos.length > 1 ? "s" : ""}`}
        </p>
        {!galerie.accesComplet && galerie.albumPhotos > photos.length && (
          <p className="mt-1 text-[12px] text-text-faint">
            Vous possédez {photos.length} des {galerie.albumPhotos} photos de cette galerie.
          </p>
        )}
      </header>

      <main className="mx-auto max-w-[900px] px-5 sm:px-6">
        {error && (
          <p className="mt-5 rounded-sv border border-danger-border bg-danger-bg px-3.5 py-3 text-[12.5px] font-semibold text-danger">
            {error}
          </p>
        )}

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((photo) => (
            <div key={photo.id} className="overflow-hidden rounded-sv border border-border bg-surface">
              <img src={photo.thumbUrl} alt="" loading="lazy" className="aspect-[4/3] w-full object-cover" />
              <button
                onClick={() => download(photo.id, photo.filename)}
                disabled={busy === photo.id}
                className="w-full px-3 py-2.5 text-[12.5px] font-bold disabled:opacity-50"
                style={{ color: "#8CA9FF" }}
              >
                {busy === photo.id ? "Préparation…" : "Télécharger"}
              </button>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
