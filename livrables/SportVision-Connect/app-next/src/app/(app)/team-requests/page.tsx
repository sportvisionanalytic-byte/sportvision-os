"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { LockedModule } from "@/components/ui/LockedModule";
import {
  confirmRequestEducateur,
  deriveStage,
  fetchClubJoinRequests,
  rejectTeamMembership,
  STAGE_LABEL,
  STAGE_TONE,
  validateTeamMembership,
  type TeamJoinRequest,
} from "@/lib/data/club/team-requests";
import { fetchJoinableTeams, fetchMyJoinRequests, requestTeamMembershipAsPlayer } from "@/lib/data/player/team-requests";
import type { JoinableTeam, MyJoinRequest } from "@/lib/data/player/team-requests";
import { fetchConfirmedChildren, type ConfirmedChild } from "@/lib/data/family/children";
import { fetchChildJoinRequests, fetchJoinableTeamsForClub, requestTeamMembershipForChild } from "@/lib/data/family/team-requests";

// /team-requests — demandes d'adhésion à une équipe, avec validation à deux niveaux (éducateur
// puis dirigeant) quand clubs.membership_validation_mode = 'double'. Trois audiences dans le même
// fichier, comme /teams (isAcademy/isCoach) : dirigeant/éducateur (organisation club, file
// d'attente à traiter), joueur affilié (demander/suivre sa propre demande), parent (demander/
// suivre pour un enfant déjà affilié). Backend entièrement réel — membership_requests,
// confirm_request_educateur, validate_team_membership, reject_team_membership
// (migration-clubplus-v14/v15.sql), complété par request_team_membership_for_existing_child et la
// policy ctm_family_club_select (migration-connect-v26.sql). Gated par canAccess(ctx, "teams")
// (même module que /teams — pas de nouvelle clé connect_modules, pas d'entitlement dédié : accès
// core dès que "teams" est prêt, cf. entitlements.ts).

const STATUT_LABEL: Record<string, string> = {
  a_verifier: "En cours de traitement",
  autorisation_manquante: "Autorisation parentale requise",
  en_attente_parent: "En attente du parent",
  pret_a_valider: "En cours de traitement",
  validee: "Acceptée",
  refusee: "Refusée",
  doublon_signale: "Signalée en doublon",
  transferee_admin: "Transférée à l'administrateur",
};

const STATUT_TONE: Record<string, "neutral" | "info" | "warning" | "success" | "danger"> = {
  a_verifier: "info",
  autorisation_manquante: "warning",
  en_attente_parent: "warning",
  pret_a_valider: "info",
  validee: "success",
  refusee: "danger",
  doublon_signale: "warning",
  transferee_admin: "info",
};

export default function TeamRequestsPage() {
  const { ctx } = useSession();

  if (!canAccess(ctx, "teams")) return <LockedModule />;

  if (ctx.organization.type === "club") {
    return <ClubValidationView clubId={ctx.organization.id} role={ctx.membership.role} />;
  }
  if (ctx.organization.type === "player" && ctx.organization.parentOrganizationId) {
    return <PlayerRequestView playerId={ctx.organization.id} clubId={ctx.organization.parentOrganizationId} />;
  }
  if (ctx.organization.type === "parent") {
    return <ParentRequestView parentId={ctx.organization.id} />;
  }

  return <Card className="p-8 text-center text-[13.5px] text-text-soft">Ce module ne concerne pas cet espace.</Card>;
}

// ── Dirigeant / éducateur ────────────────────────────────────────────────

