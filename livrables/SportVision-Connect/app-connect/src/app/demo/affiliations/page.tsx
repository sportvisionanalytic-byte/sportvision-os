import { DEMO_CLUB } from "@/lib/demo/mock-data";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

export default function DemoAffiliationsPage() {
  return (
    <div className="flex flex-col gap-6 animate-sv-in">
      <div className="flex flex-col gap-2">
        <h1 className="font-sora text-[27px] font-bold tracking-tight lg:text-[33px]">Mes affiliations</h1>
        <p className="max-w-[560px] text-[15px] text-text-tertiary">Retrouvez les clubs et structures sportives liés à votre profil.</p>
      </div>
      <div className="rounded-sv-card p-px" style={{ background: "linear-gradient(130deg, rgba(34,211,238,.55), rgba(79,125,255,.2) 60%, transparent)" }}>
        <div className="flex flex-col gap-4 rounded-[calc(theme(borderRadius.sv-card)-1px)] bg-bg-elevated p-5">
          <div className="flex flex-wrap items-center gap-4">
            <span className="flex h-[52px] w-[52px] flex-none items-center justify-center rounded-sv bg-white/5 font-mono text-[8px] text-text-faint">logo</span>
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="font-sora text-[20px] font-semibold tracking-tight">{DEMO_CLUB.nom}</span>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] text-text-tertiary">{DEMO_CLUB.ville}</span>
                <span className="rounded-sv-pill px-2.5 py-1 text-[12px] font-medium" style={{ color: "#22D3EE", background: "rgba(34,211,238,.14)" }}>✓ Affilié</span>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Fact label="Structure" value={DEMO_CLUB.nom} />
            <Fact label="Statut" value="Affilié" />
            <Fact label="Depuis" value={formatDate(DEMO_CLUB.since)} />
            <Fact label="SportVision Club+" value="Structure partenaire" />
          </div>
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-sv border border-border bg-surface p-3.5">
      <span className="text-[11px] font-medium uppercase tracking-[.1em] text-text-label">{label}</span>
      <span className="font-sora text-[14px] font-semibold">{value}</span>
    </div>
  );
}
