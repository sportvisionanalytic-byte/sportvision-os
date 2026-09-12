"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CalendarDays,
  Download,
  FileText,
  Images,
  Inbox,
  MapPin,
  UserPlus,
  Users,
} from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess, canCreate } from "@/lib/permissions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { LockedModule } from "@/components/ui/LockedModule";
import { EmptyState } from "@/components/ui/EmptyState";
import { ImageRightStatusBadge } from "@/components/teams/ImageRightBanner";
import {
  imageRightForPlayer,
  isRealId,
  mockTeamCalendar,
  mockTeamContent,
  mockTeamDocuments,
  mockTeamRequests,
  mockTeams,
  playersForTeam,
} from "@/lib/mock/teams";
import type { LicenseStatus, Team } from "@/lib/types/teams";
import { cn } from "@/lib/cn";
import { createClient } from "@/lib/supabase/client";
import { retirerJoueurEquipe } from "@/lib/data/club/team-detail";
import { fetchLiensParentsADecider, deciderLienParent, type LienParentADecider } from "@/lib/data/club/parentLinks";
import { fetchClubTeams } from "@/lib/data/club/teams";
import { ACCOUNT_STATUS_LABEL, fetchTeamRoster, type TeamRosterPlayer } from "@/lib/data/club/team-detail";
import { fetchClubMembers } from "@/lib/data/club/users";
import { peutOpererClub } from "@/lib/data/club/invitations";
import type { OrgUser } from "@/lib/types/settings";
import { TeamStaffCard } from "@/components/teams/TeamStaffCard";
import { TeamInvitationsCard } from "@/components/teams/TeamInvitationsCard";
import { InviterEncadrantModal } from "@/components/teams/InviterEncadrantModal";
import { EncadrementInvitations, EquipeAlertes, EquipeApercuKpis, EquipeDroitImage } from "@/components/teams/EquipeApercu";
import { fetchApercuEquipe, fetchStatutLancement, type AlerteEquipe, type ApercuEquipe } from "@/lib/data/club/cockpit";
import { fetchClubCalendarEvents } from "@/lib/data/club/calendar";
import { fetchClubMediaAssets } from "@/lib/data/club/content";
import { fetchClubRequests } from "@/lib/data/club/requests";
import { AUTHORIZATION_STATUS_LABELS, AUTHORIZATION_STATUS_TONE } from "@/lib/data/family/authorizations";
import { MEDIA_KIND_LABELS, type MediaAsset } from "@/lib/types/content";
import { VISUAL_REQUEST_STATUS_TONE, VISUAL_TYPE_LABELS, type VisualRequest } from "@/lib/types/studio";
import type { CalendarEvent } from "@/lib/types/calendar";

// Fiche équipe — 6 onglets : Aperçu · Effectif · Calendrier · Contenus · Demandes · Documents.
// ACTIONS.md § 16.

const TABS = ["apercu", "effectif", "calendrier", "contenus", "demandes", "documents"] as const;
type TabKey = (typeof TABS)[number];
const TAB_LABEL: Record<TabKey, string> = {
  apercu: "Aperçu",
  effectif: "Effectif",
  calendrier: "Calendrier",
  contenus: "Contenus",
  demandes: "Demandes",
  documents: "Documents",
};

const LICENSE_LABEL: Record<LicenseStatus, string> = {
  valid: "Licence à jour",
  pending: "Licence en attente",
  expired: "Licence expirée",
  missing: "Licence manquante",
};
const LICENSE_TONE: Record<LicenseStatus, "success" | "warning" | "danger"> = {
  valid: "success",
  pending: "warning",
  expired: "danger",
  missing: "danger",
};

