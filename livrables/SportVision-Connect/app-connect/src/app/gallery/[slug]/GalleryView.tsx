"use client";

/* eslint-disable @next/next/no-img-element */
// <img> et non next/image, volontairement : les dérivés sont déjà générés à la bonne taille au
// dépôt (480 px / 1600 px) et servis publiquement par le CDN Supabase. Passer par l'optimiseur de
// Next ferait retransiter chaque vignette par le serveur pour refaire un travail déjà fait, et
// ajouterait une latence à la première ouverture — exactement ce qu'on veut éviter pour un parent
// qui ouvre le lien depuis WhatsApp au bord d'un terrain.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  fetchGalleryPhotos,
  fetchGalleryProducts,
  trackGalleryView,
  type GalleryHeader,
  type GalleryPhoto,
} from "@/lib/gallery/data";
import { GalleryCheckout } from "./GalleryCheckout";
import { OffersSheet } from "./OffersSheet";
import {
  formatPrice,
  isSellable,
  offerSummary,
  quoteFromLadder,
  sellableProducts,
  type CartLine,
  type CartQuote,
  type GalleryProduct,
  type LinkOffer,
  type PriceLadderEntry,
} from "@/lib/gallery/pricing";

const PAGE_SIZE = 60;

// ── Deux parcours, une seule page ────────────────────────────────────────────────────────────
//
// FORMULE (le lien porte une offre) : le visiteur regarde TOUT librement, en aperçus filigranés,
// et achète un accès. Le prix ne bouge pas pendant qu'il navigue. C'est le modèle demandé le
// 07/09 : faire monter le prix photo par photo pousse à la capture d'écran plutôt qu'à l'achat,
// et pénalise justement celui qui aime beaucoup de photos.
//
// CATALOGUE (lien historique, sans offre) : l'ancien panier à la photo, inchangé. Des liens déjà
// envoyés à des familles fonctionnent encore avec ce parcours, on ne le retire pas sous leurs pieds.

