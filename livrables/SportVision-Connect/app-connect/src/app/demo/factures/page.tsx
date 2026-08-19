import { DEMO_INVOICES } from "@/lib/demo/mock-data";

const STATUS_LABEL: Record<string, { label: string; fg: string; bg: string }> = {
  a_regler: { label: "À régler", fg: "#FBBF24", bg: "rgba(251,191,36,.14)" },
  payee: { label: "Payée", fg: "#22D3EE", bg: "rgba(34,211,238,.14)" },
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

export default function DemoFacturesPage() {
  return (
    <div className="flex flex-col gap-6 animate-sv-in">
      <div className="flex flex-col gap-2">
        <h1 className="font-sora text-[27px] font-bold tracking-tight lg:text-[33px]">Factures &amp; paiements</h1>
        <p className="max-w-[560px] text-[15px] text-text-tertiary">Retrouvez vos factures et l&apos;historique de vos paiements.</p>
      </div>
      <div className="flex flex-col gap-3">
        {DEMO_INVOICES.map((inv) => {
          const s = STATUS_LABEL[inv.status]!;
          return (
            <div key={inv.id} className="flex flex-col gap-3 rounded-sv-card border border-border bg-surface p-5">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="font-sora text-[16px] font-semibold">{inv.label}</span>
                  <span className="text-[13px] text-text-tertiary">
                    Prestation : {formatDate(inv.prestationDate)} · Facture émise : {formatDate(inv.factureDate)}
                  </span>
                </div>
                <div className="ml-auto flex flex-none items-center gap-3">
                  <span className="font-sora text-[16px] font-semibold">{inv.amount} €</span>
                  <span className="rounded-sv-pill px-2.5 py-1 text-[12px] font-medium" style={{ color: s.fg, background: s.bg }}>{s.label}</span>
                </div>
              </div>
              {inv.sub && <p className="text-[13px] leading-relaxed text-text-faint lg:text-[12px]">{inv.sub}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
