import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchMyGalleries, fetchMyGalleryPhotos } from "@/lib/gallery/data";
import { GalerieDetailView } from "./GalerieDetailView";

export const metadata: Metadata = {
  title: "Mes photos — SportVision",
  robots: { index: false, follow: false },
};

// Le détail d'une galerie achetée : uniquement les photos que CE compte possède.
//
// Union de toutes ses commandes sur cet album, sans doublon (§16) : un pack 10 puis un pack 20 sur
// le même match donnent une seule galerie, avec les photos des deux achats. La base fait cette
// union — la refaire ici donnerait deux façons de compter, qui finiraient par diverger.
export default async function GalerieDetailPage({ params }: { params: Promise<{ albumId: string }> }) {
  const { albumId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/auth/login?redirect=/galeries/${albumId}`);

  const [galeries, photos] = await Promise.all([
    fetchMyGalleries(supabase),
    fetchMyGalleryPhotos(supabase, albumId),
  ]);
  const galerie = galeries.find((g) => g.albumId === albumId);
  if (!galerie) redirect("/galeries");

  return <GalerieDetailView galerie={galerie} photos={photos} />;
}
