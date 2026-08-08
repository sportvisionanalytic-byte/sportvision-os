"use client";

import Link from "next/link";
import { FileSignature, FileText } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { Button } from "@/components/ui/Button";
import { Card, CardPremium } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { LockedModule } from "@/components/ui/LockedModule";
import { CONTRACT_STATUS_LABEL, CONTRACT_STATUS_TONE, formatMonthlyAmount, signatureExpiresAt } from "@/components/contracts/format";
import { contractsForOrganization } from "@/lib/mock/billing";

// Écran Contrats — ACTIONS.md § 18. Bandeau premium avec les conditions clés du contrat
// principal, « Signer l'avenant » quand une signature est en attente, puis la liste des
// contrats de l'organisation.
export default function ContractsPage() {
  const { ctx } = useSession();

  if (!canAccess(ctx, "contracts")) return <LockedModule />;

  const contracts = contractsForOrganization(ctx.organization.id);

  if (contracts.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        <div>
          <div className="text-[12px] font-bold text-text-soft">Contrats</div>
          <h1 className="mt-1.5 text-[29px] font-extrabold leading-tight tracking-tight">Vos contrats</h1>
        </div>
        <Card className="flex flex-col items-center gap-2 px-8 py-16 text-center">
          <FileText className="h-6 w-6 text-text-faint" aria-hidden />
          <div className="mt-1 text-[15px] font-extrabold">Aucun contrat pour le moment.</div>
          <p className="max-w-sm text-[13px] text-text-soft">
            Vos contrats SportVision apparaîtront ici dès qu&apos;un devis sera accepté.
          </p>
        </Card>
      </div>
    );
  }

  const main = contracts.find((c) => c.status === "actif" || c.status === "a_renouveler") ?? contracts[0]!;
  const needsSignature = main.status === "a_renouveler" && !!main.signatureUrl;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="text-[12px] font-bold text-text-soft">Contrats</div>
        <h1 className="mt-1.5 text-[29px] font-extrabold leading-tight tracking-tight">Vos contrats</h1>
      </div>

      <CardPremium>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-extrabold uppercase tracking-[.1em] text-brand-blue-pale">
              Contrat principal
            </div>
            <div className="mt-1 text-[22px] font-extrabold tracking-tight">{main.name}</div>
            <div className="mt-1 text-[12.5px] text-[#B9C7EB]">
              Du {main.startsAt} au {main.endsAt}
            </div>
          </div>
          <Badge tone={CONTRACT_STATUS_TONE[main.status]}>{CONTRACT_STATUS_LABEL[main.status]}</Badge>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3.5 sm:grid-cols-4">
          <PremiumStat label="Durée d'engagement" value={`${main.commitmentMonths} mois`} />
          <PremiumStat label="Préavis" value={`${main.noticeMonths} mois`} />
          <PremiumStat label="Mensualité" value={formatMonthlyAmount(main.monthlyAmount)} />
          <PremiumStat label="Renouvellement" value="Reconduction tacite" />
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          {needsSignature && main.signatureRequestedAt && (
            <Button variant="secondary" className="border-white/25 bg-white/[.12] text-white hover:border-white/40">
              <FileSignature className="h-3.5 w-3.5" aria-hidden />
              Signer l&apos;avenant — expire le {signatureExpiresAt(main.signatureRequestedAt)}
            </Button>
          )}
          <Link href={`/contracts/${main.id}`}>
            <Button variant="primary">Ouvrir le contrat</Button>
          </Link>
        </div>
      </CardPremium>

      {contracts.length > 1 && (
        <Card>
          {contracts.map((c) => (
            <div key={c.id} className="flex items-center gap-3.5 border-b border-divider px-5 py-3.5 last:border-0">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-bold text-text">{c.name}</span>
                <span className="mt-0.5 block text-[12px] text-text-soft">Du {c.startsAt} au {c.endsAt}</span>
              </span>
              <Badge tone={CONTRACT_STATUS_TONE[c.status]}>{CONTRACT_STATUS_LABEL[c.status]}</Badge>
              <Link href={`/contracts/${c.id}`}>
                <Button variant="secondary" className="h-8 flex-none px-3 text-[12px]">
                  Ouvrir
                </Button>
              </Link>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

function PremiumStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-[#B9C7EB]">{label}</div>
      <div className="mt-1 text-[15px] font-extrabold tracking-tight">{value}</div>
    </div>
  );
}
