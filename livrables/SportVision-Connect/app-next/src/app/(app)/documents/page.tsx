"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, FileText } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { hasClubFinancialAccess } from "@/lib/permissions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { LockedModule } from "@/components/ui/LockedModule";
import { RestrictedToBureau } from "@/components/ui/RestrictedToBureau";
import { cn } from "@/lib/cn";
import { INVOICE_STATUS_LABEL, INVOICE_STATUS_TONE, formatEuroTTC } from "@/components/billing/format";
import { CONTRACT_STATUS_LABEL, CONTRACT_STATUS_TONE } from "@/components/contracts/format";
import { createClient } from "@/lib/supabase/client";
import { fetchClientContracts, fetchClientDevis, fetchClientInvoices } from "@/lib/data/projet/billing";
import { resolveClubPortailClientId } from "@/lib/data/club/portail-link";
import type { ClientContract, ClientDevis } from "@/lib/data/projet/billing";
import type { Invoice } from "@/lib/types/billing";

// Écran Documents — vue consolidée devis/factures/contrats en lecture seule, calquée sur le
// module vanilla équivalent (livrables/SportVision-Connect/app/modules/club-services-documents-
// rapports.js, ClubModules.documents) : aucune action (accepter un devis, payer, signer) n'est
// dupliquée ici — ces actions vivent respectivement dans /billing et /contracts. Ce module n'est
// qu'un flux chronologique unique pour tout retrouver rapidement.

type DocKind = "devis" | "facture" | "contrat";
interface DocRow {
  kind: DocKind;
  title: string;
  date: string;
  amount: number | null;
  statusLabel: string;
  statusTone: "success" | "warning" | "danger" | "info" | "accent" | "cyan" | "neutral";
  pdfUrl?: string;
}

const DEVIS_STATUS_TONE: Record<string, DocRow["statusTone"]> = {
  brouillon: "neutral",
  "envoyé": "info",
  en_attente: "warning",
  "accepté": "success",
  "refusé": "danger",
  "expiré": "neutral",
  "annulé": "neutral",
};

export default function DocumentsPage() {
  const { ctx } = useSession();

  if (ctx.organization.type === "generic") return <ClientDocumentsView clientId={ctx.organization.id} />;
  if (ctx.organization.type === "club") return <ClubDocumentsView />;

  return <LockedModule />;
}

function ClubDocumentsView() {
  const { ctx } = useSession();
  const [clientId, setClientId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    const supabase = createClient();
    resolveClubPortailClientId(supabase, ctx.organization.id).then(setClientId);
  }, [ctx.organization.id]);

  // Communication ("Selon permission", pas automatique) et Éducateur ("Non") — §11/§13/§14 du
  // master doc. Retiré du menu (navigation.ts § filterClubRoleNav) : ce garde couvre l'accès
  // direct par URL. client_devis/client_factures/client_contrats renvoient déjà [] pour ces
  // rôles côté RLS (club_member_has_financial_access, migration-connect-v41) — sans ce message,
  // l'écran affichait "Aucun document pour le moment", trompeur (les documents existent, l'accès
  // est refusé, ce n'est pas la même chose).
  if (!hasClubFinancialAccess(ctx)) {
    return <RestrictedToBureau />;
  }

  if (clientId === undefined) {
    return <div className="py-16 text-center text-[13px] text-text-soft">Chargement…</div>;
  }

  if (clientId === null) {
    return (
      <Card className="flex flex-col items-center gap-3 px-8 py-16 text-center">
        <FileText className="h-6 w-6 text-text-faint" aria-hidden />
        <div className="max-w-md">
          <h2 className="text-[18px] font-extrabold tracking-tight">Documents pas encore reliés</h2>
          <p className="mt-2 text-[13.5px] leading-relaxed text-text-soft">
            SportVision n&apos;a pas encore relié {ctx.organization.name} à un espace Documents — vos devis, factures
            et contrats apparaîtront ici une fois ce lien fait par votre interlocuteur SportVision.
          </p>
        </div>
      </Card>
    );
  }

  return <ClientDocumentsView clientId={clientId} />;
}

