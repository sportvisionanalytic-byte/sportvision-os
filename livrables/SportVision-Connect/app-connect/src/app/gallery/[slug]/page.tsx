import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { fetchGalleryPhotos, fetchGalleryProducts, openGallery, type GalleryDenial } from "@/lib/gallery/data";
import { GalleryView } from "./GalleryView";
import { GalleryPasswordGate } from "./GalleryPasswordGate";

// Galerie publique — /gallery/<slug>?k=<jeton>
//
// Page ouverte sans compte, très majoritairement depuis un lien WhatsApp sur mobile. Deux
// principes gouvernent ce fichier :
//
//   1. Le slug est lisible, le JETON fait la sécurité. Un slug se devine ("nom-du-club-u12"),
//      pas un jeton de 24 caractères aléatoires. `access_mode` n'est pas touché : l'accès anonyme
//      est porté par le lien, décision du 07/09.
//   2. Rien n'est lu en direct dans les tables. media_albums et media_assets n'ont aucune policy
//      de lecture pour `anon` ; tout passe par les RPC de migration-galeries-v3-publique.sql, qui
//      vérifient le jeton avant de renvoyer quoi que ce soit et ne renvoient jamais le chemin
//      d'un original.
//
// "/gallery" est déclaré dans PUBLIC_PATHS (src/lib/supabase/middleware.ts), sans quoi le
// middleware redirigerait chaque visiteur vers /auth/login.

const RAISON_TITRE: Record<GalleryDenial, string> = {
  introuvable: "Cette galerie n'existe plus",
  desactive: "Cette galerie n'est plus disponible",
  expire: "Cette galerie a expiré",
  non_publie: "Cette galerie n'est pas encore ouverte",
  mot_de_passe: "Galerie protégée",
  mot_de_passe_invalide: "Mot de passe incorrect",
};

const RAISON_TEXTE: Record<GalleryDenial, string> = {
  introuvable: "Le lien que vous avez reçu n'est plus valide. Demandez-en un nouveau à votre club.",
  desactive: "Le partage de cette galerie a été arrêté par SportVision ou par le club.",
  expire: "Ce lien avait une durée limitée et n'est plus actif. Votre club peut en générer un nouveau.",
  non_publie: "Les photos sont en cours de préparation. Revenez avec ce même lien dans quelques jours.",
  mot_de_passe: "",
  mot_de_passe_invalide: "",
};

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ k?: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const { k } = await searchParams;
  const supabase = await createClient();
  const result = await openGallery(supabase, slug, k ?? "");

  // L'aperçu compte autant que la page : le lien est presque toujours ouvert depuis WhatsApp, et
  // une vignette avec la photo de couverture change complètement le taux d'ouverture. Sur un lien
  // invalide, on ne divulgue évidemment rien.
  if (!result.ok) return { title: "Galerie SportVision", robots: { index: false, follow: false } };

  const { header } = result;
  const description = [header.clubNom, header.equipe, `${header.photoCount} photos`]
    .filter(Boolean)
    .join(" · ");
  return {
    title: `${header.titre} — SportVision`,
    description,
    // Une galerie ne doit pas se retrouver dans un moteur de recherche : elle est destinée aux
    // familles qui ont reçu le lien, pas au public.
    robots: { index: false, follow: false },
    openGraph: {
      title: header.titre,
      description,
      images: header.coverUrl ? [{ url: header.coverUrl }] : undefined,
      type: "website",
    },
  };
}

export default async function GalleryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ k?: string }>;
}) {
  const { slug } = await params;
  const { k } = await searchParams;
  const token = k ?? "";
  const supabase = await createClient();
  const result = await openGallery(supabase, slug, token);

  if (!result.ok && (result.raison === "mot_de_passe" || result.raison === "mot_de_passe_invalide")) {
    return <GalleryPasswordGate slug={slug} token={token} />;
  }

  if (!result.ok) {
    return <GalleryClosed raison={result.raison} />;
  }

  // Première page rendue côté serveur : le visiteur voit des photos immédiatement, sans attendre
  // un aller-retour depuis son navigateur. La suite arrive au défilement.
  const [page, products] = await Promise.all([
    fetchGalleryPhotos(supabase, slug, token, { limit: 60 }),
    fetchGalleryProducts(supabase, slug, token),
  ]);

  return (
    <GalleryView
      slug={slug}
      token={token}
      header={result.header}
      initialPhotos={page.photos}
      initialTotal={page.total || result.header.photoCount}
      initialProducts={products}
    />
  );
}

function GalleryClosed({ raison }: { raison: GalleryDenial }) {
  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center bg-bg px-6 text-center text-text"
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
      <h1 className="mt-6 font-sora text-[22px] font-extrabold tracking-tight">{RAISON_TITRE[raison]}</h1>
      <p className="mt-3 max-w-[380px] text-[13.5px] leading-relaxed text-text-tertiary">{RAISON_TEXTE[raison]}</p>
    </div>
  );
}
