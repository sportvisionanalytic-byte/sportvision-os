import { CheckCircle2, Clock } from "lucide-react";
import type { Service } from "@/lib/types/services";
import { formatServiceDate } from "@/lib/types/services";
import { Button } from "@/components/ui/Button";

export function ValidationTab({
  service,
  horairesConfirmed,
  onConfirm,
}: {
  service: Service;
  horairesConfirmed: boolean;
  onConfirm: () => void;
}) {
  return (
    <div className="mx-auto flex max-w-[440px] flex-col items-center gap-4 py-6 text-center">
      <span
        className={
          horairesConfirmed
            ? "flex h-14 w-14 items-center justify-center rounded-full bg-success-bg text-success-fg"
            : "flex h-14 w-14 items-center justify-center rounded-full bg-warning-bg text-warning-fg"
        }
      >
        {horairesConfirmed ? <CheckCircle2 className="h-6 w-6" aria-hidden /> : <Clock className="h-6 w-6" aria-hidden />}
      </span>
      <div>
        <div className="text-[16px] font-extrabold tracking-tight">
          {horairesConfirmed ? "Horaires confirmés" : "Merci de confirmer les horaires"}
        </div>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-text-soft">
          {formatServiceDate(service.date)} · {service.startTime} – {service.endTime} · {service.address}
        </p>
      </div>
      <Button variant="primary" onClick={onConfirm} disabled={horairesConfirmed}>
        {horairesConfirmed ? "Horaires confirmés" : "Confirmer les horaires"}
      </Button>
    </div>
  );
}
