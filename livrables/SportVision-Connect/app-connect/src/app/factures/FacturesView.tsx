"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { PlayerInvoice, PlayerPayment } from "@/lib/prestations/types";
import { formatDateLong, formatEUR } from "@/lib/prestations/format";

const INVOICE_STATUS_LABEL: Record<string, { label: string; fg: string; bg: string }> = {
  brouillon: { label: "Brouillon", fg: "#9A9AB8", bg: "rgba(255,255,255,.07)" },
  emise: { label: "À régler", fg: "#FBBF24", bg: "rgba(251,191,36,.14)" },
  payee: { label: "Payée", fg: "#22D3EE", bg: "rgba(34,211,238,.14)" },
  en_retard: { label: "En retard", fg: "#F472B6", bg: "rgba(244,114,182,.14)" },
  annulee: { label: "Annulée", fg: "#9A9AB8", bg: "rgba(255,255,255,.07)" },
  remboursee: { label: "Remboursée", fg: "#8CA9FF", bg: "rgba(79,125,255,.16)" },
};

const PAYMENT_STATUS_LABEL: Record<string, { label: string; fg: string; bg: string }> = {
  en_attente: { label: "En attente", fg: "#FBBF24", bg: "rgba(251,191,36,.14)" },
  reussi: { label: "Payé", fg: "#22D3EE", bg: "rgba(34,211,238,.14)" },
  echoue: { label: "Échoué", fg: "#F472B6", bg: "rgba(244,114,182,.14)" },
  rembourse: { label: "Remboursé", fg: "#8CA9FF", bg: "rgba(79,125,255,.16)" },
  annule: { label: "Annulé", fg: "#9A9AB8", bg: "rgba(255,255,255,.07)" },
};

