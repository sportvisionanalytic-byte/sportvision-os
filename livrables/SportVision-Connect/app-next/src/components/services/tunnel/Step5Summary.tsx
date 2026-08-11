import type { PlanCode } from "@/lib/types";
import {
  SERVICE_OPTION_BY_CODE,
  computeServicePricing,
  formatServiceDate,
  formatServicePriceHTOrDevis,
  needsRetractationWaiver,
  type CatalogueOffer,
} from "@/lib/types/services";
import type { TunnelState } from "./types";

export function Step5Summary({
  state,
  offer,
  planCode,
  onAcceptTermsChange,
  onRetractationRenonceeChange,
}: {
  state: TunnelState;
  offer: CatalogueOffer | null;
  planCode: PlanCode;
  onAcceptTermsChange: (accepted: boolean) => void;
  onRetractationRenonceeChange: (renonce: boolean) => void;
}) {
  if (!offer) return null;

  const pricing = computeServicePricing({
    basePrice: offer.prixHt,
    optionCodes: state.optionCodes,
    planCode,
    travelFees: state.travelFees,
  });
  const needsWaiver = needsRetractationWaiver(state.date);

  return (
    <div>
      <h2 className="text-[18px] font-extrabold tracking-tight">Récapitulatif</h2>
      <p className="mt-1 text-[13.5px] text-text-soft">Vérifiez les informations avant d&apos;envoyer votre demande.</p>

      <div className="mt-5 flex flex-col gap-3">
        <SummaryRow label="Prestation" value={offer.nom} />
        <SummaryRow label="Date" value={state.date ? formatServiceDate(state.date) : "—"} />
        <SummaryRow label="Horaires" value={state.startTime && state.endTime ? `${state.startTime} – ${state.endTime}` : "—"} />
        <SummaryRow label="Adresse" value={state.address || "—"} />
        {state.teamLabel && <SummaryRow label="Équipe" value={state.teamLabel} />}
        <SummaryRow label="Contact sur place" value={`${state.contactName || "—"} · ${state.contactPhone || "—"}`} />
        {state.needs && <SummaryRow label="Besoins spécifiques" value={state.needs} />}
        <SummaryRow
          label="Options"
          value={state.optionCodes.length ? state.optionCodes.map((c) => SERVICE_OPTION_BY_CODE[c].label).join(", ") : "Aucune"}
        />
        <SummaryRow label="Montant total estimé" value={formatServicePriceHTOrDevis(pricing.totalPrice)} strong />
        {pricing.depositAmount !== null && (
          <SummaryRow label="Acompte estimé" value={formatServicePriceHTOrDevis(pricing.depositAmount)} strong />
        )}
      </div>

      {needsWaiver && (
        <label className="mt-4 flex items-start gap-2.5 rounded-xl border border-warning-fg/30 bg-warning-bg p-3.5 text-[12.5px] leading-relaxed text-text-soft">
          <input
            type="checkbox"
            checked={state.retractationRenoncee}
            onChange={(e) => onRetractationRenonceeChange(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-brand-blue-electric"
          />
          Votre prestation est prévue dans moins de 14 jours. Je demande l&apos;exécution immédiate de la
          prestation et je renonce expressément à mon droit de rétractation de 14 jours (article L221-18 du Code
          de la consommation).
        </label>
      )}

      <label className="mt-4 flex items-start gap-2.5 rounded-xl border border-border bg-surface-alt p-3.5 text-[12.5px] leading-relaxed text-text-soft">
        <input
          type="checkbox"
          checked={state.acceptedTerms}
          onChange={(e) => onAcceptTermsChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-brand-blue-electric"
        />
        J&apos;accepte les conditions générales de prestation SportVision, notamment le nombre de corrections
        incluses (deux, la troisième étant facturée).
      </label>
    </div>
  );
}

function SummaryRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-divider pb-3 last:border-0 last:pb-0">
      <span className="flex-none text-[12.5px] font-bold text-text-soft">{label}</span>
      <span className={strong ? "text-right text-[14px] font-extrabold text-text" : "text-right text-[13px] text-text"}>
        {value}
      </span>
    </div>
  );
}
