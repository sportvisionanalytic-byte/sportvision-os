"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Radio } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/client";
import { resolveOrgLegacyClientId } from "@/lib/data/shared/org-legacy-link";
import { fetchLiveDuJour, type LiveDuJour } from "@/lib/data/event/live";
import { LockedModule } from "@/components/ui/LockedModule";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

// /live — fil du jour pour un tournoi en Full Communication. Plan Tier C § Phase 4.
//
// Gate à deux niveaux, même pattern que /sessions (Phase 1) : organization.type === "event"
// d'abord, puis l'état honnête "pas encore relié" si organizations.legacy_client_id est encore
// null (le rattachement se fait au moment de l'activation, connect-org-activate).
//
// Une fois relié : le fil et les 2 tuiles "Portée du jour"/"Interactions" viennent de
// data/event/live.ts, qui réutilise data/shared/contenu-stats.ts (Phase 5, saisie manuelle de
// stats par le CM). RLS : nécessite migration-connect-v23-event-live-contenus-access.sql
// (étend contenus_client_select/contenu_stats_select à un membre event via legacy_client_id).
//
// « Photos livrées » (4e tuile du design d'origine) reste honnêtement absente : aucune table ne
// suit de vraies photos livrées pour une organisation event (club_media/club_creations sont
// scopées club_id, sans équivalent event) — voir le commentaire détaillé dans data/event/live.ts.
// Affichée "—" plutôt qu'un chiffre recyclé d'une donnée qui mesure autre chose.

function fmtNumber(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("fr-FR");
}

export default function LivePage() {
  const { ctx } = useSession();
  const router = useRouter();
  const [linkedClientId, setLinkedClientId] = useState<string | null | undefined>(undefined);
  const [live, setLive] = useState<LiveDuJour | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (ctx.organization.type !== "event") return;
    const supabase = createClient();
    resolveOrgLegacyClientId(supabase, ctx.organization.id).then(setLinkedClientId);
  }, [ctx.organization.id, ctx.organization.type]);

  useEffect(() => {
    if (!linkedClientId) return;
    const supabase = createClient();
    fetchLiveDuJour(supabase, linkedClientId)
      .then(setLive)
      .catch(() => setLoadError(true));
  }, [linkedClientId]);

  if (ctx.organization.type !== "event" || !canAccess(ctx, "live")) return <LockedModule />;

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-5">
      <div>
        <h1 className="text-[29px] font-extrabold leading-tight tracking-tight">Live</h1>
        <p className="mt-1.5 max-w-xl text-[13.5px] text-text-soft">Le fil du jour pour {ctx.organization.name}.</p>
      </div>
      <Button variant="secondary" onClick={() => router.push("/content")}>
        Voir la galerie
      </Button>
    </div>
  );

  if (linkedClientId === undefined) {
    return <div className="py-16 text-center text-[13px] text-text-soft">Chargement…</div>;
  }

  if (linkedClientId === null) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <Card className="flex flex-col items-center gap-3 px-8 py-16 text-center">
          <Radio className="h-6 w-6 text-text-faint" aria-hidden />
          <div className="max-w-md">
            <h2 className="text-[18px] font-extrabold tracking-tight">Espace Live pas encore relié</h2>
            <p className="mt-2 text-[13.5px] leading-relaxed text-text-soft">
              SportVision n&apos;a pas encore relié {ctx.organization.name} à votre espace Live. Contactez votre
              interlocuteur SportVision pour l&apos;activer.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <Card className="p-8 text-center text-[13.5px] text-text-soft">Impossible de charger le fil du jour.</Card>
      </div>
    );
  }

  if (live === null) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <div className="py-16 text-center text-[13px] text-text-soft">Chargement du fil du jour…</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {header}

      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <Card className="p-4">
          <div className="text-[22px] font-extrabold tracking-tight">{live.stats.publicationsSorties}</div>
          <div className="mt-0.5 text-[12px] font-semibold text-text-soft">Publications sorties</div>
        </Card>
        <Card className="p-4">
          <div className="text-[22px] font-extrabold tracking-tight">{fmtNumber(live.stats.porteeDuJour)}</div>
          <div className="mt-0.5 text-[12px] font-semibold text-text-soft">Portée du jour</div>
        </Card>
        <Card className="p-4">
          <div className="text-[22px] font-extrabold tracking-tight">{fmtNumber(live.stats.interactionsDuJour)}</div>
          <div className="mt-0.5 text-[12px] font-semibold text-text-soft">Interactions</div>
        </Card>
        <Card className="p-4">
          <div className="text-[22px] font-extrabold tracking-tight text-text-faint">—</div>
          <div className="mt-0.5 text-[12px] font-semibold text-text-soft">Photos livrées</div>
        </Card>
      </div>

      <Card>
        <div className="border-b border-divider px-5 py-4 text-[15px] font-extrabold tracking-tight">
          Fil du jour
        </div>
        {live.items.length === 0 && (
          <div className="px-5 py-6 text-center text-[13px] text-text-soft">Rien à afficher pour le moment.</div>
        )}
        {live.items.map((item) => (
          <div key={item.id} className="flex items-center gap-3.5 border-b border-divider px-5 py-3.5 last:border-0">
            <span className="w-16 flex-none text-[11.5px] font-bold uppercase tracking-wide text-text-soft">
              {item.typeContenu || "—"}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-text">{item.titre}</span>
            <Badge tone="info">{item.plateforme || "—"}</Badge>
          </div>
        ))}
      </Card>
    </div>
  );
}
