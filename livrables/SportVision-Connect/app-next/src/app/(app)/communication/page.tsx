"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  ImagePlus,
  MessageCircleWarning,
  Sparkles,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canCreate } from "@/lib/permissions";
import { LockedModule } from "@/components/ui/LockedModule";
import { Card } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { SkeletonRow } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Toast, useToast } from "@/components/feedback/Toast";
import { useClientId } from "@/lib/data/shared/use-client-id";
import { createClient } from "@/lib/supabase/client";
import { fetchContenus, type Contenu } from "@/lib/data/shared/contenus";
import { CONTENU_STATUT_LABEL, CONTENU_STATUT_TONE } from "@/components/communication/contenuStatusTone";
import {
  fetchClubMatchClaims,
  fetchClubMatches,
  requestVisualHref,
  setClubMatchClaim,
  type ClubMatchClaim,
} from "@/lib/data/club/matches";
import { fetchClubMediaAssets } from "@/lib/data/club/content";
import type { Match } from "@/lib/types/studio";
import type { MediaAsset } from "@/lib/types/content";
import { MEDIA_KIND_LABELS } from "@/lib/types/content";
import type { SupabaseClient } from "@supabase/supabase-js";

// /communication — deux produits différents partagent cette route selon l'offre (voir
// resolveNavigation § README.md "l'offre décide avant le type") :
//   - Full Communication (planCode === "full_communication") : planning éditorial existant
//     (FullCommunicationPlanning ci-dessous, INCHANGÉ), CM interne/externe qui pilote le
//     calendrier de contenus d'un client relié (table `contenus`, useClientId).
//   - Club+ Start/Performance classique, type "club" (brief Fouka 17/08/2026,
//     CLUB-PLUS-PRODUCT-BIBLE.md §9) : le vrai "Centre communication" — un hub anti-doublon pour
//     un communication_manager/external_cm de club (CommunicationHub ci-dessous, NOUVEAU).
// Les autres combinaisons (académie/coach sur une offre Club+, par exemple) gardent l'ancien
// comportement (FullCommunicationPlanning, qui affichera "pas encore reliée" faute de
// portail_client_id) : hors périmètre de ce chantier, qui cible explicitement "communication_
// manager d'un club Start/Performance" — voir le brief.
export default function CommunicationPage() {
  const { ctx } = useSession();

  if (ctx.organization.type === "club" && ctx.subscription.planCode !== "full_communication") {
    return <CommunicationHub />;
  }

  return <FullCommunicationPlanning />;
}

function FullCommunicationPlanning() {
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
            <Link
              key={c.id}
              href={`/communication/publications/${c.id}`}
              className="flex flex-wrap items-center gap-3.5 border-b border-divider px-5 py-3.5 last:border-0 hover:bg-row-hover"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-bold text-text">{c.titre}</span>
                <span className="mt-0.5 block text-[12px] text-text-soft">
                  {[c.plateforme, c.typeContenu, c.sponsor].filter(Boolean).join(" · ") || "—"}
                </span>
              </span>
              <span className="w-28 flex-none text-right text-[12px] text-text-soft">
                {c.datePrevue ?? c.datePublication ?? "Date à définir"}
              </span>
              <Badge tone={CONTENU_STATUT_TONE[c.statut]}>{CONTENU_STATUT_LABEL[c.statut]}</Badge>
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Centre communication — Club+ Start/Performance (Bible §9). Hub à 5 cartes, chacune renvoyant
// vers l'écran détaillé existant (Match Center, Demandes de visuels, Mes contenus) plutôt que de
// réimplémenter ces écrans ici — "réutiliser avant de créer" (Bible §26). "Prendre en charge" /
// "Pris en compte" (anti-doublon entre CM) est câblé sur les deux tables citées par le brief :
// club_matches et club_requests (colonne `taken_by`, migration-clubplus-v41-centre-
// communication-prise-en-charge.sql, exécutée — vérifié en direct le 17/08/2026).
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** club_requests.status = 'info_manquante' — statut réel le plus proche de "Modification
 * demandée" (§9/§17) dans ce schéma : aucun des 6 statuts réels de club_requests (voir
 * data/club/requests.ts § STATUS_MAP) n'est littéralement "correction"/"modification". Ce
 * statut signifie "SportVision attend une information du club pour continuer" — un retour
 * SportVision -> CM, ce qui est la même intention que "Modification reçue". Documenté ici plutôt
 * que fabriqué silencieusement. */
