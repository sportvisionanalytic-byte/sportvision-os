"use client";

/* eslint-disable @next/next/no-img-element */
// <img> et non next/image, pour la même raison que dans la galerie : les aperçus sont déjà générés
// à la bonne taille au dépôt et servis par le CDN. Voir GalleryView.tsx.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { fetchOrderChoices, submitOrderSelection, type SelectionRefus } from "@/lib/gallery/data";
import type { GalleryPhoto } from "@/lib/gallery/data";

// Choix des photos APRÈS paiement — l'écran d'un acheteur de pack.
//
// Pourquoi après et pas avant : faire construire son prix photo par photo pousse à la capture
// d'écran plutôt qu'à l'achat, et fait payer plus cher celui qui aime le plus de photos. Le client
// paie donc un accès (« 5 photos au choix »), puis choisit tranquillement.
//
// Le choix est DÉFINITIF, et l'écran le dit avant, pas après. Ce n'est pas une limite technique :
// pouvoir rechanger ses 5 photos indéfiniment reviendrait à obtenir la galerie entière au prix
// d'un pack. Mieux vaut l'annoncer clairement que de le découvrir au moment de valider.
//
// Rien n'est vérifié ici : le quota et l'appartenance des photos à l'album sont revalidés en base
// par media_gallery_order_select. Ce qui est compté à l'écran ne sert qu'à guider la main.

const PAGE_SIZE = 200;

const REFUS: Record<SelectionRefus, string> = {
  introuvable: "Ce lien n'est plus valide. Vérifiez l'adresse reçue par e-mail.",
  non_payee: "Votre paiement n'est pas encore confirmé. Réessayez dans un instant.",
  sans_objet: "Cette commande ne demande aucun choix de photos.",
  deja_choisie: "Vos photos ont déjà été choisies pour cette commande.",
  aucune_photo: "Aucune des photos retenues n'est disponible. Réessayez.",
  trop_de_photos: "Vous avez sélectionné plus de photos que votre formule n'en couvre.",
};

