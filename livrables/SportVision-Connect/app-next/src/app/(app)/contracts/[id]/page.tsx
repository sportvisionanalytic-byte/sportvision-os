"use client";

import Link from "next/link";
import { FileSignature, FileText, Paperclip } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { LockedModule } from "@/components/ui/LockedModule";
import {
  CONTRACT_STATUS_LABEL,
  CONTRACT_STATUS_TONE,
  SCHEDULE_STATUS_LABEL,
  SCHEDULE_STATUS_TONE,
  signatureExpiresAt,
} from "@/components/contracts/format";
import { mockContracts, schedulesForContract } from "@/lib/mock/billing";

// Fiche contrat — ACTIONS.md § 18 : 8 conditions, 5 points « à retenir », échéancier, aperçu
// PDF, « Signer avec Youtrust » (lien 8 jours), annexes.
export default function ContractDetailPage({ params }: { params: { id: string } }) {
  const { ctx } = useSession();

  if (!canAccess(ctx, "contracts")) return <LockedModule />;

  const contract = mockContracts.find((c) => c.id === params.id && c.organizationId === ctx.organization.id);

  if (!contract) {
    return (
      <Card className="flex flex-col items-center gap-3 px-8 py-16 text-center">
        <div className="text-[15px] font-extrabold">Contrat introuvable.</div>
        <Link href="/contracts">
          <Button variant="secondary">Retour aux contrats</Button>
        </Link>
      </Card>
    );
  }

  const schedule = schedulesForContract(contract.id);
  const needsSignature = !!contract.signatureUrl && !contract.signedAt;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/contracts" className="text-[12px] font-bold text-text-soft hover:text-brand-blue-electric">
            ← Contrats
          </Link>
          <h1 className="mt-1.5 text-[29px] font-extrabold leading-tight tracking-tight">{contract.name}</h1>
          <div className="mt-1.5">
            <Badge tone={CONTRACT_STATUS_TONE[contract.status]}>{CONTRACT_STATUS_LABEL[contract.status]}</Badge>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <Button variant="secondary">
            <Paperclip className="h-3.5 w-3.5" aria-hidden />
            Voir les annexes
          </Button>
          {needsSignature && (
            <Button variant="primary">
              <FileSignature className="h-3.5 w-3.5" aria-hidden />
              Signer avec Youtrust
            </Button>
          )}
        </div>
      </div>

      {needsSignature && contract.signatureRequestedAt && (
        <Card className="flex items-start gap-3 border-warning-fg/30 bg-warning-bg px-4 py-3.5">
          <FileSignature className="mt-0.5 h-4.5 w-4.5 flex-none text-warning-fg" aria-hidden />
          <p className="text-[12.5px] leading-relaxed text-warning-fg">
            Ce contrat attend votre signature. Le lien Youtrust expire le{" "}
            {signatureExpiresAt(contract.signatureRequestedAt)}.
          </p>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-4.5 lg:col-span-2">
          <div className="text-[14px] font-extrabold tracking-tight">Conditions</div>
          <dl className="mt-3.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {contract.conditions.map((c) => (
              <div key={c.label}>
                <dt className="text-[11px] font-bold uppercase tracking-[.04em] text-text-faint">{c.label}</dt>
                <dd className="mt-1 text-[13.5px] font-bold text-text">{c.value}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card className="p-4.5">
          <div className="text-[14px] font-extrabold tracking-tight">À retenir</div>
          <ul className="mt-3.5 flex flex-col gap-2.5">
            {contract.keyTerms.map((term) => (
              <li key={term.id} className="flex items-start gap-2 text-[12.5px] leading-relaxed text-text-soft">
                <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-brand-blue-electric" aria-hidden />
                {term.label}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="p-4.5">
        <div className="text-[14px] font-extrabold tracking-tight">Échéancier</div>
        {schedule.length === 0 ? (
          <p className="mt-3 text-[12.5px] text-text-soft">Aucune échéance enregistrée.</p>
        ) : (
          <div className="mt-3.5 flex flex-col gap-0">
            {schedule
              .slice()
              .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))
              .map((s) => (
                <div key={s.id} className="flex items-center gap-3.5 border-b border-divider py-3 last:border-0">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold text-text">{s.label}</span>
                    <span className="mt-0.5 block text-[11.5px] text-text-soft">Échéance : {s.dueDate}</span>
                  </span>
                  {typeof s.amount === "number" && (
                    <span className="text-[12.5px] font-bold text-text-soft">{s.amount.toLocaleString("fr-FR")} € TTC</span>
                  )}
                  <Badge tone={SCHEDULE_STATUS_TONE[s.status]}>{SCHEDULE_STATUS_LABEL[s.status]}</Badge>
                </div>
              ))}
          </div>
        )}
      </Card>

      <Card className="flex items-center justify-between gap-4 p-4.5">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-neutral-bg text-neutral-fg">
            <FileText className="h-4.5 w-4.5" aria-hidden />
          </span>
          <div>
            <div className="text-[13.5px] font-bold text-text">Aperçu du contrat</div>
            <div className="text-[12px] text-text-soft">Document PDF signé électroniquement via Youtrust</div>
          </div>
        </div>
        <Button variant="secondary">Ouvrir l&apos;aperçu</Button>
      </Card>
    </div>
  );
}
