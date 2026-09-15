import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import {
  fetchGalleryPhotos,
  fetchGalleryProducts,
  fetchPriceLadder,
  openGallery,
  type GalleryDenial,
} from "@/lib/gallery/data";
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

// 15/09/2026 — « Un coach m'a dit que la galerie ne marche pas, la galerie de Creil, le lien
// n'existe plus » (Fouka). La galerie de Creil marchait : 41 photos, deux formules, lien actif.
// Ce que le coach avait ouvert, c'est le lien AMPUTÉ de son jeton — recopié sans la fin. Et la
// page lui répondait « Cette galerie n'existe plus ».
//
// Le texte en dessous disait déjà la vérité (« ce lien est incomplet »), mais personne ne lit le
// second paragraphe quand le titre a déjà tranché. Un titre qui affirme la disparition de ce qui
// existe envoie le club appeler SportVision, et fait perdre une vente.
//
// On sépare donc les deux cas, et sans rien demander à la base : un lien SANS jeton ne peut pas
// être un lien périmé, c'est forcément un lien tronqué.
const RAISON_TITRE: Record<GalleryDenial, string> = {
  introuvable: "Ce lien ne fonctionne pas",
  desactive: "Cette galerie n'est plus disponible",
  expire: "Cette galerie a expiré",
  non_publie: "Cette galerie n'est pas encore ouverte",
  mot_de_passe: "Galerie protégée",
  mot_de_passe_invalide: "Mot de passe incorrect",
};

const RAISON_TEXTE: Record<GalleryDenial, string> = {
  // Le cas le plus frequent n'est pas un lien perime, c'est un lien COUPE : recopie d'un message,
  // d'un QR mal cadre, d'un partage qui a tronque la fin. Et « demandez-en un nouveau a votre
  // club » ne veut rien dire pour la galerie d'un tournoi, ou il n'y a pas de club (12/09/2026).
  introuvable:
    "Ce lien est incomplet ou n'est plus valide. Vérifiez que vous l'avez copié en entier, jusqu'à la suite de lettres et de chiffres qui le termine, puis redemandez-le à la personne qui vous l'a envoyé.",
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
  const description = [header.clubNom ?? header.structure, header.equipe, `${header.photoCount} photos`]
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
    return <GalleryClosed raison={result.raison} sansJeton={token.trim() === ""} />;
  }

  // Première page rendue côté serveur : le visiteur voit des photos immédiatement, sans attendre
  // un aller-retour depuis son navigateur. La suite arrive au défilement.
  const [page, products, ladder] = await Promise.all([
    fetchGalleryPhotos(supabase, slug, token, { limit: 60 }),
    fetchGalleryProducts(supabase, slug, token),
    fetchPriceLadder(supabase, slug, token),
  ]);

  return (
    <GalleryView
      slug={slug}
      token={token}
      header={result.header}
      initialPhotos={page.photos}
      initialTotal={page.total || result.header.photoCount}
      initialProducts={products}
      initialLadder={ladder}
    />
  );
}

function GalleryClosed({ raison, sansJeton = false }: { raison: GalleryDenial; sansJeton?: boolean }) {
  // Lien coupé : on le dit tel quel, et on montre à quoi ressemble la fin qui manque. C'est la
  // seule chose que le visiteur peut corriger lui-même.
  const titre = sansJeton && raison === "introuvable" ? "Il manque la fin de ce lien" : RAISON_TITRE[raison];
  const texte = sansJeton && raison === "introuvable"
    ? "Le lien d'une galerie se termine par « ?k= » suivi d'une suite de lettres et de chiffres. Sans elle, les photos ne peuvent pas s'ouvrir. Recopiez le lien en entier, ou redemandez-le à la personne qui vous l'a envoyé."
    : RAISON_TEXTE[raison];
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
      <h1 className="mt-6 font-sora text-[22px] font-extrabold tracking-tight">{titre}</h1>
      <p className="mt-3 max-w-[380px] text-[13.5px] leading-relaxed text-text-tertiary">{texte}</p>
    </div>
  );
}
