"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CalendarDays } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { LockedModule } from "@/components/ui/LockedModule";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useClientId } from "@/lib/data/shared/use-client-id";
import { createClient } from "@/lib/supabase/client";
import { fetchContenus, type Contenu, type ContenuStatut } from "@/lib/data/shared/contenus";

const STATUT_LABEL: Record<ContenuStatut, string> = {
  a_valider_client: "À valider",
  corrections: "Corrections demandées",
  valide: "Validé",
  programme: "Programmé",
  publie: "Publié",
  archive: "Archivé",
};

const STATUT_TONE: Record<ContenuStatut, "success" | "warning" | "danger" | "info" | "neutral"> = {
  a_valider_client: "warning",
  corrections: "danger",
  valide: "info",
  programme: "info",
  publie: "success",
  archive: "neutral",
};

// /communication — planning éditorial réel (table `contenus`, voir data/shared/contenus.ts).
// Lecture seule : `contenus` n'a aucune policy update accessible côté client, la replanification
// par glisser-déposer de la maquette d'origine n'a donc pas d'équivalent réel — retirée plutôt
// que simulée. "À traiter" (validations) vit dans /validations, pas ici.
export default function CommunicationPage() {
  const { ctx } = useSession();
  const resolution = useClientId();

  if (resolution.status === "locked") return <LockedModule />;
  if (resolution.status === "loading") return <div className="py-16 text-center text-[13px] text-text-soft">Chargement…</div>;

  if (resolution.status === "not_linked") {
    return (
      <div className="flex flex-col gap-5">
        <h1 className="text-[29px] font-extrabold tracking-tight">Communication</h1>
        <Card className="flex flex-col items-center gap-3 px-8 py-16 text-center">
          <CalendarDays className="h-6 w-6 text-text-faint" aria-hidden />
          <div className="max-w-md">
            <h2 className="text-[18px] font-extrabold tracking-tight">Communication pas encore reliée</h2>
            <p className="mt-2 text-[13.5px] leading-relaxed text-text-soft">
              SportVision n&apos;a pas encore relié {ctx.organization.name} à un espace Communication. Contactez votre
              interlocuteur SportVision pour l&apos;activer.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  return <PlanningView clientId={resolution.clientId} />;
}

function PlanningView({ clientId }: { clientId: string }) {
  const { ctx } = useSession();
  const [items, setItems] = useState<Contenu[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  async function reload() {
    setLoadError(false);
    setItems(null);
    try {
      const supabase = createClient();
      setItems(await fetchContenus(supabase, clientId));
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
        <div className="text-[12px] font-bold text-text-soft">Communication</div>
        <h1 className="mt-1.5 text-[29px] font-extrabold leading-tight tracking-tight">
          Planning éditorial de {ctx.organization.name}
        </h1>
      </div>

      {loadError && (
        <Card className="flex flex-wrap items-center gap-3 border-danger-fg/30 bg-danger-bg px-5 py-4">
          <AlertTriangle className="h-[18px] w-[18px] flex-none text-danger-fg" aria-hidden />
          <span className="min-w-0 flex-1 text-[13px] font-semibold text-danger-fg">
            Impossible de charger le planning éditorial.
          </span>
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
          <CalendarDays className="h-6 w-6 text-text-faint" aria-hidden />
          <div className="mt-1 text-[15px] font-extrabold">Rien de programmé pour le moment.</div>
        </Card>
      ) : (
        <Card>
          {items.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-3.5 border-b border-divider px-5 py-3.5 last:border-0">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-bold text-text">{c.titre}</span>
                <span className="mt-0.5 block text-[12px] text-text-soft">
                  {[c.plateforme, c.typeContenu, c.sponsor].filter(Boolean).join(" · ") || "—"}
                </span>
              </span>
              <span className="w-28 flex-none text-right text-[12px] text-text-soft">
                {c.datePrevue ?? c.datePublication ?? "Date à définir"}
              </span>
              <Badge tone={STATUT_TONE[c.statut]}>{STATUT_LABEL[c.statut]}</Badge>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