export default function TeamDetailPage({ params }: { params: { id: string } }) {
  const { ctx } = useSession();
  const [tab, setTab] = useState<TabKey>("apercu");

  if (!canAccess(ctx, "teams")) return <LockedModule />;

  // Fiche équipe réelle pour un club (03/09/2026) : team_memberships/player_profiles (roster),
  // club_calendar_events/club_matches (calendrier), club_media/club_creations (contenus) et
  // club_requests (demandes) existent tous désormais avec un vrai team_id — plus de raison de
  // verrouiller cet écran. Les autres types d'organisation (CM externe, sponsor...) gardent le
  // rendu mock ci-dessous, hors périmètre de ce chantier.
  if (ctx.organization.type === "club") {
    // 10/09/2026 — Le droit d'agir se demande à la base, il ne se déduit pas du rôle affiché.
    // Cette ligne testait `role === "admin"` : le CM SportVision, qui porte `external_cm` dans un
    // espace délégué, n'avait donc AUCUNE action d'encadrement sur la fiche — ni inviter un coach,
    // ni rattacher quelqu'un. Septième fois aujourd'hui que la même déduction produit le même bug.
    // Trouvé en ouvrant l'écran, après l'avoir corrigé sur « Coachs & dirigeants » sans penser à
    // regarder ici.
    return <RealTeamDetail organizationId={ctx.organization.id} teamId={params.id} />;
  }

  const team = mockTeams.find((t) => t.id === params.id && t.organizationId === ctx.organization.id);

  if (!team) {
    return (
      <Card className="flex flex-col items-center gap-3 px-8 py-16 text-center">
        <div className="text-[15px] font-extrabold">Équipe introuvable.</div>
        <Link href="/teams">
          <Button variant="secondary">Retour aux équipes</Button>
        </Link>
      </Card>
    );
  }

  const players = playersForTeam(team.id);
  const missingRights = players.filter((p) => imageRightForPlayer(p.id)?.status !== "signed").length;
  const canAddPlayer = canCreate(ctx, "player");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/teams" className="text-[12px] font-bold text-text-soft hover:text-brand-blue-electric">
            ← Équipes
          </Link>
          <h1 className="mt-1.5 text-[29px] font-extrabold leading-tight tracking-tight">{team.name}</h1>
          <div className="mt-1 text-[12.5px] font-semibold text-text-soft">
            {team.category} · Saison {team.season} · {team.playerCount} joueurs
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <Button variant="secondary">
            <Download className="h-3.5 w-3.5" aria-hidden />
            Exporter l&apos;effectif
          </Button>
          <Button variant="primary" disabled={!canAddPlayer}>
            <UserPlus className="h-3.5 w-3.5" aria-hidden />
            Ajouter un joueur
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-divider pb-0.5">
        {TABS.map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "rounded-t-[10px] px-3.5 py-2.5 text-[13px] font-bold transition-colors duration-sv",
              tab === key
                ? "border-b-2 border-brand-blue bg-surface-alt text-text"
                : "border-b-2 border-transparent text-text-soft hover:text-text",
            )}
          >
            {TAB_LABEL[key]}
          </button>
        ))}
      </div>

      {tab === "apercu" && <OverviewTab team={team} missingRights={missingRights} />}
      {tab === "effectif" && <RosterTab players={players} />}
      {tab === "calendrier" && <CalendarTab teamId={team.id} />}
      {tab === "contenus" && <ContentTab teamId={team.id} />}
      {tab === "demandes" && <RequestsTab teamId={team.id} />}
      {tab === "documents" && <DocumentsTab teamId={team.id} />}
    </div>
  );
}

