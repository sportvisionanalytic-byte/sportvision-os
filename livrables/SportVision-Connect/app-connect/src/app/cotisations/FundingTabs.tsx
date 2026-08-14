"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

export interface FundingRow {
  id: string;
  group_id: string | null;
  group_name: string | null;
  titre: string;
  contexte: string | null;
  catalogue_offre_nom: string | null;
  montant_cible: number;
  montant_collecte: number;
  repartition_mode: "egale" | "libre";
  nb_participants_prevu: number | null;
  date_limite: string | null;
  statut: "ouverte" | "objectif_atteint" | "expiree" | "annulee";
  is_creator: boolean;
  participants_count: number;
  my_contribution_amount: number | null;
  created_at: string;
}

type Tab = "en-cours" | "creees" | "participations" | "terminees";

const TABS: { id: Tab; label: string }[] = [
  { id: "en-cours", label: "En cours" },
  { id: "creees", label: "Créées par moi" },
  { id: "participations", label: "Mes participations" },
  { id: "terminees", label: "Terminées" },
];

const STATUS_LABEL: Record<FundingRow["statut"], { label: string; color: string; bg: string }> = {
  ouverte: { label: "En cours", color: "#F472B6", bg: "rgba(244,114,182,.14)" },
  objectif_atteint: { label: "Objectif atteint", color: "#22D3EE", bg: "rgba(34,211,238,.14)" },
  expiree: { label: "Expirée", color: "#9A9AB8", bg: "rgba(255,255,255,.08)" },
  annulee: { label: "Annulée", color: "#9A9AB8", bg: "rgba(255,255,255,.08)" },
};

function euros(n: number) {
  return `${n.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`;
}

function formatDeadline(iso: string | null) {
  if (!iso) return null;
  return `Jusqu'au ${new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}`;
}

// basePath : "/cotisations" (Espace joueur, défaut — comportement strictement inchangé) ou
// "/particulier/cotisations" (Espace particulier, même composant réutilisé tel quel : la RPC
// list_my_fundings() renvoie déjà, sans changement, toutes les cotisations créées par l'appelant
// — y compris celles créées par un particulier pour un sportif qu'il accompagne).
export function FundingTabs({ fundings, basePath = "/cotisations" }: { fundings: FundingRow[]; basePath?: string }) {
  const [tab, setTab] = useState<Tab>("en-cours");

  const filtered = useMemo(() => {
    switch (tab) {
      case "en-cours":
        return fundings.filter((f) => f.statut === "ouverte" || f.statut === "objectif_atteint");
      case "creees":
        return fundings.filter((f) => f.is_creator);
      case "participations":
        return fundings.filter((f) => f.my_contribution_amount != null);
      case "terminees":
        return fundings.filter((f) => f.statut === "expiree" || f.statut === "annulee");
    }
  }, [fundings, tab]);

  return (
    <div className="flex flex-col gap-6 animate-sv-in">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="font-sora text-[27px] font-bold tracking-tight lg:text-[33px]">Cotisations</h1>
          <p className="text-[15px] text-text-tertiary">Financez vos prestations SportVision à plusieurs.</p>
        </div>
        <Link
          href={`${basePath}/creer`}
          className="flex h-[46px] flex-none items-center gap-2 rounded-sv bg-sv-gradient px-[18px] font-sora text-[15px] font-semibold text-white hover:brightness-[1.12]"
        >
          <span className="material-symbols-rounded !text-[20px]">add</span>
          Créer une cotisation
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-sv-pill border px-[17px] py-[11px] text-[14px] font-medium transition-colors duration-150 ${
              tab === t.id
                ? "border-cotisations/40 bg-cotisations-bg text-cotisations"
                : "border-border text-text-tertiary hover:text-text"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {filtered.map((f) => {
            const pct = Math.min(100, Math.round((f.montant_collecte / f.montant_cible) * 100));
            const reached = f.statut === "objectif_atteint";
            const deadline = formatDeadline(f.date_limite);
            return (
              <div
                key={f.id}
                className="flex flex-col gap-[15px] rounded-sv-card border p-5"
                style={{ borderColor: reached ? "rgba(34,211,238,.3)" : "rgba(255,255,255,.09)" }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="rounded-sv-pill px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[.06em]"
                    style={{ color: STATUS_LABEL[f.statut].color, background: STATUS_LABEL[f.statut].bg }}
                  >
                    {STATUS_LABEL[f.statut].label}
                  </span>
                  {f.is_creator && (
                    <span className="rounded-sv-pill bg-white/[.07] px-2.5 py-1 text-[11px] font-medium text-text-tertiary">
                      Créée par moi
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <span className="font-sora text-[18px] font-semibold tracking-tight">{f.titre}</span>
                  <span className="text-[13px] text-text-tertiary">{f.group_name || f.contexte || "Partage libre"}</span>
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex items-baseline justify-between gap-2.5">
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-sora text-[23px] font-bold tracking-tight">{euros(f.montant_collecte)}</span>
                      <span className="text-[13px] text-text-tertiary">/ {euros(f.montant_cible)}</span>
                    </div>
                    <span className="text-[13px] font-semibold" style={{ color: reached ? "#22D3EE" : "#F472B6" }}>
                      {pct}%
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-sv-pill bg-white/[.08]">
                    <div
                      className={`h-full rounded-sv-pill ${reached ? "bg-sv-gradient-financee" : "bg-sv-gradient-cotisation"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-[13px] text-text-tertiary">
                      {f.participants_count} participation{f.participants_count > 1 ? "s" : ""}
                    </span>
                    {deadline && <span className="text-[13px] text-text-tertiary">{deadline}</span>}
                  </div>
                </div>
                <Link
                  href={`${basePath}/${f.id}`}
                  className="mt-auto flex h-[46px] items-center justify-center rounded-sv border border-border-strong bg-white/[.06] font-sora text-[14px] font-semibold hover:bg-white/[.12]"
                >
                  Voir
                </Link>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex max-w-[560px] flex-col gap-3.5 rounded-sv-card border border-dashed border-border-strong bg-surface p-[30px]">
          <span className="flex h-12 w-12 items-center justify-center rounded-sv bg-cotisations-bg">
            <span className="material-symbols-rounded !text-[24px] text-cotisations">savings</span>
          </span>
          <span className="font-sora text-[19px] font-semibold">Aucune cotisation ici</span>
          <p className="text-[14px] leading-relaxed text-text-tertiary">
            Financez votre prochaine prestation avec votre équipe : chacun participe depuis un simple lien.
          </p>
          <Link
            href="/prestations"
            className="self-start rounded-sv bg-sv-gradient px-4 py-2.5 font-sora text-[15px] font-semibold text-white"
          >
            Découvrir les prestations
          </Link>
        </div>
      )}
    </div>
  );
}
