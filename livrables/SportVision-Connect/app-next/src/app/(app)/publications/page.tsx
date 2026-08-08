"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Inbox } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { LockedModule } from "@/components/communication/LockedModule";
import { EmptyState } from "@/components/communication/EmptyState";
import { displayStatusTone } from "@/components/communication/statusTone";
import { getPublicationsByOrg } from "@/lib/mock/communication";
import { PLATFORM_LABELS, publicationDisplayStatus, type PublicationDisplayStatus } from "@/lib/types/communication";
import { cn } from "@/lib/cn";

// /publications — historique des publications (tableau). ACTIONS.md § 9. Le tableau ne montre
// que 4 statuts au client (Publiée, À valider, En préparation, Erreur de publication) : la
// mécanique interne de production (idée, à produire, en création…) reste dans /communication.
// Aucun détail technique Metricool (externalPostId) n'est jamais affiché.
const FILTERS: (PublicationDisplayStatus | "Toutes")[] = ["Toutes", "Publiée", "À valider", "En préparation", "Erreur de publication"];

export default function PublicationsPage() {
  const { ctx } = useSession();
  if (!canAccess(ctx, "publications")) return <LockedModule ctx={ctx} />;
  return <PublicationsHistory organizationId={ctx.organization.id} />;
}

function PublicationsHistory({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("Toutes");

  const publications = getPublicationsByOrg(organizationId)
    .slice()
    .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());

  const filtered = publications.filter((p) => filter === "Toutes" || publicationDisplayStatus(p.status) === filter);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="text-[12px] font-bold text-text-soft">Full Communication</div>
        <h1 className="mt-1 text-[24px] font-extrabold tracking-tight">Publications</h1>
        <p className="mt-1 text-[13.5px] text-text-soft">Historique de toutes vos publications, tous statuts confondus.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-[12px] font-bold transition-colors",
              filter === f ? "border-brand-blue bg-info-bg text-info-fg" : "border-border-strong text-text-soft hover:border-brand-blue-electric",
            )}
          >
            {f}
          </button>
        ))}
      </div>

      <Card className="overflow-hidden p-0">
        {filtered.length === 0 ? (
          <div className="p-6">
            <EmptyState icon={Inbox} title="Aucune publication" subtitle="Aucune publication ne correspond à ce filtre." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left">
              <thead>
                <tr className="border-b border-divider bg-surface-alt">
                  {["Publication", "Plateforme", "Date", "Statut", "Portée", "Interactions"].map((h) => (
                    <th key={h} className="px-5 py-3 text-[11px] font-extrabold uppercase tracking-[.04em] text-text-faint">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const displayStatus = publicationDisplayStatus(p.status);
                  return (
                    <tr
                      key={p.id}
                      onClick={() => router.push(`/communication/publications/${p.id}`)}
                      className="cursor-pointer border-b border-divider last:border-0 hover:bg-row-hover"
                    >
                      <td className="max-w-[280px] truncate px-5 py-3.5 text-[13.5px] font-bold text-text">{p.title}</td>
                      <td className="px-5 py-3.5 text-[13px] text-text-soft">{PLATFORM_LABELS[p.platform]}</td>
                      <td className="px-5 py-3.5 text-[13px] text-text-soft">{formatDate(p.scheduledAt)}</td>
                      <td className="px-5 py-3.5">
                        <Badge tone={displayStatusTone(displayStatus)}>{displayStatus}</Badge>
                      </td>
                      <td className="px-5 py-3.5 text-[13px] font-semibold text-text">{p.reach ? p.reach.toLocaleString("fr-FR") : "—"}</td>
                      <td className="px-5 py-3.5 text-[13px] font-semibold text-text">
                        {p.engagement ? p.engagement.toLocaleString("fr-FR") : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}
