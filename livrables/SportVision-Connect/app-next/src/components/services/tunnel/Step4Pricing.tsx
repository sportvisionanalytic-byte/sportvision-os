import { cn } from "@/lib/cn";
import type { PlanCode } from "@/lib/types";
import { PLANS } from "@/lib/plans";
import {
  computeServicePricing,
  formatServicePriceHT,
  formatServicePriceHTOrDevis,
  SERVICE_OPTION_BY_CODE,
  type CatalogueOffer,
} from "@/lib/types/services";
import type { TunnelState } from "./types";

export function Step4Pricing({
  state,
  offer,
  planCode,
}: {
  state: TunnelState;
  offer: CatalogueOffer | null;
  planCode: PlanCode;
}) {
  if (!offer) return null;

  const pricing = computeServicePricing({
    basePrice: offer.prixHt,
    optionCodes: state.optionCodes,
    planCode,
    travelFees: state.travelFees,
  });
  const plan = PLANS[planCode];

  return (
    <div>
      <h2 className="text-[18px] font-extrabold tracking-tight">Tarification</h2>
      <p className="mt-1 text-[13.5px] text-text-soft">
        Estimation HT avant qualification par notre équipe — le montant définitif et les modalités de règlement
        vous seront communiqués dans le devis.
      </p>

      <div className="mt-5 divide-y divide-divider rounded-sv-card border border-border bg-surface">
        <PriceLine label="Forfait" value={formatServicePriceHTOrDevis(offer.prixHt)} />
        {state.optionCodes.map((code) => (
          <PriceLine key={code} label={SERVICE_OPTION_BY_CODE[code].label} value={`+ ${formatServicePriceHT(SERVICE_OPTION_BY_CODE[code].price)}`} />
        ))}
        {pricing.discountAmount > 0 && (
          <PriceLine
            label={`Remise ${plan.name} (-${pricing.discountPct} %)`}
            value={`- ${formatServicePriceHT(pricing.discountAmount)}`}
            tone="positive"
          />
        )}
        {pricing.totalPrice !== null && (
          <PriceLine
            label="Déplacement"
            value={pricing.travelFees > 0 ? formatServicePriceHT(pricing.travelFees) : "Offert"}
          />
        )}
        <PriceLine label="Total estimé" value={formatServicePriceHTOrDevis(pricing.totalPrice)} strong />
        {pricing.depositAmount !== null && (
          <PriceLine label="Acompte estimé (30 %)" value={formatServicePriceHT(pricing.depositAmount)} strong />
        )}
      </div>
    </div>
  );
}

function PriceLine({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: "positive";
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className={cn("text-[13px]", strong ? "font-extrabold text-text" : "text-text-soft")}>{label}</span>
      <span
        className={cn(
          "text-[13.5px] font-bold",
          strong ? "text-[15px] font-extrabold text-text" : tone === "positive" ? "text-success-fg" : "text-text",
        )}
      >
        {value}
      </span>
    </div>
  );
}
