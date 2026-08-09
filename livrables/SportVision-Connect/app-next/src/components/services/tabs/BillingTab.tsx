import type { Service } from "@/lib/types/services";
import { formatServicePrice, formatServicePriceOrPending } from "@/lib/types/services";
import { Button } from "@/components/ui/Button";

export function BillingTab({ service }: { service: Service }) {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <div className="rounded-sv-card border border-border bg-surface-alt p-4">
        <div className="text-[13px] font-extrabold tracking-tight">Montants</div>
        <div className="mt-3 flex flex-col gap-2 text-[13px]">
          <Row label="Forfait" value={formatServicePriceOrPending(service.basePrice)} />
          {service.optionsTotal > 0 && <Row label="Options" value={`+ ${formatServicePrice(service.optionsTotal)}`} />}
          {service.discountAmount > 0 && <Row label="Remise offre" value={`- ${formatServicePrice(service.discountAmount)}`} />}
          {service.travelFees > 0 && <Row label="Déplacement" value={formatServicePrice(service.travelFees)} />}
          <Row label="Total TTC" value={formatServicePriceOrPending(service.totalPrice)} strong />
          <Row label="Acompte (30 %)" value={formatServicePrice(service.depositAmount)} strong />
        </div>
      </div>

      <div className="rounded-sv-card border border-border bg-surface-alt p-4">
        <div className="text-[13px] font-extrabold tracking-tight">Paiement</div>
        <div className="mt-3 flex flex-col gap-2 text-[13px] text-text-soft">
          <span>
            Acompte —{" "}
            {service.depositPaidAt ? (
              <span className="font-bold text-success-fg">réglé</span>
            ) : (
              <span className="font-bold text-warning-fg">en attente</span>
            )}
          </span>
          <span>
            Solde —{" "}
            {service.balancePaidAt ? (
              <span className="font-bold text-success-fg">réglé</span>
            ) : (
              <span className="font-bold text-text-faint">à venir</span>
            )}
          </span>
        </div>
        <div className="mt-4 flex flex-wrap gap-2.5">
          <a href={service.depositInvoiceUrl} target="_blank" rel="noreferrer">
            <Button variant="secondary">Voir la facture d&apos;acompte</Button>
          </a>
          <a href={service.quoteUrl} target="_blank" rel="noreferrer">
            <Button variant="secondary">Télécharger le devis signé</Button>
          </a>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-divider pb-2 last:border-0 last:pb-0">
      <span className={strong ? "font-extrabold text-text" : "text-text-soft"}>{label}</span>
      <span className={strong ? "text-[14px] font-extrabold text-text" : "font-semibold text-text"}>{value}</span>
    </div>
  );
}
