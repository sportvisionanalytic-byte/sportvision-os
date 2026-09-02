"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { fetchPhotoAlbums, type AvailableMediaProduct, type PhotoAlbumTeaser } from "@/lib/supabase/photoPass";

// Moteur média générique (Espace joueur) — voir page.tsx pour le contexte. Achat via l'edge
// function create-pass-photo-checkout (mode Stripe 'payment', ponctuel, product_id désormais
// requis) : cette page ne pose JAMAIS elle-même un droit "actif" — l'accès complet aux albums ne
// devient réel qu'une fois le webhook Stripe traité (MASTER-CONNECT-V1.md §25), d'où le
// rafraîchissement différé après un retour de paiement réussi, même mécanisme que
// AbonnementView.tsx.
//
// RÈGLE DE SÉCURITÉ : secureCollectionRef n'apparaît QUE sur un album où `unlocked` est déjà true
// (calculé côté serveur par la RPC media_album_list — jamais recalculé/deviné ici). Un album
// verrouillé n'affiche jamais qu'un teaser (titre, date, aperçu, nombre de photos).
function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

function formatPrice(cents: number, currency: string): string {
  return (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: currency.toUpperCase() });
}

export function PhotosView({
  clubId,
  teamId,
  teamName,
  saisonId,
  albums: initialAlbums,
  products,
  returnStatus,
}: {
  clubId: string | null;
  teamId: string | null;
  teamName: string | null;
  saisonId: string | null;
  albums: PhotoAlbumTeaser[];
  products: AvailableMediaProduct[];
  returnStatus: "succes" | "annule" | null;
}) {
  const router = useRouter();
  const [albums, setAlbums] = useState(initialAlbums);
  const [busyProductId, setBusyProductId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hasAlbums = albums.length > 0;
  // BUGFIX (audit mobile/desktop 02/09/2026, reproduit en réel avec un album gratuit +
  // un album payant sur le même club) : cette section affichait le bloc d'achat seulement si
  // AUCUN album n'était déverrouillé (albums.some(unlocked)) — un simple album gratuit/teaser
  // (access_mode='free_members') suffisait à masquer DÉFINITIVEMENT le bouton "Obtenir" pour
  // TOUS les autres albums encore verrouillés du même club, empêchant tout achat. Ce qui compte
  // pour savoir s'il reste quelque chose à proposer à l'achat, c'est l'inverse : y a-t-il au
  // moins un album encore verrouillé.

  // Le webhook Stripe (checkout.session.completed) confirme l'activation en tâche de fond — même
  // délai/logique que AbonnementView.tsx : un seul rafraîchissement différé après un retour
  // "succes" suffit à rattraper la quasi-totalité des cas.
  useEffect(() => {
    if (returnStatus !== "succes" || !clubId || !teamId || !saisonId) return;
    const t = setTimeout(async () => {
      const supabase = createClient();
      const fresh = await fetchPhotoAlbums(supabase, clubId, teamId, saisonId);
      setAlbums(fresh);
      router.refresh();
    }, 2500);
    return () => clearTimeout(t);
  }, [returnStatus, clubId, teamId, saisonId, router]);

  async function acheterProduit(productId: string) {
    setBusyProductId(productId);
    setError(null);
    const supabase = createClient();
    const { data, error: fnError } = await supabase.functions.invoke("create-pass-photo-checkout", {
      body: { product_id: productId },
    });
    setBusyProductId(null);
    if (fnError || data?.error) {
      setError(data?.error || "Impossible de traiter votre demande pour le moment.");
      return;
    }
    if (data?.url) {
      window.location.href = data.url;
    }
  }

  return (
    <div className="flex flex-col gap-6 animate-sv-in">
      <div className="flex flex-col gap-2">
        <h1 className="font-sora text-[27px] font-bold tracking-tight lg:text-[33px]">Photos</h1>
        <p className="max-w-[560px] text-[15px] text-text-tertiary">
          {teamName ? `Les albums photo de ${teamName}.` : "Les albums photo de votre équipe."}
        </p>
      </div>

      {returnStatus === "succes" && (
        <div className="flex items-start gap-2.5 rounded-sv border border-affiliations/40 bg-affiliations-bg px-4 py-3.5">
          <span className="material-symbols-rounded !text-[19px] text-affiliations" aria-hidden="true">hourglass_top</span>
          <span className="text-[14px] leading-relaxed text-text-secondary lg:text-[13px]">
            Paiement reçu par Stripe — déverrouillage de vos albums en cours. Cette page se met à jour automatiquement.
          </span>
        </div>
      )}
      {returnStatus === "annule" && (
        <div className="flex items-start gap-2.5 rounded-sv border border-border bg-white/[.04] px-4 py-3.5">
          <span className="material-symbols-rounded !text-[19px] text-text-faint" aria-hidden="true">info</span>
          <span className="text-[14px] leading-relaxed text-text-tertiary lg:text-[13px]">Paiement annulé — aucun changement n&apos;a été effectué.</span>
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2.5 rounded-sv border border-danger-border bg-danger-bg px-4 py-3.5">
          <span className="material-symbols-rounded !text-[19px] text-danger" aria-hidden="true">error</span>
          <span className="text-[14px] leading-relaxed text-[#FBCFE8] lg:text-[13px]">{error}</span>
        </div>
      )}

      {!clubId || !teamId || !saisonId ? (
        <EmptyState text="Rejoignez votre club et votre équipe pour retrouver ici vos albums photo." />
      ) : !hasAlbums ? (
        <EmptyState text="Aucun album publié pour le moment. Vos prochains albums photo apparaîtront ici." />
      ) : (
        <>
          {albums.some((a) => !a.unlocked) && products.length > 0 && (
            <div className="flex flex-col gap-3">
              {products.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center gap-4 rounded-sv-card border border-border bg-surface p-5">
                  <span className="flex h-12 w-12 flex-none items-center justify-center rounded-sv bg-contenus-bg">
                    <span className="material-symbols-rounded !text-[24px] text-contenus" aria-hidden="true">lock</span>
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="font-sora text-[15px] font-semibold">{p.name}</span>
                    <span className="text-[13px] text-text-tertiary">{formatPrice(p.priceCents, p.currency)}</span>
                  </div>
                  <Button onClick={() => acheterProduit(p.id)} loading={busyProductId === p.id} className="flex-none">
                    Obtenir
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {albums.map((a) => (
              <AlbumCard key={a.id} album={a} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function AlbumCard({ album }: { album: PhotoAlbumTeaser }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-sv-card border border-border bg-surface">
      <div
        className="relative h-[130px]"
        style={{ background: "linear-gradient(135deg, rgba(168,85,247,.35), rgba(34,211,238,.18))" }}
      >
        {album.coverPreviewUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- aperçu distant, pas un domaine autorisé pour next/image
          <img src={album.coverPreviewUrl} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
        )}
        {!album.unlocked && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/35">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/55">
              <span className="material-symbols-rounded !text-[20px] text-white" aria-hidden="true">lock</span>
            </span>
          </div>
        )}
        <span className="absolute right-3 top-3 rounded-sv-pill bg-black/45 px-2.5 py-1 text-[11px] font-medium text-text">
          {album.photoCount} photo{album.photoCount > 1 ? "s" : ""}
        </span>
      </div>
      <div className="flex flex-col gap-1.5 p-4">
        <span className="font-sora text-[16px] font-semibold">{album.title}</span>
        <span className="text-[13px] text-text-tertiary">{formatDate(album.eventDate) || "Date non précisée"}</span>
        {album.unlocked ? (
          album.secureCollectionRef ? (
            <a
              href={album.secureCollectionRef}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 flex items-center gap-1.5 font-sora text-[14px] font-semibold text-contenus"
            >
              Ouvrir l&apos;album
              <span className="material-symbols-rounded !text-[17px]" aria-hidden="true">arrow_forward</span>
            </a>
          ) : (
            <span className="mt-1 text-[13px] leading-relaxed text-text-tertiary">
              Accès activé — contactez SportVision pour le lien complet s&apos;il n&apos;apparaît pas ici.
            </span>
          )
        ) : (
          <span className="mt-1 flex items-center gap-1.5 text-[13px] font-medium text-text-faint">
            <span className="material-symbols-rounded !text-[15px]" aria-hidden="true">lock</span>
            Accès requis
          </span>
        )}
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex max-w-[560px] flex-col gap-3.5 rounded-sv-card border border-dashed border-border-strong bg-surface p-6">
      <span className="flex h-12 w-12 items-center justify-center rounded-sv bg-contenus-bg">
        <span className="material-symbols-rounded !text-[24px] text-contenus" aria-hidden="true">photo_camera</span>
      </span>
      <span className="font-sora text-[18px] font-semibold">Aucun album ici</span>
      <p className="text-[14px] leading-relaxed text-text-tertiary">{text}</p>
    </div>
  );
}
