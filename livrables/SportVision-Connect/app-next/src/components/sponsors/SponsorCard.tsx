import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { visibilityGauge } from "@/lib/mock/sponsors";
import type { Sponsor } from "@/lib/types/sponsors";
import { SPONSOR_LEVEL_LABEL, SPONSOR_LEVEL_TONE, SPONSOR_STATUS_LABEL, SPONSOR_STATUS_TONE, formatEuro } from "./format";

// Carte sponsor avec jauge de visibilité — ACTIONS.md § 17, écran /sponsors.
export function SponsorCard({ sponsor }: { sponsor: Sponsor }) {
  const gauge = visibilityGauge(sponsor.id);

  return (
    <Link href={`/sponsors/${sponsor.id}`}>
      <Card className="h-full p-4.5 hover:-translate-y-0.5 hover:border-brand-blue-pale hover:shadow-sv-card-hover">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-[15px] font-extrabold tracking-tight">{sponsor.name}</div>
            {sponsor.sector && <div className="mt-0.5 text-[12px] text-text-soft">{sponsor.sector}</div>}
          </div>
          <Badge tone={SPONSOR_LEVEL_TONE[sponsor.level]}>{SPONSOR_LEVEL_LABEL[sponsor.level]}</Badge>
        </div>

        <div className="mt-4">
          <div className="flex items-baseline justify-between text-[12px] font-semibold text-text-soft">
            <span>Visibilité livrée</span>
            <span className="font-extrabold text-text">{gauge === null ? "Non suivi" : `${gauge} %`}</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-sunken">
            {gauge !== null && (
              <div
                className="h-full rounded-full bg-gradient-to-r from-brand-cyan to-brand-violet"
                style={{ width: `${Math.min(100, Math.max(0, gauge))}%` }}
              />
            )}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-divider pt-3">
          <span className="text-[12px] font-semibold text-text-soft">{formatEuro(sponsor.annualAmount)} / an</span>
          <Badge tone={SPONSOR_STATUS_TONE[sponsor.status]}>{SPONSOR_STATUS_LABEL[sponsor.status]}</Badge>
        </div>
      </Card>
    </Link>
  );
}
