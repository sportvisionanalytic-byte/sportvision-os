"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { PlayerOrder } from "@/lib/prestations/types";
import { BUCKET_LABEL, type OrderBucket, stageFromStatut, bucketFromStage, STAGE_LABEL, STAGE_COLOR } from "@/lib/prestations/status";
import { formatDateLong, formatEUR } from "@/lib/prestations/format";
import type { AthleteRow } from "@/lib/supabase/particulier";

type MultiOrder = PlayerOrder & { forWho: string | null };

const TABS: Array<"Toutes" | OrderBucket> = ["Toutes", "a_venir", "en_cours", "terminees", "annulees"];

export function CommandesParticulierView({ athletes, initialSportif }: { athletes: AthleteRow[]; initialSportif: string | null }) {
  const [orders, setOrders] = useState<MultiOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"Toutes" | OrderBucket>("Toutes");
  const [sportifFilter, setSportifFilter] = useState<string | null>(initialSportif);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase.functions
      .invoke("connect-player-prestations", { body: { action: "list_orders", multi: true } })
      .then(({ data, error: fnError }) => {
        if (cancelled) return;
        if (fnError || data?.error) {
          setError(data?.error || "Impossible de charger vos commandes pour le moment.");
          return;
        }
        setOrders(data.orders as MultiOrder[]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filterOptions = useMemo(
    () => [{ key: null, label: "Tous" }, ...athletes.map((a) => ({ key: `${a.kind}:${a.refId}`, label: `${a.firstName} ${a.lastName}`.trim() }))],
    [athletes],
  );

  const visible = useMemo(() => {
    if (!orders) return [];
    let list = orders;
    if (tab !== "Toutes") list = list.filter((o) => bucketFromStage(stageFromStatut(o.statut)) === tab);
    if (sportifFilter) {
      const label = filterOptions.find((f) => f.key === sportifFilter)?.label;
      if (label) list = list.filter((o) => o.forWho === label);
    }
    return list;
  }, [orders, tab, sportifFilter, filterOptions]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-sora text-[33px] font-bold tracking-tight">Mes commandes</h1>
        <p className="max-w-[560px] text-[15px] text-text-tertiary">Les prestations réservées pour vous et les sportifs que vous accompagnez.</p>
      </div>

      {athletes.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {filterOptions.map((f) => (
            <button
              key={f.key ?? "all"}
              type="button"
              onClick={() => setSportifFilter(f.key)}
              className={`rounded-sv-pill border px-3.5 py-2 text-[13px] font-medium transition-colors duration-150 ${
                sportifFilter === f.key ? "border-[rgba(140,169,255,.65)] bg-[rgba(79,125,255,.2)] text-text" : "border-border text-text-tertiary hover:text-text"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`h-10 rounded-sv-pill px-4 text-[13px] font-semibold transition-colors duration-150 ${
              tab === t ? "bg-sv-gradient text-white" : "border border-border-strong bg-surface text-text-secondary hover:bg-surface-hover"
            }`}
          >
            {t === "Toutes" ? "Toutes" : BUCKET_LABEL[t]}
          </button>
        ))}
      </div>

      {error && <span className="text-[13px] text-danger">{error}</span>}

      {orders === null && !error && (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[92px] animate-pulse rounded-sv-card border border-border bg-surface" />
          ))}
        </div>
      )}

      {orders !== null && visible.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-sv-card border border-dashed border-border-strong bg-surface p-8 text-center">
          <span className="material-symbols-rounded !text-[24px] text-text-tertiary">receipt_long</span>
          <span className="font-sora text-[16px] font-semibold">{orders.length === 0 ? "Aucune commande pour le moment" : "Aucune commande dans cette catégorie"}</span>
          {orders.length === 0 && (
            <Link href="/particulier/prestations" className="mt-1 rounded-sv bg-sv-gradient px-4 py-2.5 font-sora text-[14px] font-semibold text-white">
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
                href={`/particulier/commandes/${order.id}`}
                className="flex items-center gap-4 rounded-sv-card border border-border bg-surface p-4.5 transition-colors duration-150 hover:bg-surface-hover"
              >
                <span className="flex h-12 w-12 flex-none items-center justify-center rounded-sv bg-prestations-bg">
                  <span className="material-symbols-rounded !text-[22px] text-prestations">camera_alt</span>
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-sora text-[15px] font-semibold text-text">{order.offreNom || "Prestation"}</span>
                    {order.forWho && (
                      <span className="rounded-sv-pill bg-white/[.07] px-2 py-0.5 text-[11px] font-medium text-text-tertiary">Pour {order.forWho}</span>
                    )}
                  </div>
                  <span className="truncate text-[13px] text-text-tertiary">
                    {formatDateLong(order.datePrestation)} {order.lieu ? `· ${order.lieu}` : ""}
                  </span>
                </div>
                <div className="flex flex-none flex-col items-end gap-1.5">
                  <span className="rounded-sv-pill px-2.5 py-1 text-[12px] font-medium" style={{ color: color.fg, background: color.bg }}>
                    {STAGE_LABEL[stage]}
                  </span>
                  {amount !== null && <span className="font-sora text-[13px] font-semibold text-text">{formatEUR(amount)}</span>}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
