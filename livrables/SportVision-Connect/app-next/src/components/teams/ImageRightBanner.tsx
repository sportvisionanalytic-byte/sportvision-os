import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import type { ImageRight, ImageRightStatus } from "@/lib/types/teams";

// Bandeau droit à l'image — ACTIONS.md § 16 « Fiche joueur » : vert si l'autorisation est
// signée, orange sinon, avec le rappel de la règle bloquante (DATA_MODEL.md § ImageRight).

const STATUS_LABEL: Record<ImageRightStatus, string> = {
  signed: "Signée",
  pending: "En attente",
  refused: "Refusée",
  withdrawn: "Retirée",
};

export function imageRightBadgeTone(status: ImageRightStatus): BadgeTone {
  return status === "signed" ? "success" : "warning";
}

export function ImageRightStatusBadge({ status }: { status: ImageRightStatus }) {
  return <Badge tone={imageRightBadgeTone(status)}>{STATUS_LABEL[status]}</Badge>;
}

export function ImageRightBanner({ imageRight }: { imageRight: ImageRight | undefined }) {
  const status = imageRight?.status ?? "pending";
  const signed = status === "signed";

  return (
    <div
      className={
        signed
          ? "flex items-start gap-3 rounded-sv-card border border-success-fg/30 bg-success-bg px-4 py-3.5"
          : "flex items-start gap-3 rounded-sv-card border border-warning-fg/30 bg-warning-bg px-4 py-3.5"
      }
    >
      {signed ? (
        <CheckCircle2 className="mt-0.5 h-4.5 w-4.5 flex-none text-success-fg" aria-hidden />
      ) : (
        <AlertTriangle className="mt-0.5 h-4.5 w-4.5 flex-none text-warning-fg" aria-hidden />
      )}
      <div className="min-w-0">
        <div className={signed ? "text-[13.5px] font-extrabold text-success-fg" : "text-[13.5px] font-extrabold text-warning-fg"}>
          {signed ? "Droit à l'image signé" : "Autorisation manquante"}
        </div>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-text-soft">
          {signed
            ? `Signée${imageRight?.signedByName ? ` par ${imageRight.signedByName}` : ""}${imageRight?.signedAt ? ` le ${imageRight.signedAt}` : ""}. Les contenus de ce joueur sont publiables selon les périmètres autorisés.`
            : "Les contenus de ce joueur ne sont pas publiables tant que l'autorisation n'est pas signée."}
        </p>
      </div>
    </div>
  );
}
