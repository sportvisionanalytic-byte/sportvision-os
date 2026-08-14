"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { CatalogueOffer } from "@/lib/prestations/catalogue";
import { baseTtc, categorieIcon } from "@/lib/prestations/catalogue";
import { formatEUR } from "@/lib/prestations/format";
import { gradientFor } from "@/lib/avatarGradients";
import type { AthleteRow } from "@/lib/supabase/particulier";

type BenefKind = "self" | "linked" | "managed";

export function PrestationsParticulierView({
  firstName,
  athletes,
  offers,
  initialBenefKind,
  initialBenefId,
}: {
  firstName: string;
  athletes: AthleteRow[];
  offers: CatalogueOffer[];
  initialBenefKind: BenefKind;
  initialBenefId: string | null;
}) {
  const router = useRouter();
  const [benefKind, setBenefKind] = useState<BenefKind>(initialBenefKind);
  const [benefId, setBenefId] = useState<string | null>(initialBenefId);

  const beneficiaries = useMemo(
    () => [
      { kind: "self" as BenefKind, id: null as string | null, label: "Pour moi", initial: (firstName[0] || "?").toUpperCase() },
      ...athletes.map((a) => ({ kind: a.kind as BenefKind, id: a.refId, label: `${a.firstName} ${a.lastName}`.trim(), initial: (a.firstName[0] || "?").toUpperCase() })),
    ],
    [athletes, firstName],
  );

  function selectBenef(kind: BenefKind, id: string | null) {
    setBenefKind(kind);
    setBenefId(id);
  }

  function goToOffer(offerId: string) {
    const params = new URLSearchParams({ benefKind });
    if (benefId) params.set("benefId", benefId);
    router.push(`/particulier/reserver/${offerId}?${params.toString()}`);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-sora text-[33px] font-bold tracking-tight">Prestations SportVision</h1>
        <p className="text-[15px] text-text-tertiary">Pour vous ou pour un sportif que vous accompagnez.</p>
      </div>

      <div className="flex flex-col gap-3">
        <span className="text-[13px] font-medium text-text-secondary">Pour qui réservez-vous ?</span>
        <div className="flex flex-wrap gap-2">
          {beneficiaries.map((b) => {
            const active = b.kind === benefKind && b.id === benefId;
            return (
              <button
                key={`${b.kind}:${b.id}`}
                type="button"
                onClick={() => selectBenef(b.kind, b.id)}
                className={`flex items-center gap-2.5 rounded-sv-pill border py-2 pl-2 pr-4 text-[14px] font-medium transition-colors duration-150 ${
                  active ? "border-[rgba(140,169,255,.65)] bg-[rgba(79,125,255,.2)] text-text" : "border-border text-text-secondary hover:text-text"
                }`}
              >
                <span
                  className="flex h-7 w-7 flex-none items-center justify-center rounded-full font-sora text-[11px] font-semibold text-white"
                  style={{ background: gradientFor(`${b.kind}:${b.id ?? "self"}`) }}
                >
                  {b.initial}
                </span>
                {b.label}
              </button>
            );
          })}
        </div>
        {athletes.length === 0 && (
          <span className="text-[12.5px] text-text-faint">
            Aucun sportif ne vous a encore autorisé à réserver pour lui. Vous pouvez réserver pour vous-même.
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {offers.map((offer) => {
          const ttc = baseTtc(offer);
          return (
            <button
              key={offer.id}
              type="button"
              onClick={() => goToOffer(offer.id)}
              className="flex flex-col overflow-hidden rounded-sv-card border border-border bg-surface text-left transition-colors duration-150 hover:border-[rgba(140,169,255,.45)]"
            >
              <div
                className="flex h-[100px] items-center px-[18px]"
                style={{ background: "linear-gradient(135deg,#3B1E6E 0%,#22307A 55%,#0F4C63 100%)" }}
              >
                <span className="flex h-[46px] w-[46px] items-center justify-center rounded-sv bg-[rgba(9,8,26,.42)]">
                  <span className="material-symbols-rounded !text-[23px] text-white">{categorieIcon(offer.categorie)}</span>
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-2.5 p-[18px]">
                <span className="font-sora text-[16px] font-semibold tracking-tight">{offer.nom}</span>
                <span className="text-[13px] leading-relaxed text-text-tertiary">{offer.description || ""}</span>
                <div className="mt-auto flex items-center justify-between gap-2.5 pt-1.5">
                  <span className="font-sora text-[15px] font-semibold">{ttc !== null ? `${formatEUR(ttc)} TTC` : "Sur devis"}</span>
                  <span className="flex items-center gap-1.5 font-sora text-[13.5px] font-semibold text-prestations">
                    Réserver
                    <span className="material-symbols-rounded !text-[16px]">arrow_forward</span>
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
