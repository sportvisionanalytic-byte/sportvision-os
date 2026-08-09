"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Sparkles } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess, canCreate } from "@/lib/permissions";
import { LockedModule } from "@/components/ui/LockedModule";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Toast, useToast } from "@/components/feedback/Toast";
import { MatchResultModal } from "@/components/matchcenter/MatchResultModal";
import { cn } from "@/lib/cn";
import { fetchClubMatches, saveClubMatchResult } from "@/lib/data/club/matches";
import { createClient } from "@/lib/supabase/client";
import { MATCH_STATUS_LABELS, MATCH_STATUS_TONE, type Match, type MatchStatus } from "@/lib/types/studio";

// Match Center — saisie de résultats. Voir ACTIONS.md § 8 et DATA_MODEL.md § Match.
// "content_created" (visuel généré) n'a pas d'équivalent réel en base (voir data/club/matches.ts)
// et aucun marquage local ne le simule plus : /studio est verrouillé (hors READY_MODULES), il n'y
// a donc aujourd'hui aucun chemin réel pour faire transiter un match vers ce statut.

const TABS: { key: MatchStatus; label: string }[] = [
  { key: "upcoming", label: "À venir" },
  { key: "result_pending", label: "À transmettre" },
  { key: "result_received", label: "Reçus" },
  { key: "content_created", label: "Contenus créés" },
];

export default function MatchCenterPage() {
  const { ctx } = useSession();
  const { toastMessage, toastTone, showToast } = useToast();
  const [tab, setTab] = useState<MatchStatus>("upcoming");
  const [modalMatchId, setModalMatchId] = useState<string | null>(null);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  const allowed = canAccess(ctx, "matchcenter");
  const canWrite = canCreate(ctx, "match_result");

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    fetchClubMatches(supabase, ctx.organization.id)
      .then((rows) => {
        if (!cancelled) setMatches(rows);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.organization.id]);

  if (!allowed) return <LockedModule title="Match Center" />;

  if (loadError) {
    return (
      <Card className="p-8 text-center">
        <div className="text-[14px] font-extrabold">Impossible de charger les matchs.</div>
        <p className="mt-1.5 text-[13px] text-text-soft">Réessayez dans quelques instants.</p>
      </Card>
    );
  }

  if (matches === null) {
    return <div className="py-16 text-center text-[13px] text-text-soft">Chargement des matchs…</div>;
  }

  const orgMatches = matches;
  const pending = orgMatches.filter((m) => m.status === "result_pending");
  const rows = orgMatches.filter((m) => m.status === tab);

  function handleSaveResult(matchId: string, patch: Partial<Match>) {
    const supabase = createClient();
    saveClubMatchResult(supabase, matchId, patch)
      .then(() => {
        setMatches((prev) => (prev ? prev.map((m) => (m.id === matchId ? { ...m, ...patch, status: "result_received" } : m)) : prev));
        setModalMatchId(null);
        showToast("Résultat enregistré.");
      })
      .catch(() => showToast("Enregistrement impossible, réessayez.", "error"));
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[12px] font-bold text-text-soft">Club+</div>
          <h1 className="mt-1.5 text-[29px] font-extrabold leading-tight tracking-tight">Match Center</h1>
          <p className="mt-1.5 max-w-2xl text-[13.5px] text-text-soft">
            Transmettez vos résultats et créez le visuel qui va avec, en quelques champs.
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <Button variant="secondary" disabled title="Le studio de création de visuels arrive bientôt.">
            Bientôt disponible
          </Button>
          <Button
            variant="primary"
            disabled={pending.length === 0 || !canWrite}
            onClick={() => setModalMatchId(pending[0]!.id)}
          >
            Saisir un résultat
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-divider pb-3">
        {TABS.map((t) => {
          const count = orgMatches.filter((m) => m.status === t.key).length;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[12.5px] font-bold transition-colors duration-sv",
                tab === t.key
                  ? "border-transparent bg-gradient-to-br from-brand-blue to-brand-violet text-white"
                  : "border-border-strong bg-transparent text-text-soft hover:border-brand-blue-electric",
              )}
            >
              {t.label}
              {count > 0 && <span className="opacity-80">· {count}</span>}
            </button>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <Card className="p-8 text-center">
          <div className="text-[14px] font-extrabold">Aucun match dans cette vue</div>
          <p className="mt-1.5 text-[13px] text-text-soft">Rien à traiter pour l&apos;instant.</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((m) => (
            <Card key={m.id} className="flex flex-wrap items-center gap-3.5 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-extrabold tracking-tight">
                    {m.teamName} {m.isHome ? "vs" : "@"} {m.opponent}
                  </span>
                  <Badge tone={MATCH_STATUS_TONE[m.status]}>{MATCH_STATUS_LABELS[m.status]}</Badge>
                  {m.scoreFor !== undefined && m.scoreAgainst !== undefined && (
                    <span className="font-mono text-[13px] font-bold text-brand-blue-pale">
                      {m.scoreFor} - {m.scoreAgainst}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-[12px] font-semibold text-text-faint">
                  <CalendarClock className="h-3.5 w-3.5" aria-hidden />
                  {m.kickoffAt ? new Date(m.kickoffAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long" }) : "Date à confirmer"}
                  {m.venue ? ` · ${m.venue}` : ""}
                </div>
              </div>
              {m.status === "result_pending" && (
                <Button
                  variant="secondary"
                  className="h-9 px-3.5 text-[12.5px]"
                  disabled={!canWrite}
                  onClick={() => setModalMatchId(m.id)}
                >
                  Saisir le résultat
                </Button>
              )}
              {(m.status === "result_received" || m.status === "content_created") && (
                <Button variant="secondary" className="h-9 px-3.5 text-[12.5px]" disabled title="Le studio de création de visuels arrive bientôt.">
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  Bientôt disponible
                </Button>
              )}
            </Card>
          ))}
        </div>
      )}

      {modalMatchId && (
        <MatchResultModal
          matches={pending}
          initialMatchId={modalMatchId}
          onClose={() => setModalMatchId(null)}
          onSubmit={handleSaveResult}
        />
      )}

      <Toast message={toastMessage} tone={toastTone} />
    </div>
  );
}
