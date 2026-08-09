"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, FileText, Receipt } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { LockedModule } from "@/components/ui/LockedModule";
import { Toast, useToast } from "@/components/feedback/Toast";
import { INVOICE_STATUS_LABEL, INVOICE_STATUS_TONE, formatEuroTTC } from "@/components/billing/format";
import { CONTRACT_STATUS_LABEL, CONTRACT_STATUS_TONE } from "@/components/contracts/format";
import { createClient } from "@/lib/supabase/client";
import {
  decideDevis,
  fetchClientContracts,
  fetchClientDevis,
  fetchClientInvoices,
  type ClientContract,
  type ClientDevis,
} from "@/lib/data/projet/billing";
import { resolveClubPortailClientId } from "@/lib/data/club/portail-link";
import type { Invoice } from "@/lib/types/billing";

function daysLate(dueDate: string): number {
  const diff = Date.now() - new Date(dueDate).getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

// Écran Factures — ACTIONS.md § 19. Un seul flux réel (vues client_devis/client_factures/
// client_contrats) pour deux personas : Espace Projet (client_id = organization.id directement)
// et Club (client_id = clubs.portail_client_id, résolu — un club n'est pas lui-même une ligne
// `clients`, voir portail-link.ts). Le joueur affilié n'a pas de facturation propre (portée par
// son club). Les autres types restent verrouillés (aucune donnée financière réelle à leur nom).
export default function BillingPage() {
  const { ctx } = useSession();

  const isAffiliatedPlayer = ctx.organization.type === "player" && !!ctx.organization.parentOrganizationId;
  if (isAffiliatedPlayer) return <AffiliatedPlayerNotice />;

  if (ctx.organization.type === "generic") return <BillingDocumentsView clientId={ctx.organization.id} allowDevisDecision />;
  if (ctx.organization.type === "club") return <ClubBillingView />;

  return <LockedModule />;
}

function ClubBillingView() {
  const { ctx } = useSession();
  const [clientId, setClientId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    const supabase = createClient();
    resolveClubPortailClientId(supabase, ctx.organization.id).then(setClientId);
  }, [ctx.organization.id]);

  if (clientId === undefined) {
    return <div className="py-16 text-center text-[13px] text-text-soft">Chargement…</div>;
  }

  if (clientId === null) {
    return (
      <Card className="flex flex-col items-center gap-3 px-8 py-16 text-center">
        <Receipt className="h-6 w-6 text-text-faint" aria-hidden />
        <div className="max-w-md">
          <h2 className="text-[18px] font-extrabold tracking-tight">Facturation pas encore reliée</h2>
          <p className="mt-2 text-[13.5px] leading-relaxed text-text-soft">
            SportVision n&apos;a pas encore relié {ctx.organization.name} à un espace Facturation. Contactez votre
            interlocuteur SportVision pour l&apos;activer.
          </p>
        </div>
      </Card>
    );
  }

  return <BillingDocumentsView clientId={clientId} allowDevisDecision={false} />;
}

