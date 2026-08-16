"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, MoreVertical, Sparkles } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess, canCreate } from "@/lib/permissions";
import { LockedModule } from "@/components/ui/LockedModule";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Toast, useToast } from "@/components/feedback/Toast";
import { MatchResultModal } from "@/components/matchcenter/MatchResultModal";
import { cn } from "@/lib/cn";
import { fetchClubMatches, requestVisualHref, saveClubMatchResult, type MatchOutcome } from "@/lib/data/club/matches";
import { createClient } from "@/lib/supabase/client";
import { MATCH_STATUS_LABELS, MATCH_STATUS_TONE, type Match, type MatchStatus } from "@/lib/types/studio";

// Match Center — saisie de résultats. Voir ACTIONS.md § 8 et DATA_MODEL.md § Match.
// "content_created" (visuel généré) n'a pas d'équivalent réel en base (voir data/club/matches.ts)
// et aucun marquage local ne le simule plus : /studio est verrouillé (hors READY_MODULES), il n'y
// a donc aujourd'hui aucun chemin réel pour faire transiter un match vers ce statut.
// "postponed"/"cancelled" (migration-clubplus-v37.sql) : 16/08/2026, ces statuts sont désormais
// réellement actionnables — menu "..." sur chaque ligne à venir/à transmettre (Reporter/Annuler),
// qui ouvre MatchResultModal avec le statut cible préréglé. Voir ce composant pour le détail.

const TABS: { key: MatchStatus; label: string }[] = [
  { key: "upcoming", label: "À venir" },
  { key: "result_pending", label: "À transmettre" },
  { key: "result_received", label: "Reçus" },
  { key: "content_created", label: "Contenus créés" },
  { key: "postponed", label: "Reportés" },
  { key: "cancelled", label: "Annulés" },
];

