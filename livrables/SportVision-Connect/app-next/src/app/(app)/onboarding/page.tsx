"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session-context";
import { cn } from "@/lib/cn";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { updateClubOrganization, uploadClubLogo } from "@/lib/data/club/organization";
import { fetchClubMembers } from "@/lib/data/club/users";
import {
  fetchClubInvitations,
  messageErreurInvitation,
  preparerInvitation,
  STATUT_INVITATION_LABEL,
  STATUT_INVITATION_TONE,
  type InvitationClub,
} from "@/lib/data/club/invitations";
import { resolveClubPortailClientId } from "@/lib/data/club/portail-link";
import {
  ENCADRANT_LIBELLE,
  enregistrerContactPresident,
  fetchContactPresident,
  fetchEquipesEtat,
  fetchInvitationsPreparees,
  fetchSectionsOnboarding,
  fetchStatutLancement,
  lancerLeClub,
  type ContactPresident,
  type EtatEquipe,
  type EtatSection,
  type ResultatLancement,
  type SectionOnboarding,
  type StatutLancementClub,
} from "@/lib/data/club/cockpit";
import { InviterEncadrantModal } from "@/components/teams/InviterEncadrantModal";
import { ROLE_LABELS, type OrgUser } from "@/lib/types/settings";
import { fetchClubTeams, createClubTeam } from "@/lib/data/club/teams";
import {
  createInviteLink,
  fetchClubInviteLinks,
  rotateInviteLink,
  deactivateInviteLink,
  buildJoinUrl,
  type InviteLink,
} from "@/lib/data/club/invite-links";
import { QrCode } from "@/components/ui/QrCode";
import {
  parseRosterCsv,
  previewRosterImport,
  confirmRosterImport,
  type RosterImportRow,
  type RosterPreviewResult,
  type RosterImportResult,
} from "@/lib/data/club/roster-import";
import { fetchClubSponsors, createClubSponsor, uploadSponsorLogo } from "@/lib/data/club/sponsors";
import { fetchClubCalendarEvents, createClubCalendarEvent } from "@/lib/data/club/calendar";
import { TEAM_CATEGORY_OPTIONS, type Team } from "@/lib/types/teams";
import type { Sponsor } from "@/lib/types/sponsors";
import type { CalendarEvent } from "@/lib/types/calendar";
import { ImportMatchesModal } from "@/components/calendar/ImportMatchesModal";
import type { MembershipRole } from "@/lib/types";
import {
  fetchOnboardingCompletion,
  fetchOnboardingProgress,
  ensureOnboardingStarted,
  submitOnboarding,
  fetchClubVenues,
  createClubVenue,
  deleteClubVenue,
  setVenuePrincipal,
  fetchTrainingSlotsForClub,
  createTrainingSlot,
  deleteTrainingSlot,
  fetchClubSocialAccounts,
  createClubSocialAccount,
  deleteClubSocialAccount,
  fetchClubCommunicationPrefs,
  updateClubCommunicationPrefs,
  fetchClubImageRights,
  updateClubImageRights,
  JOURS_ORDER,
  JOURS_LABELS,
  OBJECTIFS_COMMUNICATION_OPTIONS,
  TON_COMMUNICATION_OPTIONS,
  DROIT_IMAGE_MODE_LABELS,
  type OnboardingCompletion,
  type ClubVenue,
  type TrainingSlot,
  type ClubSocialAccount,
  type SocialPlatform,
  type DroitImageMode,
} from "@/lib/data/club/onboarding";

// /onboarding — collecte guidée des informations du club à la signature (master prompt Fouka,
// 02/09/2026). Pas un routeur multi-pages : 9 sections en cartes verticales sur une seule page
// (plus simple à maintenir qu'un stepper à URLs séparées, tout en restant "plusieurs étapes",
// pas un formulaire de 60 champs à plat — chaque carte a son propre état et son propre
// enregistrement, comme /settings/organization). Réutilise systématiquement les fonctions déjà
// existantes (organization.ts/teams.ts/sponsors.ts/calendar.ts/users.ts) — seules les entités
// réellement nouvelles (lieux, créneaux, réseaux sociaux, droit à l'image, progression) viennent
// de data/club/onboarding.ts.
export default function OnboardingPage() {
  const { ctx } = useSession();
  const router = useRouter();
  const { organization, membership } = ctx;
  // Le CM affilie remplit la mise en place du club a la place du president : c'est tout l'objet
  // de son affectation. Deux droits restent hors de sa portee, et ni l'un ni l'autre ne repose
  // sur cet ecran — la base refuse le SIRET, et le president ne se prepare que par l'Owner (v116).
  const estCmAffilie = membership.role === "external_cm";
  // `president` ajouté le 10/09/2026 (migration v114) : il administre son club, informations
  // administratives et légales comprises — décision explicite de Fouka pour le SIRET. Le CM, lui,
  // garde l'édition opérationnelle mais PAS l'identité légale.
  const estAdministrateur = membership.role === "admin" || membership.role === "president";
  const canEdit = organization.type === "club" && (estAdministrateur || estCmAffilie);
  const canEditLegal = organization.type === "club" && estAdministrateur;
  const canInvite = organization.type === "club" && (estAdministrateur || estCmAffilie);

  const [completion, setCompletion] = useState<OnboardingCompletion | null>(null);
  const [statut, setStatut] = useState<string | null>(null);
  const [sections, setSections] = useState<SectionOnboarding[] | null>(null);
  const [lancement, setLancement] = useState<StatutLancementClub | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function refreshCompletion() {
    const supabase = createClient();
    const [c, p, sec, lan] = await Promise.allSettled([
      fetchOnboardingCompletion(supabase, organization.id),
      fetchOnboardingProgress(supabase, organization.id),
      fetchSectionsOnboarding(supabase, organization.id),
      fetchStatutLancement(supabase, organization.id),
    ]);
    if (c.status === "fulfilled") setCompletion(c.value);
    setStatut(p.status === "fulfilled" ? p.value?.statut ?? "not_started" : "not_started");
    if (sec.status === "fulfilled") setSections(sec.value);
    if (lan.status === "fulfilled") setLancement(lan.value);
    return sec.status === "fulfilled" ? sec.value : null;
  }

  useEffect(() => {
    if (organization.type !== "club") return;
    const supabase = createClient();
    setSections(null);
    setLancement(null);
    ensureOnboardingStarted(supabase, organization.id)
      .catch(() => {})
      .finally(() =>
        refreshCompletion()
          .then((sec) => {
            // La section ouverte : celle demandée dans l'adresse (un lien « Résoudre » du
            // tableau de bord), sinon la première obligatoire encore incomplète.
            const demandee = new URLSearchParams(window.location.search).get("section");
            const premiere =
              sec?.find((x) => x.obligatoire && x.etat === "incomplet")?.cle ??
              sec?.find((x) => x.etat === "incomplet")?.cle ??
              "identite";
            setActive(demandee ?? premiere);
          })
          .catch(() => setActive("identite")),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization.id]);

  if (organization.type !== "club") {
    return (
      <Card className="p-8 text-center text-[13.5px] text-text-soft">
        L&apos;onboarding SportVision concerne uniquement l&apos;espace club.
      </Card>
    );
  }

  function ouvrir(cle: string) {
    setActive(cle);
    try {
      window.history.replaceState(null, "", `?section=${cle}`);
    } catch {
      /* l'adresse ne suit pas : sans conséquence */
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Redirige vers le tableau de bord après envoi (05/09/2026, retour Fouka).
  async function handleSubmit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await submitOnboarding(createClient(), organization.id);
      router.push("/dashboard");
    } catch {
      setSubmitError("Impossible d'envoyer pour le moment. Réessayez.");
      setSubmitting(false);
    }
  }

  const enPreparation = lancement ? lancement.statut !== "actif" : true;
  const ordre = sections?.map((x) => x.cle) ?? [];
  const index = active ? ordre.indexOf(active) : -1;
  const suivante = index >= 0 && index < ordre.length - 1 ? sections?.[index + 1] : undefined;
  const precedente = index > 0 ? sections?.[index - 1] : undefined;
  const refresh = () => {
    refreshCompletion().catch(() => {});
  };

  const carte = (() => {
    switch (active) {
      case "identite":
        return <IdentiteCard clubId={organization.id} address={organization.address ?? ""} siret={organization.siret ?? ""} siretLisible={organization.siretLisible === true} canEdit={canEdit} canEditLegal={canEditLegal} onSaved={refresh} />;
      case "responsables":
        return <ResponsablesCard clubId={organization.id} canEdit={canEdit} canInvite={canInvite} estCm={estCmAffilie} enPreparation={enPreparation} onSaved={refresh} />;
      case "equipes":
      case "entrainements":
        return <EquipesCard clubId={organization.id} canEdit={canEdit} canInvite={canInvite} enPreparation={enPreparation} onSaved={refresh} />;
      case "calendrier":
        return <CalendrierCard clubId={organization.id} canEdit={canEdit} onSaved={refresh} />;
      case "branding":
        return (
          <BrandingCard
            clubId={organization.id}
            logoUrl={organization.logoUrl ?? null}
            colors={[organization.brandColors?.[0] ?? "#4F7DFF", organization.brandColors?.[1] ?? "#A855F7"]}
            canEdit={canEdit}
            onSaved={refresh}
          />
        );
      case "sponsors":
        return <SponsorsCard clubId={organization.id} canEdit={canEdit} onSaved={refresh} />;
      case "communication":
        return <CommunicationCard clubId={organization.id} canEdit={canEdit} onSaved={refresh} />;
      case "droit_image":
        return <DroitImageCard clubId={organization.id} canEdit={canEdit} onSaved={refresh} />;
      case "lancement":
        return <LancementCard clubId={organization.id} lancement={lancement} peutLancer={estCmAffilie || estAdministrateur} onOuvrir={ouvrir} onLance={refresh} />;
      default:
        return null;
    }
  })();

  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
      <OnboardingChecklist
        sections={sections}
        completion={completion}
        lancement={lancement}
        statutEnvoi={statut}
        active={active}
        afficherLancement={estCmAffilie}
        onOuvrir={ouvrir}
      />

      <div className="flex min-w-0 flex-col gap-4">
        {active === null ? <Card className="p-8 text-center text-[13px] text-text-soft">Chargement…</Card> : carte}

        {active !== null && active !== "lancement" && sections && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            {precedente ? (
              <Button variant="secondary" className="h-9 px-4 text-[12.5px]" onClick={() => ouvrir(precedente.cle)}>
                ← {precedente.libelle}
              </Button>
            ) : (
              <span />
            )}
            {suivante ? (
              <Button className="h-9 px-4 text-[12.5px]" onClick={() => ouvrir(suivante.cle)}>
                Section suivante : {suivante.libelle} →
              </Button>
            ) : estCmAffilie ? (
              <Button className="h-9 px-4 text-[12.5px]" onClick={() => ouvrir("lancement")}>
                Lancement du club →
              </Button>
            ) : null}
          </div>
        )}

        {/* L'envoi à SportVision reste le geste du club qui s'onboarde seul. Pour le CM, il n'a pas
            de sens : le CM EST SportVision. Son geste final, c'est le lancement. */}
        {canEdit && !estCmAffilie && (
          <Card className="flex flex-col gap-3 p-5">
            <div className="text-[13px] text-text-soft">
              Vous pouvez envoyer dès maintenant même si tout n&apos;est pas complété — SportVision verra ce qu&apos;il reste à
              préciser et pourra vous relancer, ou compléter certaines sections avec vous.
            </div>
            {submitError && <p className="text-[12.5px] font-bold text-danger-fg">{submitError}</p>}
            <Button variant="primary" className="self-start" loading={submitting} onClick={handleSubmit} disabled={statut === "validated"}>
              {statut === "submitted" || statut === "needs_information" ? "Renvoyer à SportVision" : "Envoyer à SportVision"}
            </Button>
          </Card>
        )}
      </div>
    </div>
  );
}