function BillingDocumentsView({ clientId, allowDevisDecision }: { clientId: string; allowDevisDecision: boolean }) {
  const { ctx } = useSession();
  const { toastMessage, toastTone, showToast } = useToast();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [devis, setDevis] = useState<ClientDevis[]>([]);
  const [contracts, setContracts] = useState<ClientContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [decidingDevisId, setDecidingDevisId] = useState<string | null>(null);

  async function reload() {
    setLoadError(false);
    try {
      const supabase = createClient();
      const [inv, dev, con] = await Promise.all([
        fetchClientInvoices(supabase, clientId),
        fetchClientDevis(supabase, clientId),
        fetchClientContracts(supabase, clientId),
      ]);
      setInvoices(inv);
      setDevis(dev);
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

  const pendingDevisList = allowDevisDecision ? devis.filter((d) => d.decidable) : [];
  const overdue = invoices.find((i) => i.status === "en_retard");
  // "emise" seulement : les factures en_retard ont déjà leur propre carte ci-dessous, les
  // reprendre ici doublonnerait le même montant sous deux étiquettes différentes.
  const upcoming = invoices.filter((i) => i.status === "emise").sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))[0];

  async function handleDevisDecision(devisId: string, decision: "accepté" | "refusé") {
    setDecidingDevisId(devisId);
    try {
      const supabase = createClient();
      await decideDevis(supabase, devisId, decision);
      await reload();
    } catch {
      showToast("Action impossible, réessayez.", "error");
    } finally {
      setDecidingDevisId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-5">
        <div>
          <div className="text-[12px] font-bold text-text-soft">Facturation</div>
          <h1 className="mt-1.5 text-[29px] font-extrabold leading-tight tracking-tight">
            Devis, contrats et factures de {ctx.organization.name}
          </h1>
        </div>
        <Card className="flex flex-col items-center gap-2 px-8 py-16 text-center">
          <div className="text-[13.5px] font-bold text-text-soft">Chargement de vos informations…</div>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="text-[12px] font-bold text-text-soft">Facturation</div>
        <h1 className="mt-1.5 text-[29px] font-extrabold leading-tight tracking-tight">
          Devis, contrats et factures de {ctx.organization.name}
        </h1>
      </div>

      {loadError && (
        <Card className="flex flex-wrap items-center gap-3 border-danger-fg/30 bg-danger-bg px-5 py-4">
          <AlertTriangle className="h-[18px] w-[18px] flex-none text-danger-fg" aria-hidden />
          <span className="min-w-0 flex-1 text-[13px] font-semibold text-danger-fg">
            Impossible de charger certaines de vos informations. Les montants ci-dessous peuvent être incomplets.
          </span>
          <Button variant="secondary" className="h-8 flex-none px-3 text-[12px]" onClick={reload}>
            Réessayer
          </Button>
        </Card>
      )}

      {pendingDevisList.map((d) => (
        <Card key={d.id} className="flex flex-wrap items-center gap-3 border-brand-blue-pale/40 bg-info-bg px-5 py-4">
          <FileText className="h-[18px] w-[18px] flex-none text-info-fg" aria-hidden />
          <span className="min-w-0 flex-1 text-[13px] font-semibold text-info-fg">
            Devis {d.numero} · {formatEuroTTC(d.totalTtc)} — en attente de votre décision.
          </span>
          <Button
            variant="secondary"
            className="h-8 flex-none px-3 text-[12px]"
            disabled={decidingDevisId === d.id}
            onClick={() => handleDevisDecision(d.id, "refusé")}
          >
            Refuser
          </Button>
          <Button
            variant="primary"
            className="h-8 flex-none px-3 text-[12px]"
            disabled={decidingDevisId === d.id}
            onClick={() => handleDevisDecision(d.id, "accepté")}
          >
            Accepter
          </Button>
        </Card>
      ))}

      {contracts.length > 0 && (
        <Card>
          {contracts.map((c) => (
            <div key={c.id} className="flex flex-col gap-1.5 border-b border-divider px-5 py-3.5 last:border-0">
              <div className="flex items-center gap-3.5">
                <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-text">{c.name}</span>
                <Badge tone={CONTRACT_STATUS_TONE[c.status]}>{CONTRACT_STATUS_LABEL[c.status]}</Badge>
              </div>
              {c.awaitingSignature && (
                <p className="text-[12px] text-text-soft">
                  Signature demandée — vous avez reçu un e-mail de notre partenaire de signature électronique
                  (Youtrust) avec un lien pour signer. Vérifiez votre boîte mail, y compris les spams.
                </p>
              )}
            </div>
          ))}
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
              {inv.pdfUrl && (
                <a
                  href={inv.pdfUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-none text-[12px] font-bold text-info-fg hover:underline"
                >
                  Voir le PDF
                </a>
              )}
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
