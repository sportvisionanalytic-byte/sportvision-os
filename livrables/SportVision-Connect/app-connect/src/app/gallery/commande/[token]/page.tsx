import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { fetchOrderSummary } from "@/lib/gallery/data";
import { OrderView } from "./OrderView";

// Page de commande — /gallery/commande/<jeton>
//
// Le jeton reçu par e-mail est la seule clé. Il n'est jamais lisible depuis une table
// (media_download_grants n'a aucune policy de lecture pour un humain) et la fonction en base
// revérifie à chaque appel que la commande est bien payée. Aucun chemin d'original ne transite
// par cette page : chaque téléchargement est signé au clic par l'Edge Function gallery-download.

export const metadata: Metadata = {
  title: "Vos photos — SportVision",
  // Une commande n'a rien à faire dans un moteur de recherche.
  robots: { index: false, follow: false },
};

export default async function OrderPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const order = await fetchOrderSummary(supabase, token);

  if (!order) return <OrderClosed titre="Commande introuvable" texte="Ce lien n'est plus valide. Vérifiez l'adresse reçue par e-mail." />;
  if (order.expiree) {
    return (
      <OrderClosed
        titre="Ce lien a expiré"
        texte={`Votre commande reste enregistrée. Créez votre compte SportVision Connect avec ${order.email} pour retrouver vos photos, ou écrivez-nous à contact@sportvision-an.fr.`}
      />
    );
  }

  return <OrderView token={token} order={order} />;
}

function OrderClosed({ titre, texte }: { titre: string; texte: string }) {
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
      <p className="mt-3 max-w-[400px] text-[13.5px] leading-relaxed text-text-tertiary">{texte}</p>
    </div>
  );
}
