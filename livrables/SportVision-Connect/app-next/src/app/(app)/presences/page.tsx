"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CalendarClock, Send } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { Button } from "@/components/ui/Button";
import { Card, CardPremium } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { LockedModule } from "@/components/ui/LockedModule";
import { EmptyState } from "@/components/communication/EmptyState";
import { presenceStatusTone, PRESENCE_STATUS_LABELS } from "@/components/communication/statusTone";
import { PRESENCE_KIND_LABELS } from "@/lib/types/communication";
import { createClient } from "@/lib/supabase/client";
import { fetchClubPresences, type ClubPresence } from "@/lib/data/club/presences";
import { decompterLeMois, libelleMois } from "@/lib/presences/mois";
import {
  fetchCoverageWishes,
  cancelCoverageWish,
  rejectCoverageWish,
  selectCoverageWish,
  COVERAGE_TYPE_LABELS,
  COVERAGE_PRIORITY_LABELS,
  COVERAGE_WISH_STATUS_LABELS,
  COVERAGE_WISH_STATUS_TONE,
  type CoverageWish,
} from "@/lib/data/club/coverageWishes";
import { RequestPresenceModal } from "@/components/presences/RequestPresenceModal";
import { ROLES_DEMANDE_PRESENCE } from "@/lib/data/club/coverageWishes";

// /presences — présences terrain réelles (table club_presences, migration-connect-v17-club-
// presences.sql, EN ATTENTE D'EXÉCUTION — jusque-là, liste honnêtement vide). Lecture seule :
// c'est SportVision qui planifie/valide, pas le club. Le total "réalisées" est calculé depuis les
// vraies lignes status='completed', plus jamais ctx.subscription.presencesUsed (toujours 0, non
// tracké).
//
// "Demander une présence" (§26-33, priorité remontée par Fouka en post-audit 05/09/2026) ouvre
// désormais RequestPresenceModal (coverage_wishes) au lieu de router.push("/services/new") — le
// club SIGNALE un événement, il ne réserve jamais un opérateur ni ne crée de mission directement
// (create_coverage_wishes s'en charge, décision CM requise avant toute planification réelle).
export default function PresencesPage() {
  const { ctx } = useSession();
  if (!canAccess(ctx, "presences")) return <LockedModule />;
  return <PresencesScreen />;
}

// `external_cm` ajouté le 10/09/2026 : c'est le CM SportVision qui décide des événements couverts
// — « le CM choisit librement les matchs/entraînements où SportVision sera présent » — et il était
// le seul à ne pas pouvoir en demander une. Huitième fois aujourd'hui qu'un droit déduit du rôle
// affiché oublie celui qui exploite le club. Trouvé en ouvrant l'écran.
const CAN_REQUEST_ROLES = ROLES_DEMANDE_PRESENCE;

