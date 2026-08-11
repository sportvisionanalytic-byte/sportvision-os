import { cn } from "@/lib/cn";
import type { PlanCode } from "@/lib/types";
import { PLANS } from "@/lib/plans";
import { computeServicePricing, formatServicePrice, SERVICE_OPTION_BY_CODE } from "@/lib/types/services";
import type { TunnelState } from "./types";

export function Step4Pricing({
  state,
  planCode,
  organizationAddress,
}: {
  state: TunnelState;
  planCode: PlanCode;
  organizationAddress?: string;
}) {
  if (!state.serviceType) return null;

  const pricing = computeServicePricing({
    serviceType: state.serviceType,
    optionCodes: state.optionCodes,
    planCode,
    address: state.address,
    organizationAddress,
  });
  const plan = PLANS[planCode];

  return (
    <div>
      <h2 className="text-[18px] font-extrabold tracking-tight">Tarification</h2>
      <p className="mt-1 text-[13.5px] text-text-soft">
        Estimation avant qualification par notre équipe — le montant définitif et les modalités de règlement vous
        seront communiqués dans le devis.
      </p>

      <div className="mt-5 divide-y divide-divider rounded-sv-card border border-border bg-surface">
        <PriceLine label="Forfait" value={formatServicePrice(pricing.basePrice)} />
        {state.optionCodes.map((code) => (
          <PriceLine key={code} label={SERVICE_OPTION_BY_CODE[code].label} value={`+ ${formatServicePrice(SERVICE_OPTION_BY_CODE[code].price)}`} />
        ))}
        {pricing.discountAmount > 0 && (
          <PriceLine
            label={`Remise ${plan.name} (-${pricing.discountPct} %)`}
            value={`- ${formatServicePrice(pricing.discountAmount)}`}
            tone="positive"
          />
        )}
        <PriceLine
          label="Déplacement"
          value={pricing.travelFees > 0 ? formatServicePrice(pricing.travelFees) : "Offert"}
        />
        <PriceLine label="Total estimé" value={formatServicePrice(pricing.totalPrice)} strong />
        <PriceLine label="Acompte estimé (30 %)" value={formatServicePrice(pricing.depositAmount)} strong />
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
