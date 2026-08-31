"use client";

import { useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { LockedModule } from "@/components/ui/LockedModule";
import { Card } from "@/components/ui/Card";
import { createClient } from "@/lib/supabase/client";
import { resolveOrgLegacyClientId } from "@/lib/data/shared/org-legacy-link";
import { fetchCoachSessions, type CoachSessionEvent } from "@/lib/data/coach/sessions";
import { parseDateOnly } from "@/lib/date-only";

// /sessions — séances du coach, alimentées par calendar_events (type='seance'), en lecture seule
// (le staff SportVision planifie, le coach consulte — voir le plan Tier C § Phase 1 Séances/
// Stages). Remplace le mock sessionsByCoachOrg (heure/lieu/statut inventés, retiré de
// lib/mock/events.ts) : calendar_events ne porte réellement que date + titre + contexte, rien de
// plus n'est affiché.
//
// Gate à deux niveaux, même pattern que /billing (ClubBillingView) : organization.type === "coach"
// d'abord, puis l'état honnête "pas encore relié" si organizations.legacy_client_id est encore
// null (le pont Documents ↔ Portail de connect-org-signup est best-effort et peut ne pas avoir
// abouti).

function fmtDate(value: string): string {
  const d = parseDateOnly(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export default function SessionsPage() {
  const { ctx } = useSession();
  const [linkedClientId, setLinkedClientId] = useState<string | null | undefined>(undefined);
  const [sessions, setSessions] = useState<CoachSessionEvent[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (ctx.organization.type !== "coach") return;
    const supabase = createClient();
    resolveOrgLegacyClientId(supabase, ctx.organization.id).then(setLinkedClientId);
  }, [ctx.organization.id, ctx.organization.type]);

  useEffect(() => {
    if (!linkedClientId) return;
    const supabase = createClient();
    fetchCoachSessions(supabase, ctx.organization.id)
      .then(setSessions)
      .catch(() => setLoadError(true));
  }, [ctx.organization.id, linkedClientId]);

  if (ctx.organization.type !== "coach" || !canAccess(ctx, "sessions")) return <LockedModule />;

  const header = (
    <div>
      <h1 className="text-[29px] font-extrabold leading-tight tracking-tight">Séances</h1>
      <p className="mt-1.5 max-w-xl text-[13.5px] text-text-soft">
        Vos prochaines séances au planning, alimenté par SportVision.
      </p>
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
          <CalendarClock className="h-6 w-6 text-text-faint" aria-hidden />
          <div className="max-w-md">
            <h2 className="text-[18px] font-extrabold tracking-tight">Espace Séances pas encore relié</h2>
            <p className="mt-2 text-[13.5px] leading-relaxed text-text-soft">
              SportVision n&apos;a pas encore relié {ctx.organization.name} à votre espace Séances. Contactez votre
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
        <Card className="p-8 text-center text-[13.5px] text-text-soft">Impossible de charger vos séances.</Card>
      </div>
    );
  }

  if (sessions === null) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <div className="py-16 text-center text-[13px] text-text-soft">Chargement de vos séances…</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {header}

      {sessions.length === 0 && (
        <Card className="p-8 text-center text-[13.5px] text-text-soft">Aucune séance planifiée pour le moment.</Card>
      )}

      {sessions.length > 0 && (
        <Card>
          {sessions.map((session) => (
            <div
              key={session.id}
              className="flex flex-wrap items-center gap-3.5 border-b border-divider px-5 py-4 last:border-0 hover:bg-row-hover"
            >
              <div className="w-[170px] flex-none text-[13px] font-extrabold capitalize text-text">{fmtDate(session.eventDate)}</div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-bold text-text">{session.title}</div>
                {session.context && <div className="mt-0.5 truncate text-[12px] text-text-soft">{session.context}</div>}
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
