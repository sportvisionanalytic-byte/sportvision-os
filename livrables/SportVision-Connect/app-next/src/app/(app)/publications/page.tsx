"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Inbox } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { LockedModule } from "@/components/ui/LockedModule";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useClientId } from "@/lib/data/shared/use-client-id";
import { createClient } from "@/lib/supabase/client";
import { fetchContenus, type Contenu } from "@/lib/data/shared/contenus";

// /publications — historique réel des contenus publiés/programmés (table `contenus`, filtrée sur
// statut). Pas de colonnes "Portée"/"Interactions" : aucune métrique de diffusion n'existe dans le
// schéma (Metricool n'est utilisé qu'à la main par les CM, aucune intégration API) — voir le plan
// Tier B § Phase 5. Ne jamais inventer un chiffre à la place.
export default function PublicationsPage() {
  const { ctx } = useSession();
  const resolution = useClientId();

  if (resolution.status === "locked") return <LockedModule />;
  if (resolution.status === "loading") return <div className="py-16 text-center text-[13px] text-text-soft">Chargement…</div>;

  if (resolution.status === "not_linked") {
    return (
      <div className="flex flex-col gap-5">
        <h1 className="text-[29px] font-extrabold tracking-tight">Publications</h1>
        <Card className="flex flex-col items-center gap-2 px-8 py-16 text-center">
          <div className="max-w-md text-[13.5px] text-text-soft">
            SportVision n&apos;a pas encore relié {ctx.organization.name} à un espace Publications.
          </div>
        </Card>
      </div>
    );
  }

  return <PublicationsHistory clientId={resolution.clientId} />;
}

function PublicationsHistory({ clientId }: { clientId: string }) {
  const { ctx } = useSession();
  const [items, setItems] = useState<Contenu[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  async function reload() {
    setLoadError(false);
    setItems(null);
    try {
      const supabase = createClient();
      const all = await fetchContenus(supabase, clientId);
      setItems(all.filter((c) => c.statut === "publie" || c.statut === "programme"));
    } catch {
      setLoadError(true);
      setItems([]);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="text-[12px] font-bold text-text-soft">Publications</div>
        <h1 className="mt-1.5 text-[29px] font-extrabold leading-tight tracking-tight">
          Publications de {ctx.organization.name}
        </h1>
      </div>

      {loadError && (
        <Card className="flex flex-wrap items-center gap-3 border-danger-fg/30 bg-danger-bg px-5 py-4">
          <AlertTriangle className="h-[18px] w-[18px] flex-none text-danger-fg" aria-hidden />
          <span className="min-w-0 flex-1 text-[13px] font-semibold text-danger-fg">Impossible de charger les publications.</span>
          <Button variant="secondary" className="h-8 flex-none px-3 text-[12px]" onClick={reload}>
            Réessayer
          </Button>
        </Card>
      )}

      {items === null ? (
        <Card className="flex flex-col items-center gap-2 px-8 py-16 text-center">
          <div className="text-[13.5px] font-bold text-text-soft">Chargement…</div>
        </Card>
      ) : items.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 px-8 py-16 text-center">
          <Inbox className="h-6 w-6 text-text-faint" aria-hidden />
          <div className="mt-1 text-[15px] font-extrabold">Aucune publication pour le moment.</div>
        </Card>
      ) : (
        <Card>
          {items.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-3.5 border-b border-divider px-5 py-3.5 last:border-0">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-bold text-text">{c.titre}</span>
                <span className="mt-0.5 block text-[12px] text-text-soft">{c.plateforme ?? "—"}</span>
              </span>
              <span className="w-28 flex-none text-right text-[12px] text-text-soft">{c.datePublication ?? c.datePrevue ?? "—"}</span>
              <Badge tone={c.statut === "publie" ? "success" : "info"}>{c.statut === "publie" ? "Publié" : "Programmé"}</Badge>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