export function GalleryView({
  slug,
  token,
  password,
  header,
  initialPhotos,
  initialTotal,
  initialProducts,
  initialLadder,
}: {
  slug: string;
  token: string;
  /** Galerie protégée : le mot de passe accompagne chaque page suivante, et ne transite jamais
   * par l'URL (voir GalleryPasswordGate). */
  password?: string;
  header: GalleryHeader;
  initialPhotos: GalleryPhoto[];
  initialTotal: number;
  initialProducts: GalleryProduct[];
  initialLadder: PriceLadderEntry[];
}) {
  const [photos, setPhotos] = useState<GalleryPhoto[]>(initialPhotos);
  const [total] = useState(initialTotal);
  const [products] = useState<GalleryProduct[]>(initialProducts);
  const [ladder] = useState<PriceLadderEntry[]>(initialLadder);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  // La formule choisie. Tant qu'elle est nulle, la galerie se parcourt librement : on ne fait pas
  // choisir avant d'avoir laissé regarder, c'est en trouvant son enfant qu'on décide d'acheter.
  const [offreChoisie, setOffreChoisie] = useState<LinkOffer | null>(null);
  const [offresOpen, setOffresOpen] = useState(false);
  const [shared, setShared] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const storageKey = `sv-gallery-sel:${header.albumId}`;
  // L'offre du lien commande tout le reste de l'écran. Quand elle existe, la mécanique de panier
  // disparaît entièrement : pas de coche sur les photos, pas de total qui grimpe, pas de sélection
  // à conserver entre deux pages.
  // Le nombre d'offres est libre : la page ne suppose jamais qu'il y en a une, ni trois.
  const offres = header.offres;
  const formule = offres.length > 0;
  const enVente = formule || isSellable(products);
  const vendable = !formule && isSellable(products);
  // Une offre à quota fait passer la galerie en mode sélection ; un album complet non.
  const quota = offreChoisie?.photosAllowance ?? null;
  const enSelection = quota !== null;
  const complet = enSelection && selected.length >= quota;
  const { wholeAlbum } = sellableProducts(products);
  // Ce que la galerie contient VRAIMENT, moins ce que la base a accepté de servir. La différence
  // est calculée sur `photos.length` et non sur la limite annoncée : un album de 8 photos avec une
  // vitrine réglée à 12 ne doit pas afficher « et 4 autres photos » qui n'existent pas.
  const restantes = Math.max(0, header.photoCount - photos.length);
  // Le premier prix PAYANT. Annoncer « à partir de 0 € » parce qu'une photo est offerte laisse
  // croire que toute la galerie est gratuite, et dévalorise les formules payantes juste à côté.
  const payantes = offres.filter((o) => o.priceCents > 0);
  const prixDAppel = payantes.length > 0
    ? `À partir de ${formatPrice(Math.min(...payantes.map((o) => o.priceCents)), payantes[0]!.currency)}`
    : "Offert";

  // §18 : la sélection survit à l'ouverture d'une photo, à un retour arrière et à un rechargement
  // accidentel. sessionStorage et pas de commande en base : un panier non payé n'a rien à faire
  // dans la base de données.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) setSelected(JSON.parse(saved) as string[]);
    } catch {
      /* navigation privée, stockage bloqué : la galerie marche, la sélection ne survit pas. */
    }
  }, [storageKey]);

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(selected));
    } catch {
      /* idem */
    }
  }, [selected, storageKey]);

  // Comptage de vue : un identifiant de session aléatoire, jamais une empreinte d'appareil.
  useEffect(() => {
    let sessionId: string;
    try {
      sessionId = sessionStorage.getItem("sv-gallery-session") ?? "";
      if (!sessionId) {
        sessionId = Math.random().toString(36).slice(2) + Date.now().toString(36);
        sessionStorage.setItem("sv-gallery-session", sessionId);
      }
    } catch {
      sessionId = Math.random().toString(36).slice(2);
    }
    void trackGalleryView(createClient(), slug, token, sessionId);
  }, [slug, token]);

  const loadMore = useCallback(async () => {
    if (loadingMore || photos.length >= total) return;
    setLoadingMore(true);
    const page = await fetchGalleryPhotos(createClient(), slug, token, {
      password,
      limit: PAGE_SIZE,
      offset: photos.length,
    });
    setPhotos((prev) => {
      const seen = new Set(prev.map((p) => p.id));
      return [...prev, ...page.photos.filter((p) => !seen.has(p.id))];
    });
    setLoadingMore(false);
  }, [loadingMore, photos.length, total, slug, token, password]);

  // Chargement progressif : on ne télécharge jamais toute la galerie d'un coup. La sentinelle est
  // déclenchée 800 px avant le bas, pour que la suite arrive avant que le visiteur n'attende.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) void loadMore();
    }, { rootMargin: "800px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore]);

  // On bloque à la source plutôt qu'au moment de payer : découvrir qu'on a coché 18 photos pour
  // une formule qui en couvre 17, après avoir parcouru 500 vignettes, est la pire façon de
  // l'apprendre. Le serveur revérifie de toute façon.
  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (quota !== null && prev.length >= quota) return prev;
      return [...prev, id];
    });
  }, [quota]);

  // Lecture dans la grille pré-calculée par la base, jamais un calcul local : le total affiché
  // est exactement celui qui sera débité.
  const quote = useMemo(
    () => quoteFromLadder(selected.length, ladder, products[0]?.currency ?? "eur"),
    [selected.length, ladder, products],
  );

  // ── Visionneuse ────────────────────────────────────────────────────────
  const closeLightbox = useCallback(() => setLightbox(null), []);
  const step = useCallback(
    (delta: number) =>
      setLightbox((i) => {
        if (i === null) return i;
        const next = i + delta;
        return next < 0 || next >= photos.length ? i : next;
      }),
    [photos.length],
  );

  useEffect(() => {
    if (lightbox === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeLightbox();
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    // Le fond ne doit pas défiler derrière la visionneuse : sur mobile c'est le défaut le plus
    // visible d'une lightbox faite à la va-vite.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [lightbox, closeLightbox, step]);

  // Précharge l'image suivante : sur mobile, c'est ce qui fait la différence entre un défilement
  // fluide et un écran noir d'une demi-seconde à chaque photo.
  useEffect(() => {
    if (lightbox === null) return;
    const next = photos[lightbox + 1];
    if (next) {
      const img = new Image();
      img.src = next.previewUrl;
    }
  }, [lightbox, photos]);

  async function share() {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: header.titre, url });
        return;
      } catch {
        /* partage annulé : on retombe sur la copie */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setShared(true);
      setTimeout(() => setShared(false), 2200);
    } catch {
      /* presse-papier refusé */
    }
  }

  const dateLabel = header.eventDate
    ? new Date(`${header.eventDate}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
    : null;

  return (
    <div className="min-h-screen bg-bg pb-28 text-text">
      {/* ── En-tête ─────────────────────────────────────────────────────── */}
      <header className="relative overflow-hidden">
        {header.coverUrl && (
          <div
            aria-hidden
            className="absolute inset-0 scale-110 bg-cover bg-center opacity-30 blur-[2px]"
            style={{ backgroundImage: `url(${header.coverUrl})` }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-bg/70 via-bg/85 to-bg" aria-hidden />
        <div className="relative mx-auto flex max-w-[1180px] flex-col gap-2.5 px-4 pb-4 pt-4 sm:px-6 sm:pb-7 sm:pt-7">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-baseline gap-1.5">
              <span className="font-sora text-[13px] font-bold tracking-tight">SportVision</span>
              <span className="bg-sv-gradient bg-clip-text text-[9px] font-medium uppercase tracking-[.16em] text-transparent">
                Galerie
              </span>
            </div>
            {/* min-h-[40px] : mesure au doigt plutot qu'a l'oeil. Le bouton faisait 76x32 px, au
                dessus du minimum exige mais en dessous de ce qu'on vise pour une cible tactile.
                La hauteur est portee par min-h et non par du padding, pour que le libelle puisse
                passer a « Lien copie » sans deplacer l'en-tete. */}
            <button
              onClick={share}
              className="flex min-h-[40px] items-center rounded-sv-pill border border-border-strong px-3.5 text-[12px] font-semibold text-text-secondary transition hover:bg-surface-hover"
            >
              {shared ? "Lien copié" : "Partager"}
            </button>
          </div>

          <div>
            {/* Titre volontairement contenu sur mobile : chaque ligne d'en-tête est une ligne de
                photos en moins sur le premier écran, et c'est pour les photos que le parent est
                venu. Les métadonnées tiennent sur une seule ligne. */}
            <h1 className="font-sora text-[21px] font-extrabold leading-tight tracking-tight sm:text-[32px]">
              {header.titre}
            </h1>
            <p className="mt-1 text-[12.5px] leading-snug text-text-tertiary">
              {[header.clubNom, header.equipe, dateLabel, `${header.photoCount} photos`].filter(Boolean).join(" · ")}
            </p>
            {vendable && selected.length === 0 && (
              <p className="mt-0.5 text-[12px] text-text-faint">
                Touchez une photo pour l&apos;agrandir, ✓ pour la sélectionner
              </p>
            )}
            {formule && (
              <p className="mt-0.5 text-[12px] text-text-faint">
                {enSelection
                  ? `Touchez ✓ pour choisir vos photos — ${selected.length} sur ${quota}.`
                  : offreChoisie
                    ? "Toutes les photos de la galerie sont comprises."
                    : "Parcourez toutes les photos librement, puis choisissez votre formule."}
              </p>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1180px] px-4 sm:px-6">
        {photos.length === 0 ? (
          <EmptyState livraisonExterne={header.livraisonExterne} />
        ) : (
          <>
            {/* Colonnes CSS plutôt qu'une grille carrée : les cadrages du photographe sont
                conservés, portraits comme panoramiques. Recadrer tout en carré détruirait
                justement ce pour quoi les parents achètent. */}
            <div className="columns-2 gap-2 sm:columns-3 sm:gap-3 lg:columns-4">
              {photos.map((photo, index) => (
                <PhotoTile
                  key={photo.id}
                  photo={photo}
                  index={index}
                  selected={selected.includes(photo.id)}
                  selectable={vendable || enSelection}
                  disabled={enSelection && complet && !selected.includes(photo.id)}
                  onOpen={() => setLightbox(index)}
                  onToggle={() => toggle(photo.id)}
                />
              ))}
            </div>
            {/* La sentinelle ne sert qu'a declencher la page suivante : sur une galerie deja
                entierement chargee, elle ne laissait qu'un vide sous les photos. */}
            {photos.length < total && <div ref={sentinelRef} className="h-10" />}
            {loadingMore && <p className="pb-6 text-center text-[12.5px] text-text-faint">Chargement…</p>}

            {/* Ce qui n'est pas montré est ANNONCÉ, pas caché. Le nombre restant est l'argument de
                vente : « et 188 autres » vaut mieux qu'une galerie qui a l'air d'en contenir 12.
                Ces photos-là ne sont pas dans la page : la base ne les a pas servies. */}
            {restantes > 0 && (
              <div className="mb-8 rounded-sv-card border border-border-strong bg-surface px-5 py-7 text-center sm:px-8">
                <div className="mx-auto mb-3 flex items-center justify-center gap-1.5" aria-hidden>
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="h-9 w-9 rounded-sv border border-border-strong bg-bg-elevated"
                      style={{ opacity: 1 - i * 0.28 }}
                    />
                  ))}
                </div>
                <h2 className="font-sora text-[17px] font-extrabold tracking-tight sm:text-[19px]">
                  {restantes} autre{restantes > 1 ? "s" : ""} photo{restantes > 1 ? "s" : ""} vous attend
                  {restantes > 1 ? "ent" : ""}
                </h2>
                <p className="mx-auto mt-2 max-w-[420px] text-[13px] leading-relaxed text-text-tertiary">
                  {formule && enVente
                    ? `Vous voyez ${photos.length} photo${photos.length > 1 ? "s" : ""} sur les ${header.photoCount} de cette galerie. Nos formules vous donnent accès aux originaux, en pleine qualité et sans filigrane.`
                    : `Cette galerie contient ${header.photoCount} photos au total.`}
                </p>
                {formule && enVente && (
                  <button
                    onClick={() => (offres.length === 1 ? setOffreChoisie(offres[0]!) : setOffresOpen(true))}
                    className="mt-4 rounded-sv-pill bg-sv-gradient px-7 py-3 text-[14px] font-bold text-white"
                  >
                    {offres.length === 1 ? "Choisir cette formule" : "Voir les formules"}
                  </button>
                )}
              </div>
            )}
          </>
        )}

        <footer className="mt-8 border-t border-border pb-6 pt-5 text-center">
          <p className="text-[11.5px] text-text-faint">
            Photographies réalisées par SportVision · {header.clubNom ?? ""}
          </p>
        </footer>
      </main>

      {/* ── Barre d'achat, parcours FORMULE ─────────────────────────────── */}
      {/* Trois états, dans l'ordre où le parent les rencontre : il regarde, il a choisi une
          formule à quota et il coche, il a choisi l'album entier. La barre est là dès la première
          seconde : il doit savoir ce que ça coûte avant de faire défiler 500 photos. */}
      {formule && enVente && !checkoutOpen && !offresOpen && lightbox === null && photos.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border-strong bg-bg-elevated/95 backdrop-blur">
          <div className="mx-auto flex max-w-[1180px] items-center justify-between gap-3 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
            {!offreChoisie ? (
              <>
                <div className="min-w-0">
                  <div className="text-[13.5px] font-bold">
                    {offres.length === 1
                      ? offres[0]!.name
                      : `${offres.length} formules disponibles`}
                  </div>
                  <div className="truncate text-[12px] text-text-tertiary">
                    {offres.length === 1 ? offerSummary(offres[0]!, header.photoCount) : prixDAppel}
                  </div>
                </div>
                <button
                  onClick={() => (offres.length === 1 ? setOffreChoisie(offres[0]!) : setOffresOpen(true))}
                  className="flex-none rounded-sv-pill bg-sv-gradient px-5 py-2.5 text-[13.5px] font-bold text-white"
                >
                  {offres.length === 1 ? "Choisir" : "Voir les formules"}
                </button>
              </>
            ) : enSelection ? (
              <>
                <div className="min-w-0">
                  <div className="text-[13.5px] font-bold">
                    {selected.length} / {quota} photo{quota! > 1 ? "s" : ""}
                  </div>
                  {/* py-1.5 -mt-0.5 : le bouton ne faisait que 18 px de haut. Ce n'est pas un
                      lien decoratif dans une phrase, c'est la seule facon de revenir sur son
                      choix de formule une fois la selection commencee. Le padding vertical est
                      compense par une marge negative pour ne pas repousser la barre. */}
                  <button
                    onClick={() => setOffresOpen(true)}
                    className="-mt-0.5 truncate py-1.5 text-[12px] text-text-tertiary underline underline-offset-2"
                  >
                    {offreChoisie.name} — changer de formule
                  </button>
                </div>
                {/* Le prix ne bouge JAMAIS pendant la sélection : c'est tout l'objet d'une
                    formule. Acheter avec moins de photos que le quota est permis — un parent qui
                    ne trouve que 11 photos de son enfant doit pouvoir acheter quand même. */}
                <button
                  onClick={() => setCheckoutOpen(true)}
                  disabled={selected.length === 0}
                  className="flex-none rounded-sv-pill bg-sv-gradient px-5 py-2.5 text-[13.5px] font-bold text-white disabled:opacity-40"
                >
                  Continuer — {formatPrice(offreChoisie.priceCents, offreChoisie.currency)}
                </button>
              </>
            ) : (
              <>
                <div className="min-w-0">
                  <div className="truncate text-[13.5px] font-bold">{offreChoisie.name}</div>
                  <button
                    onClick={() => setOffresOpen(true)}
                    className="truncate text-[12px] text-text-tertiary underline underline-offset-2"
                  >
                    {offerSummary(offreChoisie, header.photoCount)} — changer
                  </button>
                </div>
                <button
                  onClick={() => setCheckoutOpen(true)}
                  className="flex-none rounded-sv-pill bg-sv-gradient px-5 py-2.5 text-[13.5px] font-bold text-white"
                >
                  {formatPrice(offreChoisie.priceCents, offreChoisie.currency)}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Barre de sélection, parcours CATALOGUE ───────────────────────── */}
      {vendable && selected.length > 0 && !cartOpen && !checkoutOpen && lightbox === null && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border-strong bg-bg-elevated/95 backdrop-blur">
          <div className="mx-auto flex max-w-[1180px] items-center justify-between gap-3 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
            <div className="min-w-0">
              <div className="text-[13.5px] font-bold">
                {selected.length} photo{selected.length > 1 ? "s" : ""} sélectionnée{selected.length > 1 ? "s" : ""}
              </div>
              {quote && (
                <div className="text-[12px] text-text-tertiary">
                  {formatPrice(quote.totalCents, quote.currency)}
                  {quote.savingsCents > 0 && (
                    <span className="ml-1.5 text-affiliations">
                      soit {formatPrice(quote.savingsCents, quote.currency)} d&apos;économie
                    </span>
                  )}
                </div>
              )}
            </div>
            <button
              onClick={() => setCartOpen(true)}
              className="flex-none rounded-sv-pill bg-sv-gradient px-5 py-2.5 text-[13.5px] font-bold text-white"
            >
              Voir mon panier
            </button>
          </div>
        </div>
      )}

      {cartOpen && quote && (
        <CartSheet
          quote={quote}
          count={selected.length}
          totalPhotos={header.photoCount}
          wholeAlbumProduct={wholeAlbum}
          onClose={() => setCartOpen(false)}
          onClear={() => {
            setSelected([]);
            setCartOpen(false);
          }}
          onCheckout={() => {
            setCartOpen(false);
            setCheckoutOpen(true);
          }}
        />
      )}

      {/* Un seul écran de paiement pour les deux parcours : ce qui change, c'est le récapitulatif
          et la sélection transmise. La formule n'en transmet aucune — le serveur retrouve le prix
          depuis le lien, il ne l'apprend pas du navigateur. */}
      {checkoutOpen && formule && offreChoisie && (
        <GalleryCheckout
          slug={slug}
          token={token}
          password={password}
          offerId={offreChoisie.offerId}
          // Une formule à quota transmet les photos choisies ; un album complet n'en transmet
          // aucune, le serveur fige lui-même tout ce que contient la galerie à cet instant.
          assetIds={enSelection ? selected : []}
          libelle={
            enSelection
              ? `${offreChoisie.name} · ${selected.length} photo${selected.length > 1 ? "s" : ""}`
              : offreChoisie.name
          }
          totalCents={offreChoisie.priceCents}
          currency={offreChoisie.currency}
          onClose={() => setCheckoutOpen(false)}
        />
      )}

      {checkoutOpen && !formule && quote && (
        <GalleryCheckout
          slug={slug}
          token={token}
          password={password}
          assetIds={selected}
          libelle={quote.wholeAlbum ? "Galerie complète" : `${selected.length} photo${selected.length > 1 ? "s" : ""}`}
          totalCents={quote.totalCents}
          currency={quote.currency}
          onClose={() => setCheckoutOpen(false)}
        />
      )}

      {offresOpen && (
        <OffersSheet
          offres={offres}
          photoCount={header.photoCount}
          selection={selected.length}
          onChoisir={(o) => {
            // Changer de formule NE VIDE PAS la sélection : quelqu'un qui monte d'un pack garde
            // ce qu'il a déjà trouvé. On rogne seulement ce qui dépasse le nouveau quota, et
            // toujours par la fin, pour ne pas retirer un choix fait en premier.
            setOffreChoisie(o);
            setOffresOpen(false);
            if (o.photosAllowance !== null) setSelected((prev) => prev.slice(0, o.photosAllowance!));
            else setSelected([]);
          }}
          onClose={() => setOffresOpen(false)}
        />
      )}

      {lightbox !== null && photos[lightbox] && (
        <Lightbox
          photo={photos[lightbox]}
          index={lightbox}
          count={total || photos.length}
          selected={selected.includes(photos[lightbox].id)}
          selectable={vendable || enSelection}
          quotaAtteint={enSelection && complet && !selected.includes(photos[lightbox].id)}
          onToggle={() => toggle(photos[lightbox]!.id)}
          // Le moment où l'on regarde une photo en grand est celui où l'on a envie de l'avoir :
          // le bouton d'achat suit jusque dans la visionneuse plutôt que d'obliger à en sortir.
          achat={
            // En mode sélection, la visionneuse sert à cocher, pas à acheter : le bouton d'achat
            // y ferait quitter la photo qu'on est en train de juger.
            formule && enVente && !enSelection
              ? {
                  libelle: offreChoisie
                    ? `Débloquer — ${formatPrice(offreChoisie.priceCents, offreChoisie.currency)}`
                    : "Choisir ma formule",
                  onAchat: () => {
                    closeLightbox();
                    if (offreChoisie) setCheckoutOpen(true);
                    else if (offres.length === 1) setOffreChoisie(offres[0]!);
                    else setOffresOpen(true);
                  },
                }
              : null
          }
          onPrev={() => step(-1)}
          onNext={() => step(1)}
          onClose={closeLightbox}
        />
      )}
    </div>
  );
}

function PhotoTile({
  photo,
  index,
  selected,
  selectable,
  disabled,
  onOpen,
  onToggle,
}: {
  photo: GalleryPhoto;
  index: number;
  selected: boolean;
  selectable: boolean;
  /** Quota atteint : la photo reste visible et agrandissable, elle ne se coche simplement plus. */
  disabled?: boolean;
  onOpen: () => void;
  onToggle: () => void;
}) {
  // Le ratio réel est connu avant que l'image arrive : la place est réservée, donc la grille ne
  // saute pas pendant le chargement.
  const ratio = photo.width && photo.height ? `${photo.width} / ${photo.height}` : "4 / 3";
  return (
    <div className="relative mb-2 break-inside-avoid sm:mb-3">
      <button
        onClick={onOpen}
        aria-label={`Ouvrir la photo ${index + 1}`}
        className="block w-full overflow-hidden rounded-sv focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
      >
        <img
          src={photo.thumbUrl}
          alt=""
          loading={index < 8 ? "eager" : "lazy"}
          decoding="async"
          width={photo.width ?? undefined}
          height={photo.height ?? undefined}
          style={{ aspectRatio: ratio }}
          className={`w-full bg-surface object-cover transition duration-200 ${
            selected ? "brightness-[.72]" : "hover:brightness-110"
          }`}
        />
      </button>
      {selectable && (
        <>
          {/* Voile sombre sous le bouton : sans lui l'indicateur disparaît sur une photo claire,
              et sur une photo sombre un cercle vide se lit comme un indicateur de chargement. */}
          {!selected && (
            <div
              aria-hidden
              className="pointer-events-none absolute right-0 top-0 h-16 w-16 rounded-bl-[40px] rounded-tr-sv bg-gradient-to-bl from-black/55 to-transparent"
            />
          )}
          <button
            onClick={onToggle}
            aria-pressed={selected}
            disabled={disabled}
            aria-label={selected ? "Retirer de la sélection" : "Ajouter à la sélection"}
            /* h-10 w-10 et non h-8 w-8 : c'est LA façon de choisir une photo dans un parcours
               payant (« Touchez ✓ pour choisir vos photos »), sur une grille où les vignettes
               se touchent. À 32 px, un doigt qui rate sélectionne la photo d'à côté — donc
               achète la mauvaise photo. */
            className={`absolute right-2 top-2 flex h-10 w-10 items-center justify-center rounded-full text-[15px] font-bold leading-none transition ${
              selected
                ? "bg-sv-gradient text-white shadow-[0_2px_10px_rgba(0,0,0,.45)]"
                : "border-[1.5px] border-white/80 text-white/80 hover:bg-white/20 disabled:opacity-30"
            }`}
          >
            ✓
          </button>
        </>
      )}
    </div>
  );
}

function Lightbox({
  photo,
  index,
  count,
  selected,
  selectable,
  quotaAtteint,
  onToggle,
  achat,
  onPrev,
  onNext,
  onClose,
}: {
  photo: GalleryPhoto;
  index: number;
  count: number;
  selected: boolean;
  selectable: boolean;
  /** Quota atteint et cette photo non cochée : on l'annonce plutôt que d'ignorer l'appui. */
  quotaAtteint?: boolean;
  onToggle: () => void;
  /** Parcours formule : un seul bouton d'achat, aucune sélection. null dans l'ancien parcours. */
  achat: { libelle: string; onAchat: () => void } | null;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const touchX = useRef<number | null>(null);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Photo ${index + 1} sur ${count}`}
      // Noir franc et non 95 % : a 95 %, la galerie reste lisible derriere la photo et attire
      // l'oeil. On regarde UNE photo, pas une photo posee sur une page.
      className="fixed inset-0 z-50 flex flex-col bg-black"
      onTouchStart={(e) => {
        touchX.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        const start = touchX.current;
        const end = e.changedTouches[0]?.clientX ?? null;
        touchX.current = null;
        if (start === null || end === null) return;
        // 60 px : assez pour ne pas déclencher un changement de photo sur un simple appui, assez
        // peu pour que le geste reste naturel au pouce.
        if (end - start > 60) onPrev();
        else if (start - end > 60) onNext();
      }}
    >
      <div className="flex flex-none items-center justify-between px-4 py-3 text-white">
        <span className="text-[12.5px] tabular-nums text-white/70">
          {index + 1} / {count}
        </span>
        <button onClick={onClose} aria-label="Fermer" className="flex h-11 w-11 items-center justify-center rounded-full text-[20px] leading-none hover:bg-white/10">
          ✕
        </button>
      </div>

      {/* Bord a bord : sur un telephone etroit, une photo au format paysage est deja petite, et
          lui retirer encore 16 px de chaque cote la rend inutilement minuscule. */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        <img src={photo.previewUrl} alt="" className="max-h-full max-w-full object-contain" />
        <button
          onClick={onPrev}
          aria-label="Photo précédente"
          className="absolute left-1 top-1/2 hidden -translate-y-1/2 rounded-full bg-black/45 px-3 py-4 text-white hover:bg-black/70 sm:block"
        >
          ‹
        </button>
        <button
          onClick={onNext}
          aria-label="Photo suivante"
          className="absolute right-1 top-1/2 hidden -translate-y-1/2 rounded-full bg-black/45 px-3 py-4 text-white hover:bg-black/70 sm:block"
        >
          ›
        </button>
      </div>

      {selectable && (
        <div className="flex-none px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            onClick={onToggle}
            disabled={quotaAtteint}
            className={`w-full rounded-sv-pill py-3 text-[14px] font-bold transition disabled:opacity-45 ${
              selected ? "border border-border-strong bg-surface text-text" : "bg-sv-gradient text-white"
            }`}
          >
            {selected
              ? "Retirer de ma sélection"
              : quotaAtteint
                ? "Votre formule est complète"
                : "Sélectionner cette photo"}
          </button>
        </div>
      )}

      {achat && (
        <div className="flex-none px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            onClick={achat.onAchat}
            className="w-full rounded-sv-pill bg-sv-gradient py-3 text-[14px] font-bold text-white"
          >
            {achat.libelle}
          </button>
        </div>
      )}
    </div>
  );
}