export default function MatchCenterPage() {
  const { ctx } = useSession();
  const { toastMessage, toastTone, showToast } = useToast();
  const [tab, setTab] = useState<MatchStatus>("upcoming");
  const [modalMatchId, setModalMatchId] = useState<string | null>(null);
  const [modalDefaultStatus, setModalDefaultStatus] = useState<MatchOutcome>("completed");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  const allowed = canAccess(ctx, "matchcenter");
  const canWrite = canCreate(ctx, "match_result");
  // CTA "Demander un visuel" (Bible §9/§18, "Résultat -> Visuel") sur un match reçu — voir
  // composeMatchVisualBrief (data/club/matches.ts) pour pourquoi ça pointe vers /requests/new et
  // pas /studio/[template] (module "studio" verrouillé pour tout compte réel aujourd'hui).
  const canRequestVisual = canAccess(ctx, "visual_requests") && canCreate(ctx, "visual_request");

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

  const OUTCOME_TO_STATUS: Record<MatchOutcome, MatchStatus> = {
    completed: "result_received",
    postponed: "postponed",
    cancelled: "cancelled",
  };

  const OUTCOME_TOAST: Record<MatchOutcome, string> = {
    completed: "Résultat enregistré.",
    postponed: "Match reporté.",
    cancelled: "Match annulé.",
  };

  function handleSaveResult(
    matchId: string,
    matchStatus: MatchOutcome,
    patch: Partial<Match> & { attendance?: number; assists?: string; cards?: string; comment?: string },
  ) {
    const { attendance, assists, cards, comment, ...matchFields } = patch;
    const supabase = createClient();
    saveClubMatchResult(supabase, matchId, matchStatus, patch)
      .then(() => {
        setMatches((prev) =>
          prev
            ? prev.map((m) =>
                m.id === matchId
                  ? {
                      ...m,
                      ...matchFields,
                      status: OUTCOME_TO_STATUS[matchStatus],
                      extendedReport:
                        matchStatus === "completed" ? { attendance, assists, cards, comment } : m.extendedReport,
                    }
                  : m,
              )
            : prev,
        );
        setModalMatchId(null);
        showToast(OUTCOME_TOAST[matchStatus]);
      })
      .catch(() => showToast("Enregistrement impossible, réessayez.", "error"));
  }

  // Le sélecteur multi-match de la modale ne reste pertinent que pour le flux "Saisir un
  // résultat" lancé depuis un match à transmettre (toute la liste "pending" reste choisissable) ;
  // pour un report/annulation déclenché depuis une ligne précise, la modale ne porte que sur ce
  // match-là.
  const modalMatch = modalMatchId ? orgMatches.find((mm) => mm.id === modalMatchId) : undefined;
  const modalMatches =
    modalDefaultStatus === "completed" && modalMatch?.status === "result_pending" ? pending : modalMatch ? [modalMatch] : [];

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
          <Button
            variant="primary"
            disabled={pending.length === 0 || !canWrite}
            onClick={() => {
              setModalDefaultStatus("completed");
              setModalMatchId(pending[0]!.id);
            }}
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
                  {m.competition ? ` · ${m.competition}` : ""}
                  {m.venue ? ` · ${m.venue}` : ""}
                </div>
              </div>
              {/* "postponed" inclus : un match reporté est rejoué à une date ultérieure et doit
                  pouvoir recevoir un résultat sans repasser par un statut intermédiaire — sinon un
                  match reporté reste bloqué sans action possible. */}
              {(m.status === "result_pending" || m.status === "postponed") && (
                <Button
                  variant="secondary"
                  className="h-9 px-3.5 text-[12.5px]"
                  disabled={!canWrite}
                  onClick={() => {
                    setModalDefaultStatus("completed");
                    setModalMatchId(m.id);
                  }}
                >
                  Saisir le résultat
                </Button>
              )}
              {/* "Résultat -> Visuel" (Bible §9/§18) : un match reçu peut nourrir directement une
                  demande de visuel, brief pré-rempli équipe/adversaire/score/buteurs/MVP/
                  commentaire — voir composeMatchVisualBrief. */}
              {m.status === "result_received" && canRequestVisual && (
                <Link href={requestVisualHref(m)}>
                  <Button variant="secondary" className="h-9 px-3.5 text-[12.5px]">
                    <Sparkles className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                    Demander un visuel
                  </Button>
                </Link>
              )}
              {/* Reporter/annuler : pas pertinent une fois annulé (pas de workflow de
                  "dé-annulation" dans ce chantier) — mais un match déjà reporté peut l'être à
                  nouveau, ou finalement être annulé. */}
              {(m.status === "upcoming" || m.status === "result_pending" || m.status === "postponed") && (
                <div className="relative">
                  <button
                    type="button"
                    aria-label={`Autres actions pour ${m.teamName} vs ${m.opponent}`}
                    disabled={!canWrite}
                    onClick={() => setOpenMenuId(openMenuId === m.id ? null : m.id)}
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-border-strong text-text-soft transition-colors duration-sv hover:border-brand-blue-electric disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <MoreVertical className="h-4 w-4" aria-hidden />
                  </button>
                  {openMenuId === m.id && (
                    <>
                      <button
                        type="button"
                        aria-hidden
                        tabIndex={-1}
                        className="fixed inset-0 z-40 cursor-default"
                        onClick={() => setOpenMenuId(null)}
                      />
                      <div className="absolute right-0 top-11 z-50 w-52 overflow-hidden rounded-sv border border-border-strong bg-elevated shadow-sv-modal">
                        <button
                          type="button"
                          onClick={() => {
                            setOpenMenuId(null);
                            setModalDefaultStatus("postponed");
                            setModalMatchId(m.id);
                          }}
                          className="block w-full px-3.5 py-2.5 text-left text-[12.5px] font-bold text-text-soft hover:bg-hover"
                        >
                          Reporter le match
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setOpenMenuId(null);
                            setModalDefaultStatus("cancelled");
                            setModalMatchId(m.id);
                          }}
                          className="block w-full border-t border-divider px-3.5 py-2.5 text-left text-[12.5px] font-bold text-danger-fg hover:bg-hover"
                        >
                          Annuler le match
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {modalMatchId && modalMatch && (
        <MatchResultModal
          matches={modalMatches}
          initialMatchId={modalMatchId}
          defaultStatus={modalDefaultStatus}
          onClose={() => setModalMatchId(null)}
          onSubmit={handleSaveResult}
        />
      )}

      <Toast message={toastMessage} tone={toastTone} />
    </div>
  );
}