interface ModificationRequest {
  id: string;
  team: string | null;
  type: string;
  createdAt: string;
  takenBy: string | null;
}

async function fetchModificationRequests(supabase: SupabaseClient, organizationId: string): Promise<ModificationRequest[]> {
  const { data, error } = await supabase
    .from("club_requests")
    .select("id, team, type, created_at, taken_by")
    .eq("club_id", organizationId)
    .eq("status", "info_manquante")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as { id: string; team: string | null; type: string; created_at: string; taken_by: string | null }[]).map(
    (row) => ({ id: row.id, team: row.team, type: row.type, createdAt: row.created_at, takenBy: row.taken_by }),
  );
}

/** Même garde-fou `.select("id")` que setClubMatchClaim (data/club/matches.ts) : une RLS qui
 * bloquerait silencieusement ne doit jamais ressembler à un succès. */
async function setRequestClaim(supabase: SupabaseClient, requestId: string, userId: string | null): Promise<void> {
  const { data, error } = await supabase.from("club_requests").update({ taken_by: userId }).eq("id", requestId).select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Action refusée : demande introuvable ou accès refusé.");
}

/** Un match "résultat disponible" (recu) sans buteurs/MVP/commentaire du tout — critère simple
 * (Bible : "matchs sans buteurs/MVP/commentaire renseignés"), pas de nouvelle colonne. Un match
 * qui a déjà au moins une de ces informations n'est pas remonté ici : le but est de repérer les
 * résultats totalement bruts, pas de pinailler sur un champ optionnel manquant parmi d'autres. */
function isMissingMatchInfo(m: Match): boolean {
  return !m.scorers?.length && !m.manOfTheMatch && !m.extendedReport?.comment;
}