// multi/commandeHref (Espace particulier, migration-connect-v51) : voir le commentaire
// équivalent de CommandeDetailView.tsx. Défauts inchangés pour l'Espace joueur.
export function FacturesView({ multi = false, commandeHref = "/commandes" }: { multi?: boolean; commandeHref?: string } = {}) {
  const [tab, setTab] = useState<"factures" | "paiements">("factures");
  const [invoices, setInvoices] = useState<(PlayerInvoice & { forWho?: string | null })[] | null>(null);
  const [payments, setPayments] = useState<(PlayerPayment & { forWho?: string | null })[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    Promise.all([
      supabase.functions.invoke("connect-player-prestations", { body: { action: "list_invoices", multi } }),
      supabase.functions.invoke("connect-player-prestations", { body: { action: "list_payments", multi } }),
    ]).then(([invRes, payRes]) => {
      if (cancelled) return;
      if (invRes.error || invRes.data?.error || payRes.error || payRes.data?.error) {
        setError("Impossible de charger vos factures pour le moment.");
        return;
      }
      setInvoices(invRes.data.invoices as PlayerInvoice[]);
      setPayments(payRes.data.payments as PlayerPayment[]);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const due = useMemo(() => (invoices || []).filter((i) => i.statut === "emise" || i.statut === "en_retard"), [invoices]);
  const dueTotal = useMemo(() => due.reduce((sum, i) => sum + i.montantTtc, 0), [due]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-sora text-[33px] font-bold tracking-tight">Factures & paiements</h1>
        <p className="max-w-[560px] text-[15px] text-text-tertiary">Retrouvez vos factures et l&apos;historique de vos paiements.</p>
      </div>

      {due.length > 0 && due[0] && (
        <div className="flex flex-wrap items-center gap-4 rounded-sv-card border border-attente/40 bg-attente-bg p-5">
          <span className="flex h-12 w-12 flex-none items-center justify-center rounded-sv bg-white/10">
            <span className="material-symbols-rounded !text-[22px] text-attente">warning</span>
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="font-sora text-[16px] font-semibold">{formatEUR(dueTotal)} à régler</span>
            <span className="text-[13px] text-text-secondary">
              {due.length === 1 ? due[0].offreNom || due[0].numero : `${due.length} factures en attente`}
              {due[0].dateEcheance ? ` · échéance ${formatDateLong(due[0].dateEcheance)}` : ""}
            </span>
          </div>
          {due[0].prestationId && (
            <Link href={`${commandeHref}/${due[0].prestationId}`} className="flex-none rounded-sv bg-sv-gradient px-4 py-2.5 font-sora text-[13px] font-semibold text-white">
              Régler
            </Link>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setTab("factures")}
          className={`h-10 rounded-sv-pill px-4 text-[13px] font-semibold transition-colors duration-150 ${
            tab === "factures" ? "bg-sv-gradient text-white" : "border border-border-strong bg-surface text-text-secondary hover:bg-surface-hover"
          }`}
        >
          Factures
        </button>
        <button
          type="button"
          onClick={() => setTab("paiements")}
          className={`h-10 rounded-sv-pill px-4 text-[13px] font-semibold transition-colors duration-150 ${
            tab === "paiements" ? "bg-sv-gradient text-white" : "border border-border-strong bg-surface text-text-secondary hover:bg-surface-hover"
          }`}
        >
          Paiements
        </button>
      </div>

      {error && <span className="text-[13px] text-danger">{error}</span>}

      {tab === "factures" && (
        <>
          {invoices === null && !error && <ListSkeleton />}
          {invoices !== null && invoices.length === 0 && <EmptyState label="Aucune facture pour le moment." />}
          {invoices !== null && invoices.length > 0 && (
            <div className="flex flex-col gap-2.5">
              {invoices.map((inv) => {
                const status = INVOICE_STATUS_LABEL[inv.statut] || (INVOICE_STATUS_LABEL.brouillon as { label: string; fg: string; bg: string });
                return (
                  <div key={inv.id} className="flex items-center gap-3.5 rounded-sv-card border border-border bg-surface p-4">
                    <span className="flex h-11 w-11 flex-none items-center justify-center rounded-sv bg-white/5">
                      <span className="material-symbols-rounded !text-[20px] text-text-tertiary">description</span>
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-[14px] font-medium text-text">{inv.offreNom || inv.numero}</span>
                      <span className="text-[12.5px] text-text-tertiary">
                        {inv.numero} · {formatDateLong(inv.dateEmission)}
                      </span>
                    </div>
                    <span className="flex-none rounded-sv-pill px-2.5 py-1 text-[12px] font-medium" style={{ color: status.fg, background: status.bg }}>
                      {status.label}
                    </span>
                    <span className="flex-none font-sora text-[14px] font-semibold">{formatEUR(inv.montantTtc)}</span>
                    {inv.pdfUrl ? (
                      <a href={inv.pdfUrl} target="_blank" rel="noreferrer" className="flex-none text-[#8CA9FF]">
                        <span className="material-symbols-rounded !text-[20px]">download</span>
                      </a>
                    ) : (
                      <span className="flex-none w-5" />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {tab === "paiements" && (
        <>
          {payments === null && !error && <ListSkeleton />}
          {payments !== null && payments.length === 0 && <EmptyState label="Aucun paiement pour le moment." />}
          {payments !== null && payments.length > 0 && (
            <div className="flex flex-col gap-2.5">
              {payments.map((p) => {
                const status = PAYMENT_STATUS_LABEL[p.statut] || (PAYMENT_STATUS_LABEL.en_attente as { label: string; fg: string; bg: string });
                return (
                  <div key={p.id} className="flex items-center gap-3.5 rounded-sv-card border border-border bg-surface p-4">
                    <span className="flex h-11 w-11 flex-none items-center justify-center rounded-sv bg-white/5">
                      <span className="material-symbols-rounded !text-[20px] text-text-tertiary">payments</span>
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-[14px] font-medium text-text">{p.offreNom || "Paiement"}</span>
                      <span className="text-[12.5px] text-text-tertiary">
                        {p.prestationRef || "—"} · {formatDateLong(p.createdAt)}
                      </span>
                    </div>
                    <span className="flex-none rounded-sv-pill px-2.5 py-1 text-[12px] font-medium" style={{ color: status.fg, background: status.bg }}>
                      {status.label}
                    </span>
                    <span className="flex-none font-sora text-[14px] font-semibold">{formatEUR(p.montant)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2.5">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-[68px] animate-pulse rounded-sv-card border border-border bg-surface" />
      ))}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-sv-card border border-dashed border-border-strong bg-surface p-8 text-center">
      <span className="material-symbols-rounded !text-[24px] text-text-tertiary">receipt_long</span>
      <span className="text-[14px] text-text-tertiary">{label}</span>
    </div>
  );
}