// ── La checklist ──

const ETAT_SECTION: Record<EtatSection, { icone: string; classe: string; libelle: string }> = {
  termine: { icone: "✓", classe: "bg-success-bg text-success-fg", libelle: "Terminé" },
  attention: { icone: "!", classe: "bg-warning-bg text-warning-fg", libelle: "Attention" },
  incomplet: { icone: "○", classe: "bg-surface-sunken text-text-faint", libelle: "Incomplet" },
};

const STATUT_LANCEMENT_LB: Record<StatutLancementClub["statut"], { libelle: string; tone: "warning" | "info" | "success" }> = {
  en_preparation: { libelle: "En préparation", tone: "warning" },
  pret: { libelle: "Prêt à être lancé", tone: "info" },
  actif: { libelle: "Actif", tone: "success" },
};

function modifieLe(iso: string | null, par: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const quand =
    d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) +
    " à " +
    d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return `Modifié le ${quand}${par ? ` par ${par}` : ""}`;
}

function OnboardingChecklist({
  sections,
  completion,
  lancement,
  statutEnvoi,
  active,
  afficherLancement,
  onOuvrir,
}: {
  sections: SectionOnboarding[] | null;
  completion: OnboardingCompletion | null;
  lancement: StatutLancementClub | null;
  statutEnvoi: string | null;
  active: string | null;
  afficherLancement: boolean;
  onOuvrir: (cle: string) => void;
}) {
  // Sans la lecture détaillée (un rôle qui n'opère pas le club), on garde le résumé d'avant.
  if (sections === null || sections.length === 0) {
    return (
      <Card className="flex flex-col gap-3 p-5 lg:sticky lg:top-4">
        <div className="text-[15px] font-extrabold">Configuration du club</div>
        {completion ? (
          <>
            <div className="text-[12.5px] text-text-soft">
              {completion.sections_completees} / {completion.sections_total} sections terminées · {completion.pourcentage} %
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-sunken">
              <div className="h-full rounded-full bg-gradient-to-r from-brand-cyan to-brand-violet" style={{ width: `${completion.pourcentage}%` }} />
            </div>
          </>
        ) : (
          <div className="text-[12.5px] text-text-soft">Chargement…</div>
        )}
      </Card>
    );
  }

  const faites = sections.filter((x) => x.etat !== "incomplet").length;
  const pourcentage = Math.round((faites / sections.length) * 100);
  const groupes: { titre: string; liste: SectionOnboarding[] }[] = [
    { titre: "Obligatoire avant lancement", liste: sections.filter((x) => x.obligatoire) },
    { titre: "Optionnel", liste: sections.filter((x) => !x.obligatoire) },
  ];
  const statut = lancement ? STATUT_LANCEMENT_LB[lancement.statut] : null;

  return (
    <Card className="flex flex-col p-0 lg:sticky lg:top-4">
      <div className="flex flex-col gap-2.5 border-b border-border px-4 py-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[15px] font-extrabold">Configuration du club</span>
          {statut && <Badge tone={statut.tone}>{statut.libelle}</Badge>}
        </div>
        <div className="flex items-baseline justify-between text-[12.5px] text-text-soft">
          <span>
            <b className="tabular-nums text-text">
              {faites} / {sections.length}
            </b>{" "}
            sections terminées
          </span>
          <b className="tabular-nums text-text">{pourcentage} %</b>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-surface-sunken" aria-hidden>
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand-cyan to-brand-violet transition-[width] duration-300"
            style={{ width: `${pourcentage}%` }}
          />
        </div>
        {statutEnvoi === "submitted" && (
          <Badge tone="info" className="self-start">
            Envoyé à SportVision
          </Badge>
        )}
        {statutEnvoi === "needs_information" && (
          <Badge tone="warning" className="self-start">
            Informations demandées
          </Badge>
        )}
      </div>

      {groupes.map((g) => (
        <div key={g.titre} className="border-b border-border py-1.5 last:border-0">
          <div className="px-4 pb-1 pt-2 text-[10.5px] font-extrabold uppercase tracking-[.09em] text-text-faint">{g.titre}</div>
          {g.liste.map((x) => {
            const etat = ETAT_SECTION[x.etat];
            const modif = modifieLe(x.derniere_at, x.derniere_par);
            return (
              <button
                key={x.cle}
                type="button"
                onClick={() => onOuvrir(x.cle)}
                aria-current={active === x.cle ? "step" : undefined}
                className={cn(
                  "flex w-full items-start gap-2.5 px-4 py-2 text-left transition-colors",
                  active === x.cle ? "bg-accent-bg" : "hover:bg-row-hover",
                )}
              >
                <span
                  aria-label={etat.libelle}
                  className={cn("mt-px flex h-5 w-5 flex-none items-center justify-center rounded-full text-[11px] font-extrabold", etat.classe)}
                >
                  {etat.icone}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-bold">{x.libelle}</span>
                  {x.detail && <span className="block text-[11.5px] text-text-soft">{x.detail}</span>}
                  {modif && <span className="block text-[11px] text-text-faint">{modif}</span>}
                </span>
              </button>
            );
          })}
        </div>
      ))}

      {afficherLancement && lancement && (
        <button
          type="button"
          onClick={() => onOuvrir("lancement")}
          aria-current={active === "lancement" ? "step" : undefined}
          className={cn(
            "m-3 rounded-sv px-4 py-3 text-left transition-colors",
            lancement.statut === "pret"
              ? "bg-gradient-to-r from-brand-blue to-brand-violet text-white"
              : active === "lancement"
                ? "bg-accent-bg"
                : "bg-surface-sunken hover:bg-row-hover",
          )}
        >
          <span className="block text-[13px] font-extrabold">
            {lancement.statut === "actif" ? "Club lancé" : lancement.statut === "pret" ? "Lancer le club" : "Lancement du club"}
          </span>
          <span className={cn("block text-[11.5px]", lancement.statut === "pret" ? "text-white/85" : "text-text-soft")}>
            {lancement.statut === "actif"
              ? "Les invitations sont parties."
              : lancement.statut === "pret"
                ? `${lancement.invitations_preparees} invitation${lancement.invitations_preparees > 1 ? "s" : ""} prête${lancement.invitations_preparees > 1 ? "s" : ""} à partir`
                : `Il manque : ${lancement.sections_manquantes.join(", ")}`}
          </span>
        </button>
      )}
    </Card>
  );
}

// ── Le lancement ──

type InvitationPreparee = Awaited<ReturnType<typeof fetchInvitationsPreparees>>[number];

