"use client";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FORMAT_LABELS, PLATFORM_LABELS, computeValidationUrgency, type Publication } from "@/lib/types/communication";

// Carte de la file de validation — ACTIONS.md § 9 /validations. Aperçu placeholder (CHARTE.md
// § Imagerie : dégradé rayé + libellé monospace, aucune image réelle fournie), badge d'urgence,
// auteur, format, date de publication prévue.
export function ValidationCard({
  publication,
  onValidate,
  onRequestCorrection,
  onPreview,
}: {
  publication: Publication;
  onValidate: () => void;
  onRequestCorrection: () => void;
  onPreview: () => void;
}) {
  const urgency = computeValidationUrgency(publication.scheduledAt);

  return (
    <Card className="flex flex-col overflow-hidden">
      <div
        className="relative h-[112px] w-full flex-none"
        style={{
          backgroundImage:
            "repeating-linear-gradient(125deg, #4F7DFF 0px, #4F7DFF 14px, #A855F7 14px, #A855F7 28px)",
        }}
      >
        <span className="absolute inset-0 flex items-center justify-center px-3 text-center font-mono text-[10.5px] font-bold uppercase tracking-wide text-white/95">
          {PLATFORM_LABELS[publication.platform]} · {FORMAT_LABELS[publication.format]}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-2.5 p-4">
        <div className="flex items-center justify-between gap-2">
          <Badge tone={urgency === "urgent" ? "danger" : "neutral"}>{urgency === "urgent" ? "Urgent" : "Standard"}</Badge>
          <span className="text-[11px] font-semibold text-text-faint">{formatDateTime(publication.scheduledAt)}</span>
        </div>
        <div className="text-[14px] font-extrabold leading-snug tracking-tight">{publication.title}</div>
        <div className="text-[12px] font-semibold text-text-soft">Par {publication.ownerName}</div>

        <div className="mt-auto flex flex-wrap gap-2 pt-2.5">
          <button onClick={onPreview} className="text-[12px] font-bold text-brand-blue-electric hover:text-brand-violet">
            Voir en grand
          </button>
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" className="h-9 px-3 text-[12px]" onClick={onRequestCorrection}>
              Demander une correction
            </Button>
            <Button
              variant="primary"
              className="h-9 bg-[linear-gradient(135deg,#28C995,#22D3EE)] px-3 text-[12px]"
              onClick={onValidate}
            >
              Valider
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
