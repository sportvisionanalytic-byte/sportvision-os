"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { createClient } from "@/lib/supabase/client";
import { useClientId } from "@/lib/data/shared/use-client-id";
import { fetchPlanning, type ContenuCm } from "@/lib/data/club/planningEditorial";
import { ligneContenu, resumePlanning } from "@/lib/communication/planning";

// Le planning éditorial au tableau de bord du CM (11/09/2026) : ce qui part aujourd'hui et ce qui
// reste à préparer, lus dans la même table que le Centre communication : une seule source.
export function ResumePlanningCm() {
  const resolution = useClientId();
  const [items, setItems] = useState<ContenuCm[] | null>(null);
  const clientId = resolution.status === "ready" ? resolution.clientId : null;

  useEffect(() => {
    if (!clientId) return;
    fetchPlanning(createClient(), clientId).then(setItems).catch(() => setItems([]));
  }, [clientId]);

  const resume = useMemo(() => resumePlanning(items ?? [], new Date()), [items]);
  if (!clientId || items === null) return null;

  const ligne = (c: ContenuCm) => (
    <Link key={c.id} href="/communication" className="flex items-baseline gap-2 py-1 text-[13px] hover:underline">
      <span className="min-w-0 flex-1 truncate">
        <b className="font-bold">{ligneContenu(c)}</b> <span className="text-text-soft">· {c.titre}</span>
      </span>
    </Link>
  );

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[13px] font-extrabold uppercase tracking-[.06em]">Communication du jour</h2>
        <Link href="/communication" className="text-[12.5px] font-bold text-accent-fg hover:underline">
          Ouvrir le planning →
        </Link>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <div className="text-[12px] font-bold text-text-soft">Aujourd&apos;hui</div>
          {resume.aujourdhui.length ? resume.aujourdhui.slice(0, 4).map(ligne) : <p className="py-1 text-[13px] text-text-faint">Rien de programmé aujourd&apos;hui.</p>}
        </div>
        <div>
          <div className="text-[12px] font-bold text-text-soft">À préparer (7 jours)</div>
          {resume.aPreparer.length ? resume.aPreparer.slice(0, 4).map(ligne) : <p className="py-1 text-[13px] text-text-faint">Tout est prêt.</p>}
        </div>
      </div>
    </Card>
  );
}