export function OrderSelect({
  token,
  allowance,
  albumTitre,
}: {
  token: string;
  allowance: number;
  albumTitre: string | null;
}) {
  const router = useRouter();
  const [photos, setPhotos] = useState<GalleryPhoto[]>([]);
  const [total, setTotal] = useState(0);
  const [chargement, setChargement] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [apercu, setApercu] = useState<number | null>(null);
  const [confirmation, setConfirmation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let vivant = true;
    void (async () => {
      const page = await fetchOrderChoices(createClient(), token, { limit: PAGE_SIZE });
      if (!vivant) return;
      setPhotos(page.photos);
      setTotal(page.total);
      setChargement(false);
    })();
    return () => {
      vivant = false;
    };
  }, [token]);

  const loadMore = useCallback(async () => {
    if (chargement || photos.length === 0 || photos.length >= total) return;
    const page = await fetchOrderChoices(createClient(), token, {
      limit: PAGE_SIZE,
      offset: photos.length,
    });
    setPhotos((prev) => {
      const seen = new Set(prev.map((p) => p.id));
      return [...prev, ...page.photos.filter((p) => !seen.has(p.id))];
    });
  }, [chargement, photos.length, total, token]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: "800px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore]);

  const complet = selected.length >= allowance;

  function toggle(id: string) {
    setError(null);
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      // On bloque à la source plutôt que de refuser à la validation : découvrir qu'on a coché
      // 8 photos pour un pack de 5 après avoir tout parcouru est la pire des façons de l'apprendre.
      if (prev.length >= allowance) return prev;
      return [...prev, id];
    });
  }

  async function valider() {
    if (busy || selected.length === 0) return;
    setBusy(true);
    setError(null);
    const result = await submitOrderSelection(createClient(), token, selected);
    if (!result.ok) {
      setError(REFUS[result.raison]);
      setBusy(false);
      setConfirmation(false);
      return;
    }
    // On relit la commande côté serveur plutôt que de basculer un état local : l'écran suivant
    // affiche des boutons de téléchargement, et ceux-là doivent refléter ce que la base a
    // réellement enregistré, pas ce que le navigateur croit avoir envoyé.
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-bg pb-28 text-text">
      <header className="mx-auto max-w-[1180px] px-5 pt-7 sm:px-6">
        <div className="flex items-baseline gap-1.5">
          <span className="font-sora text-[13px] font-bold tracking-tight">SportVision</span>
          <span className="bg-sv-gradient bg-clip-text text-[9px] font-medium uppercase tracking-[.16em] text-transparent">
            Galerie
          </span>
        </div>

        <h1 className="mt-5 font-sora text-[24px] font-extrabold leading-tight tracking-tight sm:text-[30px]">
          Choisissez vos {allowance} photo{allowance > 1 ? "s" : ""}
        </h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-text-tertiary">
          Votre paiement est confirmé{albumTitre ? ` pour ${albumTitre}` : ""}. Sélectionnez les photos que
          vous souhaitez recevoir en pleine qualité, sans filigrane.
        </p>
        <p className="mt-1 text-[12.5px] font-semibold text-attente">
          Ce choix est définitif : prenez le temps de tout regarder avant de valider.
        </p>
      </header>

      <main className="mx-auto max-w-[1180px] px-4 sm:px-6">
        {error && (
          <p className="mt-5 rounded-sv border border-danger-border bg-danger-bg px-3.5 py-3 text-[12.5px] font-semibold text-danger">
            {error}
          </p>
        )}

        {chargement ? (
          <p className="py-16 text-center text-[13px] text-text-faint">Chargement de vos photos…</p>
        ) : photos.length === 0 ? (
          <div className="mt-6 rounded-sv-card border border-border bg-surface px-6 py-14 text-center">
            <h2 className="font-sora text-[17px] font-bold">Aucune photo à choisir</h2>
            <p className="mx-auto mt-2 max-w-[400px] text-[13px] leading-relaxed text-text-tertiary">
              Vos photos ont peut-être déjà été choisies. Rechargez cette page, ou écrivez-nous à
              contact@sportvision-an.fr.
            </p>
          </div>
        ) : (
          <>
            <div className="mt-6 columns-2 gap-2 sm:columns-3 sm:gap-3 lg:columns-4">
              {photos.map((photo, index) => {
                const coche = selected.includes(photo.id);
                const ratio = photo.width && photo.height ? `${photo.width} / ${photo.height}` : "4 / 3";
                return (
                  <div key={photo.id} className="relative mb-2 break-inside-avoid sm:mb-3">
                    <button
                      onClick={() => setApercu(index)}
                      aria-label={`Agrandir la photo ${index + 1}`}
                      className="block w-full overflow-hidden rounded-sv focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                    >
                      <img
                        src={photo.thumbUrl}
                        alt=""
                        loading={index < 8 ? "eager" : "lazy"}
                        decoding="async"
                        style={{ aspectRatio: ratio }}
                        className={`w-full bg-surface object-cover transition duration-200 ${
                          coche ? "brightness-[.72]" : complet ? "opacity-60" : "hover:brightness-110"
                        }`}
                      />
                    </button>
                    {!coche && (
                      <div
                        aria-hidden
                        className="pointer-events-none absolute right-0 top-0 h-16 w-16 rounded-bl-[40px] rounded-tr-sv bg-gradient-to-bl from-black/55 to-transparent"
                      />
                    )}
                    <button
                      onClick={() => toggle(photo.id)}
                      aria-pressed={coche}
                      disabled={!coche && complet}
                      aria-label={coche ? "Retirer de mon choix" : "Choisir cette photo"}
                      className={`absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full text-[15px] font-bold leading-none transition ${
                        coche
                          ? "bg-sv-gradient text-white shadow-[0_2px_10px_rgba(0,0,0,.45)]"
                          : "border-[1.5px] border-white/80 text-white/80 hover:bg-white/20 disabled:opacity-35"
                      }`}
                    >
                      ✓
                    </button>
                  </div>
                );
              })}
            </div>
            <div ref={sentinelRef} className="h-10" />
          </>
        )}
      </main>

      {/* Barre de progression du choix : toujours visible, y compris à zéro photo cochée, pour que
          le quota soit une information et pas une surprise. */}
      {photos.length > 0 && apercu === null && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border-strong bg-bg-elevated/95 backdrop-blur">
          <div className="mx-auto flex max-w-[1180px] items-center justify-between gap-3 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
            <div className="min-w-0">
              <div className="text-[13.5px] font-bold">
                {selected.length} / {allowance} photo{allowance > 1 ? "s" : ""} choisie{selected.length > 1 ? "s" : ""}
              </div>
              <div className="text-[12px] text-text-tertiary">
                {complet
                  ? "Votre choix est complet."
                  : `Encore ${allowance - selected.length} à choisir parmi ${total}.`}
              </div>
            </div>
            <button
              onClick={() => setConfirmation(true)}
              disabled={selected.length === 0}
              className="flex-none rounded-sv-pill bg-sv-gradient px-5 py-2.5 text-[13.5px] font-bold text-white disabled:opacity-40"
            >
              Valider mon choix
            </button>
          </div>
        </div>
      )}

      {/* Confirmation explicite : le choix ne se défait pas, il ne doit pas partir sur un appui
          malencontreux à côté du pouce. */}
      {confirmation && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60" onClick={() => setConfirmation(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Confirmer mon choix"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[520px] rounded-t-sv-card border-t border-border-strong bg-bg-elevated px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5"
          >
            <h2 className="font-sora text-[17px] font-extrabold tracking-tight">
              Valider ces {selected.length} photo{selected.length > 1 ? "s" : ""} ?
            </h2>
            <p className="mt-2 text-[13px] leading-relaxed text-text-tertiary">
              {selected.length < allowance
                ? `Votre formule en couvre ${allowance}. Vous en avez choisi ${selected.length} : les ${allowance - selected.length} restantes seront perdues, le choix ne peut pas être repris.`
                : "Ce choix est définitif et ne pourra plus être modifié."}
            </p>

            <button
              onClick={valider}
              disabled={busy}
              className="mt-4 w-full rounded-sv-pill bg-sv-gradient py-3.5 text-[14.5px] font-bold text-white disabled:opacity-50"
            >
              {busy ? "Enregistrement…" : "Confirmer mon choix"}
            </button>
            <button
              onClick={() => setConfirmation(false)}
              className="mt-3 w-full py-2 text-[12.5px] text-text-faint underline underline-offset-2"
            >
              Revenir à ma sélection
            </button>
          </div>
        </div>
      )}

      {apercu !== null && photos[apercu] && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Photo ${apercu + 1} sur ${total}`}
          className="fixed inset-0 z-50 flex flex-col bg-black/95"
        >
          <div className="flex flex-none items-center justify-between px-4 py-3 text-white">
            <span className="text-[12.5px] tabular-nums text-white/70">
              {apercu + 1} / {photos.length}
            </span>
            <button
              onClick={() => setApercu(null)}
              aria-label="Fermer"
              className="rounded-full px-3 py-1.5 text-[20px] leading-none hover:bg-white/10"
            >
              ✕
            </button>
          </div>
          <div className="flex flex-1 items-center justify-center overflow-hidden px-2">
            <img src={photos[apercu]!.previewUrl} alt="" className="max-h-full max-w-full object-contain" />
          </div>
          <div className="flex-none px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <button
              onClick={() => toggle(photos[apercu]!.id)}
              disabled={!selected.includes(photos[apercu]!.id) && complet}
              className={`w-full rounded-sv-pill py-3 text-[14px] font-bold transition disabled:opacity-40 ${
                selected.includes(photos[apercu]!.id)
                  ? "border border-border-strong bg-surface text-text"
                  : "bg-sv-gradient text-white"
              }`}
            >
              {selected.includes(photos[apercu]!.id)
                ? "Retirer de mon choix"
                : complet
                  ? `Votre choix est complet (${allowance})`
                  : "Choisir cette photo"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
