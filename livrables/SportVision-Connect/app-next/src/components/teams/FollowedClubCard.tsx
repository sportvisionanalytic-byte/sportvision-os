import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import type { FollowedClub } from "@/lib/types/teams";

// ACTIONS.md § 16 — pour un CM externe, /teams devient « Clubs suivis » : une carte par club
// avec publications, à valider, jauge d'avancement, statut d'accès et « Ouvrir le planning ».
const ACCESS_LABEL: Record<FollowedClub["accessStatus"], string> = {
  active: "Accès actif",
  restreint: "Accès restreint",
  en_attente: "Accès en attente",
};
const ACCESS_TONE: Record<FollowedClub["accessStatus"], "success" | "warning" | "neutral"> = {
  active: "success",
  restreint: "warning",
  en_attente: "neutral",
};

export function FollowedClubCard({ club }: { club: FollowedClub }) {
  return (
    <Card className="p-4.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[15px] font-extrabold tracking-tight">{club.clubName}</div>
          <div className="mt-1.5">
            <Badge tone={ACCESS_TONE[club.accessStatus]}>{ACCESS_LABEL[club.accessStatus]}</Badge>
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-center">
        <div className="rounded-xl bg-surface-alt px-2 py-2.5">
          <div className="text-[17px] font-extrabold">{club.publicationsCount}</div>
          <div className="text-[11px] font-bold text-text-soft">Publications</div>
        </div>
        <div className="rounded-xl bg-surface-alt px-2 py-2.5">
          <div className="text-[17px] font-extrabold text-warning-fg">{club.toValidateCount}</div>
          <div className="text-[11px] font-bold text-text-soft">À valider</div>
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-baseline justify-between text-[12px] font-semibold text-text-soft">
          <span>Avancement du mois</span>
          <span className="font-extrabold text-text">{club.progressPct} %</span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-sunken">
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand-cyan to-brand-violet"
            style={{ width: `${Math.min(100, Math.max(0, club.progressPct))}%` }}
          />
        </div>
      </div>

      <Link href="/communication" className="mt-4 block">
        <Button variant="secondary" className="w-full">
          Ouvrir le planning
        </Button>
      </Link>
    </Card>
  );
}
