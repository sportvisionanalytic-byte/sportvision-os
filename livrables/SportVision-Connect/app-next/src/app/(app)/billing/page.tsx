"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CreditCard, FileText, Receipt } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { LockedModule } from "@/components/ui/LockedModule";
import { Toast, useToast } from "@/components/feedback/Toast";
import { INVOICE_STATUS_LABEL, INVOICE_STATUS_TONE, formatEuroTTC, formatPaymentMethod } from "@/components/billing/format";
import { contractsForOrganization, invoicesForOrganization, mockPaymentMethods } from "@/lib/mock/billing";
import { createClient } from "@/lib/supabase/client";
import {
  decideDevis,
  fetchClientContracts,
  fetchClientDevis,
  fetchClientInvoices,
  signContract,
  type ClientContract,
  type ClientDevis,
} from "@/lib/data/projet/billing";
import type { Invoice } from "@/lib/types/billing";

function daysLate(dueDate: string): number {
  const diff = Date.now() - new Date(dueDate).getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

// Écran Factures — ACTIONS.md § 19. 3 cartes (facture en retard, prochaine mensualité, moyen de
// paiement) puis la liste des factures.
export default function BillingPage() {
  const { ctx } = useSession();

  const isAffiliatedPlayer = ctx.organization.type === "player" && !!ctx.organization.parentOrganizationId;
  if (isAffiliatedPlayer) return <AffiliatedPlayerNotice />;

  // Espace Projet/ponctuel — devis/factures/contrats réels (vues client_*), pas le module
  // "billing" club (verrouillé, voir Phase 1). Bypass volontaire du gate canAccess ci-dessous,
  // même pattern que la vue partenaire sponsor.
  if (ctx.organization.type === "generic") return <ProjetBillingView />;

  if (!canAccess(ctx, "billing")) return <LockedModule />;

  const invoices = invoicesForOrganization(ctx.organization.id);
  const overdue = invoices.find((i) => i.status === "en_retard");
  const upcoming = invoices
    .filter((i) => i.status === "a_payer")
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))[0];
  const paymentMethod = mockPaymentMethods[ctx.organization.id];
  const mainContract = contractsForOrganization(ctx.organization.id)[0];
  const priorityInvoice = overdue ?? upcoming;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[12px] font-bold text-text-soft">Factures</div>
          <h1 className="mt-1.5 text-[29px] font-extrabold leading-tight tracking-tight">
            Facturation de {ctx.organization.name}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {mainContract && (
            <Link href={`/contracts/${mainContract.id}`}>
              <Button variant="secondary">Voir l&apos;échéancier</Button>
            </Link>
          )}
          <Button variant="secondary">Gérer le moyen de paiement</Button>
          {priorityInvoice && (
            <Link href={`/billing/${priorityInvoice.id}`}>
              <Button variant="primary">Payer maintenant</Button>
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className={overdue ? "border-danger-fg/30 bg-danger-bg p-4.5" : "p-4.5"}>
          <div className={overdue ? "flex items-center gap-2 text-danger-fg" : "flex items-center gap-2 text-text-soft"}>
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            <span className="text-[11.5px] font-bold uppercase tracking-[.04em]">Facture en retard</span>
          </div>
          {overdue ? (
            <>
              <div className="mt-2 text-[20px] font-extrabold tracking-tight text-danger-fg">
                {formatEuroTTC(overdue.totalInclVat)}
              </div>
              <div className="mt-0.5 text-[12px] font-semibold text-danger-fg">
                {overdue.number} · en retard depuis {daysLate(overdue.dueDate)} j
              </div>
            </>
          ) : (
            <div className="mt-2 text-[13.5px] font-bold text-success-fg">Aucune facture en retard.</div>
          )}
        </Card>

        <Card className="p-4.5">
          <div className="flex items-center gap-2 text-text-soft">
            <Receipt className="h-3.5 w-3.5" aria-hidden />
            <span className="text-[11.5px] font-bold uppercase tracking-[.04em]">Prochaine mensualité</span>
          </div>
          {upcoming ? (
            <>
              <div className="mt-2 text-[20px] font-extrabold tracking-tight">{formatEuroTTC(upcoming.totalInclVat)}</div>
              <div className="mt-0.5 text-[12px] font-semibold text-text-soft">Échéance le {upcoming.dueDate}</div>
            </>
          ) : (
            <div className="mt-2 text-[13.5px] font-bold text-text-soft">Aucune échéance à venir.</div>
          )}
        </Card>

        <Card className="p-4.5">
          <div className="flex items-center gap-2 text-text-soft">
            <CreditCard className="h-3.5 w-3.5" aria-hidden />
            <span className="text-[11.5px] font-bold uppercase tracking-[.04em]">Moyen de paiement</span>
          </div>
          {paymentMethod ? (
            <div className="mt-2 text-[15px] font-extrabold tracking-tight">{formatPaymentMethod(paymentMethod)}</div>
          ) : (
            <div className="mt-2 text-[13.5px] font-bold text-text-soft">Aucun moyen de paiement enregistré.</div>
          )}
        </Card>
      </div>

      {invoices.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 px-8 py-16 text-center">
          <FileText className="h-6 w-6 text-text-faint" aria-hidden />
          <div className="mt-1 text-[15px] font-extrabold">Aucune facture pour le moment.</div>
        </Card>
      ) : (
        <Card>
          {invoices.map((inv) => (
            <Link
              key={inv.id}
              href={`/billing/${inv.id}`}
              className="flex items-center gap-3.5 border-b border-divider px-5 py-3.5 last:border-0 hover:bg-row-hover"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[12.5px] font-bold text-text">{inv.number}</span>
                <span className="mt-0.5 block truncate text-[12px] text-text-soft">{inv.subject}</span>
              </span>
              <span className="w-24 flex-none text-right text-[13px] font-bold text-text">
                {formatEuroTTC(inv.totalInclVat)}
              </span>
              <span className="w-28 flex-none text-right text-[12px] text-text-soft">Échéance {inv.dueDate}</span>
              <Badge tone={INVOICE_STATUS_TONE[inv.status]}>{INVOICE_STATUS_LABEL[inv.status]}</Badge>
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}

function ProjetBillingView() {
  const { ctx } = useSession();
  const { toastMessage, toastTone, showToast } = useToast();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [devis, setDevis] = useState<ClientDevis[]>([]);
  const [contracts, setContracts] = useState<ClientContract[]>([]);
  const [busy, setBusy] = useState(false);

  async function reload() {
    const supabase = createClient();
    const [inv, dev, con] = await Promise.all([
      fetchClientInvoices(supabase, ctx.organization.id),
      fetchClientDevis(supabase, ctx.organization.id),
      fetchClientContracts(supabase, ctx.organization.id),
    ]);
    setInvoices(inv);
    setDevis(dev);
    setContracts(con);
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.organization.id]);

  const pendingDevis = devis.find((d) => d.decidable);
  const awaitingContract = contracts.find((c) => c.awaitingSignature);
  const overdue = invoices.find((i) => i.status === "en_retard");
  const upcoming = invoices.filter((i) => i.status === "a_payer").sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))[0];

  async function handleDevisDecision(decision: "accepté" | "refusé") {
    if (!pendingDevis) return;
    setBusy(true);
    try {
      const supabase = createClient();
      await decideDevis(supabase, pendingDevis.id, decision);
      await reload();
    } catch {
      showToast("Action impossible, réessayez.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleSignContract() {
    if (!awaitingContract) return;
    const name = `${ctx.user.firstName} ${ctx.user.lastName}`.trim();
    setBusy(true);
    try {
      const supabase = createClient();
      await signContract(supabase, awaitingContract.id, name);
      await reload();
    } catch {
      showToast("Signature impossible, réessayez.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="text-[12px] font-bold text-text-soft">Facturation</div>
        <h1 className="mt-1.5 text-[29px] font-extrabold leading-tight tracking-tight">
          Devis, contrats et factures de {ctx.organization.name}
        </h1>
      </div>

      {pendingDevis && (
        <Card className="flex flex-wrap items-center gap-3 border-brand-blue-pale/40 bg-info-bg px-5 py-4">
          <FileText className="h-[18px] w-[18px] flex-none text-info-fg" aria-hidden />
          <span className="min-w-0 flex-1 text-[13px] font-semibold text-info-fg">
            Devis {pendingDevis.numero} · {formatEuroTTC(pendingDevis.totalTtc)} — en attente de votre décision.
          </span>
          <Button variant="secondary" className="h-8 flex-none px-3 text-[12px]" disabled={busy} onClick={() => handleDevisDecision("refusé")}>
            Refuser
          </Button>
          <Button variant="primary" className="h-8 flex-none px-3 text-[12px]" disabled={busy} onClick={() => handleDevisDecision("accepté")}>
            Accepter
          </Button>
        </Card>
      )}

      {awaitingContract && (
        <Card className="flex flex-wrap items-center gap-3 border-brand-blue-pale/40 bg-info-bg px-5 py-4">
          <FileText className="h-[18px] w-[18px] flex-none text-info-fg" aria-hidden />
          <span className="min-w-0 flex-1 text-[13px] font-semibold text-info-fg">
            Contrat {awaitingContract.name} — signature demandée.
          </span>
          <Button variant="primary" className="h-8 flex-none px-3 text-[12px]" disabled={busy} onClick={handleSignContract}>
            Signer
          </Button>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card className={overdue ? "border-danger-fg/30 bg-danger-bg p-4.5" : "p-4.5"}>
          <div className={overdue ? "flex items-center gap-2 text-danger-fg" : "flex items-center gap-2 text-text-soft"}>
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            <span className="text-[11.5px] font-bold uppercase tracking-[.04em]">Facture en retard</span>
          </div>
          {overdue ? (
            <>
              <div className="mt-2 text-[20px] font-extrabold tracking-tight text-danger-fg">{formatEuroTTC(overdue.totalInclVat)}</div>
              <div className="mt-0.5 text-[12px] font-semibold text-danger-fg">
                {overdue.number} · en retard depuis {daysLate(overdue.dueDate)} j
              </div>
            </>
          ) : (
            <div className="mt-2 text-[13.5px] font-bold text-success-fg">Aucune facture en retard.</div>
          )}
        </Card>

        <Card className="p-4.5">
          <div className="flex items-center gap-2 text-text-soft">
            <Receipt className="h-3.5 w-3.5" aria-hidden />
            <span className="text-[11.5px] font-bold uppercase tracking-[.04em]">Prochaine échéance</span>
          </div>
          {upcoming ? (
            <>
              <div className="mt-2 text-[20px] font-extrabold tracking-tight">{formatEuroTTC(upcoming.totalInclVat)}</div>
              <div className="mt-0.5 text-[12px] font-semibold text-text-soft">Échéance le {upcoming.dueDate}</div>
            </>
          ) : (
            <div className="mt-2 text-[13.5px] font-bold text-text-soft">Aucune échéance à venir.</div>
          )}
        </Card>
      </div>

      {invoices.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 px-8 py-16 text-center">
          <FileText className="h-6 w-6 text-text-faint" aria-hidden />
          <div className="mt-1 text-[15px] font-extrabold">Aucune facture pour le moment.</div>
        </Card>
      ) : (
        <Card>
          {invoices.map((inv) => (
            <div key={inv.id} className="flex items-center gap-3.5 border-b border-divider px-5 py-3.5 last:border-0">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[12.5px] font-bold text-text">{inv.number}</span>
                <span className="mt-0.5 block truncate text-[12px] text-text-soft">{inv.subject}</span>
              </span>
              <span className="w-24 flex-none text-right text-[13px] font-bold text-text">{formatEuroTTC(inv.totalInclVat)}</span>
              <span className="w-28 flex-none text-right text-[12px] text-text-soft">Échéance {inv.dueDate}</span>
              <Badge tone={INVOICE_STATUS_TONE[inv.status]}>{INVOICE_STATUS_LABEL[inv.status]}</Badge>
            </div>
          ))}
        </Card>
      )}

      <Toast message={toastMessage} tone={toastTone} />
    </div>
  );
}

function AffiliatedPlayerNotice() {
  const { ctx } = useSession();
  const [clubName, setClubName] = useState<string | null>(null);

  useEffect(() => {
    if (!ctx.organization.parentOrganizationId) return;
    const supabase = createClient();
    supabase
      .from("organizations")
      .select("nom")
      .eq("id", ctx.organization.parentOrganizationId)
      .maybeSingle()
      .then(({ data }) => setClubName((data as { nom: string } | null)?.nom ?? null));
  }, [ctx.organization.parentOrganizationId]);

  return (
    <Card className="flex flex-col items-center gap-3 px-8 py-16 text-center">
      <Receipt className="h-6 w-6 text-text-faint" aria-hidden />
      <div className="max-w-md">
        <h2 className="text-[18px] font-extrabold tracking-tight">Vos factures sont gérées par votre club</h2>
        <p className="mt-2 text-[13.5px] leading-relaxed text-text-soft">
          En tant que joueur rattaché à un club abonné, votre facturation est portée par
          l&apos;organisation qui vous accueille — voir README.md § Joueur affilié vs indépendant.
        </p>
      </div>
      {clubName && <div className="text-[12.5px] font-bold text-text-soft">Club : {clubName}</div>}
    </Card>
  );
}
