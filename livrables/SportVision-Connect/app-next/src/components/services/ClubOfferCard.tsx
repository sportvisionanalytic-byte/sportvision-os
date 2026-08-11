"use client";

import { Lock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { isOfferLocked, offerAdvantageLabel, offerPriceLabel } from "@/lib/data/club/bookings";
import type { ClubCatalogueOffre, ClubPlan } from "@/lib/types/club-bookings";

// Carte catalogue — port de offerCard() (référence vanille, club-services-documents-rapports.js).
export function ClubOfferCard({
  offer,
  plan,
  onReserve,
}: {
  offer: ClubCatalogueOffre;
  plan: ClubPlan;
  onReserve: () => void;
}) {
  const locked = isOfferLocked(offer, plan);
  const advantage = offerAdvantageLabel(offer, plan);

  return (
    <Card className="flex flex-col gap-3 p-4.5">
      <div>
        <div className="flex items-center gap-1.5 text-[14.5px] font-extrabold tracking-tight text-text">
          {offer.nom}
          {locked && <Lock className="h-3.5 w-3.5 text-text-faint" aria-hidden />}
        </div>
        {offer.description && (
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-text-soft">{offer.description}</p>
        )}
        {offer.dureeEstimee && <p className="mt-2 text-[11.5px] text-text-faint">Délai : {offer.dureeEstimee}</p>}
      </div>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2.5">
        <div>
          <div className="text-[15px] font-extrabold text-text">{offerPriceLabel(offer)}</div>
          {advantage && <div className="text-[10.5px] font-bold text-brand-blue-electric">{advantage}</div>}
        </div>
        <Button variant="primary" className="h-9 px-3.5 text-[12.5px]" onClick={onReserve}>
          Réserver
        </Button>
      </div>
    </Card>
  );
}