function CartSheet({
  quote,
  count,
  totalPhotos,
  wholeAlbumProduct,
  onClose,
  onClear,
  onCheckout,
}: {
  quote: CartQuote;
  count: number;
  totalPhotos: number;
  wholeAlbumProduct: GalleryProduct | null;
  onClose: () => void;
  onClear: () => void;
  onCheckout: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Mon panier"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[520px] rounded-t-sv-card border-t border-border-strong bg-bg-elevated px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-sora text-[17px] font-extrabold tracking-tight">Mon panier</h2>
          <button onClick={onClose} aria-label="Fermer" className="flex h-10 w-10 items-center justify-center rounded-full text-[18px] leading-none text-text-tertiary hover:bg-surface-hover">
            ✕
          </button>
        </div>

        <p className="mb-3 text-[12.5px] text-text-tertiary">
          {quote.wholeAlbum
            ? `La galerie entière (${totalPhotos} photos) revient moins cher que votre sélection.`
            : `${count} photo${count > 1 ? "s" : ""} sélectionnée${count > 1 ? "s" : ""}.`}
        </p>

        <div className="flex flex-col gap-2">
          {quote.lines.map((line) => (
            <div key={line.productId} className="flex items-center justify-between gap-3 rounded-sv border border-border bg-surface px-3.5 py-3">
              <div className="min-w-0">
                <div className="text-[13.5px] font-semibold">{line.name}</div>
                <div className="text-[11.5px] text-text-faint">{cartLineDetail(line, quote.currency)}</div>
              </div>
              <div className="flex-none text-[13.5px] font-bold tabular-nums">
                {formatPrice(line.unitPriceCents * line.quantity, quote.currency)}
              </div>
            </div>
          ))}
        </div>

        {quote.savingsCents > 0 && (
          <p className="mt-3 rounded-sv border border-affiliations/30 bg-affiliations-bg px-3.5 py-2.5 text-[12.5px] font-semibold text-affiliations">
            Meilleure offre appliquée — vous économisez {formatPrice(quote.savingsCents, quote.currency)}
          </p>
        )}

        {!quote.wholeAlbum && wholeAlbumProduct && (
          <p className="mt-2 text-[12px] text-text-faint">
            Toute la galerie ({totalPhotos} photos) : {formatPrice(wholeAlbumProduct.priceCents, wholeAlbumProduct.currency)}
          </p>
        )}

        <div className="mt-4 flex items-center justify-between border-t border-border pt-3.5">
          <span className="text-[13px] text-text-secondary">Total</span>
          <span className="font-sora text-[20px] font-extrabold tabular-nums">
            {formatPrice(quote.totalCents, quote.currency)}
          </span>
        </div>

        <button
          onClick={onCheckout}
          className="mt-4 w-full rounded-sv-pill bg-sv-gradient py-3.5 text-[14.5px] font-bold text-white"
        >
          Continuer vers le paiement
        </button>
        <p className="mt-2 text-center text-[11.5px] text-text-faint">
          Aucun compte n&apos;est nécessaire pour acheter vos photos.
        </p>
        <button onClick={onClear} className="mt-3 w-full py-2 text-[12.5px] text-text-faint underline underline-offset-2">
          Vider ma sélection
        </button>
      </div>
    </div>
  );
}

