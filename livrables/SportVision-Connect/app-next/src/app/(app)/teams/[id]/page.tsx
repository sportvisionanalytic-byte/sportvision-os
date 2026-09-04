"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
import { fetchClubTeams } from "@/lib/data/club/teams";
import { ACCOUNT_STATUS_LABEL, fetchTeamRoster, type TeamRosterPlayer } from "@/lib/data/club/team-detail";
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
        <EmptyState icon={Users} title="Aucun joueur enregistré" />
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
        <EmptyState icon={CalendarDays} title="Aucun événement à venir" />
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
        <EmptyState icon={Images} title="Aucun contenu pour cette équipe" />
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
        <EmptyState icon={Inbox} title="Aucune demande en cours pour cette équipe" />
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
        <EmptyState icon={FileText} title="Aucun document pour cette équipe" />
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
  const [tab, setTab] = useState<RealTabKey>("apercu");
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [roster, setRoster] = useState<TeamRosterPlayer[] | null>(null);

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
        <Button variant="secondary">
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

      {tab === "apercu" && <RealOverviewTab team={team} roster={roster} missingRights={missingRights} />}
      {tab === "effectif" && <RealRosterTab roster={roster} />}
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
}: {
  team: Team;
  roster: TeamRosterPlayer[];
  missingRights: number;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card className="p-4.5 lg:col-span-2">
        <div className="text-[14px] font-extrabold tracking-tight">Informations générales</div>
        <dl className="mt-3.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <RealInfo label="Entraîneur" value={team.headCoachName} />
          <RealInfo label="Catégorie" value={team.category} />
          <RealInfo label="Effectif" value={`${roster.length} joueur${roster.length > 1 ? "s" : ""}`} />
          <RealInfo label="Saison" value={team.season} />
        </dl>
      </Card>

      <Card className="p-4.5">
        <div className="text-[14px] font-extrabold tracking-tight">Droit à l&apos;image</div>
        {missingRights > 0 ? (
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

function RealRosterTab({ roster }: { roster: TeamRosterPlayer[] }) {
  if (roster.length === 0) {
    return (
      <Card>
        <EmptyState icon={Users} title="Aucun joueur enregistré" />
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
          <span>
            <Badge tone={AUTHORIZATION_STATUS_TONE[p.imageRightStatus] ?? "neutral"}>
              {AUTHORIZATION_STATUS_LABELS[p.imageRightStatus] ?? p.imageRightStatus}
            </Badge>
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
        <EmptyState icon={CalendarDays} title="Aucun événement à venir" />
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
        <EmptyState icon={Images} title="Aucun contenu pour cette équipe" />
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
        <EmptyState icon={Inbox} title="Aucune demande en cours pour cette équipe" />
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
