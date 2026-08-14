"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { gradientFor } from "@/lib/avatarGradients";
import { ATHLETE_STATUS_LABEL, ATHLETE_STATUS_COLOR, type AthleteRow } from "@/lib/supabase/particulier";

export function AthletesListView({ athletes }: { athletes: AthleteRow[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!query.trim()) return athletes;
    const q = query.trim().toLowerCase();
    return athletes.filter(
      (a) =>
        `${a.firstName} ${a.lastName}`.toLowerCase().includes(q) ||
        (a.sport || "").toLowerCase().includes(q) ||
        (a.clubNom || "").toLowerCase().includes(q),
    );
  }, [athletes, query]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="font-sora text-[33px] font-bold tracking-tight">Mes sportifs</h1>
          <p className="max-w-[560px] text-[15px] text-text-tertiary">
            Les sportifs que vous accompagnez et ce que vous êtes autorisé à consulter.
          </p>
        </div>
        <Link
          href="/particulier/sportifs/ajouter"
          className="flex h-[46px] flex-none items-center gap-2 rounded-sv bg-sv-gradient px-[18px] font-sora text-[15px] font-semibold text-white hover:brightness-[1.12]"
        >
          <span className="material-symbols-rounded !text-[20px]">add</span>
          Ajouter un sportif
        </Link>
      </div>

      {athletes.length > 3 && (
        <div className="relative flex max-w-[420px]">
          <span className="material-symbols-rounded absolute left-4 top-3.5 !text-[21px] text-text-faint">search</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un sportif…"
            aria-label="Rechercher un sportif"
            className="h-[52px] w-full rounded-sv border border-border-strong bg-surface pl-[46px] pr-4 text-[15px] text-text outline-none focus:border-[#8CA9FF] focus:shadow-[0_0_0_3px_rgba(79,125,255,.28)]"
          />
        </div>
      )}

      {filtered.length > 0 ? (
        <div className="flex flex-col gap-3">
          {filtered.map((a) => {
            const statusColor = ATHLETE_STATUS_COLOR[a.status];
            return (
              <Link
                key={`${a.kind}:${a.refId}`}
                href={`/particulier/sportifs/${a.kind}/${a.refId}`}
                className="flex flex-wrap items-center gap-4 rounded-sv-card border border-border bg-surface p-[18px] hover:bg-white/[.09]"
              >
                <span
                  className="flex h-12 w-12 flex-none items-center justify-center rounded-sv font-sora text-[16px] font-semibold text-white"
                  style={{ background: gradientFor(`${a.kind}:${a.refId}`) }}
                >
                  {(a.firstName[0] || "?").toUpperCase()}
                </span>
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="font-sora text-[16px] font-semibold tracking-tight">
                    {a.firstName} {a.lastName}
                  </span>
                  <span className="text-[13px] text-text-tertiary">
                    {[a.sport, a.categorie].filter(Boolean).join(" · ") || "—"}
                  </span>
                  {a.clubNom && <span className="text-[12px] text-text-faint">{a.clubNom}</span>}
                </div>
                <div className="ml-auto flex flex-none flex-col items-end gap-1.5">
                  <span className="rounded-sv-pill bg-white/[.07] px-2.5 py-1 text-[11px] font-medium text-text-secondary">
                    {a.relationLabel}
                  </span>
                  <span
                    className="rounded-sv-pill px-2.5 py-1 text-[11px] font-medium"
                    style={{ color: statusColor.fg, background: statusColor.bg }}
                  >
                    {ATHLETE_STATUS_LABEL[a.status]}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="flex max-w-[540px] flex-col gap-2.5 rounded-sv-card border border-dashed border-border-strong bg-white/[.04] p-7">
          <span className="flex h-[46px] w-[46px] items-center justify-center rounded-sv bg-affiliations-bg">
            <span className="material-symbols-rounded !text-[23px] text-affiliations">group_add</span>
          </span>
          <span className="font-sora text-[18px] font-semibold">
            {query ? "Aucun résultat" : "Aucun sportif pour le moment"}
          </span>
          <p className="text-[14px] leading-relaxed text-text-tertiary">
            {query
              ? "Essayez un autre nom, un sport ou un club."
              : "Reliez votre compte à un joueur qui utilise déjà Connect, ou créez un profil géré."}
          </p>
          <Link
            href="/particulier/sportifs/ajouter"
            className="mt-1 self-start rounded-sv bg-sv-gradient px-4 py-2.5 font-sora text-[15px] font-semibold text-white"
          >
            Ajouter un sportif
          </Link>
        </div>
      )}
    </div>
  );
}
