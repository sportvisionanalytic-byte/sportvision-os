import { CreditCard, Wallet } from "lucide-react";
import { cn } from "@/lib/cn";
import type { PlanCode } from "@/lib/types";
import { PLANS } from "@/lib/plans";
import { computeServicePricing, formatServicePrice, SERVICE_OPTION_BY_CODE } from "@/lib/types/services";
import type { TunnelState } from "./types";

export function Step4Pricing({
  state,
  planCode,
  organizationAddress,
  onChangeDepositMethod,
}: {
  state: TunnelState;
  planCode: PlanCode;
  organizationAddress?: string;
  onChangeDepositMethod: (method: "card" | "cash") => void;
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
      <p className="mt-1 text-[13.5px] text-text-soft">Détail du montant et de l&apos;acompte à régler pour confirmer.</p>

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
        <PriceLine label="Total" value={formatServicePrice(pricing.totalPrice)} strong />
        <PriceLine label="Acompte à régler maintenant (30 %)" value={formatServicePrice(pricing.depositAmount)} strong />
      </div>

      <div className="mt-5">
        <span className="text-[12.5px] font-bold text-text-soft">Mode de règlement de l&apos;acompte</span>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <DepositOption
            active={state.depositMethod === "card"}
            onClick={() => onChangeDepositMethod("card")}
            icon={<CreditCard className="h-4 w-4" aria-hidden />}
            label="Carte bancaire"
            description="Paiement sécurisé via Stripe, immédiat."
          />
          <DepositOption
            active={state.depositMethod === "cash"}
            onClick={() => onChangeDepositMethod("cash")}
            icon={<Wallet className="h-4 w-4" aria-hidden />}
            label="Espèces"
            description="À régler sur place le jour de la prestation."
          />
        </div>
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

function DepositOption({
  active,
  onClick,
  icon,
  label,
  description,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-start gap-3 rounded-sv-card border p-3.5 text-left transition-[border-color,box-shadow] duration-sv",
        active ? "border-brand-blue bg-info-bg shadow-sv-card-hover" : "border-border bg-surface hover:border-brand-blue-pale",
      )}
    >
      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-info-bg text-info-fg">{icon}</span>
      <span>
        <span className="block text-[13.5px] font-extrabold text-text">{label}</span>
        <span className="mt-0.5 block text-[12px] leading-relaxed text-text-soft">{description}</span>
      </span>
    </button>
  );
}