function ClientDocumentsView({ clientId }: { clientId: string }) {
  const { ctx } = useSession();
  const [devis, setDevis] = useState<ClientDevis[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [contracts, setContracts] = useState<ClientContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState<"tous" | DocKind>("tous");

  async function reload() {
    setLoadError(false);
    setLoading(true);
    try {
      const supabase = createClient();
      const [dev, inv, con] = await Promise.all([
        fetchClientDevis(supabase, clientId),
        fetchClientInvoices(supabase, clientId),
        fetchClientContracts(supabase, clientId),
      ]);
      setDevis(dev);
      setInvoices(inv);
      setContracts(con);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const docs = useMemo<DocRow[]>(() => {
    const rows: DocRow[] = [
      ...devis.map((d): DocRow => ({
        kind: "devis",
        title: `Devis ${d.numero}`,
        date: d.dateExpiration ?? "",
        amount: d.totalTtc,
        statusLabel: d.statusLabel,
        statusTone: DEVIS_STATUS_TONE[d.statut] ?? "neutral",
      })),
      ...invoices.map((f): DocRow => ({
        kind: "facture",
        title: `Facture ${f.number}`,
        date: f.issueDate,
        amount: f.totalInclVat,
        statusLabel: INVOICE_STATUS_LABEL[f.status],
        statusTone: INVOICE_STATUS_TONE[f.status],
        pdfUrl: f.pdfUrl,
      })),
      ...contracts.map((c): DocRow => ({
        kind: "contrat",
        title: c.name,
        date: c.startsAt,
        amount: c.monthlyAmount ?? null,
        statusLabel: CONTRACT_STATUS_LABEL[c.status],
        statusTone: CONTRACT_STATUS_TONE[c.status],
      })),
    ];
    rows.sort((a, b) => (a.date < b.date ? 1 : -1));
    return filter === "tous" ? rows : rows.filter((r) => r.kind === filter);
  }, [devis, invoices, contracts, filter]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="text-[12px] font-bold text-text-soft">Documents</div>
        <h1 className="mt-1.5 text-[29px] font-extrabold leading-tight tracking-tight">
          Documents de {ctx.organization.name}
        </h1>
      </div>

      {loadError && (
        <Card className="flex flex-wrap items-center gap-3 border-danger-fg/30 bg-danger-bg px-5 py-4">
          <AlertTriangle className="h-[18px] w-[18px] flex-none text-danger-fg" aria-hidden />
          <span className="min-w-0 flex-1 text-[13px] font-semibold text-danger-fg">
            Impossible de charger vos documents pour le moment.
          </span>
          <Button variant="secondary" className="h-8 flex-none px-3 text-[12px]" onClick={reload}>
            Réessayer
          </Button>
        </Card>
      )}

      {loading ? (
        <Card className="flex flex-col items-center gap-2 px-8 py-16 text-center">
          <div className="text-[13.5px] font-bold text-text-soft">Chargement…</div>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["tous", "Tous"],
                ["devis", "Devis"],
                ["facture", "Factures"],
                ["contrat", "Contrats"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={cn(
                  "rounded-full border px-3.5 py-1.5 text-[12.5px] font-bold transition-colors duration-sv",
                  filter === key ? "border-brand-blue-electric bg-info-bg text-brand-blue-electric" : "border-border-strong text-text-soft",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {docs.length === 0 ? (
            <Card className="flex flex-col items-center gap-2 px-8 py-16 text-center">
              <FileText className="h-6 w-6 text-text-faint" aria-hidden />
              <div className="mt-1 text-[15px] font-extrabold">Aucun document pour le moment.</div>
            </Card>
          ) : (
            <Card>
              {docs.map((d, i) => (
                <div key={`${d.kind}-${i}`} className="flex flex-wrap items-center gap-3.5 border-b border-divider px-5 py-3.5 last:border-0">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold text-text">{d.title}</span>
                    {d.date && <span className="mt-0.5 block text-[12px] text-text-soft">{d.date}</span>}
                  </span>
                  {d.amount !== null && (
                    <span className="text-[13px] font-bold text-text-soft">{formatEuroTTC(d.amount)}</span>
                  )}
                  <Badge tone={d.statusTone}>{d.statusLabel}</Badge>
                  {d.pdfUrl && (
                    <a href={d.pdfUrl} target="_blank" rel="noreferrer" className="text-[12px] font-bold text-info-fg hover:underline">
                      Voir le PDF
                    </a>
                  )}
                </div>
              ))}
            </Card>
          )}

          <p className="text-[12.5px] text-text-soft">
            Ces documents sont gérés par votre interlocuteur SportVision — contactez-le pour toute question ou action
            sur un devis, une facture ou un contrat.
          </p>
        </>
      )}
    </div>
  );
}