function CommunicationHub() {
  const { ctx } = useSession();
  const { toastMessage, toastTone, showToast } = useToast();
  const canAct = canCreate(ctx, "visual_request");

  const [matches, setMatches] = useState<Match[] | null>(null);
  const [matchClaims, setMatchClaims] = useState<Map<string, string | null> | null>(null);
  const [matchesError, setMatchesError] = useState(false);

  const [modRequests, setModRequests] = useState<ModificationRequest[] | null>(null);
  const [modRequestsError, setModRequestsError] = useState(false);

  const [media, setMedia] = useState<MediaAsset[] | null>(null);
  const [mediaError, setMediaError] = useState(false);

  const loadMatches = useCallback(async () => {
    setMatchesError(false);
    const supabase = createClient();
    try {
      const [rows, claims] = await Promise.all([
        fetchClubMatches(supabase, ctx.organization.id),
        fetchClubMatchClaims(supabase, ctx.organization.id).catch<ClubMatchClaim[]>(() => []),
      ]);
      setMatches(rows);
      setMatchClaims(new Map(claims.map((c) => [c.id, c.takenBy])));
    } catch {
      setMatchesError(true);
      setMatches([]);
    }
  }, [ctx.organization.id]);

  const loadModRequests = useCallback(async () => {
    setModRequestsError(false);
    const supabase = createClient();
    try {
      setModRequests(await fetchModificationRequests(supabase, ctx.organization.id));
    } catch {
      setModRequestsError(true);
      setModRequests([]);
    }
  }, [ctx.organization.id]);

  const loadMedia = useCallback(async () => {
    setMediaError(false);
    const supabase = createClient();
    try {
      setMedia(await fetchClubMediaAssets(supabase, ctx.organization.id));
    } catch {
      setMediaError(true);
      setMedia([]);
    }
  }, [ctx.organization.id]);

  useEffect(() => {
    loadMatches();
    loadModRequests();
    loadMedia();
  }, [loadMatches, loadModRequests, loadMedia]);

  const resultsAvailable = useMemo(() => (matches ?? []).filter((m) => m.status === "result_received"), [matches]);
  const missingInfo = useMemo(() => resultsAvailable.filter(isMissingMatchInfo), [resultsAvailable]);
  const toValidate = useMemo(() => (media ?? []).filter((a) => a.status === "to_validate"), [media]);
  const newContent = useMemo(
    () => [...(media ?? [])].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 5),
    [media],
  );

  function claimMatch(matchId: string, next: string | null) {
    const supabase = createClient();
    setClubMatchClaim(supabase, matchId, next)
      .then(() => {
        setMatchClaims((prev) => new Map(prev).set(matchId, next));
        showToast(next ? "Match pris en charge." : "Prise en charge retirée.");
      })
      .catch(() => showToast("Action impossible, réessayez.", "error"));
  }

  function claimRequest(requestId: string, next: string | null) {
    const supabase = createClient();
    setRequestClaim(supabase, requestId, next)
      .then(() => {
        setModRequests((prev) => (prev ? prev.map((r) => (r.id === requestId ? { ...r, takenBy: next } : r)) : prev));
        showToast(next ? "Demande prise en charge." : "Prise en charge retirée.");
      })
      .catch(() => showToast("Action impossible, réessayez.", "error"));
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="text-[12px] font-bold text-text-soft">Communication</div>
        <h1 className="mt-1.5 text-[29px] font-extrabold leading-tight tracking-tight">Centre communication</h1>
        <p className="mt-1.5 max-w-2xl text-[13.5px] text-text-soft">
          Tout ce qui attend une action de communication pour {ctx.organization.name}. Prenez en charge un élément
          pour éviter qu&apos;un autre membre le traite en double.
        </p>
      </div>

      <HubSection
        icon={Trophy}
        title="Résultat disponible"
        badgeTone="info"
        loading={matches === null}
        error={matchesError}
        onRetry={loadMatches}
        empty="Aucun résultat en attente de communication."
        count={resultsAvailable.length}
        footer={
          <Link href="/matchcenter" className="text-[12.5px] font-bold text-brand-blue-electric">
            Ouvrir Match Center →
          </Link>
        }
      >
        {resultsAvailable.map((m) => (
          <ClaimRow
            key={m.id}
            title={`${m.teamName} ${m.isHome ? "vs" : "@"} ${m.opponent}`}
            subtitle={
              (m.scoreFor !== undefined && m.scoreAgainst !== undefined ? `${m.scoreFor} - ${m.scoreAgainst} · ` : "") +
              (m.kickoffAt ? new Date(m.kickoffAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : "Date à confirmer")
            }
            takenBy={matchClaims?.get(m.id) ?? null}
            currentUserId={ctx.user.id}
            canAct={canAct}
            onClaim={() => claimMatch(m.id, ctx.user.id)}
            onRelease={() => claimMatch(m.id, null)}
          >
            {canAct && (
              <Link href={requestVisualHref(m)}>
                <Button variant="secondary" className="h-8 px-3 text-[12px]">
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  Demander un visuel
                </Button>
              </Link>
            )}
          </ClaimRow>
        ))}
      </HubSection>

      <HubSection
        icon={ImagePlus}
        title="Visuel à valider"
        badgeTone="accent"
        loading={media === null}
        error={mediaError}
        onRetry={loadMedia}
        empty="Aucun visuel en attente de validation."
        count={toValidate.length}
        footer={
          <Link href="/content" className="text-[12.5px] font-bold text-brand-blue-electric">
            Ouvrir Mes contenus →
          </Link>
        }
      >
        {toValidate.map((a) => (
          <SimpleRow
            key={a.id}
            title={a.name}
            subtitle={MEDIA_KIND_LABELS[a.kind]}
            action={
              <Link href={`/content/${a.id}`}>
                <Button variant="secondary" className="h-8 px-3 text-[12px]">
                  Voir
                </Button>
              </Link>
            }
          />
        ))}
      </HubSection>

      <HubSection
        icon={AlertTriangle}
        title="Informations manquantes"
        badgeTone="warning"
        loading={matches === null}
        error={matchesError}
        onRetry={loadMatches}
        empty="Tous les résultats disponibles ont leurs informations complémentaires."
        count={missingInfo.length}
      >
        {missingInfo.map((m) => (
          <SimpleRow
            key={m.id}
            title={`${m.teamName} ${m.isHome ? "vs" : "@"} ${m.opponent}`}
            subtitle="Buteurs, joueur du match et commentaire non renseignés"
            action={
              <Link href="/matchcenter">
                <Button variant="secondary" className="h-8 px-3 text-[12px]">
                  Compléter
                </Button>
              </Link>
            }
          />
        ))}
      </HubSection>

      <HubSection
        icon={ClipboardList}
        title="Nouveaux contenus"
        badgeTone="cyan"
        loading={media === null}
        error={mediaError}
        onRetry={loadMedia}
        empty="Aucun contenu récent."
        count={newContent.length}
        footer={
          <Link href="/content" className="text-[12.5px] font-bold text-brand-blue-electric">
            Ouvrir Mes contenus →
          </Link>
        }
      >
        {newContent.map((a) => (
          <SimpleRow
            key={a.id}
            title={a.name}
            subtitle={`${MEDIA_KIND_LABELS[a.kind]} · ${new Date(a.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}`}
            action={
              <Link href={`/content/${a.id}`}>
                <Button variant="secondary" className="h-8 px-3 text-[12px]">
                  Voir
                </Button>
              </Link>
            }
          />
        ))}
      </HubSection>

      <HubSection
        icon={MessageCircleWarning}
        title="Modification reçue"
        badgeTone="danger"
        loading={modRequests === null}
        error={modRequestsError}
        onRetry={loadModRequests}
        empty="Aucune demande en attente de complément."
        count={modRequests?.length ?? 0}
        footer={
          <Link href="/requests" className="text-[12.5px] font-bold text-brand-blue-electric">
            Ouvrir Demandes de visuels →
          </Link>
        }
      >
        {(modRequests ?? []).map((r) => (
          <ClaimRow
            key={r.id}
            title={r.team ? `${r.type} · ${r.team}` : r.type}
            subtitle={new Date(r.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
            takenBy={r.takenBy}
            currentUserId={ctx.user.id}
            canAct={canAct}
            onClaim={() => claimRequest(r.id, ctx.user.id)}
            onRelease={() => claimRequest(r.id, null)}
          >
            <Link href="/requests">
              <Button variant="secondary" className="h-8 px-3 text-[12px]">
                Voir
              </Button>
            </Link>
          </ClaimRow>
        ))}
      </HubSection>

      <Toast message={toastMessage} tone={toastTone} />
    </div>
  );
}

function HubSection({
  icon: Icon,
  title,
  badgeTone,
  loading,
  error,
  onRetry,
  empty,
  count,
  footer,
  children,
}: {
  icon: LucideIcon;
  title: string;
  badgeTone: BadgeTone;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  empty: string;
  count: number;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <div className="flex items-center justify-between border-b border-divider px-5 py-4">
        <div className="flex items-center gap-2.5">
          <Icon className="h-4 w-4 text-text-soft" aria-hidden />
          <span className="text-[15px] font-extrabold tracking-tight">{title}</span>
          <Badge tone={badgeTone}>
            {count} élément{count > 1 ? "s" : ""}
          </Badge>
        </div>
        {footer}
      </div>
      {error ? (
        <ErrorState message="Impossible de charger ces informations." onRetry={onRetry} />
      ) : loading ? (
        <div>
          {Array.from({ length: 2 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      ) : count === 0 ? (
        <EmptyState icon={CheckCircle2} title={empty} />
      ) : (
        children
      )}
    </Card>
  );
}

function SimpleRow({ title, subtitle, action }: { title: string; subtitle: string; action: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3.5 border-b border-divider px-5 py-3.5 last:border-0 hover:bg-row-hover">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-bold text-text">{title}</span>
        <span className="mt-0.5 block text-[12px] text-text-soft">{subtitle}</span>
      </span>
      {action}
    </div>
  );
}

function ClaimRow({
  title,
  subtitle,
  takenBy,
  currentUserId,
  canAct,
  onClaim,
  onRelease,
  children,
}: {
  title: string;
  subtitle: string;
  takenBy: string | null;
  currentUserId: string;
  canAct: boolean;
  onClaim: () => void;
  onRelease: () => void;
  children?: React.ReactNode;
}) {
  const mine = takenBy === currentUserId;
  const takenByOther = !!takenBy && !mine;

  return (
    <div className="flex flex-wrap items-center gap-3.5 border-b border-divider px-5 py-3.5 last:border-0 hover:bg-row-hover">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-bold text-text">{title}</span>
        <span className="mt-0.5 block text-[12px] text-text-soft">{subtitle}</span>
      </span>
      {takenByOther ? (
        <Badge tone="neutral">Pris en charge</Badge>
      ) : mine ? (
        <Badge tone="success">Pris en charge par vous</Badge>
      ) : null}
      {canAct && (
        <Button
          variant="secondary"
          className="h-8 px-3 text-[12px]"
          disabled={takenByOther}
          onClick={mine ? onRelease : onClaim}
        >
          {mine ? "Relâcher" : "Prendre en charge"}
        </Button>
      )}
      {children}
    </div>
  );
}
