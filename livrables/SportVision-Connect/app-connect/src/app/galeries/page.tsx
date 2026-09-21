import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchMyGalleries, fetchMyOrders } from "@/lib/gallery/data";
import { GaleriesView } from "./GaleriesView";

// Mes galeries — l'espace de l'acheteur de photos.
//
// Volontairement HORS des espaces (joueur) et /particulier : un parent qui a acheté les photos
// d'un tournoi n'a ni joueur, ni équipe, ni club. Le faire passer par requireJoueurAccount le
// renverrait vers un onboarding qui n'a aucun sens pour lui. Ici, la seule condition est d'être
// connecté — ce sont ses achats, la base ne renvoie que les siens.
//
// Une seule ligne par galerie, même si le compte a acheté deux fois dessus (§15) : quelqu'un qui
// prend un pack 10 puis un pack 20 sur le même match n'a pas deux galeries, il en a une avec plus
// de photos dedans. Les deux commandes restent distinctes plus bas.

export const metadata: Metadata = {
  title: "Mes galeries — SportVision",
  robots: { index: false, follow: false },
};

export default async function GaleriesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login?redirect=/galeries");

  // 21/09/2026, retour de Fouka : « quand je vais dans mes galeries, à chaque fois ça me met vers
  // un lien bizarre ». Cette page vit hors des espaces (un acheteur de photos n'a ni club ni
  // équipe), et son seul lien de retour renvoyait tout le monde vers /dashboard — l'espace JOUEUR.
  // Un parent atterrissait donc sur une page sans menu, dont la seule sortie le menait ailleurs
  // que chez lui. On regarde d'où il vient pour le ramener au bon endroit.
  const { data: reglages } = await supabase
    .from("connect_profile_settings")
    .select("account_type")
    .eq("user_id", user.id)
    .maybeSingle();
  const estParticulier = reglages?.account_type === "particulier";
  const retourHref = estParticulier ? "/particulier" : "/dashboard";

  const [galeries, commandes] = await Promise.all([
    fetchMyGalleries(supabase),
    fetchMyOrders(supabase),
  ]);

  if (galeries.length === 0) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-6 text-center text-text">
        <div className="flex items-baseline gap-1.5">
          <span className="font-sora text-[15px] font-bold tracking-tight">SportVision</span>
          <span className="bg-sv-gradient bg-clip-text text-[10px] font-medium uppercase tracking-[.16em] text-transparent">
            Galerie
          </span>
        </div>
        <h1 className="mt-6 font-sora text-[22px] font-extrabold tracking-tight">Aucune galerie pour l&apos;instant</h1>
        <p className="mt-3 max-w-[420px] text-[13.5px] leading-relaxed text-text-tertiary">
          {estParticulier ? (
            <>
              Vos achats de photos apparaîtront ici. Les photos de vos sportifs, elles, se
              trouvent sur leur fiche : <b>Mes sportifs</b>, puis <b>Voir les photos</b>.
            </>
          ) : (
            <>
              Vos achats de photos apparaîtront ici. Si vous venez d&apos;acheter, confirmez votre
              adresse e-mail : le rattachement se fait tout seul ensuite.
            </>
          )}
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
          {estParticulier && (
            <Link
              href="/particulier/sportifs"
              className="rounded-sv bg-surface px-4 py-2.5 text-[13px] font-semibold text-text ring-1 ring-border"
            >
              Voir mes sportifs
            </Link>
          )}
          <Link href={retourHref} className="text-[13px] text-text-tertiary underline underline-offset-2">
            Retour à mon espace
          </Link>
        </div>
      </div>
    );
  }

  return <GaleriesView galeries={galeries} commandes={commandes} retourHref={retourHref} />;
}