function LancementCard({
  clubId,
  lancement,
  peutLancer,
  onOuvrir,
  onLance,
}: {
  clubId: string;
  lancement: StatutLancementClub | null;
  peutLancer: boolean;
  onOuvrir: (cle: string) => void;
  onLance: () => void;
}) {
  const [invitations, setInvitations] = useState<InvitationPreparee[] | null>(null);
  const [confirmation, setConfirmation] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [resultat, setResultat] = useState<ResultatLancement | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    fetchInvitationsPreparees(createClient(), clubId)
      .then(setInvitations)
      .catch(() => setInvitations([]));
  }, [clubId, lancement?.statut]);

  async function lancer() {
    setEnCours(true);
    setErreur(null);
    try {
      setResultat(await lancerLeClub(createClient(), clubId));
      setConfirmation(false);
      onLance();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Le lancement a échoué.");
    } finally {
      setEnCours(false);
    }
  }

  if (!lancement) return <Card className="p-8 text-center text-[13px] text-text-soft">Chargement…</Card>;

  const nb = invitations?.length ?? lancement.invitations_preparees;

  return (
    <Card className="flex flex-col gap-4 p-5">
      <SectionHeader
        title="Lancement du club"
        description="Tant que le club n'est pas lancé, rien ne part : vous préparez les équipes, les responsables et les invitations en toute tranquillité."
      />

      {resultat && (
        <div className="rounded-xl border border-success-fg/30 bg-success-bg px-4 py-3 text-[13px]">
          <div className="font-bold text-success-fg">Club lancé.</div>
          <div className="mt-0.5 text-text-soft">
            {resultat.envoyees.length} invitation{resultat.envoyees.length > 1 ? "s" : ""} envoyée
            {resultat.envoyees.length > 1 ? "s" : ""}.
          </div>
          {resultat.echecs.length > 0 && (
            <div className="mt-2 text-danger-fg">
              <div className="font-bold">
                {resultat.echecs.length} envoi{resultat.echecs.length > 1 ? "s" : ""} en échec, à relancer depuis « Invitations » :
              </div>
              <ul className="mt-1 list-disc pl-5 text-[12.5px]">
                {resultat.echecs.map((x) => (
                  <li key={x.email}>
                    {x.email} : {x.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {lancement.statut === "actif" && !resultat && (
        <p className="text-[13px] text-text-soft">
          Club lancé le{" "}
          {new Date(lancement.lance_at ?? "").toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
          {lancement.lance_par ? ` par ${lancement.lance_par}` : ""}. Les nouvelles invitations s&apos;envoient désormais une par une,
          depuis « Invitations ».
        </p>
      )}

      {lancement.statut === "en_preparation" && (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] font-semibold">Avant de lancer, il reste à compléter :</p>
          <div className="flex flex-wrap gap-2">
            {lancement.sections_manquantes.map((libelle) => (
              <Button key={libelle} variant="secondary" className="h-8 px-3 text-[12px]" onClick={() => onOuvrir(CLE_PAR_LIBELLE[libelle] ?? "identite")}>
                {libelle} →
              </Button>
            ))}
          </div>
        </div>
      )}

      {lancement.statut !== "actif" && (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] font-semibold">
            {nb === 0 ? "Aucune invitation préparée pour l'instant." : `${nb} invitation${nb > 1 ? "s partiront" : " partira"} au lancement :`}
          </p>
          {invitations && invitations.length > 0 && (
            <ul className="divide-y divide-divider rounded-xl border border-border-strong px-3.5">
              {invitations.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-2 py-2 text-[12.5px]">
                  <span className="min-w-0 flex-1 font-semibold">{[i.prenom, i.nom].filter(Boolean).join(" ") || i.email}</span>
                  <span className="text-text-soft">{i.email}</span>
                  <Badge tone="neutral">
                    {ROLE_INVITATION_LB[i.role] ?? i.role}
                    {i.teams.length > 0 ? ` · ${i.teams.join(", ")}` : ""}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {lancement.statut === "pret" && peutLancer && !confirmation && !resultat && (
        <Button className="self-start" onClick={() => setConfirmation(true)}>
          Lancer le club
        </Button>
      )}

      {confirmation && (
        <div className="flex flex-col gap-3 rounded-xl border border-brand-violet/40 bg-accent-bg p-4">
          <p className="text-[13px] font-semibold">
            Cette action permettra d&apos;envoyer les invitations préparées aux coachs et membres concernés
            {nb > 0 ? ` (${nb} e-mail${nb > 1 ? "s" : ""})` : ""}. Le club passera en statut « Actif ».
          </p>
          {erreur && <p className="text-[12.5px] font-bold text-danger-fg">{erreur}</p>}
          <div className="flex gap-2">
            <Button loading={enCours} onClick={lancer}>
              Confirmer le lancement
            </Button>
            <Button variant="secondary" disabled={enCours} onClick={() => setConfirmation(false)}>
              Annuler
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

const CLE_PAR_LIBELLE: Record<string, string> = {
  "Identité": "identite",
  "Responsables": "responsables",
  "Équipes": "equipes",
  "Entraînements": "entrainements",
  "Calendrier": "calendrier",
  "Branding": "branding",
  "Sponsors": "sponsors",
  "Communication": "communication",
  "Droit à l'image": "droit_image",
};

const ROLE_INVITATION_LB: Record<string, string> = {
  president: "Président",
  secretaire: "Secrétaire",
  tresorier: "Trésorier",
  directeur_sportif: "Directeur sportif",
  comm: "Communication",
  membre_bureau: "Bureau",
  administratif: "Administratif",
  coach: "Coach",
  resp_equipe: "Responsable d'équipe",
};

const fieldClass =
  "h-11 rounded-xl border border-border-strong bg-input-bg px-3.5 text-[14px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,84,255,.12)]";

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <label className={cn("flex flex-col gap-1.5", full && "sm:col-span-2")}>
      <span className="text-[12.5px] font-bold text-text-soft">{label}</span>
      {children}
    </label>
  );
}

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div>
      <div className="text-[13.5px] font-extrabold">{title}</div>
      {description && <p className="mt-0.5 text-[12px] text-text-soft">{description}</p>}
    </div>
  );
}

// ── Identité ──

function IdentiteCard({
  clubId,
  address,
  siret,
  siretLisible,
  canEdit,
  canEditLegal,
  onSaved,
}: {
  clubId: string;
  address: string;
  siret: string;
  // 11/09/2026 — Décision de Fouka : le CM SportVision ne lit pas le SIRET (la base ne le lui
  // rend plus). Le champ n'est donc affiché qu'à qui le lit réellement, et jamais renvoyé sinon.
  siretLisible: boolean;
  canEdit: boolean;
  canEditLegal: boolean;
  onSaved: () => void;
}) {
  const [adresse, setAdresse] = useState(address);
  const [siretVal, setSiretVal] = useState(siret);
  // La ville compte pour « Identité » (club_onboarding_completion) : sans champ pour la saisir,
  // le CM ne pouvait jamais compléter cette section — donc jamais lancer le club (trouvé le
  // 10/09/2026 sur SF Villemomble, ville vide).
  const [ville, setVille] = useState("");
  useEffect(() => {
    createClient()
      .from("clubs")
      .select("ville")
      .eq("id", clubId)
      .maybeSingle()
      .then(({ data }) => setVille((data as { ville: string | null } | null)?.ville ?? ""));
  }, [clubId]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Sans ce catch, un refus d'ecriture (RLS, declencheur SIRET) remontait en rejet de promesse
  // non gere : le bouton arretait de tourner et l'ecran ne disait rien. Vu de l'utilisateur,
  // « j'appuie sur Enregistrer et ca n'enregistre pas ». Un echec doit se voir.
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      // Le SIRET ne part que si on a le droit de le modifier ET qu'on l'a lu. Jusqu'au 11/09/2026,
      // le CM renvoyait le SIRET tel qu'il l'avait lu ; il ne le lit plus (décision de Fouka) :
      // renvoyer la valeur vide l'aurait effacé, ou fait refuser tout l'enregistrement par le
      // déclencheur proteger_identite_legale_club — adresse et ville comprises.
      await updateClubOrganization(
        createClient(),
        clubId,
        canEditLegal && siretLisible ? { adresse, ville, siret: siretVal } : { adresse, ville },
      );
      setSaved(true);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible d'enregistrer ces informations. Réessayez.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <SectionHeader title="Identité du club" description="Adresse et ville du club. Le nom et la discipline se corrigent par l'administration SportVision." />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Adresse" full>
          <input value={adresse} onChange={(e) => setAdresse(e.target.value)} disabled={!canEdit} placeholder="Non renseignée" className={fieldClass} />
        </Field>
        <Field label="Ville">
          <input value={ville} onChange={(e) => setVille(e.target.value)} disabled={!canEdit} placeholder="Non renseignée" className={fieldClass} />
        </Field>
        {siretLisible && (
          <Field label="SIRET (si association)">
            <input value={siretVal} onChange={(e) => setSiretVal(e.target.value)} disabled={!canEdit || !canEditLegal} placeholder="Non renseigné" className={fieldClass} />
            {canEdit && !canEditLegal && (
              <p className="mt-1 text-[11.5px] text-muted-fg">
                Identité légale du club : seule l&apos;administration SportVision peut la corriger.
              </p>
            )}
          </Field>
        )}
      </div>
      {canEdit && (
        <div className="flex items-center gap-3">
          <Button className="h-9 px-4 text-[12.5px]" loading={saving} onClick={save}>
            Enregistrer
          </Button>
          {saved && <span className="text-[12px] font-bold text-success-fg">Enregistré.</span>}
          {error && <span className="text-[12px] font-bold text-danger-fg">{error}</span>}
        </div>
      )}
    </Card>
  );
}

// ── Responsables ──

// Les dirigeants qu'on peut préparer depuis l'onboarding. Les valeurs sont celles de
// `club_invitations.role`. Le président n'y figure que pour qui peut le nommer (l'Owner) : pour le
// CM, la base le refuse (v116), et l'écran lui propose à la place de noter ses coordonnées.
const ROLES_DIRIGEANTS = [
  { value: "secretaire", label: "Secrétaire" },
  { value: "tresorier", label: "Trésorier" },
  { value: "directeur_sportif", label: "Directeur sportif" },
  { value: "comm", label: "Responsable communication" },
  { value: "membre_bureau", label: "Membre du bureau" },
  { value: "administratif", label: "Administratif" },
] as const;
const ROLE_PRESIDENT = { value: "president", label: "Président" } as const;
const ROLES_EQUIPE = new Set(["coach", "resp_equipe"]);

function ResponsablesCard({
  clubId,
  canEdit,
  canInvite,
  estCm,
  enPreparation,
  onSaved,
}: {
  clubId: string;
  canEdit: boolean;
  canInvite: boolean;
  estCm: boolean;
  enPreparation: boolean;
  onSaved: () => void;
}) {
  const [members, setMembers] = useState<OrgUser[] | null>(null);
  const [invitations, setInvitations] = useState<InvitationClub[]>([]);
  const [modaleOuverte, setModaleOuverte] = useState(false);
  const [portailId, setPortailId] = useState<string | null | undefined>(undefined);
  const [contact, setContact] = useState<ContactPresident | null>(null);
  const [formContact, setFormContact] = useState<Omit<ContactPresident, "id"> | null>(null);
  const [savingContact, setSavingContact] = useState(false);
  const [errorContact, setErrorContact] = useState<string | null>(null);

  function reload() {
    const supabase = createClient();
    fetchClubMembers(supabase, clubId).then(setMembers).catch(() => setMembers([]));
    fetchClubInvitations(supabase, clubId).then(setInvitations).catch(() => setInvitations([]));
  }
  useEffect(() => {
    reload();
    const supabase = createClient();
    resolveClubPortailClientId(supabase, clubId)
      .then((id) => {
        setPortailId(id);
        if (id) fetchContactPresident(supabase, id).then(setContact).catch(() => setContact(null));
      })
      .catch(() => setPortailId(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubId]);

  async function enregistrerContact() {
    if (!formContact || !portailId) return;
    if (!formContact.prenom?.trim() || !formContact.nom?.trim()) {
      setErrorContact("Prénom et nom du président sont obligatoires.");
      return;
    }
    setSavingContact(true);
    setErrorContact(null);
    try {
      await enregistrerContactPresident(createClient(), portailId, contact?.id ?? null, formContact);
      setContact(await fetchContactPresident(createClient(), portailId));
      setFormContact(null);
      onSaved();
    } catch (e) {
      setErrorContact(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setSavingContact(false);
    }
  }

  const actifs = (members ?? []).filter((m) => m.status !== "disabled");
  const presidentMembre = actifs.find((m) => m.role === "president");
  const invitationPresident = invitations.find((i) => i.role === "president" && (i.statut === "preparee" || i.statut === "envoyee"));
  const invitationsDirigeants = invitations.filter(
    (i) => !ROLES_EQUIPE.has(i.role) && i.role !== "president" && (i.statut === "preparee" || i.statut === "envoyee"),
  );
  const dirigeants = actifs.filter((m) => m.role !== "president");

  return (
    <Card className="flex flex-col gap-4 p-5">
      <SectionHeader
        title="Responsables"
        description="Le président et le bureau. Chacun recevra un accès Club+ à son niveau, sans qu'aucun compte soit créé à sa place."
      />

      {/* ── Le président ── */}
      <div className="rounded-xl border border-border-strong p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[12.5px] font-extrabold uppercase tracking-[.05em] text-text-soft">Président</span>
          {presidentMembre ? (
            <Badge tone="success">Connecté à Club+</Badge>
          ) : invitationPresident ? (
            <Badge tone={STATUT_INVITATION_TONE[invitationPresident.statut]}>{STATUT_INVITATION_LABEL[invitationPresident.statut]}</Badge>
          ) : contact ? (
            <Badge tone="info">Coordonnées renseignées</Badge>
          ) : (
            <Badge tone="warning">À renseigner</Badge>
          )}
        </div>
        <div className="mt-2 text-[13.5px] font-semibold">
          {presidentMembre
            ? `${presidentMembre.firstName} ${presidentMembre.lastName}`.trim() || "Président"
            : invitationPresident
              ? [invitationPresident.prenom, invitationPresident.nom].filter(Boolean).join(" ") || invitationPresident.email
              : contact
                ? [contact.prenom, contact.nom].filter(Boolean).join(" ")
                : <span className="font-normal text-text-soft">Aucun président connu pour l&apos;instant.</span>}
        </div>
        {contact && !presidentMembre && (
          <div className="mt-0.5 text-[12px] text-text-soft">
            {[contact.email, contact.telephone].filter(Boolean).join(" · ") || "Ni e-mail ni téléphone"}
          </div>
        )}
        {estCm && !presidentMembre && !invitationPresident && (
          <p className="mt-2 text-[11.5px] leading-relaxed text-text-faint">
            L&apos;accès du président se prépare par SportVision ou l&apos;administrateur du compte Club+. Notez ici ses
            coordonnées : c&apos;est ce qui permet de lui préparer son invitation.
          </p>
        )}
        {estCm && canEdit && portailId && !presidentMembre && !formContact && (
          <Button
            variant="secondary"
            className="mt-2.5 h-8 px-3 text-[12px]"
            onClick={() => setFormContact({ prenom: contact?.prenom ?? "", nom: contact?.nom ?? "", email: contact?.email ?? "", telephone: contact?.telephone ?? "" })}
          >
            {contact ? "Modifier les coordonnées" : "Renseigner les coordonnées du président"}
          </Button>
        )}
        {estCm && portailId === null && !presidentMembre && (
          <p className="mt-2 text-[11.5px] text-text-faint">Ce club n&apos;est pas encore relié à sa fiche SportVision : les coordonnées ne peuvent pas être enregistrées ici.</p>
        )}
        {formContact && (
          <div className="mt-3 flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Prénom">
                <input value={formContact.prenom ?? ""} onChange={(e) => setFormContact({ ...formContact, prenom: e.target.value })} className={fieldClass} />
              </Field>
              <Field label="Nom">
                <input value={formContact.nom ?? ""} onChange={(e) => setFormContact({ ...formContact, nom: e.target.value })} className={fieldClass} />
              </Field>
              <Field label="E-mail">
                <input type="email" value={formContact.email ?? ""} onChange={(e) => setFormContact({ ...formContact, email: e.target.value })} className={fieldClass} />
              </Field>
              <Field label="Téléphone">
                <input type="tel" value={formContact.telephone ?? ""} onChange={(e) => setFormContact({ ...formContact, telephone: e.target.value })} className={fieldClass} />
              </Field>
            </div>
            {errorContact && <p className="text-[12.5px] font-bold text-danger-fg">{errorContact}</p>}
            <div className="flex gap-2">
              <Button className="h-9 px-4 text-[12.5px]" loading={savingContact} onClick={enregistrerContact}>
                Enregistrer
              </Button>
              <Button variant="secondary" className="h-9 px-4 text-[12.5px]" onClick={() => setFormContact(null)}>
                Annuler
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── Le bureau ── */}
      <div className="flex flex-col gap-2">
        <span className="text-[12.5px] font-extrabold uppercase tracking-[.05em] text-text-soft">Bureau et dirigeants</span>
        {dirigeants.length === 0 && invitationsDirigeants.length === 0 && members !== null && (
          <p className="text-[12.5px] text-text-soft">Aucun dirigeant renseigné pour le moment.</p>
        )}
        {(dirigeants.length > 0 || invitationsDirigeants.length > 0) && (
          <div className="flex flex-col divide-y divide-divider rounded-xl border border-border-strong px-3.5">
            {dirigeants.map((m) => (
              <div key={m.membershipId} className="flex flex-wrap items-center gap-3 py-2.5">
                <span className="w-40 flex-none text-[12.5px] font-bold text-text">{ROLE_LABELS[m.role] ?? m.role}</span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                  {m.firstName || m.lastName ? `${m.firstName} ${m.lastName}`.trim() : "—"}
                </span>
                <Badge tone={m.status === "invited" ? "warning" : "success"}>{m.status === "invited" ? "Invitation envoyée" : "Actif"}</Badge>
              </div>
            ))}
            {invitationsDirigeants.map((i) => (
              <div key={i.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <span className="w-40 flex-none text-[12.5px] font-bold text-text">
                  {ROLES_DIRIGEANTS.find((r) => r.value === i.role)?.label ?? i.role}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                  {[i.prenom, i.nom].filter(Boolean).join(" ") || i.email}
                </span>
                <Badge tone={STATUT_INVITATION_TONE[i.statut]}>
                  {i.statut === "preparee" && enPreparation ? "Partira au lancement" : STATUT_INVITATION_LABEL[i.statut]}
                </Badge>
              </div>
            ))}
          </div>
        )}
        {canInvite && (
          <Button variant="secondary" className="h-9 self-start px-4 text-[12.5px]" onClick={() => setModaleOuverte(true)}>
            + Préparer l&apos;invitation d&apos;un responsable
          </Button>
        )}
      </div>

      {modaleOuverte && (
        <InviterEncadrantModal
          clubId={clubId}
          titre="Préparer l'invitation d'un responsable"
          roles={estCm ? ROLES_DIRIGEANTS : [ROLE_PRESIDENT, ...ROLES_DIRIGEANTS]}
          sansEquipe
          enPreparation={enPreparation}
          onClose={() => setModaleOuverte(false)}
          onInvited={() => {
            reload();
            onSaved();
          }}
        />
      )}
    </Card>
  );
}

// ── Équipes + entraînements ──

function EquipesCard({
  clubId,
  canEdit,
  canInvite,
  enPreparation,
  onSaved,
}: {
  clubId: string;
  canEdit: boolean;
  canInvite: boolean;
  enPreparation: boolean;
  onSaved: () => void;
}) {
  const [teams, setTeams] = useState<Team[] | null>(null);
  // L'état de chaque équipe (encadrant, effectif) : une seule source, club_equipes_etat.
  const [etats, setEtats] = useState<Map<string, EtatEquipe>>(new Map());
  const [ouverte, setOuverte] = useState<string | null>(null);
  const [filtre, setFiltre] = useState<"toutes" | "sans_coach" | "sans_creneau" | "sans_effectif">("toutes");
  const [coachModalTeam, setCoachModalTeam] = useState<string | null>(null);
  const [venues, setVenues] = useState<ClubVenue[] | null>(null);
  const [slots, setSlots] = useState<TrainingSlot[]>([]);
  const [showTeamForm, setShowTeamForm] = useState(false);
  const [teamName, setTeamName] = useState("");
  // Plusieurs categories possibles : beaucoup de clubs font jouer les U8 avec les U9. La
  // premiere cochee reste la principale, celle qu'affichent les ecrans existants.
  const [teamCategories, setTeamCategories] = useState<string[]>([]);
  const [teamCoachFirstName, setTeamCoachFirstName] = useState("");
  const [teamCoachLastName, setTeamCoachLastName] = useState("");
  const [teamCoachEmail, setTeamCoachEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coachInviteWarning, setCoachInviteWarning] = useState<string | null>(null);
  const [coachPrepare, setCoachPrepare] = useState<string | null>(null);
  const [showVenueForm, setShowVenueForm] = useState(false);
  const [venueName, setVenueName] = useState("");
  const [venueVille, setVenueVille] = useState("");
  const [venueSaving, setVenueSaving] = useState(false);
  const [venueError, setVenueError] = useState<string | null>(null);
  const [venueBusyId, setVenueBusyId] = useState<string | null>(null);
  const [slotForm, setSlotForm] = useState<{ teamId: string; jour: string; heureDebut: string; heureFin: string; venueId: string } | null>(null);
  const [slotSaving, setSlotSaving] = useState(false);
  const [slotError, setSlotError] = useState<string | null>(null);
  const [importTeamId, setImportTeamId] = useState<string | null>(null);
  const [importRows, setImportRows] = useState<RosterImportRow[]>([]);
  const [importPreview, setImportPreview] = useState<RosterPreviewResult[] | null>(null);
  const [importResults, setImportResults] = useState<RosterImportResult[] | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [clubLink, setClubLink] = useState<InviteLink | null | undefined>(undefined);
  const [clubLinkBusy, setClubLinkBusy] = useState(false);
  const [clubLinkError, setClubLinkError] = useState<string | null>(null);
  const [showClubQr, setShowClubQr] = useState(false);
  const [clubLinkCopied, setClubLinkCopied] = useState(false);

  useEffect(() => {
    fetchClubInviteLinks(createClient(), clubId)
      .then((links) => setClubLink(links.find((l) => l.actif) ?? null))
      .catch(() => setClubLink(null));
  }, [clubId]);

  async function handleCreateClubLink() {
    setClubLinkBusy(true);
    setClubLinkError(null);
    try {
      setClubLink(await createInviteLink(createClient(), clubId, null));
    } catch (e) {
      setClubLinkError(e instanceof Error ? e.message : "Impossible de générer le lien.");
    } finally {
      setClubLinkBusy(false);
    }
  }

  async function handleRotateClubLink() {
    if (!clubLink) return;
    setClubLinkBusy(true);
    setClubLinkError(null);
    try {
      setClubLink(await rotateInviteLink(createClient(), clubLink.id));
    } catch (e) {
      setClubLinkError(e instanceof Error ? e.message : "Impossible de régénérer le lien.");
    } finally {
      setClubLinkBusy(false);
    }
  }

  async function handleDeactivateClubLink() {
    if (!clubLink) return;
    setClubLinkBusy(true);
    setClubLinkError(null);
    try {
      await deactivateInviteLink(createClient(), clubLink.id);
      setClubLink(null);
    } catch (e) {
      setClubLinkError(e instanceof Error ? e.message : "Impossible de désactiver le lien.");
    } finally {
      setClubLinkBusy(false);
    }
  }

  function handleCopyClubLink() {
    if (!clubLink) return;
    navigator.clipboard.writeText(buildJoinUrl(clubLink.code)).then(() => {
      setClubLinkCopied(true);
      setTimeout(() => setClubLinkCopied(false), 1500);
    });
  }

  async function reload() {
    const supabase = createClient();
    const [t, v] = await Promise.all([fetchClubTeams(supabase, clubId), fetchClubVenues(supabase, clubId)]);
    setTeams(t);
    setVenues(v);
    setSlots(await fetchTrainingSlotsForClub(supabase, t.map((x) => x.id)));
    fetchEquipesEtat(supabase, clubId)
      .then((liste) => setEtats(new Map(liste.map((e) => [e.team_id, e]))))
      .catch(() => setEtats(new Map()));
  }
  useEffect(() => {
    reload().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubId]);

  // Coach invité au même moment que la création de l'équipe (05/09/2026, retour Fouka) : avant,
  // le champ "Coach" de ce formulaire n'était qu'un texte libre affiché sur la fiche équipe,
  // sans aucun accès Club+ réel — l'admin devait ensuite cliquer séparément sur "+ Inviter un
  // coach" pour ça. Fusionné en une seule action quand un e-mail est renseigné ici ; sans e-mail,
  // le nom reste un simple texte libre comme avant (le coach n'a peut-être pas encore d'adresse
  // à disposition). Un échec de l'invitation n'annule jamais la création de l'équipe déjà
  // réussie — averti séparément plutôt que de perdre le travail déjà fait.
  async function handleCreateTeam() {
    if (!teamName.trim()) {
      setError("Le nom de l'équipe est obligatoire.");
      return;
    }
    setSaving(true);
    setError(null);
    setCoachInviteWarning(null);
    const coachDisplayName = [teamCoachFirstName.trim(), teamCoachLastName.trim()].filter(Boolean).join(" ");
    try {
      await createClubTeam(createClient(), clubId, {
        name: teamName.trim(),
        categories: teamCategories,
        coach: coachDisplayName || undefined,
      });
      // 10/09/2026 — Le coach est PRÉPARÉ, plus créé. L'ancien chemin (clubplus-invite, mode
      // « direct ») créait le compte à sa place et affichait son mot de passe : c'est exactement
      // ce que Fouka a écarté (« la personne prend possession de son compte elle-même »), et un
      // e-mail partait avant le lancement du club. L'invitation attend désormais le lancement, ou
      // un envoi explicite depuis « Invitations ».
      if (teamCoachEmail.trim() && teamCoachFirstName.trim() && teamCoachLastName.trim()) {
        try {
          await preparerInvitation(createClient(), {
            clubId,
            email: teamCoachEmail.trim(),
            role: "coach",
            prenom: teamCoachFirstName.trim(),
            nom: teamCoachLastName.trim(),
            teams: [teamName.trim()],
          });
          setCoachPrepare(
            `Équipe créée. L'invitation de ${teamCoachFirstName.trim()} ${teamCoachLastName.trim()} est préparée${
              enPreparation ? " : elle partira au lancement du club." : " : envoyez-la depuis « Invitations »."
            }`,
          );
        } catch (e) {
          setCoachInviteWarning(
            `Équipe créée, mais l'invitation du coach n'a pas pu être préparée (${messageErreurInvitation(e, "erreur inconnue")}).`,
          );
        }
      }
      setTeamName("");
      setTeamCategories([]);
      setTeamCoachFirstName("");
      setTeamCoachLastName("");
      setTeamCoachEmail("");
      setShowTeamForm(false);
      await reload();
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible de créer l'équipe (plafond du plan atteint ?).");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateVenue() {
    if (!venueName.trim()) return;
    setVenueSaving(true);
    setVenueError(null);
    try {
      await createClubVenue(createClient(), clubId, { nom: venueName.trim(), ville: venueVille.trim() || undefined });
      setVenueName("");
      setVenueVille("");
      setShowVenueForm(false);
      await reload();
    } catch (e) {
      setVenueError(e instanceof Error ? e.message : "Impossible d'ajouter ce lieu. Réessayez.");
    } finally {
      setVenueSaving(false);
    }
  }

  async function handleDeleteVenue(venueId: string) {
    setVenueBusyId(venueId);
    setVenueError(null);
    try {
      await deleteClubVenue(createClient(), venueId);
      await reload();
    } catch (e) {
      setVenueError(e instanceof Error ? e.message : "Impossible de retirer ce lieu. Réessayez.");
    } finally {
      setVenueBusyId(null);
    }
  }

  async function handleSetVenuePrincipal(venueId: string) {
    setVenueBusyId(venueId);
    setVenueError(null);
    try {
      await setVenuePrincipal(createClient(), clubId, venueId);
      await reload();
    } catch (e) {
      setVenueError(e instanceof Error ? e.message : "Impossible de définir ce terrain principal. Réessayez.");
    } finally {
      setVenueBusyId(null);
    }
  }

  async function handleCreateSlot() {
    if (!slotForm || !slotForm.heureDebut) {
      setSlotError("L'heure de début est obligatoire.");
      return;
    }
    setSlotSaving(true);
    setSlotError(null);
    try {
      await createTrainingSlot(createClient(), {
        teamId: slotForm.teamId,
        jour: slotForm.jour,
        heureDebut: slotForm.heureDebut,
        heureFin: slotForm.heureFin || undefined,
        venueId: slotForm.venueId || undefined,
      });
      setSlotForm(null);
      await reload();
      onSaved();
    } catch (e) {
      setSlotError(e instanceof Error ? e.message : "Impossible d'ajouter ce créneau. Réessayez.");
    } finally {
      setSlotSaving(false);
    }
  }

  async function handleDeleteSlot(id: string) {
    try {
      await deleteTrainingSlot(createClient(), id);
      await reload();
    } catch {
      setSlotError("Impossible de retirer ce créneau. Réessayez.");
    }
  }

  function openImport(teamId: string) {
    setImportTeamId(teamId);
    setImportRows([]);
    setImportPreview(null);
    setImportResults(null);
    setImportError(null);
  }

  async function handleCsvSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !importTeamId) return;
    setImportError(null);
    setImportResults(null);
    try {
      const text = await file.text();
      const { rows, errors } = parseRosterCsv(text);
      if (rows.length === 0) {
        setImportError(errors[0] ?? "Aucune ligne exploitable dans ce fichier.");
        return;
      }
      setImportRows(rows);
      setImportBusy(true);
      const preview = await previewRosterImport(createClient(), clubId, rows);
      setImportPreview(preview);
      if (errors.length > 0) setImportError(`${errors.length} ligne(s) ignorée(s) : ${errors[0]}`);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Impossible d'analyser ce fichier.");
    } finally {
      setImportBusy(false);
    }
  }

  async function handleConfirmImport(teamId: string, saison: string) {
    if (importRows.length === 0) return;
    setImportBusy(true);
    setImportError(null);
    try {
      const results = await confirmRosterImport(createClient(), clubId, teamId, saison, importRows);
      setImportResults(results);
      await reload();
      onSaved();
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Impossible d'importer cet effectif.");
    } finally {
      setImportBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <SectionHeader title="Équipes & entraînements" description="Une équipe créée ici est réutilisée telle quelle par la Production, la Communication et Connect." />

      {canInvite && (
        <div className="rounded-xl border border-border-strong p-3.5">
          <div className="text-[12.5px] font-bold">Lien du club (toutes les équipes)</div>
          <p className="mt-0.5 text-[11.5px] text-text-soft">
            À partager largement — le joueur ou parent qui l&apos;utilise choisit ensuite son équipe. Pour un lien direct vers une équipe
            précise, utilisez le bouton de cette équipe ci-dessous.
          </p>
          {clubLinkError && <p className="mt-2 text-[12px] font-bold text-danger-fg">{clubLinkError}</p>}
          {clubLink === undefined && <p className="mt-2 text-[12px] text-text-faint">Chargement…</p>}
          {clubLink === null && (
            <Button variant="secondary" className="mt-2.5 h-9 px-3 text-[12px]" loading={clubLinkBusy} onClick={handleCreateClubLink}>
              Générer le lien du club
            </Button>
          )}
          {clubLink && (
            <div className="mt-2.5 flex flex-col gap-2">
              <button
                type="button"
                onClick={handleCopyClubLink}
                className="flex w-full items-center justify-between gap-2 rounded-lg bg-surface-sunken px-3 py-2 text-[12.5px] font-bold text-text"
              >
                <span className="font-mono tracking-[.04em]">{buildJoinUrl(clubLink.code)}</span>
                <span className="flex-none text-[11px] text-text-faint">{clubLinkCopied ? "Copié ✓" : "Copier"}</span>
              </button>
              {showClubQr && (
                <div className="flex justify-center py-1">
                  <QrCode value={buildJoinUrl(clubLink.code)} />
                </div>
              )}
              <div className="flex items-center gap-3 text-[11.5px] font-bold text-text-soft">
                <button type="button" disabled={clubLinkBusy} onClick={() => setShowClubQr((v) => !v)} className="hover:text-brand-blue-electric disabled:opacity-60">
                  {showClubQr ? "Masquer le QR" : "Afficher le QR"}
                </button>
                <button type="button" disabled={clubLinkBusy} onClick={handleRotateClubLink} className="hover:text-brand-blue-electric disabled:opacity-60">
                  Régénérer
                </button>
                <button type="button" disabled={clubLinkBusy} onClick={handleDeactivateClubLink} className="hover:text-danger-fg disabled:opacity-60">
                  Désactiver
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {(teams ?? []).length === 0 && teams !== null && <p className="text-[12.5px] text-text-soft">Aucune équipe renseignée.</p>}

      {slotError && !slotForm && <p className="text-[12.5px] font-bold text-danger-fg">{slotError}</p>}

      {/* 10/09/2026 — 42 équipes dépliées faisaient une page de 10 000 px. Chaque équipe tient
          désormais sur une ligne qui dit ce qui lui manque ; on la déplie pour agir. */}
      {(teams ?? []).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {([
            ["toutes", "Toutes", (teams ?? []).length],
            ["sans_coach", "Sans coach", (teams ?? []).filter((t) => (etats.get(t.id)?.encadrant_statut ?? "aucun") === "aucun").length],
            ["sans_creneau", "Sans créneau", (teams ?? []).filter((t) => !slots.some((x) => x.teamId === t.id)).length],
            ["sans_effectif", "Sans effectif", (teams ?? []).filter((t) => (etats.get(t.id)?.joueurs ?? 0) === 0).length],
          ] as const).map(([cle, libelle, n]) => (
            <button
              key={cle}
              type="button"
              onClick={() => setFiltre(cle)}
              className={cn(
                "rounded-full border px-3 py-1 text-[12px] font-bold transition-colors",
                filtre === cle
                  ? "border-brand-blue-electric bg-brand-blue-electric/10 text-brand-blue-electric"
                  : "border-border-strong text-text-soft hover:border-brand-blue",
              )}
            >
              {libelle} <span className="tabular-nums opacity-70">{n}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col overflow-hidden rounded-xl border border-border-strong">
        {(teams ?? [])
          .filter((team) => {
            if (filtre === "sans_coach") return (etats.get(team.id)?.encadrant_statut ?? "aucun") === "aucun";
            if (filtre === "sans_creneau") return !slots.some((x) => x.teamId === team.id);
            if (filtre === "sans_effectif") return (etats.get(team.id)?.joueurs ?? 0) === 0;
            return true;
          })
          .map((team) => {
          const teamSlots = slots.filter((s) => s.teamId === team.id).sort((a, b) => JOURS_ORDER.indexOf(a.jour as never) - JOURS_ORDER.indexOf(b.jour as never));
          const etat = etats.get(team.id);
          const statutCoach = etat?.encadrant_statut ?? "aucun";
          const deplie = ouverte === team.id || importTeamId === team.id || slotForm?.teamId === team.id;
          return (
            <div key={team.id} className="border-b border-divider last:border-0">
              <button
                type="button"
                onClick={() => setOuverte(deplie ? null : team.id)}
                aria-expanded={deplie}
                className="flex w-full flex-wrap items-center gap-x-2 gap-y-1.5 px-3.5 py-2.5 text-left transition-colors hover:bg-row-hover"
              >
                <span aria-hidden className={cn("flex-none text-text-faint transition-transform", deplie && "rotate-90")}>›</span>
                <span className="text-[13.5px] font-extrabold">{team.name}</span>
                {team.category !== "—" && <span className="text-[11.5px] text-text-soft">{team.category}</span>}
                <span className="ml-auto flex flex-wrap items-center gap-1.5">
                  <Badge tone={statutCoach === "actif" ? "success" : statutCoach === "aucun" ? "warning" : "info"}>
                    {statutCoach === "aucun" ? "Sans coach" : etat?.encadrant ?? ENCADRANT_LIBELLE[statutCoach]}
                    {statutCoach === "prepare" ? " · préparée" : statutCoach === "invite" ? " · invité" : ""}
                  </Badge>
                  <Badge tone={teamSlots.length > 0 ? "neutral" : "warning"}>
                    {teamSlots.length > 0 ? `${teamSlots.length} créneau${teamSlots.length > 1 ? "x" : ""}` : "Sans créneau"}
                  </Badge>
                  {etat && (
                    <Badge tone={etat.joueurs > 0 ? "neutral" : "warning"}>
                      {etat.joueurs > 0 ? `${etat.joueurs} joueur${etat.joueurs > 1 ? "s" : ""}` : "Effectif non renseigné"}
                    </Badge>
                  )}
                </span>
              </button>
              {deplie && (
              <div className="px-3.5 pb-3.5 pl-8">
              <div className="flex flex-wrap items-center justify-between gap-2">
                {canEdit && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="tertiary"
                      className="h-7 px-2 text-[11.5px]"
                      onClick={() => setSlotForm({ teamId: team.id, jour: "mardi", heureDebut: "", heureFin: "", venueId: "" })}
                    >
                      + Créneau d&apos;entraînement
                    </Button>
                    {canInvite && (
                      <Button
                        variant="tertiary"
                        className="h-7 px-2 text-[11.5px]"
                        onClick={() => setCoachModalTeam(team.name)}
                      >
                        + Inviter un coach
                      </Button>
                    )}
                    <Button variant="tertiary" className="h-7 px-2 text-[11.5px]" onClick={() => openImport(team.id)}>
                      + Importer un effectif (CSV)
                    </Button>
                  </div>
                )}
              </div>
              {importTeamId === team.id && (
                <div className="mt-3 flex flex-col gap-2 rounded-lg border border-border-strong p-3">
                  <p className="text-[12px] text-text-soft">
                    Fichier CSV avec les colonnes <strong>prenom</strong>, <strong>nom</strong>, <strong>date_naissance</strong> (JJ/MM/AAAA), et
                    facultativement <strong>numero_licence</strong>. Un joueur déjà connu (même nom + même date de naissance) est retrouvé
                    automatiquement, jamais dupliqué.
                  </p>
                  <label className="inline-flex h-9 w-fit cursor-pointer items-center rounded-sv border border-border-strong px-3 text-[12px] font-bold hover:border-brand-blue">
                    Choisir un fichier CSV
                    <input type="file" accept=".csv,text/csv" className="hidden" disabled={importBusy} onChange={handleCsvSelected} />
                  </label>
                  {importError && <p className="text-[12px] font-bold text-danger-fg">{importError}</p>}
                  {importPreview && !importResults && (
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-wrap gap-2 text-[12px]">
                        <Badge tone="success">{importPreview.filter((r) => r.categorie === "nouveau").length} nouveaux</Badge>
                        <Badge tone="info">{importPreview.filter((r) => r.categorie === "existant").length} déjà connus</Badge>
                        <Badge tone="warning">
                          {importPreview.filter((r) => r.categorie === "a_verifier" || r.categorie === "ambigu").length} à vérifier
                        </Badge>
                        <Badge tone="danger">{importPreview.filter((r) => r.categorie === "erreur").length} en erreur</Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button className="h-9 px-3 text-[12px]" loading={importBusy} onClick={() => handleConfirmImport(team.id, team.season || "2026-2027")}>
                          Confirmer l&apos;import ({importRows.length} joueurs)
                        </Button>
                        <Button variant="secondary" className="h-9 px-3 text-[12px]" onClick={() => setImportTeamId(null)}>
                          Annuler
                        </Button>
                      </div>
                    </div>
                  )}
                  {importResults && (
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-wrap gap-2 text-[12px]">
                        <Badge tone="success">{importResults.filter((r) => r.statut === "nouveau").length} créés</Badge>
                        <Badge tone="info">{importResults.filter((r) => r.statut === "existant").length} rattachés</Badge>
                        <Badge tone="danger">{importResults.filter((r) => r.statut === "erreur").length} erreurs</Badge>
                      </div>
                      <Button variant="secondary" className="h-9 w-fit px-3 text-[12px]" onClick={() => setImportTeamId(null)}>
                        Fermer
                      </Button>
                    </div>
                  )}
                </div>
              )}
              <div className="mt-2 flex flex-col gap-1">
                {teamSlots.length === 0 && <span className="text-[11.5px] text-text-faint">Aucun créneau d&apos;entraînement renseigné.</span>}
                {teamSlots.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 text-[12px] text-text-soft">
                    <span className="font-bold text-text">{JOURS_LABELS[s.jour]}</span>
                    <span>
                      {s.heureDebut.slice(0, 5)}
                      {s.heureFin ? `–${s.heureFin.slice(0, 5)}` : ""}
                    </span>
                    {s.venueNom && <span>· {s.venueNom}</span>}
                    {canEdit && (
                      <button type="button" onClick={() => handleDeleteSlot(s.id)} className="text-danger-fg hover:underline">
                        Retirer
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {slotForm?.teamId === team.id && (
                <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-border-strong p-3">
                  <Field label="Jour">
                    <select value={slotForm.jour} onChange={(e) => setSlotForm({ ...slotForm, jour: e.target.value })} className={cn(fieldClass, "h-9 w-32")}>
                      {JOURS_ORDER.map((j) => (
                        <option key={j} value={j}>
                          {JOURS_LABELS[j]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Début">
                    <input type="time" value={slotForm.heureDebut} onChange={(e) => setSlotForm({ ...slotForm, heureDebut: e.target.value })} className={cn(fieldClass, "h-9 w-28")} />
                  </Field>
                  <Field label="Fin">
                    <input type="time" value={slotForm.heureFin} onChange={(e) => setSlotForm({ ...slotForm, heureFin: e.target.value })} className={cn(fieldClass, "h-9 w-28")} />
                  </Field>
                  <Field label="Lieu">
                    <select value={slotForm.venueId} onChange={(e) => setSlotForm({ ...slotForm, venueId: e.target.value })} className={cn(fieldClass, "h-9 w-40")}>
                      <option value="">Non précisé</option>
                      {(venues ?? []).map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.nom}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Button className="h-9 px-3 text-[12px]" loading={slotSaving} onClick={handleCreateSlot}>
                    Ajouter
                  </Button>
                  <Button variant="secondary" className="h-9 px-3 text-[12px]" onClick={() => { setSlotForm(null); setSlotError(null); }}>
                    Annuler
                  </Button>
                  {slotError && <p className="w-full text-[12px] font-bold text-danger-fg">{slotError}</p>}
                </div>
              )}
              </div>
              )}
            </div>
          );
        })}
      </div>

      {coachModalTeam && (
        <InviterEncadrantModal
          clubId={clubId}
          teamName={coachModalTeam}
          enPreparation={enPreparation}
          onClose={() => setCoachModalTeam(null)}
          onInvited={() => {
            reload().catch(() => {});
            onSaved();
          }}
        />
      )}

      {/*
        Les lieux avaient deux defauts qui se combinaient en un blocage complet (retour Fouka,
        09/09/2026, SF Villemomble) : la liste n'etait affichee nulle part — un lieu ajoute
        disparaissait aussitot, visible seulement dans le menu deroulant d'un creneau — et le
        bouton d'ajout etait conditionne a `venues.length === 0`, donc il s'effacait des le
        premier terrain enregistre. Un club a presque toujours plusieurs installations (stade
        d'honneur, terrain annexe, gymnase, salle) : la liste est desormais visible et l'ajout
        reste ouvert en permanence.
      */}
      <div className="flex flex-col gap-2 border-t border-divider pt-4">
        <div className="text-[12.5px] font-bold text-text-soft">Lieux (stades, terrains, gymnases)</div>
        {venues === null ? (
          <p className="text-[12.5px] text-text-faint">Chargement…</p>
        ) : venues.length === 0 ? (
          <p className="text-[12.5px] text-text-faint">Aucun lieu enregistré pour le moment.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {venues.map((v) => (
              <div key={v.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border-strong px-3 py-2">
                <span className="text-[13px] font-semibold">{v.nom}</span>
                {v.ville && <span className="text-[12px] text-text-soft">{v.ville}</span>}
                {v.terrainPrincipal && <Badge tone="info">Terrain principal</Badge>}
                {canEdit && (
                  <div className="ml-auto flex items-center gap-2">
                    {!v.terrainPrincipal && (
                      <button
                        type="button"
                        disabled={venueBusyId !== null}
                        onClick={() => handleSetVenuePrincipal(v.id)}
                        className="text-[12px] font-semibold text-text-soft underline-offset-2 hover:underline disabled:opacity-50"
                      >
                        Définir principal
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={venueBusyId !== null}
                      onClick={() => handleDeleteVenue(v.id)}
                      className="text-[12px] font-semibold text-danger-fg underline-offset-2 hover:underline disabled:opacity-50"
                    >
                      {venueBusyId === v.id ? "…" : "Retirer"}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {canEdit && !showVenueForm && (
          <Button variant="secondary" className="h-9 self-start px-4 text-[12.5px]" onClick={() => setShowVenueForm(true)}>
            + Ajouter un lieu (terrain, gymnase)
          </Button>
        )}
        {canEdit && showVenueForm && (
          <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border-strong p-3.5">
            <Field label="Nom du lieu">
              <input value={venueName} onChange={(e) => setVenueName(e.target.value)} placeholder="Stade Georges Pompidou" className={cn(fieldClass, "h-9 w-56")} />
            </Field>
            <Field label="Ville">
              <input value={venueVille} onChange={(e) => setVenueVille(e.target.value)} className={cn(fieldClass, "h-9 w-40")} />
            </Field>
            <Button className="h-9 px-3 text-[12px]" loading={venueSaving} onClick={handleCreateVenue}>
              Ajouter
            </Button>
            <Button variant="secondary" className="h-9 px-3 text-[12px]" onClick={() => { setShowVenueForm(false); setVenueError(null); }}>
              Annuler
            </Button>
          </div>
        )}
        {venueError && <p className="text-[12px] font-bold text-danger-fg">{venueError}</p>}
      </div>

      {canEdit && !showTeamForm && (
        <Button variant="secondary" className="h-9 self-start px-4 text-[12.5px]" onClick={() => setShowTeamForm(true)}>
          + Ajouter une équipe
        </Button>
      )}
      {canEdit && showTeamForm && (
        <div className="flex flex-col gap-3 rounded-xl border border-border-strong p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Nom" full>
              <input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="U15 R1" className={fieldClass} />
            </Field>
            <Field label="Catégorie">
              {/* Choix multiple, et non texte libre : d'une part pour qu'un club n'ait pas
                  « U15 », « u15 » et « U 15 » qui ne se rapprochent d'aucun calendrier importe ;
                  d'autre part parce qu'une equipe couvre parfois deux ages (U8 avec U9). Chaque
                  categorie cochee sert de libelle au rapprochement a l'import. */}
              <div className="flex flex-wrap gap-1.5">
                {TEAM_CATEGORY_OPTIONS.map((c) => {
                  const choisie = teamCategories.includes(c);
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() =>
                        setTeamCategories((prev) =>
                          prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c],
                        )
                      }
                      className={cn(
                        "h-8 rounded-lg border px-2.5 text-[12px] font-bold transition-colors",
                        choisie
                          ? "border-brand-blue-electric bg-brand-blue-electric text-white"
                          : "border-border-strong text-text-soft hover:border-brand-blue",
                      )}
                    >
                      {c}
                    </button>
                  );
                })}
              </div>
              {teamCategories.length > 1 && (
                <p className="mt-1.5 text-[11.5px] text-text-soft">
                  Cette équipe couvre {teamCategories.join(" et ")}. Les calendriers de ces catégories
                  lui seront rattachés.
                </p>
              )}
            </Field>
          </div>
          <div className="border-t border-divider pt-3">
            <div className="mb-2 text-[12px] font-bold text-text-soft">
              Coach (facultatif) — avec un e-mail, son invitation est préparée ; aucun compte n&apos;est créé à sa place
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Prénom">
                <input value={teamCoachFirstName} onChange={(e) => setTeamCoachFirstName(e.target.value)} className={fieldClass} />
              </Field>
              <Field label="Nom">
                <input value={teamCoachLastName} onChange={(e) => setTeamCoachLastName(e.target.value)} className={fieldClass} />
              </Field>
              <Field label="E-mail">
                <input type="email" value={teamCoachEmail} onChange={(e) => setTeamCoachEmail(e.target.value)} className={fieldClass} />
              </Field>
            </div>
          </div>
          {error && <p className="text-[12.5px] font-bold text-danger-fg">{error}</p>}
          {coachInviteWarning && <p className="text-[12.5px] font-bold text-warning-fg">{coachInviteWarning}</p>}
          {coachPrepare && <p className="text-[12.5px] font-bold text-success-fg">{coachPrepare}</p>}
          <div className="flex items-center gap-3">
            <Button className="h-9 px-4 text-[12.5px]" loading={saving} onClick={handleCreateTeam}>
              Créer l&apos;équipe
            </Button>
            <Button variant="secondary" className="h-9 px-4 text-[12.5px]" onClick={() => setShowTeamForm(false)}>
              Annuler
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Calendrier ──

function CalendrierCard({ clubId, canEdit, onSaved }: { clubId: string; canEdit: boolean; onSaved: () => void }) {
  // 08/09/2026, demande Fouka : « j'ai le calendrier de toutes les categories, c'est possible de
  // le mettre et que ce soit distribue et affecte automatiquement ? »
  //
  // Oui, et l'outil existait deja — sur la page Calendrier, pas ici. Cette etape ne permettait
  // d'ajouter les matchs QU'UN PAR UN : impensable pour un club qui en a plusieurs centaines
  // repartis sur six ou huit categories. On y branche le meme ecran, sans le dupliquer.
  const { ctx } = useSession();
  const [importOpen, setImportOpen] = useState(false);
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"match" | "event" | "training">("event");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [location, setLocation] = useState("");
  const [teamId, setTeamId] = useState("");
  const [saving, setSaving] = useState(false);
  // Meme correctif que les autres cartes : un echec d'ecriture ne doit pas se traduire par un
  // bouton qui arrete simplement de tourner.
  const [error, setError] = useState<string | null>(null);

  function reload() {
    const supabase = createClient();
    fetchClubCalendarEvents(supabase, clubId).then(setEvents).catch(() => setEvents([]));
    fetchClubTeams(supabase, clubId).then(setTeams).catch(() => setTeams([]));
  }
  useEffect(reload, [clubId]);

  async function handleCreate() {
    if (!title.trim() || !date) return;
    setSaving(true);
    setError(null);
    try {
      const team = teams.find((t) => t.id === teamId);
      await createClubCalendarEvent(createClient(), clubId, {
        title: title.trim(),
        kind,
        date,
        time: time || undefined,
        location: location.trim() || undefined,
        team: team?.name,
        teamId: team?.id,
      });
      setTitle("");
      setDate("");
      setTime("");
      setLocation("");
      setTeamId("");
      setShowForm(false);
      reload();
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible d'ajouter cet événement. Réessayez.");
    } finally {
      setSaving(false);
    }
  }

  const upcoming = (events ?? []).filter((e) => e.startsAt >= new Date().toISOString().slice(0, 10)).slice(0, 8);

  return (
    <Card className="flex flex-col gap-4 p-5">
      <SectionHeader title="Calendrier & événements" description="Matchs, tournois, stages, portes ouvertes — ce qui aide le CM à préparer le planning éditorial et la Production à organiser les présences terrain." />
      {upcoming.length === 0 && events !== null && <p className="text-[12.5px] text-text-soft">Aucun événement à venir renseigné.</p>}
      {upcoming.length > 0 && (
        <div className="flex flex-col divide-y divide-divider">
          {upcoming.map((e) => (
            <div key={e.id} className="flex flex-wrap items-center gap-3 py-2 first:pt-0 last:pb-0 text-[12.5px]">
              <span className="w-24 flex-none font-bold text-text">{e.startsAt.slice(0, 10)}</span>
              <span className="min-w-0 flex-1 truncate">{e.title}</span>
              {e.teamName && <span className="text-text-soft">{e.teamName}</span>}
              {e.location && <span className="text-text-soft">{e.location}</span>}
            </div>
          ))}
        </div>
      )}
      {canEdit && !showForm && (
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-2.5">
            {/* L'import d'abord : c'est le geste courant quand on part du calendrier de la saison.
                L'ajout a l'unite reste pour le match amical qui n'y figure pas. */}
            <Button className="h-10 px-4 text-[12.5px]" onClick={() => setImportOpen(true)}>
              Importer le calendrier des matchs
            </Button>
            <Button variant="secondary" className="h-10 px-4 text-[12.5px]" onClick={() => setShowForm(true)}>
              + Ajouter un événement
            </Button>
          </div>
          <p className="text-[11.5px] leading-relaxed text-text-soft">
            Un fichier Excel ou CSV de la saison suffit : SportVision reconnaît les colonnes,
            répartit les matchs par équipe et vous fait confirmer ceux dont il n&apos;est pas sûr.
          </p>
        </div>
      )}
      {importOpen && (
        <ImportMatchesModal
          clubId={clubId}
          userId={ctx.user.id}
          onClose={() => setImportOpen(false)}
          onImported={() => {
            reload();
            onSaved();
          }}
        />
      )}
      {canEdit && showForm && (
        <div className="flex flex-col gap-3 rounded-xl border border-border-strong p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Titre" full>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Tournoi de la Pentecôte" className={fieldClass} />
            </Field>
            <Field label="Type">
              <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className={fieldClass}>
                <option value="match">Match</option>
                <option value="training">Entraînement spécial</option>
                <option value="event">Tournoi / stage / événement</option>
              </select>
            </Field>
            <Field label="Date">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={fieldClass} />
            </Field>
            <Field label="Heure (facultatif)">
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={fieldClass} />
            </Field>
            <Field label="Lieu (facultatif)">
              <input value={location} onChange={(e) => setLocation(e.target.value)} className={fieldClass} />
            </Field>
            <Field label="Équipe (facultatif)" full>
              <select value={teamId} onChange={(e) => setTeamId(e.target.value)} className={fieldClass}>
                <option value="">Tout le club</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="flex items-center gap-3">
            <Button className="h-9 px-4 text-[12.5px]" loading={saving} onClick={handleCreate}>
              Ajouter
            </Button>
            {error && <p className="w-full text-[12px] font-bold text-danger-fg">{error}</p>}
            <Button variant="secondary" className="h-9 px-4 text-[12.5px]" onClick={() => setShowForm(false)}>
              Annuler
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Branding ──

function BrandingCard({
  clubId,
  logoUrl: initialLogoUrl,
  colors: initialColors,
  canEdit,
  onSaved,
}: {
  clubId: string;
  logoUrl: string | null;
  colors: [string, string];
  canEdit: boolean;
  onSaved: () => void;
}) {
  const router = useRouter();
  const [logoUrl, setLogoUrl] = useState(initialLogoUrl);
  const [colors, setColors] = useState(initialColors);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  // Cette carte n'affichait NI confirmation NI erreur : le bouton tournait une demi-seconde et
  // l'ecran restait identique, y compris quand l'ecriture avait reussi. C'est la cause reelle du
  // « ca n'enregistre pas » remonte le 09/09 sur Villemomble, ou les couleurs etaient bel et bien
  // en base. Un enregistrement silencieux est indistinguable d'un echec.
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogoChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    setSaved(false);
    setError(null);
    try {
      const url = await uploadClubLogo(createClient(), clubId, file);
      setLogoUrl(url);
      setSaved(true);
      onSaved();
      // Le logo est aussi lu depuis le contexte de session (barre laterale, en-tetes) : sans ce
      // refresh il restait l'ancien partout ailleurs jusqu'a un rechargement manuel.
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible d'envoyer ce logo. Réessayez.");
    } finally {
      setUploading(false);
    }
  }

  async function saveColors() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await updateClubOrganization(createClient(), clubId, { couleurPrimaire: colors[0], couleurSecondaire: colors[1] });
      setSaved(true);
      onSaved();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible d'enregistrer ces couleurs. Réessayez.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <SectionHeader title="Branding" description="Logo et couleurs officielles — utilisés automatiquement dans le Studio et vos créations." />
      <div className="flex items-center gap-4">
        <label className={cn("relative flex h-16 w-16 flex-none items-center justify-center overflow-hidden rounded-2xl border border-dashed border-border-strong bg-surface-alt", canEdit && "cursor-pointer")}>
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="Logo du club" className="h-full w-full object-cover" />
          ) : (
            <span className="text-[10px] text-text-faint">Logo</span>
          )}
          {canEdit && <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={handleLogoChange} disabled={uploading} />}
        </label>
        <div className="text-[12px] text-text-soft">{canEdit ? "PNG, JPEG, WebP ou SVG, 2 Mo maximum." : "Logo du club."}</div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {[0, 1].map((i) => (
          <div key={i} className="flex items-center gap-2">
            <label className="relative h-8 w-8 flex-none overflow-hidden rounded-full border border-white/20" style={{ backgroundColor: colors[i] }}>
              {canEdit && (
                <input
                  type="color"
                  value={colors[i]}
                  onChange={(e) => setColors((prev) => [i === 0 ? e.target.value : prev[0], i === 1 ? e.target.value : prev[1]] as [string, string])}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
              )}
            </label>
            <span className="text-[12px] text-text-soft">{i === 0 ? "Principale" : "Secondaire"}</span>
          </div>
        ))}
      </div>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <Button className="h-9 px-4 text-[12.5px]" loading={saving} onClick={saveColors}>
            Enregistrer les couleurs
          </Button>
          {saved && <span className="text-[12px] font-bold text-success-fg">Enregistré.</span>}
          {error && <span className="text-[12px] font-bold text-danger-fg">{error}</span>}
        </div>
      )}
    </Card>
  );
}

// ── Sponsors ──

function SponsorsCard({ clubId, canEdit, onSaved }: { clubId: string; canEdit: boolean; onSaved: () => void }) {
  const [sponsors, setSponsors] = useState<Sponsor[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [niveau, setNiveau] = useState<"Or" | "Argent" | "Bronze">("Bronze");
  const [saving, setSaving] = useState(false);
  const [logoUploadingId, setLogoUploadingId] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  function reload() {
    fetchClubSponsors(createClient(), clubId).then(setSponsors).catch(() => setSponsors([]));
  }
  useEffect(reload, [clubId]);

  async function handleCreate() {
    if (!name.trim()) return;
    setSaving(true);
    setCreateError(null);
    try {
      await createClubSponsor(createClient(), clubId, { name: name.trim(), niveau });
      setName("");
      setShowForm(false);
      reload();
      onSaved();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Impossible d'ajouter ce sponsor. Réessayez.");
    } finally {
      setSaving(false);
    }
  }

  async function handleLogoChange(sponsorId: string, event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setLogoUploadingId(sponsorId);
    setLogoError(null);
    try {
      await uploadSponsorLogo(createClient(), clubId, sponsorId, file);
      reload();
      onSaved();
    } catch (e) {
      setLogoError(e instanceof Error ? e.message : "Impossible d'envoyer ce logo.");
    } finally {
      setLogoUploadingId(null);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <SectionHeader title="Sponsors" description="Logos et noms des partenaires actuels du club — modifiables plus en détail depuis Sponsors." />
      {(sponsors ?? []).length === 0 && sponsors !== null && <p className="text-[12.5px] text-text-soft">Aucun sponsor renseigné.</p>}
      {logoError && <p className="text-[12.5px] font-bold text-danger-fg">{logoError}</p>}
      {createError && <p className="text-[12.5px] font-bold text-danger-fg">{createError}</p>}
      {(sponsors ?? []).length > 0 && (
        <div className="flex flex-col divide-y divide-divider">
          {(sponsors ?? []).map((s) => (
            <div key={s.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <div className="flex h-10 w-10 flex-none items-center justify-center overflow-hidden rounded-lg border border-border-strong bg-surface-muted">
                {s.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.logoUrl} alt={s.name} className="h-full w-full object-contain" />
                ) : (
                  <span className="text-[10px] font-bold text-text-faint">Logo</span>
                )}
              </div>
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-text">{s.name}</span>
              {canEdit && (
                <label className="cursor-pointer text-[12px] font-bold text-accent hover:underline">
                  {logoUploadingId === s.id ? "Envoi…" : s.logoUrl ? "Changer le logo" : "Ajouter un logo"}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    className="hidden"
                    disabled={logoUploadingId !== null}
                    onChange={(e) => handleLogoChange(s.id, e)}
                  />
                </label>
              )}
            </div>
          ))}
        </div>
      )}
      {canEdit && !showForm && (
        <Button variant="secondary" className="h-9 self-start px-4 text-[12.5px]" onClick={() => setShowForm(true)}>
          + Ajouter un sponsor
        </Button>
      )}
      {canEdit && showForm && (
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border-strong p-3.5">
          <Field label="Nom">
            <input value={name} onChange={(e) => setName(e.target.value)} className={cn(fieldClass, "h-9 w-56")} />
          </Field>
          <Field label="Niveau">
            <select value={niveau} onChange={(e) => setNiveau(e.target.value as typeof niveau)} className={cn(fieldClass, "h-9 w-32")}>
              <option value="Or">Or</option>
              <option value="Argent">Argent</option>
              <option value="Bronze">Bronze</option>
            </select>
          </Field>
          <Button className="h-9 px-3 text-[12px]" loading={saving} onClick={handleCreate}>
            Ajouter
          </Button>
          <Button variant="secondary" className="h-9 px-3 text-[12px]" onClick={() => setShowForm(false)}>
            Annuler
          </Button>
        </div>
      )}
    </Card>
  );
}

// ── Communication ──

function CommunicationCard({ clubId, canEdit, onSaved }: { clubId: string; canEdit: boolean; onSaved: () => void }) {
  const [accounts, setAccounts] = useState<ClubSocialAccount[]>([]);
  const [platform, setPlatform] = useState<SocialPlatform>("instagram");
  const [handle, setHandle] = useState("");
  const [acces, setAcces] = useState(false);
  const [objectifs, setObjectifs] = useState<string[]>([]);
  const [ton, setTon] = useState<string | null>(null);
  const [sujetsSensibles, setSujetsSensibles] = useState("");
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [prefsSaved, setPrefsSaved] = useState(false);
  const [prefsError, setPrefsError] = useState<string | null>(null);
  const [accountSaving, setAccountSaving] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);

  async function reload() {
    const supabase = createClient();
    const [a, prefs] = await Promise.all([fetchClubSocialAccounts(supabase, clubId), fetchClubCommunicationPrefs(supabase, clubId)]);
    setAccounts(a);
    setObjectifs(prefs.objectifsCommunication);
    setTon(prefs.tonCommunication);
    setSujetsSensibles(prefs.sujetsSensibles ?? "");
  }
  useEffect(() => {
    reload().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubId]);

  async function handleAddAccount() {
    if (!handle.trim()) return;
    setAccountSaving(true);
    setAccountError(null);
    try {
      await createClubSocialAccount(createClient(), clubId, { plateforme: platform, handleOuUrl: handle.trim(), accesSportvision: acces });
      setHandle("");
      setAcces(false);
      await reload();
      onSaved();
    } catch (e) {
      setAccountError(e instanceof Error ? e.message : "Impossible d'ajouter ce compte. Réessayez.");
    } finally {
      setAccountSaving(false);
    }
  }

  async function handleRemoveAccount(id: string) {
    try {
      await deleteClubSocialAccount(createClient(), id);
      await reload();
    } catch {
      setAccountError("Impossible de retirer ce compte. Réessayez.");
    }
  }

  function toggleObjectif(value: string) {
    setObjectifs((prev) => (prev.includes(value) ? prev.filter((o) => o !== value) : [...prev, value]));
  }

  async function savePrefs() {
    setSavingPrefs(true);
    setPrefsSaved(false);
    setPrefsError(null);
    try {
      await updateClubCommunicationPrefs(createClient(), clubId, { objectifsCommunication: objectifs, tonCommunication: ton, sujetsSensibles });
      setPrefsSaved(true);
      onSaved();
    } catch (e) {
      setPrefsError(e instanceof Error ? e.message : "Impossible d'enregistrer ces préférences. Réessayez.");
    } finally {
      setSavingPrefs(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <SectionHeader title="Communication" description="Réseaux sociaux, objectifs et ton — jamais de mot de passe demandé ici." />
      <p className="-mt-2 text-[11.5px] text-text-faint">
        Cette section est comptée comme complétée dès qu&apos;un compte réseau social et au moins un objectif sont renseignés.
      </p>

      <div className="flex flex-col gap-2">
        {accounts.map((a) => (
          <div key={a.id} className="flex items-center gap-2 text-[12.5px]">
            <span className="w-20 flex-none font-bold capitalize text-text">{a.plateforme}</span>
            <span className="min-w-0 flex-1 truncate text-text-soft">{a.handleOuUrl}</span>
            {a.accesSportvision ? <Badge tone="success">Accès SportVision ✓</Badge> : <Badge tone="warning">Accès à donner</Badge>}
            {canEdit && (
              <button type="button" onClick={() => handleRemoveAccount(a.id)} className="text-danger-fg hover:underline">
                Retirer
              </button>
            )}
          </div>
        ))}
        {accounts.length === 0 && <p className="text-[12.5px] text-text-soft">Aucun compte renseigné.</p>}
      </div>

      {canEdit && (
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border-strong p-3.5">
          <Field label="Plateforme">
            <select value={platform} onChange={(e) => setPlatform(e.target.value as SocialPlatform)} className={cn(fieldClass, "h-9 w-32")}>
              <option value="instagram">Instagram</option>
              <option value="tiktok">TikTok</option>
              <option value="facebook">Facebook</option>
              <option value="linkedin">LinkedIn</option>
              <option value="youtube">YouTube</option>
              <option value="autre">Autre</option>
            </select>
          </Field>
          <Field label="Compte (@ ou lien)">
            <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@monclub" className={cn(fieldClass, "h-9 w-48")} />
          </Field>
          <label className="flex h-9 items-center gap-2 text-[12px] text-text-soft">
            <input type="checkbox" checked={acces} onChange={(e) => setAcces(e.target.checked)} />
            SportVision a déjà un accès administrateur
          </label>
          <Button className="h-9 px-3 text-[12px]" loading={accountSaving} onClick={handleAddAccount}>
            Ajouter
          </Button>
          {accountError && <p className="w-full text-[12px] font-bold text-danger-fg">{accountError}</p>}
        </div>
      )}
      <p className="text-[11.5px] text-text-faint">Pour des raisons de sécurité, ne renseignez jamais votre mot de passe ici — utilisez une invitation administrateur depuis la plateforme concernée.</p>

      <div className="border-t border-divider pt-4">
        <div className="mb-2 text-[12.5px] font-bold text-text-soft">Objectifs prioritaires</div>
        <div className="flex flex-wrap gap-2">
          {OBJECTIFS_COMMUNICATION_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              disabled={!canEdit}
              onClick={() => toggleObjectif(o.value)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors",
                objectifs.includes(o.value) ? "border-brand-blue-electric bg-info-bg text-brand-blue-electric" : "border-border-strong text-text-soft",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <Field label="Ton de communication souhaité">
        <select value={ton ?? ""} onChange={(e) => setTon(e.target.value || null)} disabled={!canEdit} className={fieldClass}>
          <option value="">Non précisé</option>
          {TON_COMMUNICATION_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Points d'attention (facultatif)">
        <textarea
          value={sujetsSensibles}
          onChange={(e) => setSujetsSensibles(e.target.value)}
          disabled={!canEdit}
          rows={3}
          placeholder="Ex. ne pas annoncer de mouvement de joueur avant validation interne du club..."
          className="rounded-xl border border-border-strong bg-input-bg p-3.5 text-[13.5px] outline-none focus-visible:border-brand-blue"
        />
      </Field>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <Button className="h-9 px-4 text-[12.5px]" loading={savingPrefs} onClick={savePrefs}>
            Enregistrer
          </Button>
          {prefsSaved && <span className="text-[12px] font-bold text-success-fg">Enregistré.</span>}
          {prefsError && <span className="text-[12px] font-bold text-danger-fg">{prefsError}</span>}
        </div>
      )}
    </Card>
  );
}

// ── Droit à l'image ──

function DroitImageCard({ clubId, canEdit, onSaved }: { clubId: string; canEdit: boolean; onSaved: () => void }) {
  const [mode, setMode] = useState<DroitImageMode | null>(null);
  const [licenciesExclus, setLicenciesExclus] = useState(false);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchClubImageRights(createClient(), clubId).then((r) => {
      setMode(r.mode);
      setLicenciesExclus(r.licenciesExclus);
      setNotes(r.notes ?? "");
    });
  }, [clubId]);

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await updateClubImageRights(createClient(), clubId, { mode, licenciesExclus, notes });
      setSaved(true);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible d'enregistrer ces informations. Réessayez.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <SectionHeader title="Droit à l'image" description="Notes internes, jamais publiées — visibles uniquement par SportVision et l'administrateur du club." />
      <Field label="Fonctionnement actuel du club">
        <select value={mode ?? ""} onChange={(e) => setMode((e.target.value || null) as DroitImageMode | null)} disabled={!canEdit} className={fieldClass}>
          <option value="">Non précisé</option>
          {Object.entries(DROIT_IMAGE_MODE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <label className="flex items-center gap-2 text-[12.5px] text-text-soft">
        <input type="checkbox" checked={licenciesExclus} onChange={(e) => setLicenciesExclus(e.target.checked)} disabled={!canEdit} />
        Certains licenciés ne doivent pas apparaître dans les contenus publiés
      </label>
      {licenciesExclus && (
        <Field label="Notes (jamais publiées)">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={!canEdit}
            rows={3}
            placeholder="Précisez ici les informations utiles pour SportVision uniquement."
            className="rounded-xl border border-border-strong bg-input-bg p-3.5 text-[13.5px] outline-none focus-visible:border-brand-blue"
          />
        </Field>
      )}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <Button className="h-9 px-4 text-[12.5px]" loading={saving} onClick={save}>
            Enregistrer
          </Button>
          {saved && <span className="text-[12px] font-bold text-success-fg">Enregistré.</span>}
          {error && <span className="text-[12px] font-bold text-danger-fg">{error}</span>}
        </div>
      )}
    </Card>
  );
}