function PresencesScreen() {
  const { ctx } = useSession();
  const [presences, setPresences] = useState<ClubPresence[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [wishes, setWishes] = useState<CoverageWish[] | null>(null);
  const [wishesError, setWishesError] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const canSeeOperator = ctx.membership.role !== "viewer";
  const canRequest = CAN_REQUEST_ROLES.has(ctx.membership.role);
  // Le club demande, le CM décide (v132) : le CM prévoit directement, et répond ici aux demandes.
  const estCm = ctx.membership.role === "external_cm";
  const [reponse, setReponse] = useState<{ id: string; motif: string | null } | null>(null);
  const [reponseErreur, setReponseErreur] = useState<string | null>(null);

  async function repondre(id: string, accepter: boolean, motif?: string) {
    setCancellingId(id);
    setReponseErreur(null);
    try {
      const supabase = createClient();
      if (accepter) await selectCoverageWish(supabase, id);
      else await rejectCoverageWish(supabase, id, motif);
      setReponse(null);
      await Promise.all([reloadWishes(), reload()]);
    } catch (e) {
      setReponseErreur((e as { message?: string } | null)?.message || "La réponse n'a pas pu être enregistrée.");
    } finally {
      setCancellingId(null);
    }
  }

  async function reload() {
    setLoadError(false);
    try {
      const supabase = createClient();
      setPresences(await fetchClubPresences(supabase, ctx.organization.id));
    } catch {
      setLoadError(true);
      setPresences([]);
    }
  }

  async function reloadWishes() {
    setWishesError(false);
    try {
      const supabase = createClient();
      setWishes(await fetchCoverageWishes(supabase, ctx.organization.id));
    } catch {
      setWishesError(true);
      setWishes([]);
    }
  }

  async function handleCancelWish(id: string) {
    setCancellingId(id);
    try {
      const supabase = createClient();
      await cancelCoverageWish(supabase, id);
      await reloadWishes();
    } catch {
      setWishesError(true);
    } finally {
      setCancellingId(null);
    }
  }

  useEffect(() => {
    reload();
    reloadWishes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.organization.id]);

  // 10/09/2026 — Plus de « X réalisées sur 12 », ni de barre qui progresse vers ce 12. Ce nombre
  // venait d'une inclusion commerciale du plan et ne décrivait aucune règle opérationnelle : le
  // CM choisit librement les événements couverts. Un dénominateur transformait ce choix en dette.
  const now = new Date();
  const decompte = decompterLeMois(presences ?? [], now);
  const currentMonthLabel = libelleMois(now);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="text-[12px] font-bold text-text-soft">Full Communication</div>
        <h1 className="mt-1 text-[24px] font-extrabold tracking-tight">Présences SportVision</h1>
        <p className="mt-1 text-[13.5px] text-text-soft">{currentMonthLabel}</p>
      </div>

      <CardPremium>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-baseline gap-x-7 gap-y-2">
            <Compte valeur={decompte.programmees} mot="programmée" />
            <Compte valeur={decompte.realisees} mot="réalisée" />
            <Compte valeur={decompte.aVenir} mot="à venir" invariable />
          </div>
          {canRequest && (
            <Button
              variant="secondary"
              className="border-white/25 bg-white/[.12] text-white hover:border-white/40"
              onClick={() => setShowRequestModal(true)}
            >
              {estCm ? "Prévoir SportVision" : "Demander une présence"}
            </Button>
          )}
        </div>
      </CardPremium>

      {loadError && (
        <Card className="flex flex-wrap items-center gap-3 border-danger-fg/30 bg-danger-bg px-5 py-4">
          <AlertTriangle className="h-[18px] w-[18px] flex-none text-danger-fg" aria-hidden />
          <span className="min-w-0 flex-1 text-[13px] font-semibold text-danger-fg">Impossible de charger les présences.</span>
          <Button variant="secondary" className="h-8 flex-none px-3 text-[12px]" onClick={reload}>
            Réessayer
          </Button>
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        {presences === null ? (
          <div className="p-9 text-center text-[13.5px] text-text-soft">Chargement…</div>
        ) : presences.length === 0 ? (
          <div className="p-6">
            <EmptyState icon={CalendarClock} title="Aucune présence programmée" subtitle="Vos prochaines présences terrain apparaîtront ici." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left">
              <thead>
                <tr className="border-b border-divider bg-surface-alt">
                  {["Date", "Événement", "Type", ...(canSeeOperator ? ["Opérateur"] : []), "Statut"].map((h) => (
                    <th key={h} className="px-5 py-3 text-[11px] font-extrabold uppercase tracking-[.04em] text-text-faint">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {presences.map((p) => (
                  <tr key={p.id} className="border-b border-divider last:border-0 hover:bg-row-hover">
                    <td className="px-5 py-3.5 text-[13px] font-semibold text-text-soft">{formatDate(p.date)}</td>
                    <td className="px-5 py-3.5 text-[13.5px] font-bold text-text">{p.eventLabel}</td>
                    <td className="px-5 py-3.5 text-[13px] text-text-soft">{PRESENCE_KIND_LABELS[p.kind]}</td>
                    {canSeeOperator && (
                      <td className="px-5 py-3.5 text-[13px] text-text-soft">{p.operatorName ?? "À confirmer"}</td>
                    )}
                    <td className="px-5 py-3.5">
                      <Badge tone={presenceStatusTone(p.status)}>{PRESENCE_STATUS_LABELS[p.status]}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {canRequest && (
        <div className="flex flex-col gap-3">
          <h2 className="text-[15px] font-extrabold tracking-tight">{estCm ? "Demandes de présence" : "Souhaits de présence"}</h2>
          {reponseErreur && <p className="text-[12.5px] font-bold text-danger-fg">{reponseErreur}</p>}
          {wishesError && (
            <Card className="flex flex-wrap items-center gap-3 border-danger-fg/30 bg-danger-bg px-5 py-4">
              <AlertTriangle className="h-[18px] w-[18px] flex-none text-danger-fg" aria-hidden />
              <span className="min-w-0 flex-1 text-[13px] font-semibold text-danger-fg">Impossible de charger vos souhaits.</span>
              <Button variant="secondary" className="h-8 flex-none px-3 text-[12px]" onClick={reloadWishes}>
                Réessayer
              </Button>
            </Card>
          )}
          <Card className="overflow-hidden p-0">
            {wishes === null ? (
              <div className="p-9 text-center text-[13.5px] text-text-soft">Chargement…</div>
            ) : wishes.length === 0 ? (
              <div className="p-6">
                <EmptyState icon={Send} title="Aucun souhait envoyé" subtitle="Les événements pour lesquels vous demandez une présence SportVision apparaîtront ici." />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-divider bg-surface-alt">
                      {["Événement", "Type", "Priorité", "Statut", ""].map((h) => (
                        <th key={h} className="px-5 py-3 text-[11px] font-extrabold uppercase tracking-[.04em] text-text-faint">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {wishes.map((w) => (
                      <tr key={w.id} className="border-b border-divider last:border-0 hover:bg-row-hover">
                        <td className="px-5 py-3.5">
                          <span className="block text-[13.5px] font-bold text-text">{w.evenementLibelle ?? "Événement"}</span>
                          <span className="block text-[12px] text-text-soft">
                            {w.evenementDate ? formatDate(w.evenementDate) : ""}
                            {estCm && w.source === "club_request" ? " · demande du club" : ""}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-[13px] font-semibold text-text">{COVERAGE_TYPE_LABELS[w.coverageType]}</td>
                        <td className="px-5 py-3.5 text-[13px] text-text-soft">{COVERAGE_PRIORITY_LABELS[w.priority]}</td>
                        <td className="px-5 py-3.5">
                          <Badge tone={COVERAGE_WISH_STATUS_TONE[w.status]}>{COVERAGE_WISH_STATUS_LABELS[w.status]}</Badge>
                          {w.status === "not_selected" && w.notSelectedReason && (
                            <span className="mt-1 block max-w-[240px] text-[12px] text-text-soft">{w.notSelectedReason}</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          {estCm && w.source === "club_request" && (w.status === "wished" || w.status === "reviewing") ? (
                            reponse?.id === w.id ? (
                              <span className="flex items-center justify-end gap-2">
                                <input
                                  value={reponse.motif ?? ""}
                                  onChange={(e) => setReponse({ id: w.id, motif: e.target.value })}
                                  placeholder="Motif (facultatif)"
                                  aria-label="Motif du refus"
                                  className="h-8 w-[180px] rounded-lg border border-border-strong bg-input-bg px-2.5 text-[12.5px] text-text outline-none focus-visible:border-brand-blue"
                                />
                                <Button variant="secondary" className="h-8 px-3 text-[12px]" loading={cancellingId === w.id}
                                  onClick={() => void repondre(w.id, false, reponse.motif ?? undefined)}>
                                  Confirmer le refus
                                </Button>
                                <button type="button" onClick={() => setReponse(null)} className="text-[12px] font-bold text-text-faint hover:text-text">
                                  Annuler
                                </button>
                              </span>
                            ) : (
                              <span className="flex items-center justify-end gap-2">
                                <Button className="h-8 px-3 text-[12px]" loading={cancellingId === w.id} onClick={() => void repondre(w.id, true)}>
                                  Accepter
                                </Button>
                                <Button variant="secondary" className="h-8 px-3 text-[12px]" disabled={cancellingId === w.id}
                                  onClick={() => setReponse({ id: w.id, motif: "" })}>
                                  Refuser
                                </Button>
                              </span>
                            )
                          ) : w.status === "wished" || w.status === "reviewing" || w.status === "selected" || w.status === "sent_to_production" ? (
                            <button
                              onClick={() => handleCancelWish(w.id)}
                              disabled={cancellingId === w.id}
                              className="text-[12.5px] font-bold text-danger-fg hover:underline disabled:opacity-50"
                            >
                              {cancellingId === w.id ? "Annulation…" : "Annuler"}
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {showRequestModal && (
        <RequestPresenceModal
          supabase={createClient()}
          clubId={ctx.organization.id}
          onClose={() => setShowRequestModal(false)}
          onSubmitted={() => void Promise.all([reloadWishes(), reload()])}
          mode={estCm ? "cm" : "club"}
        />
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
}

/** Un nombre et ce qu'il compte. Aucun dénominateur : la règle métier ne fixe ni objectif ni
 *  plafond, et la mise en forme ne doit pas en inventer un. */
function Compte({ valeur, mot, invariable }: { valeur: number; mot: string; invariable?: boolean }) {
  return (
    <div>
      <span className="text-[26px] font-extrabold tabular-nums tracking-tight">{valeur}</span>
      <span className="ml-1.5 text-[13px] font-semibold text-[#B9C7EB]">
        {mot}
        {!invariable && valeur > 1 ? "s" : ""}
      </span>
    </div>
  );
}
