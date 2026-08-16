"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { PlayerOrder } from "@/lib/prestations/types";
import { BUCKET_LABEL, type OrderBucket, stageFromStatut, bucketFromStage, STAGE_LABEL, STAGE_COLOR } from "@/lib/prestations/status";
import { formatDateLong, formatEUR } from "@/lib/prestations/format";

const TABS: Array<"Toutes" | OrderBucket> = ["Toutes", "a_venir", "en_cours", "terminees", "annulees"];

export function CommandesView() {
  const searchParams = useSearchParams();
  const paiementFlag = searchParams.get("paiement");

  const [orders, setOrders] = useState<PlayerOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"Toutes" | OrderBucket>("Toutes");

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase.functions.invoke("connect-player-prestations", { body: { action: "list_orders" } }).then(({ data, error: fnError }) => {
      if (cancelled) return;
      if (fnError || data?.error) {
        setError(data?.error || "Impossible de charger vos commandes pour le moment.");
        return;
      }
      setOrders(data.orders as PlayerOrder[]);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = useMemo(() => {
    if (!orders) return [];
    if (tab === "Toutes") return orders;
    return orders.filter((o) => bucketFromStage(stageFromStatut(o.statut)) === tab);
  }, [orders, tab]);

  return (
    <div className="flex flex-col gap-6 animate-sv-in">
      <div className="flex flex-col gap-2">
        <h1 className="font-sora text-[27px] font-bold tracking-tight lg:text-[33px]">Mes commandes</h1>
        <p className="max-w-[560px] text-[15px] text-text-tertiary">Les prestations que vous avez réservées.</p>
      </div>

      {paiementFlag === "succes" && (
        <div className="flex items-start gap-2.5 rounded-sv border border-affiliations/30 bg-affiliations-bg px-4 py-3.5">
          <span className="material-symbols-rounded !text-[19px] text-affiliations" aria-hidden="true">hourglass_top</span>
          <span className="text-[14px] leading-relaxed text-text-secondary lg:text-[13px]">
            Paiement en cours de confirmation. Le statut de votre commande se mettra à jour automatiquement dès la confirmation par
            notre prestataire de paiement — cela peut prendre quelques instants.
          </span>
        </div>
      )}
      {paiementFlag === "annule" && (
        <div className="flex items-start gap-2.5 rounded-sv border border-attente/40 bg-attente-bg px-4 py-3.5">
          <span className="material-symbols-rounded !text-[19px] text-attente" aria-hidden="true">info</span>
          <span className="text-[14px] leading-relaxed text-text-secondary lg:text-[13px]">
            Paiement annulé. Votre demande reste enregistrée — vous pouvez retenter le paiement depuis la fiche de la commande.
          </span>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`h-10 rounded-sv-pill px-4 text-[14px] font-semibold transition-colors duration-150 lg:text-[13px] ${
              tab === t ? "bg-sv-gradient text-white" : "border border-border-strong bg-surface text-text-secondary hover:bg-surface-hover"
            }`}
          >
            {t === "Toutes" ? "Toutes" : BUCKET_LABEL[t]}
          </button>
        ))}
      </div>

      {error && <span className="text-[14px] text-danger lg:text-[13px]">{error}</span>}

      {orders === null && !error && (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[92px] animate-pulse rounded-sv-card border border-border bg-surface" />
          ))}
        </div>
      )}

      {orders !== null && visible.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-sv-card border border-dashed border-border-strong bg-surface p-8 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-sv bg-prestations-bg">
            <span className="material-symbols-rounded !text-[24px] text-prestations" aria-hidden="true">receipt_long</span>
          </span>
          <span className="font-sora text-[16px] font-semibold">{orders.length === 0 ? "Aucune commande pour le moment" : "Aucune commande dans cette catégorie"}</span>
          {orders.length === 0 && (
            <Link href="/prestations" className="mt-1 rounded-sv bg-sv-gradient px-4 py-2.5 font-sora text-[14px] font-semibold text-white hover:brightness-[1.12]">
              Découvrir les prestations
            </Link>
          )}
        </div>
      )}

      {visible.length > 0 && (
        <div className="flex flex-col gap-3">
          {visible.map((order) => {
            const stage = stageFromStatut(order.statut);
            const color = STAGE_COLOR[stage];
            const amount = order.montantTtc ?? order.montantEstime;
            return (
              <Link
                key={order.id}
                href={`/commandes/${order.id}`}
                className="flex items-center gap-4 rounded-sv-card border border-border bg-surface p-4.5 transition-colors duration-150 hover:bg-surface-hover"
              >
                <span className="flex h-12 w-12 flex-none items-center justify-center rounded-sv bg-prestations-bg">
                  <span className="material-symbols-rounded !text-[22px] text-prestations" aria-hidden="true">camera_alt</span>
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate font-sora text-[15px] font-semibold text-text">{order.offreNom || "Prestation"}</span>
                  <span className="truncate text-[14px] text-text-tertiary lg:text-[13px]">
                    {formatDateLong(order.datePrestation)} {order.lieu ? `· ${order.lieu}` : ""}
                  </span>
                </div>
                <div className="flex flex-none flex-col items-end gap-1.5">
                  <span className="rounded-sv-pill px-2.5 py-1 text-[12px] font-medium" style={{ color: color.fg, background: color.bg }}>
                    {STAGE_LABEL[stage]}
                  </span>
                  {amount !== null && <span className="font-sora text-[14px] font-semibold text-text lg:text-[13px]">{formatEUR(amount)}</span>}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
