"use client";

import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { liveFeedByEventOrg, liveStatsByEventOrg } from "@/lib/mock/events";
import { LockedModule } from "@/components/persona/LockedModule";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

// /live — fil du jour pour un tournoi en Full Communication. ACTIONS.md § 10 « Tournoi Full
// Com — /live » : 4 statistiques du jour + fil horodaté des publications sorties, « Voir la
// galerie » en secondaire.
export default function LivePage() {
  const { ctx } = useSession();
  const router = useRouter();
  if (!canAccess(ctx, "live")) return <LockedModule ctx={ctx} />;

  const stats = liveStatsByEventOrg[ctx.organization.id] ?? [];
  const feed = liveFeedByEventOrg[ctx.organization.id] ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <h1 className="text-[29px] font-extrabold leading-tight tracking-tight">Live</h1>
          <p className="mt-1.5 max-w-xl text-[13.5px] text-text-soft">Le fil du jour pour {ctx.organization.name}.</p>
        </div>
        <Button variant="secondary" onClick={() => router.push("/content")}>
          Voir la galerie
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="p-4">
            <div className="text-[22px] font-extrabold tracking-tight">{s.value}</div>
            <div className="mt-0.5 text-[12px] font-semibold text-text-soft">{s.label}</div>
          </Card>
        ))}
      </div>

      <Card>
        <div className="border-b border-divider px-5 py-4 text-[15px] font-extrabold tracking-tight">
          Fil du jour
        </div>
        {feed.length === 0 && (
          <div className="px-5 py-6 text-center text-[13px] text-text-soft">Rien à afficher pour le moment.</div>
        )}
        {feed.map((item) => (
          <div key={item.id} className="flex items-center gap-3.5 border-b border-divider px-5 py-3.5 last:border-0">
            <span className="w-14 flex-none font-mono text-[12px] font-bold text-text-soft">{item.time}</span>
            <span className="min-w-0 flex-1 text-[13.5px] font-semibold text-text">{item.label}</span>
            <Badge tone="info">{item.platform}</Badge>
          </div>
        ))}
      </Card>
    </div>
  );
}
