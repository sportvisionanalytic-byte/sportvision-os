"use client";

import { useEffect, useState } from "react";
import { ShoppingBag, Images, Tag } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import {
  fetchClubCurrentSaisonId,
  fetchClubMediaPolicy,
  fetchClubMediaProducts,
  fetchClubMediaStats,
  MEDIA_POLICY_LABELS,
  MEDIA_PRODUCT_TYPE_LABELS,
  type ClubMediaPolicy,
  type ClubMediaProduct,
  type ClubMediaStats,
} from "@/lib/data/club/mediaSales";

// /media-sales — consultation en lecture seule du modèle de commercialisation photo/vidéo du club
// (master prompt Fouka §15-16, 02/09/2026) : configuré uniquement depuis SportVision OS, le club
// consulte. Aucune écriture ici, volontairement — voir mediaSales.ts.
export default function MediaSalesPage() {
  const { ctx } = useSession();
  const [saisonId, setSaisonId] = useState<string | null>(null);
  const [policy, setPolicy] = useState<ClubMediaPolicy | null | undefined>(undefined);
  const [products, setProducts] = useState<ClubMediaProduct[] | null>(null);
  const [stats, setStats] = useState<ClubMediaStats | null>(null);

  useEffect(() => {
    if (ctx.organization.type !== "club") return;
    const supabase = createClient();
    fetchClubCurrentSaisonId(supabase, ctx.organization.id).then(async (sid) => {
      setSaisonId(sid);
      if (!sid) {
        setPolicy(null);
        setProducts([]);
        setStats({ activeEntitlements: 0, publishedAlbums: 0 });
        return;
      }
      const [p, prods, st] = await Promise.all([
        fetchClubMediaPolicy(supabase, ctx.organization.id, sid),
        fetchClubMediaProducts(supabase, ctx.organization.id, sid),
        fetchClubMediaStats(supabase, ctx.organization.id, sid),
      ]);
      setPolicy(p);
      setProducts(prods);
      setStats(st);
    });
  }, [ctx.organization.id, ctx.organization.type]);

  if (ctx.organization.type !== "club") {
    return (
      <Card className="p-8 text-center text-[13.5px] text-text-soft">
        Cet écran concerne uniquement l&apos;espace club.
      </Card>
    );
  }

  const policyActive = policy?.status === "active";
  const activeProducts = (products ?? []).filter((p) => p.status === "active");

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <div>
        <div className="text-[12px] font-bold text-text-soft">Médias &amp; ventes</div>
        <h1 className="mt-1.5 text-[27px] font-extrabold leading-tight tracking-tight">Votre modèle photo</h1>
        <p className="mt-1 text-[13px] text-text-soft">
          Configuré par SportVision — pour un ajustement, contactez votre interlocuteur SportVision.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3.5">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-text-soft">
            <ShoppingBag className="h-3.5 w-3.5" aria-hidden />
            <span className="text-[11.5px] font-bold uppercase tracking-[.04em]">Accès actifs</span>
          </div>
          <div className="mt-2 text-[22px] font-extrabold tracking-tight">{stats?.activeEntitlements ?? "—"}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-text-soft">
            <Images className="h-3.5 w-3.5" aria-hidden />
            <span className="text-[11.5px] font-bold uppercase tracking-[.04em]">Albums publiés</span>
          </div>
          <div className="mt-2 text-[22px] font-extrabold tracking-tight">{stats?.publishedAlbums ?? "—"}</div>
        </Card>
      </div>

      <Card className="p-4.5">
        <div className="text-[14px] font-extrabold tracking-tight">Politique de la saison</div>
        {policy === undefined ? (
          <p className="mt-3 text-[12.5px] text-text-soft">Chargement…</p>
        ) : !policy ? (
          <p className="mt-3 text-[12.5px] text-text-soft">
            Aucune politique média configurée pour le moment — contactez SportVision pour démarrer.
          </p>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            <Badge tone="accent">{MEDIA_POLICY_LABELS[policy.defaultPolicy] ?? policy.defaultPolicy}</Badge>
            <Badge tone={policyActive ? "success" : "neutral"}>{policyActive ? "Active" : "Pas encore active"}</Badge>
            {policy.revenueSharePct != null && (
              <span className="text-[12.5px] text-text-soft">{policy.revenueSharePct}% reversés au club</span>
            )}
          </div>
        )}
      </Card>

      <Card className="p-4.5">
        <div className="mb-1 flex items-center gap-2">
          <Tag className="h-3.5 w-3.5 text-text-soft" aria-hidden />
          <div className="text-[14px] font-extrabold tracking-tight">Produits proposés aux familles</div>
        </div>
        {products === null ? (
          <p className="mt-3 text-[12.5px] text-text-soft">Chargement…</p>
        ) : activeProducts.length === 0 ? (
          <p className="mt-3 text-[12.5px] text-text-soft">Aucun produit actif pour le moment.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-2.5">
            {activeProducts.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 rounded-xl bg-surface-alt px-3.5 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold text-text">{p.name}</span>
                  <span className="block text-[11.5px] text-text-soft">{MEDIA_PRODUCT_TYPE_LABELS[p.type] ?? p.type}</span>
                </span>
                <span className="flex-none text-[13px] font-extrabold tabular-nums text-text">
                  {(p.priceCents / 100).toLocaleString("fr-FR", { style: "currency", currency: p.currency.toUpperCase() })}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