function ClubValidationView({ clubId, role }: { clubId: string; role: string }) {
  const [requests, setRequests] = useState<TeamJoinRequest[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [motif, setMotif] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const isAdmin = role === "admin";
  const isEducateur = role === "coach" || role === "team_manager";

  async function reload() {
    const supabase = createClient();
    try {
      setRequests(await fetchClubJoinRequests(supabase, clubId));
    } catch {
      setLoadError(true);
    }
  }

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    fetchClubJoinRequests(createClient(), clubId)
      .then((rows) => {
        if (!cancelled) setRequests(rows);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [clubId]);

  async function runAction(action: () => Promise<void>, requestId: string) {
    setBusyId(requestId);
    setActionError(null);
    try {
      await action();
      await reload();
      setRejectingId(null);
      setMotif("");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action impossible.");
    } finally {
      setBusyId(null);
    }
  }

  if (loadError) {
    return (
      <Card className="p-8 text-center text-[13.5px] font-semibold text-danger-fg">
        Impossible de charger les demandes d&apos;adhésion. Réessayez plus tard.
      </Card>
    );
  }

  if (requests === null) {
    return <div className="py-16 text-center text-[13px] text-text-soft">Chargement…</div>;
  }

  const pending = requests.filter((r) => r.statut !== "validee" && r.statut !== "refusee");
  const done = requests.filter((r) => r.statut === "validee" || r.statut === "refusee");

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="text-[12px] font-bold text-text-soft">Équipes</div>
        <h1 className="mt-1.5 text-[29px] font-extrabold leading-tight tracking-tight">
          {pending.length} demande{pending.length > 1 ? "s" : ""} d&apos;adhésion en attente
        </h1>
        <p className="mt-1.5 max-w-xl text-[13.5px] text-text-soft">
          {isAdmin
            ? "En mode double validation, une demande confirmée par l'éducateur attend votre validation finale."
            : isEducateur
              ? "Confirmez les demandes de vos équipes ; le dirigeant valide ensuite si le club utilise la double validation."
              : "Liste des demandes visibles pour votre rôle."}
        </p>
      </div>

      {actionError && (
        <Card className="border-danger-fg/20 bg-danger-bg px-5 py-3.5 text-[13px] font-semibold text-danger-fg">{actionError}</Card>
      )}

      {pending.length === 0 ? (
        <Card className="p-8 text-center text-[13.5px] text-text-soft">Aucune demande en attente.</Card>
      ) : (
        <div className="flex flex-col gap-3">
          {pending.map((req) => {
            const stage = deriveStage(req);
            const busy = busyId === req.id;
            const canConfirm = isEducateur && stage === "attente_educateur";
            const canValidate =
              (isAdmin && (stage === "attente_dirigeant" || req.validationMode !== "double")) ||
              (isEducateur && req.validationMode === "standard");
            const canReject = isAdmin || isEducateur;

            return (
              <Card key={req.id} className="p-4.5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-[14.5px] font-extrabold tracking-tight">
                      {req.playerFirstName ?? "—"} {req.playerLastName ?? ""}
                    </div>
                    <div className="mt-0.5 text-[12.5px] text-text-soft">
                      {req.teamName ?? "Équipe non renseignée"} · demandé le{" "}
                      {new Date(req.createdAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "long" })}
                    </div>
                  </div>
                  <Badge tone={STAGE_TONE[stage]}>{STAGE_LABEL[stage]}</Badge>
                </div>

                {rejectingId === req.id ? (
                  <div className="mt-3.5 flex flex-col gap-2 border-t border-divider pt-3.5">
                    <input
                      value={motif}
                      onChange={(e) => setMotif(e.target.value)}
                      placeholder="Motif du refus (optionnel)"
                      className="h-10 rounded-sv border border-border-strong bg-input-bg px-3 text-[13px] outline-none focus-visible:border-brand-blue"
                    />
                    <div className="flex gap-2">
                      <Button
                        variant="danger"
                        className="h-9 px-3.5 text-[12.5px]"
                        disabled={busy}
                        loading={busy}
                        onClick={() => runAction(() => rejectTeamMembership(createClient(), req.id, motif || undefined), req.id)}
                      >
                        Confirmer le refus
                      </Button>
                      <Button
                        variant="secondary"
                        className="h-9 px-3.5 text-[12.5px]"
                        onClick={() => {
                          setRejectingId(null);
                          setMotif("");
                        }}
                      >
                        Annuler
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3.5 flex flex-wrap gap-2 border-t border-divider pt-3.5">
                    {canConfirm && (
                      <Button
                        variant="primary"
                        className="h-9 px-3.5 text-[12.5px]"
                        disabled={busy}
                        loading={busy}
                        onClick={() => runAction(() => confirmRequestEducateur(createClient(), req.id), req.id)}
                      >
                        Confirmer (éducateur)
                      </Button>
                    )}
                    {canValidate && (
                      <Button
                        variant="primary"
                        className="h-9 px-3.5 text-[12.5px]"
                        disabled={busy}
                        loading={busy}
                        onClick={() => runAction(() => validateTeamMembership(createClient(), req.id), req.id)}
                      >
                        Valider l&apos;adhésion
                      </Button>
                    )}
                    {!canConfirm && !canValidate && (
                      <p className="text-[12.5px] text-text-soft">
                        {stage === "attente_educateur"
                          ? "En attente de confirmation par l'éducateur de l'équipe."
                          : "En attente de validation par un dirigeant."}
                      </p>
                    )}
                    {canReject && (
                      <Button variant="secondary" className="h-9 px-3.5 text-[12.5px]" onClick={() => setRejectingId(req.id)}>
                        Refuser
                      </Button>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {done.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[12.5px] font-bold text-text-soft">
            {done.length} demande{done.length > 1 ? "s" : ""} déjà traitée{done.length > 1 ? "s" : ""}
          </summary>
          <div className="mt-3 flex flex-col gap-2">
            {done.map((req) => (
              <Card key={req.id} className="flex items-center justify-between gap-3 px-4.5 py-3">
                <span className="text-[13px] font-semibold">
                  {req.playerFirstName} {req.playerLastName} · {req.teamName ?? "—"}
                </span>
                <Badge tone={req.statut === "validee" ? "success" : "danger"}>{req.statut === "validee" ? "Validée" : "Refusée"}</Badge>
              </Card>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// ── Joueur ────────────────────────────────────────────────────────────────

function PlayerRequestView({ playerId, clubId }: { playerId: string; clubId: string }) {
  const [teams, setTeams] = useState<JoinableTeam[] | null>(null);
  const [myRequests, setMyRequests] = useState<MyJoinRequest[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function load() {
    const supabase = createClient();
    const [teamRows, myRows] = await Promise.all([fetchJoinableTeams(supabase, clubId), fetchMyJoinRequests(supabase, playerId)]);
    setTeams(teamRows);
    setMyRequests(myRows);
    const first = teamRows[0];
    if (!selectedTeamId && first) setSelectedTeamId(first.id);
  }

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    load().catch(() => {
      if (!cancelled) setLoadError(true);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubId, playerId]);

  async function handleSubmit() {
    if (!selectedTeamId) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await requestTeamMembershipAsPlayer(createClient(), { clubId, teamId: selectedTeamId, inviteCode: inviteCode || undefined });
      setInviteCode("");
      await load();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Impossible d'envoyer la demande.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <Card className="p-8 text-center text-[13.5px] font-semibold text-danger-fg">Impossible de charger les équipes du club.</Card>
    );
  }

  if (teams === null || myRequests === null) {
    return <div className="py-16 text-center text-[13px] text-text-soft">Chargement…</div>;
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[29px] font-extrabold leading-tight tracking-tight">Rejoindre une équipe</h1>
        <p className="mt-1.5 max-w-xl text-[13.5px] text-text-soft">
          Envoyez une demande à l&apos;équipe de votre choix. Elle sera confirmée par l&apos;éducateur puis, si nécessaire, validée
          par un dirigeant du club.
        </p>
      </div>

      <Card className="flex flex-col gap-3.5 p-5">
        {teams.length === 0 ? (
          <p className="text-[13px] text-text-soft">Aucune équipe n&apos;est encore renseignée pour votre club.</p>
        ) : (
          <>
            <Field label="Équipe">
              <select
                value={selectedTeamId}
                onChange={(e) => setSelectedTeamId(e.target.value)}
                className="h-10 rounded-sv border border-border-strong bg-input-bg px-3 text-[13.5px] outline-none focus-visible:border-brand-blue"
              >
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.categorie ? ` — ${t.categorie}` : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Code d'invitation (optionnel)">
              <input
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder="SV-XXXX-0000"
                className="h-10 rounded-sv border border-border-strong bg-input-bg px-3 text-[13.5px] outline-none focus-visible:border-brand-blue"
              />
            </Field>
            {submitError && <p className="text-[12.5px] font-semibold text-danger-fg">{submitError}</p>}
            <Button variant="primary" className="self-start" disabled={submitting} loading={submitting} onClick={handleSubmit}>
              Envoyer la demande
            </Button>
          </>
        )}
      </Card>

      <div>
        <div className="mb-2.5 text-[13px] font-extrabold tracking-tight">Mes demandes</div>
        {myRequests.length === 0 ? (
          <Card className="p-6 text-center text-[13px] text-text-soft">Aucune demande envoyée pour le moment.</Card>
        ) : (
          <div className="flex flex-col gap-2">
            {myRequests.map((r) => (
              <Card key={r.id} className="flex items-center justify-between gap-3 px-4.5 py-3">
                <span className="text-[13px] font-semibold">{r.teamName ?? "—"}</span>
                <Badge tone={STATUT_TONE[r.statut] ?? "neutral"}>{STATUT_LABEL[r.statut] ?? r.statut}</Badge>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Parent ────────────────────────────────────────────────────────────────

function ParentRequestView({ parentId }: { parentId: string }) {
  const [children, setChildren] = useState<ConfirmedChild[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [openChildId, setOpenChildId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    fetchConfirmedChildren(createClient(), parentId)
      .then((rows) => {
        if (!cancelled) setChildren(rows);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [parentId]);

  if (loadError) {
    return <Card className="p-8 text-center text-[13.5px] font-semibold text-danger-fg">Impossible de charger vos enfants.</Card>;
  }
  if (children === null) {
    return <div className="py-16 text-center text-[13px] text-text-soft">Chargement…</div>;
  }
  if (children.length === 0) {
    return <Card className="p-8 text-center text-[13.5px] text-text-soft">Aucun enfant associé à votre espace pour le moment.</Card>;
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[29px] font-extrabold leading-tight tracking-tight">Adhésion à une équipe</h1>
        <p className="mt-1.5 max-w-xl text-[13.5px] text-text-soft">
          Demandez une équipe pour un enfant déjà associé à votre espace. La demande est confirmée par l&apos;éducateur puis, si
          nécessaire, validée par un dirigeant du club.
        </p>
      </div>

      <div className="flex flex-col gap-3.5">
        {children.map((child) => (
          <ChildRequestCard
            key={child.playerId}
            child={child}
            open={openChildId === child.playerId}
            onToggle={() => setOpenChildId(openChildId === child.playerId ? null : child.playerId)}
          />
        ))}
      </div>
    </div>
  );
}

function ChildRequestCard({ child, open, onToggle }: { child: ConfirmedChild; open: boolean; onToggle: () => void }) {
  const [teams, setTeams] = useState<JoinableTeam[] | null>(null);
  const [requests, setRequests] = useState<MyJoinRequest[] | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const supabase = createClient();
    const [teamRows, reqRows] = await Promise.all([
      fetchJoinableTeamsForClub(supabase, child.clubId),
      fetchChildJoinRequests(supabase, child.playerId),
    ]);
    setTeams(teamRows);
    setRequests(reqRows);
    const first = teamRows[0];
    if (!selectedTeamId && first) setSelectedTeamId(first.id);
  }

  useEffect(() => {
    if (open && teams === null) {
      load().catch(() => setError("Impossible de charger les équipes du club."));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleSubmit() {
    if (!selectedTeamId) return;
    setSubmitting(true);
    setError(null);
    try {
      await requestTeamMembershipForChild(createClient(), {
        playerId: child.playerId,
        teamId: selectedTeamId,
        inviteCode: inviteCode || undefined,
      });
      setInviteCode("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible d'envoyer la demande.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[14.5px] font-extrabold tracking-tight">
            {child.firstName} {child.lastName}
          </div>
          <div className="text-[12.5px] text-text-soft">{child.teamName ?? "Équipe non renseignée"} · {child.clubName ?? "—"}</div>
        </div>
        <Button variant="secondary" className="h-9 px-3.5 text-[12.5px]" onClick={onToggle}>
          {open ? "Fermer" : "Demander une équipe"}
        </Button>
      </div>

      {open && (
        <div className="mt-4 flex flex-col gap-4 border-t border-divider pt-4">
          {teams === null ? (
            <p className="text-[13px] text-text-soft">Chargement…</p>
          ) : teams.length === 0 ? (
            <p className="text-[13px] text-text-soft">Aucune équipe n&apos;est encore renseignée pour ce club.</p>
          ) : (
            <div className="flex flex-col gap-3">
              <Field label="Équipe">
                <select
                  value={selectedTeamId}
                  onChange={(e) => setSelectedTeamId(e.target.value)}
                  className="h-10 rounded-sv border border-border-strong bg-input-bg px-3 text-[13.5px] outline-none focus-visible:border-brand-blue"
                >
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.categorie ? ` — ${t.categorie}` : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Code d'invitation (optionnel)">
                <input
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="SV-XXXX-0000"
                  className="h-10 rounded-sv border border-border-strong bg-input-bg px-3 text-[13.5px] outline-none focus-visible:border-brand-blue"
                />
              </Field>
              {error && <p className="text-[12.5px] font-semibold text-danger-fg">{error}</p>}
              <Button variant="primary" className="self-start" disabled={submitting} loading={submitting} onClick={handleSubmit}>
                Envoyer la demande
              </Button>
            </div>
          )}

          {requests !== null && requests.length > 0 && (
            <div className="flex flex-col gap-2">
              {requests.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 rounded-sv bg-surface-alt px-3.5 py-2.5">
                  <span className="text-[12.5px] font-semibold">{r.teamName ?? "—"}</span>
                  <Badge tone={STATUT_TONE[r.statut] ?? "neutral"}>{STATUT_LABEL[r.statut] ?? r.statut}</Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-bold text-text-soft">{label}</span>
      {children}
    </label>
  );
}