/** « 3 × 3 photos » ne veut rien dire pour un client. On écrit ce qu'il achète : trois photos à
 * quatre euros, ou un pack qui couvre cinq photos. */
function cartLineDetail(line: CartLine, currency: string): string {
  if (line.type === "album_complet") return `${line.coversPhotos} photos`;
  if (line.type === "pack") {
    const parPack = Math.round(line.coversPhotos / line.quantity);
    return line.quantity > 1
      ? `${line.quantity} packs × ${formatPrice(line.unitPriceCents, currency)}`
      : `Jusqu'à ${parPack} photos`;
  }
  return `${line.quantity} × ${formatPrice(line.unitPriceCents, currency)}`;
}

function EmptyState({ livraisonExterne }: { livraisonExterne: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-sv-card border border-border bg-surface px-6 py-16 text-center">
      <div className="text-[30px] opacity-40" aria-hidden>
        📸
      </div>
      <h2 className="font-sora text-[17px] font-bold">
        {livraisonExterne ? "Vos photos vous sont livrées séparément" : "Les photos arrivent bientôt"}
      </h2>
      <p className="max-w-[380px] text-[13px] leading-relaxed text-text-tertiary">
        {livraisonExterne
          ? "Cet album vous est transmis par un lien privé envoyé par votre club. Rapprochez-vous de lui si vous ne l'avez pas reçu."
          : "Le photographe termine sa sélection. Revenez d'ici quelques jours avec ce même lien."}
      </p>
    </div>
  );
}
