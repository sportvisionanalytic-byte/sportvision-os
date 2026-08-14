"use client";

import { useMemo, useState } from "react";
import type { AthleteRow } from "@/lib/supabase/particulier";

export interface ParticulierContentItem {
  id: string;
  title: string;
  type: string;
  team: string | null;
  link: string | null;
  createdAt: string;
  athleteKey: string;
  athleteLabel: string;
}

const TYPE_ICON: Record<string, string> = { photo: "photo_camera", video: "videocam", reel: "movie", affiche: "campaign" };

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

export function ContenusParticulierView({
  items,
  athletes,
  initialSportif,
}: {
  items: ParticulierContentItem[];
  athletes: AthleteRow[];
  initialSportif: string | null;
}) {
  const [filter, setFilter] = useState<string | null>(initialSportif);

  const filterOptions = useMemo(
    () => [{ key: null, label: "Tous" }, ...athletes.filter((a) => a.rights.voir).map((a) => ({ key: `${a.kind}:${a.refId}`, label: `${a.firstName} ${a.lastName}`.trim() }))],
    [athletes],
  );

  const visible = filter ? items.filter((i) => i.athleteKey === filter) : items;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-sora text-[33px] font-bold tracking-tight">Mes contenus</h1>
        <p className="max-w-[560px] text-[15px] text-text-tertiary">Les photos et vidéos livrées pour les sportifs que vous accompagnez.</p>
      </div>

      {athletes.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {filterOptions.map((f) => (
            <button
              key={f.key ?? "all"}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`rounded-sv-pill border px-3.5 py-2 text-[13px] font-medium transition-colors duration-150 ${
                filter === f.key ? "border-[rgba(192,132,252,.55)] bg-[rgba(168,85,247,.18)] text-text" : "border-border text-text-tertiary hover:text-text"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-sv-card border border-dashed border-border-strong bg-surface p-8 text-center">
          <span className="material-symbols-rounded !text-[24px] text-text-tertiary">photo_library</span>
          <span className="font-sora text-[16px] font-semibold">Aucun contenu pour le moment</span>
          <p className="max-w-[420px] text-[13.5px] leading-relaxed text-text-tertiary">
            Les prochains contenus livrés pour vos sportifs apparaîtront ici, une fois qu&apos;un droit « Voir les
            contenus » vous aura été accordé.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((item) => {
            const content = (
              <div className="flex flex-col overflow-hidden rounded-sv-card border border-border bg-surface transition-colors duration-150 hover:border-[rgba(192,132,252,.45)]">
                <div className="flex h-[130px] items-end p-3" style={{ background: "linear-gradient(135deg,#3B1E6E 0%,#22307A 55%,#0F4C63 100%)" }}>
                  <span className="rounded-sv-pill bg-[rgba(9,8,26,.6)] px-2.5 py-1 text-[11px] font-medium text-white">Pour {item.athleteLabel}</span>
                </div>
                <div className="flex flex-col gap-1.5 p-4">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-rounded !text-[17px] text-contenus">{TYPE_ICON[item.type] || "photo_library"}</span>
                    <span className="truncate font-sora text-[14.5px] font-semibold">{item.title}</span>
                  </div>
                  <span className="text-[12.5px] text-text-tertiary">
                    {item.team ? `${item.team} · ` : ""}
                    {formatDate(item.createdAt)}
                  </span>
                </div>
              </div>
            );
            return item.link ? (
              <a key={item.id} href={item.link} target="_blank" rel="noreferrer">
                {content}
              </a>
            ) : (
              <div key={item.id}>{content}</div>
            );
          })}
        </div>
      )}
    </div>
  );
}
