"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess, canCreate } from "@/lib/permissions";
import { LockedModule } from "@/components/ui/LockedModule";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Toast, useToast } from "@/components/feedback/Toast";
import { MatchResultModal } from "@/components/matchcenter/MatchResultModal";
import { MatchRow } from "@/components/matchcenter/MatchRow";
import { TeamSelector } from "@/components/ui/TeamSelector";
import { cn } from "@/lib/cn";
import {
  assignClubMatchTeam,
  fetchClubMatches,
  fetchClubRequiresResultVerification,
  fetchOpponentCrests,
  saveClubMatchResult,
  verifyClubMatchResult,
  type MatchOutcome,
} from "@/lib/data/club/matches";
import { fetchClubTeams } from "@/lib/data/club/teams";
import { createClient } from "@/lib/supabase/client";
import {
  EXPLICATION_FILE,
  LIBELLE_FILE,
  grouperMatchs,
  peutSaisirResultat,
  type FileMatch,
} from "@/lib/matches/etat";
import { type Match, type MatchStatus } from "@/lib/types/studio";
import type { Team } from "@/lib/types/teams";

// Match Center — saisie de résultats. Voir ACTIONS.md § 8 et DATA_MODEL.md § Match.
// "content_created" (visuel généré) n'a pas d'équivalent réel en base (voir data/club/matches.ts)
// et aucun marquage local ne le simule plus : /studio est verrouillé (hors READY_MODULES), il n'y
// a donc aujourd'hui aucun chemin réel pour faire transiter un match vers ce statut.
// "postponed"/"cancelled" (migration-clubplus-v37.sql) : 16/08/2026, ces statuts sont désormais
// réellement actionnables — menu "..." sur chaque ligne à venir/à transmettre (Reporter/Annuler),
// qui ouvre MatchResultModal avec le statut cible préréglé. Voir ce composant pour le détail.
//
// 17/08/2026 (chantier "Autres rôles Club+") :
//   - Assignation d'équipe (team_id) : correctif du gap trouvé en amont — team_id existe en base
//     et porte la RLS équipe-level (migration-clubplus-v37.sql) mais aucune UI ne l'écrivait, donc
//     tout match restait visible/modifiable par tout membre du club quel que soit son scope. Un
//     sélecteur "Équipe (scope)" apparaît sur chaque ligne, réservé Admin/Directeur sportif
//     (canAssignTeam) — pas de flux de création de match dans ce repo (matchs créés côté
//     staff/backend SportVision), donc l'assignation se fait en édition sur un match existant.
//     Le Directeur sportif ne voit que ses propres équipes dans le sélecteur (assignableTeams) ;
//     la vraie garantie qu'il ne peut pas s'assigner un match hors scope reste la RLS
//     (cma_member_update, voir le docstring de assignClubMatchTeam) — le filtrage ici n'est qu'un
//     confort pour ne pas proposer une option qui échouerait de toute façon côté serveur.
//   - Vérification du résultat (Bible §8) : bouton "Vérifier le résultat" sur un match "recu" non
//     encore vérifié, visible seulement si `clubs.requires_result_verification` est actif et pour
//     Admin/Directeur sportif (canVerifyResults). Ouvre MatchResultModal en mode `verifying` (le
//     Directeur peut corriger le score avant de confirmer, jamais une validation à l'aveugle), et
//     handleVerifyResult sauvegarde puis appelle verifyClubMatchResult (verified_by/verified_at).
//     Si le club n'utilise pas ce workflow (colonne à false/absente tant que la migration v40
//     n'est pas exécutée), rien de neuf ne s'affiche — comportement actuel inchangé.

// 10/09/2026 — Les onglets par statut brut ont disparu.
//
// Ils reprenaient les six valeurs de `status` telles quelles. Sur SF Villemomble, les 430 matchs
// portaient tous le même (`a_venir`) : cinq onglets vides, un onglet-mur, et l'action principale
// grisée parce qu'elle dépendait d'un statut que rien ne pose jamais. Les files (lib/matches/
// etat.ts) classent par ce qui demande une action ; celles qui n'ont rien ne s'affichent pas.
//
// Les deux premières sont ouvertes d'emblée, le reste est replié : l'écran s'ouvre sur les matchs
// à saisir, pas sur la saison entière.
const FILES_OUVERTES: FileMatch[] = ["a_renseigner", "cette_semaine"];