function OverviewTab({
  team,
  missingRights,
}: {
  team: (typeof mockTeams)[number];
  missingRights: number;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card className="p-4.5 lg:col-span-2">
        <div className="text-[14px] font-extrabold tracking-tight">Informations générales</div>
        <dl className="mt-3.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Info label="Entraîneur principal" value={team.headCoachName} />
          {team.assistantCoachNames && team.assistantCoachNames.length > 0 && (
            <Info label="Entraîneurs adjoints" value={team.assistantCoachNames.join(", ")} />
          )}
          <Info label="Créneaux d'entraînement" value={team.trainingSlots ?? "—"} />
          <Info label="Lieu" value={team.venue ?? "—"} />
          <Info label="Effectif" value={`${team.playerCount} joueurs`} />
          <Info label="Saison" value={team.season} />
        </dl>
      </Card>

      <Card className="p-4.5">
        <div className="text-[14px] font-extrabold tracking-tight">Droit à l&apos;image</div>
        {missingRights > 0 ? (
          <div className="mt-3 flex items-start gap-2.5 rounded-xl bg-warning-bg px-3 py-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-warning-fg" aria-hidden />
            <p className="text-[12.5px] leading-relaxed text-warning-fg">
              {missingRights} joueur{missingRights > 1 ? "s" : ""} sans autorisation signée. Leurs
              contenus ne sont pas publiables.
            </p>
          </div>
        ) : (
          <div className="mt-3 flex items-start gap-2.5 rounded-xl bg-success-bg px-3 py-3">
            <p className="text-[12.5px] leading-relaxed text-success-fg">
              Toutes les autorisations de l&apos;effectif sont signées.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-bold uppercase tracking-[.04em] text-text-faint">{label}</dt>
      <dd className="mt-1 text-[13.5px] font-bold text-text">{value}</dd>
    </div>
  );
}

function RosterTab({ players }: { players: ReturnType<typeof playersForTeam> }) {
  if (players.length === 0) {
    return (
      <Card>
        <EmptyState icon={Users} title="Aucun joueur enregistré" description="Ajoutez vos joueurs un par un, ou importez un fichier depuis l’onboarding." />
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="hidden grid-cols-[40px_1.6fr_1fr_1fr_1fr] gap-3 border-b border-divider bg-surface-alt px-5 py-3 text-[11px] font-extrabold uppercase tracking-[.04em] text-text-faint sm:grid">
        <span>N°</span>
        <span>Joueur</span>
        <span>Poste</span>
        <span>Licence</span>
        <span>Droit à l&apos;image</span>
      </div>
      {players.map((p) => {
        const right = imageRightForPlayer(p.id);
        const rowClassName =
          "grid grid-cols-2 gap-2.5 border-b border-divider px-5 py-3.5 last:border-0 sm:grid-cols-[40px_1.6fr_1fr_1fr_1fr] sm:items-center sm:gap-3";
        const rowContent = (
          <>
            <span className="font-mono text-[12.5px] font-bold text-text-soft">
              {p.shirtNumber ?? "—"}
            </span>
            <span className="text-[13.5px] font-bold text-text">
              {p.firstName} {p.lastName}
            </span>
            <span className="text-[12.5px] text-text-soft">{p.position ?? "—"}</span>
            <span>
              <Badge tone={LICENSE_TONE[p.licenseStatus]}>{LICENSE_LABEL[p.licenseStatus]}</Badge>
            </span>
            <span>
              <ImageRightStatusBadge status={right?.status ?? "pending"} />
            </span>
          </>
        );
        if (isRealId(p.id)) {
          return (
            <div key={p.id} className={rowClassName}>
              {rowContent}
            </div>
          );
        }
        return (
          <Link key={p.id} href={`/teams/players/${p.id}`} className={cn(rowClassName, "hover:bg-row-hover")}>
            {rowContent}
          </Link>
        );
      })}
    </Card>
  );
}

function CalendarTab({ teamId }: { teamId: string }) {
  const entries = mockTeamCalendar.filter((e) => e.teamId === teamId);
  if (entries.length === 0) {
    return (
      <Card>
        <EmptyState icon={CalendarDays} title="Aucun événement à venir" description="Ajoutez vos matchs et vos entraînements depuis le Calendrier." />
      </Card>
    );
  }
  return (
    <Card>
      {entries.map((e) => (
        <div key={e.id} className="flex items-center gap-3.5 border-b border-divider px-5 py-3.5 last:border-0">
          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-info-bg text-info-fg">
            <CalendarDays className="h-4 w-4" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-bold text-text">{e.label}</span>
            <span className="mt-0.5 flex items-center gap-1 text-[12px] text-text-soft">
              {new Date(e.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" })}
              {e.location && (
                <>
                  <span aria-hidden>·</span>
                  <MapPin className="h-3 w-3" aria-hidden />
                  {e.location}
                </>
              )}
            </span>
          </span>
        </div>
      ))}
    </Card>
  );
}

function ContentTab({ teamId }: { teamId: string }) {
  const items = mockTeamContent.filter((c) => c.teamId === teamId);
  if (items.length === 0) {
    return (
      <Card>
        <EmptyState icon={Images} title="Aucun contenu pour cette équipe" description="Les contenus produits pour cette équipe apparaîtront ici." />
      </Card>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((c) => (
        <Card key={c.id} className="overflow-hidden">
          <div
            className="flex h-28 items-center justify-center text-[11px] font-bold uppercase tracking-[.06em] text-white/80"
            style={{
              background:
                "repeating-linear-gradient(125deg, #1B2A6B 0px, #1B2A6B 14px, #24337a 14px, #24337a 28px)",
            }}
          >
            {c.kind === "video" ? "Aperçu vidéo" : "Aperçu photo"}
          </div>
          <div className="p-3.5">
            <div className="truncate text-[13px] font-bold">{c.label}</div>
            <div className="mt-0.5 text-[11.5px] text-text-soft">{c.createdAt}</div>
          </div>
        </Card>
      ))}
    </div>
  );
}

const REQUEST_LABEL: Record<(typeof mockTeamRequests)[number]["status"], string> = {
  envoyee: "Envoyée",
  en_creation: "En création",
  a_valider: "À valider",
  terminee: "Terminée",
};
const REQUEST_TONE: Record<(typeof mockTeamRequests)[number]["status"], "info" | "accent" | "warning" | "success"> = {
  envoyee: "info",
  en_creation: "accent",
  a_valider: "warning",
  terminee: "success",
};

function RequestsTab({ teamId }: { teamId: string }) {
  const items = mockTeamRequests.filter((r) => r.teamId === teamId);
  if (items.length === 0) {
    return (
      <Card>
        <EmptyState icon={Inbox} title="Aucune demande en cours pour cette équipe" description="Les demandes d’adhésion des joueurs et des parents arrivent ici." />
      </Card>
    );
  }
  return (
    <Card>
      {items.map((r) => (
        <div key={r.id} className="flex items-center gap-3.5 border-b border-divider px-5 py-3.5 last:border-0">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-bold text-text">{r.label}</span>
            <span className="mt-0.5 block text-[12px] text-text-soft">Envoyée le {r.requestedAt}</span>
          </span>
          <Badge tone={REQUEST_TONE[r.status]}>{REQUEST_LABEL[r.status]}</Badge>
        </div>
      ))}
    </Card>
  );
}

const DOC_STATUS_LABEL: Record<(typeof mockTeamDocuments)[number]["status"], string> = {
  a_jour: "À jour",
  a_completer: "À compléter",
  expire: "Expiré",
};
const DOC_STATUS_TONE: Record<(typeof mockTeamDocuments)[number]["status"], "success" | "warning" | "danger"> = {
  a_jour: "success",
  a_completer: "warning",
  expire: "danger",
};

function DocumentsTab({ teamId }: { teamId: string }) {
  const items = mockTeamDocuments.filter((d) => d.teamId === teamId);
  if (items.length === 0) {
    return (
      <Card>
        <EmptyState icon={FileText} title="Aucun document pour cette équipe" description="Déposez les autorisations et les documents de l’équipe depuis Documents." />
      </Card>
    );
  }
  return (
    <Card>
      {items.map((d) => (
        <div key={d.id} className="flex items-center gap-3.5 border-b border-divider px-5 py-3.5 last:border-0">
          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-neutral-bg text-neutral-fg">
            <FileText className="h-4 w-4" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-bold text-text">{d.name}</span>
            <span className="mt-0.5 block text-[12px] text-text-soft">Mis à jour le {d.updatedAt}</span>
          </span>
          <Badge tone={DOC_STATUS_TONE[d.status]}>{DOC_STATUS_LABEL[d.status]}</Badge>
        </div>
      ))}
    </Card>
  );
}

// ── Fiche équipe réelle (club) ──────────────────────────────────────────────────────────────
// team.name reste la clé de filtrage pour Contenus/Demandes : club_media/club_creations/
// club_requests n'ont qu'une colonne "team" texte libre, pas de team_id (voir data/club/
// content.ts et data/club/requests.ts) — comparaison par nom, comme partout ailleurs dans l'app
// pour ces deux tables.

const REAL_TABS = ["apercu", "effectif", "calendrier", "contenus", "demandes", "documents"] as const;
type RealTabKey = (typeof REAL_TABS)[number];
const REAL_TAB_LABEL: Record<RealTabKey, string> = {
  apercu: "Aperçu",
  effectif: "Effectif",
  calendrier: "Calendrier",
  contenus: "Contenus",
  demandes: "Demandes",
  documents: "Documents",
};

function RealTeamDetail({ organizationId, teamId }: { organizationId: string; teamId: string }) {
  const { ctx: sessionCtx } = useSession();
  // `null` tant que la base n'a pas répondu : ni actions offertes, ni actions retirées à tort.
  const [canManageMembers, setCanManageMembers] = useState(false);
  const [tab, setTab] = useState<RealTabKey>("apercu");
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [roster, setRoster] = useState<TeamRosterPlayer[] | null>(null);
  const [members, setMembers] = useState<OrgUser[]>([]);
  // Incrémenté après chaque écriture sur l'encadrement : on relit la base plutôt que de recopier
  // localement ce qu'on croit avoir écrit, les périmètres étant modifiables ailleurs en parallèle.
  const [rechargement, setRechargement] = useState(0);
  // La fiche en un appel (v121). `undefined` : en cours ; `null` : pas lisible pour ce rôle — on
  // retombe alors sur l'affichage d'avant, sans rien casser.
  const [apercu, setApercu] = useState<ApercuEquipe | null | undefined>(undefined);
  const [enPreparation, setEnPreparation] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchApercuEquipe(createClient(), teamId)
      .then((a) => !cancelled && setApercu(a))
      .catch(() => !cancelled && setApercu(null));
    return () => {
      cancelled = true;
    };
  }, [teamId, rechargement]);

  useEffect(() => {
    fetchStatutLancement(createClient(), organizationId)
      .then((l) => setEnPreparation(Boolean(l && l.statut !== "actif")))
      .catch(() => setEnPreparation(false));
  }, [organizationId]);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    Promise.all([fetchClubTeams(supabase, organizationId), fetchTeamRoster(supabase, teamId)]).then(
      ([teamRows, rosterRows]) => {
        if (cancelled) return;
        setTeams(teamRows);
        setRoster(rosterRows);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [organizationId, teamId]);

  // Les membres du club sont chargés à part : l'écran ne les attend pas pour s'afficher, et
  // `cm_member_select` les laisse lire à tout membre — un échec ici (droits, réseau) doit dégrader
  // la seule carte Encadrement, pas la fiche entière.
  useEffect(() => {
    peutOpererClub(createClient(), organizationId).then(setCanManageMembers);
  }, [organizationId]);

  useEffect(() => {
    let cancelled = false;
    fetchClubMembers(createClient(), organizationId)
      .then((rows) => {
        if (!cancelled) setMembers(rows);
      })
      .catch(() => {
        if (!cancelled) setMembers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId, rechargement]);

  if (teams === null || roster === null) {
    return <div className="py-16 text-center text-[13px] text-text-soft">Chargement…</div>;
  }

  const team = teams.find((t) => t.id === teamId);
  if (!team) {
    return (
      <Card className="flex flex-col items-center gap-3 px-8 py-16 text-center">
        <div className="text-[15px] font-extrabold">Équipe introuvable.</div>
        <Link href="/teams">
          <Button variant="secondary">Retour aux équipes</Button>
        </Link>
      </Card>
    );
  }

  // 12/09/2026 — Un coach qui ouvre une équipe hors de son périmètre lisait « Aucun joueur dans
  // cette équipe » : la base ne lui rend rien, et l'écran l'interprétait comme un effectif vide.
  // C'est affirmer une conformité qui n'existe pas. On le dit comme c'est : ce n'est pas son
  // équipe. Le périmètre affiché vient de son adhésion, et la base reste seule à trancher.
  const bornéAuxSiennes =
    !!sessionCtx &&
    ["coach", "team_manager", "sports_director"].includes(sessionCtx.membership.role) &&
    sessionCtx.membership.teamScope.length > 0;
  if (bornéAuxSiennes && !sessionCtx!.membership.teamScope.includes(team.name)) {
    return (
      <Card className="flex flex-col items-center gap-3 px-8 py-16 text-center">
        <div className="text-[15px] font-extrabold">Cette équipe n&apos;est pas dans votre périmètre.</div>
        <p className="max-w-[420px] text-[13px] leading-relaxed text-text-soft">
          Vous encadrez {sessionCtx!.membership.teamScope.join(", ")}. Pour suivre une autre équipe,
          demandez à un dirigeant du club de vous y rattacher.
        </p>
        <Link href="/teams">
          <Button variant="secondary">Retour aux équipes</Button>
        </Link>
      </Card>
    );
  }

  const missingRights = roster.filter((p) => p.imageRightStatus !== "valide").length;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/teams" className="text-[12px] font-bold text-text-soft hover:text-brand-blue-electric">
            ← Équipes
          </Link>
          <h1 className="mt-1.5 text-[29px] font-extrabold leading-tight tracking-tight">{team.name}</h1>
          <div className="mt-1 text-[12.5px] font-semibold text-text-soft">
            {team.category} · Saison {team.season} · {roster.length} joueur{roster.length > 1 ? "s" : ""}
          </div>
        </div>
        {/* 10/09/2026 — Ce bouton n'avait aucune action. Il produit désormais un vrai fichier. */}
        <Button variant="secondary" onClick={() => exporterEffectif(team.name, roster)} disabled={roster.length === 0}>
          <Download className="h-3.5 w-3.5" aria-hidden />
          Exporter l&apos;effectif
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-divider pb-0.5">
        {REAL_TABS.map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "rounded-t-[10px] px-3.5 py-2.5 text-[13px] font-bold transition-colors duration-sv",
              tab === key
                ? "border-b-2 border-brand-blue bg-surface-alt text-text"
                : "border-b-2 border-transparent text-text-soft hover:text-text",
            )}
          >
            {REAL_TAB_LABEL[key]}
          </button>
        ))}
      </div>

      {tab === "apercu" && (
        <RealOverviewTab
          team={team}
          roster={roster}
          missingRights={missingRights}
          clubId={organizationId}
          members={members}
          canManageMembers={canManageMembers}
          onStaffChanged={() => setRechargement((n) => n + 1)}
          apercu={apercu ?? null}
          enPreparation={enPreparation}
        />
      )}
      {tab === "effectif" && (
        <>
          <RattachementsParents clubId={organizationId} equipe={team.name} />
          <RealRosterTab
            roster={roster}
            teamId={teamId}
            peutRetirer={canManageMembers}
            onRetire={() => setRechargement((n) => n + 1)}
          />
        </>
      )}
      {tab === "calendrier" && <RealCalendarTab organizationId={organizationId} teamId={teamId} />}
      {tab === "contenus" && <RealContentTab organizationId={organizationId} teamName={team.name} />}
      {tab === "demandes" && <RealRequestsTab organizationId={organizationId} teamName={team.name} />}
      {tab === "documents" && <EmptyTab icon={FileText} label="Aucun document pour cette équipe." />}
    </div>
  );
}

function RealOverviewTab({
  team,
  roster,
  missingRights,
  clubId,
  members,
  canManageMembers,
  onStaffChanged,
  apercu,
  enPreparation,
}: {
  team: Team;
  roster: TeamRosterPlayer[];
  missingRights: number;
  clubId: string;
  members: OrgUser[];
  canManageMembers: boolean;
  onStaffChanged: () => void;
  apercu: ApercuEquipe | null;
  enPreparation: boolean;
}) {
  const [inviterEncadrant, setInviterEncadrant] = useState(false);
  const router = useRouter();

  // 10/09/2026 — L'aperçu d'abord : l'équipe, son prochain événement, son droit à l'image, sa
  // communication, SportVision ; puis ce qui lui manque, chaque alerte avec son geste.
  if (apercu) {
    const allerA = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    const onAction = (action: AlerteEquipe["action"]) => {
      if (action === "inviter_encadrant") setInviterEncadrant(true);
      else if (action === "inviter_joueurs") allerA("invitations-joueurs");
      else if (action === "droit_image") allerA("droit-image");
      else if (action === "creneaux") router.push("/onboarding?section=entrainements");
      else if (action === "demandes") router.push("/team-requests");
    };
    return (
      <div className="flex flex-col gap-4">
        <EquipeApercuKpis apercu={apercu} />
        <EquipeAlertes alertes={apercu.alertes} onAction={onAction} />
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
          <div className="flex flex-col gap-4 lg:col-span-2">
            <TeamStaffCard
              clubId={clubId}
              teamName={team.name}
              headCoachName={team.headCoachName}
              members={members}
              canManage={canManageMembers}
              onChanged={onStaffChanged}
            />
            <EncadrementInvitations
              encadrement={apercu.encadrement}
              peutGerer={canManageMembers}
              enPreparation={enPreparation}
              onChange={onStaffChanged}
            />
            <div id="droit-image">
              <EquipeDroitImage droit={apercu.droit_image} onInviter={() => allerA("invitations-joueurs")} />
            </div>
          </div>
          <div id="invitations-joueurs">
            <TeamInvitationsCard
              clubId={clubId}
              team={team}
              inscriptions={apercu.inscriptions}
              imageManquantes={apercu.droit_image.total - apercu.droit_image.valides}
            />
          </div>
        </div>
        {inviterEncadrant && (
          <InviterEncadrantModal
            clubId={clubId}
            teamName={team.name}
            enPreparation={enPreparation}
            onClose={() => setInviterEncadrant(false)}
            onInvited={onStaffChanged}
          />
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card className="p-4.5 lg:col-span-2">
        <div className="text-[14px] font-extrabold tracking-tight">Informations générales</div>
        <dl className="mt-3.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <RealInfo label="Catégorie fédérale" value={team.category} />
          <RealInfo label="Effectif" value={`${roster.length} joueur${roster.length > 1 ? "s" : ""}`} />
          <RealInfo label="Saison" value={team.season} />
        </dl>
      </Card>

      <Card className="p-4.5">
        <div className="text-[14px] font-extrabold tracking-tight">Droit à l&apos;image</div>
        {roster.length === 0 ? (
          // « Toutes les autorisations de l'effectif sont validées » sur une équipe SANS joueur
          // affirmait une conformité qui ne repose sur rien. Rien à vérifier n'est pas la même
          // chose que tout vérifié — et c'est le cas de la totalité des équipes du club
          // aujourd'hui, aucune n'ayant encore d'effectif.
          <div className="mt-3 rounded-xl bg-surface-sunken px-3 py-3">
            <p className="text-[12.5px] leading-relaxed text-text-soft">
              Aucun joueur dans cette équipe : il n&apos;y a pour l&apos;instant aucune autorisation
              à recueillir.
            </p>
          </div>
        ) : missingRights > 0 ? (
          <div className="mt-3 flex items-start gap-2.5 rounded-xl bg-warning-bg px-3 py-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-warning-fg" aria-hidden />
            <p className="text-[12.5px] leading-relaxed text-warning-fg">
              {missingRights} joueur{missingRights > 1 ? "s" : ""} sans autorisation validée. Leurs
              contenus ne sont pas publiables.
            </p>
          </div>
        ) : (
          <div className="mt-3 flex items-start gap-2.5 rounded-xl bg-success-bg px-3 py-3">
            <p className="text-[12.5px] leading-relaxed text-success-fg">
              Toutes les autorisations de l&apos;effectif sont validées.
            </p>
          </div>
        )}
      </Card>

      {/* Les invitations de l'équipe, groupées par destinataire — c'est ici qu'elles ont un sens,
          et plus sur les 43 cartes de l'écran Équipes. Le lien joueur mène vers Connect, le coach
          reçoit une invitation nominative : deux publics, deux mécanismes (§38, §41-42). */}
      <TeamInvitationsCard clubId={clubId} team={team} />

      {/* Deux colonnes : la carte porte une liste et des actions, mais rarement plus de deux ou
          trois encadrants. Sur trois colonnes elle laissait un vide large comme la moitié de
          l'écran, à côté d'une carte d'invitations qui, elle, était à l'étroit. */}
      <div className="lg:col-span-2">
        <TeamStaffCard
          clubId={clubId}
          teamName={team.name}
          headCoachName={team.headCoachName}
          members={members}
          canManage={canManageMembers}
          onChanged={onStaffChanged}
        />
      </div>
    </div>
  );
}

function RealInfo({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-bold uppercase tracking-[.04em] text-text-faint">{label}</dt>
      <dd className="mt-1 text-[13.5px] font-bold text-text">{value || "Non renseigné"}</dd>
    </div>
  );
}

function RealRosterTab({
  roster,
  teamId,
  peutRetirer,
  onRetire,
}: {
  roster: TeamRosterPlayer[];
  teamId: string;
  peutRetirer: boolean;
  onRetire: () => void;
}) {
  // Retirer un joueur de l'équipe (12/09/2026) : aucun écran ne le permettait, et l'effectif
  // affichait « Retiré » sur une ligne que la base comptait toujours comme active. La base
  // verifie qui demande ; un refus s'affiche tel quel.
  const [enCours, setEnCours] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  async function retirer(p: TeamRosterPlayer) {
    if (
      !confirm(
        `Retirer ${p.firstName} ${p.lastName} de cette équipe ?\n\nSa fiche et son historique sont conservés, et il pourra être rattaché à une autre équipe.`,
      )
    )
      return;
    setEnCours(p.id);
    setErreur(null);
    try {
      await retirerJoueurEquipe(createClient(), p.id, teamId);
      onRetire();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Le retrait n'a pas abouti.");
    } finally {
      setEnCours(null);
    }
  }

  if (roster.length === 0) {
    return (
      <Card>
        <EmptyState icon={Users} title="Aucun joueur enregistré" description="Ajoutez vos joueurs un par un, ou importez un fichier depuis l’onboarding." />
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="hidden grid-cols-[40px_1.6fr_1fr_1fr_1fr] gap-3 border-b border-divider bg-surface-alt px-5 py-3 text-[11px] font-extrabold uppercase tracking-[.04em] text-text-faint sm:grid">
        <span>N°</span>
        <span>Joueur</span>
        <span>Licence</span>
        <span>Compte</span>
        <span>Droit à l&apos;image</span>
      </div>
      {roster.map((p) => (
        <div
          key={p.id}
          className="grid grid-cols-2 gap-2.5 border-b border-divider px-5 py-3.5 last:border-0 sm:grid-cols-[40px_1.6fr_1fr_1fr_1fr] sm:items-center sm:gap-3"
        >
          <span className="font-mono text-[12.5px] font-bold text-text-soft">{p.shirtNumber ?? "—"}</span>
          <span className="text-[13.5px] font-bold text-text">
            {p.firstName} {p.lastName}
          </span>
          <span className="text-[12.5px] text-text-soft">{p.licenseNumber ?? "—"}</span>
          <span className="text-[12.5px] text-text-soft">{ACCOUNT_STATUS_LABEL[p.accountStatus] ?? p.accountStatus}</span>
          <span className="flex items-center justify-between gap-2">
            <Badge tone={AUTHORIZATION_STATUS_TONE[p.imageRightStatus] ?? "neutral"}>
              {AUTHORIZATION_STATUS_LABELS[p.imageRightStatus] ?? p.imageRightStatus}
            </Badge>
            {peutRetirer && (
              <button
                type="button"
                disabled={enCours === p.id}
                onClick={() => void retirer(p)}
                className="text-[12px] font-bold text-text-faint hover:text-danger-fg disabled:opacity-50"
              >
                Retirer
              </button>
            )}
          </span>
        </div>
      ))}
    </Card>
  );
}

function RealCalendarTab({ organizationId, teamId }: { organizationId: string; teamId: string }) {
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    fetchClubCalendarEvents(supabase, organizationId, teamId)
      .then((rows) => {
        if (!cancelled) setEvents(rows.sort((a, b) => a.startsAt.localeCompare(b.startsAt)));
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId, teamId]);

  if (events === null) {
    return <div className="py-16 text-center text-[13px] text-text-soft">Chargement…</div>;
  }
  if (events.length === 0) {
    return (
      <Card>
        <EmptyState icon={CalendarDays} title="Aucun événement à venir" description="Ajoutez vos matchs et vos entraînements depuis le Calendrier." />
      </Card>
    );
  }
  return (
    <Card>
      {events.map((e) => (
        <div key={e.id} className="flex items-center gap-3.5 border-b border-divider px-5 py-3.5 last:border-0">
          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-info-bg text-info-fg">
            <CalendarDays className="h-4 w-4" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-bold text-text">{e.title}</span>
            <span className="mt-0.5 flex items-center gap-1 text-[12px] text-text-soft">
              {new Date(e.startsAt).toLocaleDateString("fr-FR", {
                day: "2-digit",
                month: "long",
                ...(e.allDay ? {} : { hour: "2-digit", minute: "2-digit" }),
              })}
              {e.location && (
                <>
                  <span aria-hidden>·</span>
                  <MapPin className="h-3 w-3" aria-hidden />
                  {e.location}
                </>
              )}
            </span>
          </span>
        </div>
      ))}
    </Card>
  );
}

function RealContentTab({ organizationId, teamName }: { organizationId: string; teamName: string }) {
  const [items, setItems] = useState<MediaAsset[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    fetchClubMediaAssets(supabase, organizationId)
      .then((rows) => {
        if (!cancelled) setItems(rows.filter((r) => r.teamId === teamName));
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId, teamName]);

  if (items === null) {
    return <div className="py-16 text-center text-[13px] text-text-soft">Chargement…</div>;
  }
  if (items.length === 0) {
    return (
      <Card>
        <EmptyState icon={Images} title="Aucun contenu pour cette équipe" description="Les contenus produits pour cette équipe apparaîtront ici." />
      </Card>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((c) => (
        <Card key={c.id} className="overflow-hidden">
          <div
            className="flex h-28 items-center justify-center text-[11px] font-bold uppercase tracking-[.06em] text-white/80"
            style={{
              background: "repeating-linear-gradient(125deg, #1B2A6B 0px, #1B2A6B 14px, #24337a 14px, #24337a 28px)",
            }}
          >
            {MEDIA_KIND_LABELS[c.kind]}
          </div>
          <div className="p-3.5">
            <div className="truncate text-[13px] font-bold">{c.name}</div>
            <div className="mt-0.5 text-[11.5px] text-text-soft">
              {new Date(c.createdAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function RealRequestsTab({ organizationId, teamName }: { organizationId: string; teamName: string }) {
  const [items, setItems] = useState<VisualRequest[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    fetchClubRequests(supabase, organizationId)
      .then((rows) => {
        if (!cancelled) setItems(rows.filter((r) => r.teamName === teamName));
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId, teamName]);

  if (items === null) {
    return <div className="py-16 text-center text-[13px] text-text-soft">Chargement…</div>;
  }
  if (items.length === 0) {
    return (
      <Card>
        <EmptyState icon={Inbox} title="Aucune demande en cours pour cette équipe" description="Les demandes d’adhésion des joueurs et des parents arrivent ici." />
      </Card>
    );
  }
  return (
    <Card>
      {items.map((r) => (
        <div key={r.id} className="flex items-center gap-3.5 border-b border-divider px-5 py-3.5 last:border-0">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-bold text-text">{VISUAL_TYPE_LABELS[r.visualType]}</span>
            <span className="mt-0.5 block text-[12px] text-text-soft">
              Envoyée le {new Date(r.createdAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}
            </span>
          </span>
          <Badge tone={VISUAL_REQUEST_STATUS_TONE[r.status]}>{r.status}</Badge>
        </div>
      ))}
    </Card>
  );
}

function EmptyTab({ icon: Icon, label }: { icon: typeof Inbox; label: string }) {
  return (
    <Card className="flex flex-col items-center gap-2 px-8 py-14 text-center">
      <Icon className="h-5 w-5 text-text-faint" aria-hidden />
      <div className="text-[14px] font-extrabold">{label}</div>
    </Card>
  );
}

/** L'effectif en CSV, pour Excel : séparateur « ; » et BOM, sinon les accents s'y perdent. */
function exporterEffectif(nomEquipe: string, roster: TeamRosterPlayer[]) {
  const echapper = (v: string | number | null | undefined) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lignes = [
    ["Numéro", "Prénom", "Nom", "Licence", "Compte", "Droit à l'image"].map(echapper).join(";"),
    ...roster.map((p) =>
      [
        p.shirtNumber,
        p.firstName,
        p.lastName,
        p.licenseNumber,
        ACCOUNT_STATUS_LABEL[p.accountStatus] ?? p.accountStatus,
        AUTHORIZATION_STATUS_LABELS[p.imageRightStatus] ?? p.imageRightStatus,
      ]
        .map(echapper)
        .join(";"),
    ),
  ];
  const blob = new Blob(["\ufeff" + lignes.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `effectif-${nomEquipe.replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}


// Rattachements de parents en attente (12/09/2026, migration v172).
//
// Un parent qui se rattache à un enfant reste « en attente de confirmation » : c'est le club qui
// tranche. La fonction de décision existait depuis le durcissement du 10/09, mais aucun écran ne
// l'appelait et aucune liste ne montrait ces demandes : les familles attendaient sans fin. La
// carte n'apparaît que s'il y a quelque chose à décider, et pour l'équipe ouverte.
function RattachementsParents({ clubId, equipe }: { clubId: string; equipe: string }) {
  const [liens, setLiens] = useState<LienParentADecider[] | null>(null);
  const [enCours, setEnCours] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const recharger = useCallback(() => {
    fetchLiensParentsADecider(createClient(), clubId)
      .then(setLiens)
      .catch(() => setLiens([]));
  }, [clubId]);

  useEffect(() => recharger(), [recharger]);

  const pourCetteEquipe = (liens ?? []).filter((l) => !l.equipe || l.equipe === equipe);
  if (!pourCetteEquipe.length) return null;

  async function decider(relationId: string, decision: "confirme" | "refuse") {
    setEnCours(relationId);
    setErreur(null);
    try {
      await deciderLienParent(createClient(), relationId, decision);
      recharger();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "La décision n'a pas pu être enregistrée.");
    } finally {
      setEnCours(null);
    }
  }

  return (
    <Card className="p-4.5">
      <div className="text-[15px] font-extrabold">Rattachements de parents à confirmer</div>
      <p className="mt-1 max-w-[560px] text-[12.5px] leading-relaxed text-text-soft">
        Tant que vous n&apos;avez pas confirmé, le parent n&apos;a accès à rien. Ne confirmez que si
        vous reconnaissez la personne comme responsable légal de l&apos;enfant.
      </p>
      {erreur && <p className="mt-3 text-[12.5px] font-bold text-danger-fg">{erreur}</p>}
      <div className="mt-3 flex flex-col gap-2">
        {pourCetteEquipe.map((l) => (
          <div key={l.relationId} className="flex flex-wrap items-center gap-3 rounded-xl bg-surface-sunken px-3 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-bold">
                {l.parent} <span className="font-semibold text-text-soft">se déclare {l.relation} de</span> {l.enfant}
              </div>
              <div className="text-[12px] text-text-soft">
                {l.parentEmail ?? "adresse inconnue"} · demandé le{" "}
                {new Date(l.demandeLe).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={enCours === l.relationId} onClick={() => decider(l.relationId, "refuse")}>
                Refuser
              </Button>
              <Button disabled={enCours === l.relationId} onClick={() => decider(l.relationId, "confirme")}>
                Confirmer
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
