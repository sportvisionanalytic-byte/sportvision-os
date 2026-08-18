import { DEMO_ORDERS } from "@/lib/demo/mock-data";

const STATUS_LABEL: Record<string, { label: string; fg: string; bg: string }> = {
  confirmee: { label: "Confirmée", fg: "#22D3EE", bg: "rgba(34,211,238,.14)" },
  livree: { label: "Livrée", fg: "#8CA9FF", bg: "rgba(79,125,255,.16)" },
};

export default function DemoCommandesPage() {
  return (
    <div className="flex flex-col gap-6 animate-sv-in">
      <div className="flex flex-col gap-2">
        <h1 className="font-sora text-[27px] font-bold tracking-tight lg:text-[33px]">Mes commandes</h1>
        <p className="max-w-[560px] text-[15px] text-text-tertiary">Suivez l&apos;avancement de vos prestations SportVision.</p>
      </div>
      <div className="flex flex-col gap-3">
        {DEMO_ORDERS.map((o) => {
          const s = STATUS_LABEL[o.status]!;
          return (
            <div key={o.id} className="flex flex-wrap items-center gap-4 rounded-sv-card border border-border bg-surface p-5">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="font-sora text-[16px] font-semibold">{o.label}</span>
                <span className="text-[13px] text-text-tertiary">{new Date(o.date).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}</span>
              </div>
              <span className="ml-auto flex-none rounded-sv-pill px-2.5 py-1 text-[12px] font-medium" style={{ color: s.fg, background: s.bg }}>{s.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