/** Au-delà, une file se déplie par tranches : « À venir » compte 380 lignes chez Villemomble, et
 *  personne ne fait défiler 380 cartes pour retrouver un match de février. */
const PAR_TRANCHE = 20;

export default function MatchCenterPage() {
  const { ctx } = useSession();
  const { toastMessage, toastTone, showToast } = useToast();
  const [equipe, setEquipe] = useState("");
  const [ouvertes, setOuvertes] = useState<FileMatch[]>(FILES_OUVERTES);
  const [visibles, setVisibles] = useState<Partial<Record<FileMatch, number>>>({});
  const [ecussons, setEcussons] = useState<Record<string, string>>({});
  const [modalMatchId, setModalMatchId] = useState<string | null>(null);
  const [modalDefaultStatus, setModalDefaultStatus] = useState<MatchOutcome>("completed");
  const [modalMode, setModalMode] = useState<"edit" | "verify">("edit");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [assigningTeamMatchId, setAssigningTeamMatchId] = useState<string | null>(null);
  const [requiresVerification, setRequiresVerification] = useState(false);

  const allowed = canAccess(ctx, "matchcenter");
  const canWrite = canCreate(ctx, "match_result");
  // CTA "Demander un visuel" (Bible §9/§18, "Résultat -> Visuel") sur un match reçu — voir
  // composeMatchVisualBrief (data/club/matches.ts) pour pourquoi ça pointe vers /requests/new et
  // pas /studio/[template] (module "studio" verrouillé pour tout compte réel aujourd'hui).
  const canRequestVisual = canAccess(ctx, "visual_requests") && canCreate(ctx, "visual_request");

  // Assignation d'équipe / vérification de résultat : réservées Admin/Directeur sportif (Bible
  // §7/§8/§18/§24) — un Coach ne doit ni réassigner un match hors de son scope, ni vérifier son
  // propre résultat. Le vrai garde-fou reste la RLS (voir les docstrings de assignClubMatchTeam et
  // verifyClubMatchResult dans data/club/matches.ts) ; ce masquage frontend n'est qu'un confort.
  const role = ctx.membership.role;
  const canAssignTeam = ctx.organization.type === "club" && (role === "admin" || role === "sports_director");
  const canVerifyResults = ctx.organization.type === "club" && (role === "admin" || role === "sports_director");

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

  // Chargées pour tout le monde désormais, et plus seulement pour qui peut assigner : le filtre
  // par équipe sert d'abord au coach, qui lui ne peut rien assigner.
  useEffect(() => {
    let cancelled = false;
    fetchClubTeams(createClient(), ctx.organization.id)
      .then((rows) => {
        if (!cancelled) setTeams(rows);
      })
      .catch(() => {
        /* Sélecteur d'assignation simplement absent si le chargement échoue — pas de blocage de
           l'écran principal pour un module secondaire. */
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.organization.id]);

  // Les écussons arrivent après la liste : un match reste lisible sans le blason de l'adversaire,
  // et l'écran ne doit pas attendre l'annuaire fédéral pour s'afficher.
  useEffect(() => {
    let cancelled = false;
    fetchOpponentCrests(createClient(), ctx.organization.id)
      .then((parMatch) => {
        if (!cancelled) setEcussons(parMatch);
      })
      .catch(() => {
        /* Écussons absents : initiales à la place, voir MatchRow. */
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.organization.id]);

  useEffect(() => {
    if (!canVerifyResults) return;
    let cancelled = false;
    fetchClubRequiresResultVerification(createClient(), ctx.organization.id).then((value) => {
      if (!cancelled) setRequiresVerification(value);
    });
    return () => {
      cancelled = true;
    };
  }, [canVerifyResults, ctx.organization.id]);

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

  // Directeur sportif : ne propose que SES équipes (club_members.teams) dans le sélecteur
  // d'assignation — is_team_educateur() (RLS) ne le laisserait de toute façon écrire que sur
  // celles-là, autant ne pas afficher une option qui échouerait à la sauvegarde. Admin = toutes.
  const assignableTeams = role === "admin" ? (teams ?? []) : (teams ?? []).filter((t) => ctx.membership.teamScope.includes(t.name));

  // Recalculé à chaque rendu, volontairement : une session laissée ouverte pendant la nuit doit
  // voir le match d'hier basculer en « à renseigner » au matin, pas rester « cette semaine ».
  const aujourdhui = new Date();

  // Le filtre par nom d'équipe, pas par team_id : c'est le nom que porte `club_matches.team` sur
  // les matchs jamais assignés, et le sélecteur échange des noms partout ailleurs.
  const visiblesParEquipe = equipe ? orgMatches.filter((m) => m.teamName === equipe) : orgMatches;
  const groupes = grouperMatchs(visiblesParEquipe, aujourdhui);
  // La file qui commande l'écran. `grouperMatchs` la place en tête quand elle existe.
  const aSaisir = groupes.find((g) => g.file === "a_renseigner")?.matchs ?? [];

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

  /** Vérification Directeur sportif (Bible §8) : même sauvegarde que handleSaveResult (le
   * Directeur peut avoir corrigé le score) suivie de verifyClubMatchResult (pose verified_by/
   * verified_at) — un seul geste utilisateur ("Confirmer la vérification"), deux écritures. */
  function handleVerifyResult(
    matchId: string,
    matchStatus: MatchOutcome,
    patch: Partial<Match> & { attendance?: number; assists?: string; cards?: string; comment?: string },
  ) {
    const { attendance, assists, cards, comment, ...matchFields } = patch;
    const supabase = createClient();
    saveClubMatchResult(supabase, matchId, matchStatus, patch)
      .then(() => verifyClubMatchResult(supabase, matchId, ctx.user.id))
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
                      verifiedBy: ctx.user.id,
                      verifiedAt: new Date().toISOString(),
                    }
                  : m,
              )
            : prev,
        );
        setModalMatchId(null);
        showToast("Résultat vérifié.");
      })
      .catch(() => showToast("Vérification impossible, réessayez.", "error"));
  }

  /** Assignation d'équipe (team_id) — voir le commentaire en tête de fichier et le docstring de
   * assignClubMatchTeam (data/club/matches.ts). teamId vide ("Non assignée") écrit `null`. */
  function handleAssignTeam(matchId: string, teamId: string) {
    setAssigningTeamMatchId(matchId);
    const supabase = createClient();
    assignClubMatchTeam(supabase, matchId, teamId || null)
      .then(() => {
        setMatches((prev) => (prev ? prev.map((m) => (m.id === matchId ? { ...m, teamId } : m)) : prev));
        showToast("Équipe mise à jour.");
      })
      .catch(() => showToast("Assignation impossible, réessayez.", "error"))
      .finally(() => setAssigningTeamMatchId(null));
  }

  // Le sélecteur multi-match de la modale : quand on saisit un résultat, toute la file « à
  // renseigner » reste choisissable, pour enchaîner les feuilles de match sans refermer la
  // fenêtre. Pour un report ou une annulation déclenchés depuis une ligne précise, la modale ne
  // porte que sur ce match-là.
  const modalMatch = modalMatchId ? orgMatches.find((mm) => mm.id === modalMatchId) : undefined;
  const modalMatches =
    modalDefaultStatus === "completed" && modalMatch && peutSaisirResultat(modalMatch, aujourdhui)
      ? aSaisir
      : modalMatch
        ? [modalMatch]
        : [];

  function ouvrirModale(matchId: string, outcome: MatchOutcome, mode: "edit" | "verify") {
    setOpenMenuId(null);
    setModalMode(mode);
    setModalDefaultStatus(outcome);
    setModalMatchId(matchId);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[12px] font-bold text-text-soft">Club+</div>
          <h1 className="mt-1.5 text-[29px] font-extrabold leading-tight tracking-tight">Match Center</h1>
          <p className="mt-1.5 max-w-2xl text-[13.5px] text-text-soft">
            {aSaisir.length > 0
              ? `${aSaisir.length} match${aSaisir.length > 1 ? "s" : ""} attend${aSaisir.length > 1 ? "ent" : ""} sa feuille de match.`
              : "Tous les matchs joués ont leur résultat."}
          </p>
        </div>
        <Button
          variant="primary"
          disabled={aSaisir.length === 0 || !canWrite}
          onClick={() => ouvrirModale(aSaisir[0]!.id, "completed", "edit")}
        >
          Saisir un résultat
        </Button>
      </div>

      {/* Le filtre par équipe est le même composant qu'au calendrier et à l'écran Équipes :
          43 équipes ne tiennent pas dans une liste déroulante à plat. */}
      <div className="flex flex-wrap items-center gap-2.5">
        <TeamSelector
          equipes={(teams ?? []).map((t) => ({ name: t.name, categorie: t.category }))}
          valeur={equipe}
          onChange={setEquipe}
          libelleToutes="Toutes les équipes"
        />
        {equipe && (
          <span className="text-[12px] font-semibold text-text-faint">
            {visiblesParEquipe.length} match{visiblesParEquipe.length > 1 ? "s" : ""}
          </span>
        )}
      </div>

      {groupes.length === 0 ? (
        <Card className="p-8 text-center">
          <div className="text-[14px] font-extrabold">Aucun match</div>
          <p className="mt-1.5 text-[13px] text-text-soft">
            {equipe ? `Rien pour ${equipe} sur cette saison.` : "Aucun match n'est enregistré pour ce club."}
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {groupes.map((g) => {
            const deplie = ouvertes.includes(g.file);
            const limite = visibles[g.file] ?? PAR_TRANCHE;
            const affiches = g.matchs.slice(0, limite);
            return (
              <section key={g.file} className="overflow-hidden rounded-xl border border-border">
                <button
                  onClick={() =>
                    setOuvertes((prev) =>
                      prev.includes(g.file) ? prev.filter((f) => f !== g.file) : [...prev, g.file],
                    )
                  }
                  aria-expanded={deplie}
                  className="flex w-full items-center gap-2.5 px-4 py-3 text-left hover:bg-row-hover"
                >
                  {deplie ? (
                    <ChevronDown className="h-4 w-4 flex-none text-text-faint" aria-hidden />
                  ) : (
                    <ChevronRight className="h-4 w-4 flex-none text-text-faint" aria-hidden />
                  )}
                  <span className="text-[14px] font-extrabold">{LIBELLE_FILE[g.file]}</span>
                  <span
                    className={cn(
                      "flex-none rounded-full px-2 py-[1px] text-[11.5px] font-extrabold tabular-nums",
                      g.file === "a_renseigner"
                        ? "bg-warning-bg text-warning-fg"
                        : deplie
                          ? "bg-brand-blue/15 text-brand-blue-electric"
                          : "bg-surface-alt text-text-faint",
                    )}
                  >
                    {g.matchs.length}
                  </span>
                  <span className="hidden flex-1 truncate text-[12px] text-text-faint sm:block">
                    {EXPLICATION_FILE[g.file]}
                  </span>
                </button>

                {deplie && (
                  <div className="flex flex-col gap-3 border-t border-divider p-4">
                    {affiches.map((m) => (
                      <MatchRow
                        key={m.id}
                        match={m}
                        ecussonUrl={ecussons[m.id] ?? null}
                        aujourdhui={aujourdhui}
                        canWrite={canWrite}
                        canRequestVisual={canRequestVisual}
                        canAssignTeam={canAssignTeam}
                        canVerifyResults={canVerifyResults}
                        requiresVerification={requiresVerification}
                        assignableTeams={assignableTeams}
                        teamsLoaded={teams !== null}
                        assigning={assigningTeamMatchId === m.id}
                        menuOuvert={openMenuId === m.id}
                        onToggleMenu={() => setOpenMenuId(openMenuId === m.id ? null : m.id)}
                        onAssignTeam={(teamId) => handleAssignTeam(m.id, teamId)}
                        onOpenModal={ouvrirModale}
                      />
                    ))}
                    {g.matchs.length > affiches.length && (
                      <Button
                        variant="secondary"
                        onClick={() => setVisibles((prev) => ({ ...prev, [g.file]: limite + PAR_TRANCHE }))}
                      >
                        Afficher {Math.min(PAR_TRANCHE, g.matchs.length - affiches.length)} matchs de plus
                        <span className="ml-1.5 text-text-faint">({g.matchs.length - affiches.length} restants)</span>
                      </Button>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {modalMatchId && modalMatch && (
        <MatchResultModal
          matches={modalMatches}
          initialMatchId={modalMatchId}
          defaultStatus={modalDefaultStatus}
          verifying={modalMode === "verify"}
          onClose={() => setModalMatchId(null)}
          onSubmit={modalMode === "verify" ? handleVerifyResult : handleSaveResult}
        />
      )}

      <Toast message={toastMessage} tone={toastTone} />
    </div>
  );
}
