"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "@/lib/session-context";
import { cn } from "@/lib/cn";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { updateClubOrganization, uploadClubLogo } from "@/lib/data/club/organization";
import { fetchClubMembers, inviteClubMember } from "@/lib/data/club/users";
import { ROLE_LABELS, type OrgUser } from "@/lib/types/settings";
import { fetchClubTeams, createClubTeam } from "@/lib/data/club/teams";
import { fetchClubSponsors, createClubSponsor } from "@/lib/data/club/sponsors";
import { fetchClubCalendarEvents, createClubCalendarEvent } from "@/lib/data/club/calendar";
import type { Team } from "@/lib/types/teams";
import type { Sponsor } from "@/lib/types/sponsors";
import type { CalendarEvent } from "@/lib/types/calendar";
import type { MembershipRole } from "@/lib/types";
import {
  fetchOnboardingCompletion,
  fetchOnboardingProgress,
  ensureOnboardingStarted,
  submitOnboarding,
  fetchClubVenues,
  createClubVenue,
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
  const { organization, membership } = ctx;
  const canEdit = organization.type === "club" && membership.role === "admin";

  const [completion, setCompletion] = useState<OnboardingCompletion | null>(null);
  const [statut, setStatut] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function refreshCompletion() {
    const supabase = createClient();
    const [c, p] = await Promise.all([
      fetchOnboardingCompletion(supabase, organization.id),
      fetchOnboardingProgress(supabase, organization.id),
    ]);
    setCompletion(c);
    setStatut(p?.statut ?? "not_started");
  }

  useEffect(() => {
    if (organization.type !== "club") return;
    const supabase = createClient();
    ensureOnboardingStarted(supabase, organization.id)
      .catch(() => {})
      .finally(() => refreshCompletion().catch(() => {}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization.id]);

  if (organization.type !== "club") {
    return (
      <Card className="p-8 text-center text-[13.5px] text-text-soft">
        L&apos;onboarding SportVision concerne uniquement l&apos;espace club.
      </Card>
    );
  }

  async function handleSubmit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await submitOnboarding(createClient(), organization.id);
      await refreshCompletion();
    } catch {
      setSubmitError("Impossible d'envoyer pour le moment. Réessayez.");
    } finally {
      setSubmitting(false);
    }
  }

  const sections: { key: keyof OnboardingCompletion; label: string }[] = [
    { key: "identite", label: "Identité" },
    { key: "responsables", label: "Responsables" },
    { key: "equipes", label: "Équipes" },
    { key: "entrainements", label: "Entraînements" },
    { key: "calendrier", label: "Calendrier" },
    { key: "branding", label: "Branding" },
    { key: "sponsors", label: "Sponsors" },
    { key: "communication", label: "Communication" },
    { key: "droit_image", label: "Droit à l'image" },
  ];

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <Card className="flex flex-col gap-3.5 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[15px] font-extrabold">Onboarding SportVision</div>
            <p className="mt-0.5 text-[12.5px] text-text-soft">
              Les informations ci-dessous alimentent directement SportVision OS — rien à renvoyer par e-mail ou WhatsApp.
            </p>
          </div>
          {statut === "validated" && <Badge tone="success">Validé</Badge>}
          {statut === "submitted" && <Badge tone="info">Envoyé, en vérification</Badge>}
          {statut === "needs_information" && <Badge tone="warning">Informations manquantes</Badge>}
        </div>
        {completion && (
          <>
            <div className="h-2 overflow-hidden rounded-full bg-surface-sunken">
              <div
                className="h-full rounded-full bg-gradient-to-r from-brand-cyan to-brand-violet transition-[width] duration-300"
                style={{ width: `${completion.pourcentage}%` }}
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {sections.map((s) => {
                const done = Boolean(completion[s.key]);
                return (
                  <span
                    key={s.key}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold",
                      done ? "bg-success-bg text-success-fg" : "bg-surface-sunken text-text-faint",
                    )}
                  >
                    {done ? "✓" : "○"} {s.label}
                  </span>
                );
              })}
            </div>
            <div className="text-[12px] text-text-soft">
              {completion.sections_completees} sur {completion.sections_total} sections complétées ({completion.pourcentage}%)
            </div>
          </>
        )}
      </Card>

      <IdentiteCard clubId={organization.id} address={organization.address ?? ""} siret={organization.siret ?? ""} canEdit={canEdit} onSaved={refreshCompletion} />
      <ResponsablesCard clubId={organization.id} canEdit={canEdit} onSaved={refreshCompletion} />
      <EquipesCard clubId={organization.id} canEdit={canEdit} onSaved={refreshCompletion} />
      <CalendrierCard clubId={organization.id} canEdit={canEdit} onSaved={refreshCompletion} />
      <BrandingCard
        clubId={organization.id}
        logoUrl={organization.logoUrl ?? null}
        colors={[organization.brandColors?.[0] ?? "#4F7DFF", organization.brandColors?.[1] ?? "#A855F7"]}
        canEdit={canEdit}
        onSaved={refreshCompletion}
      />
      <SponsorsCard clubId={organization.id} canEdit={canEdit} onSaved={refreshCompletion} />
      <CommunicationCard clubId={organization.id} canEdit={canEdit} onSaved={refreshCompletion} />
      <DroitImageCard clubId={organization.id} canEdit={canEdit} onSaved={refreshCompletion} />

      {canEdit && (
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
  );
}

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
  canEdit,
  onSaved,
}: {
  clubId: string;
  address: string;
  siret: string;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [adresse, setAdresse] = useState(address);
  const [siretVal, setSiretVal] = useState(siret);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      await updateClubOrganization(createClient(), clubId, { adresse, siret: siretVal });
      setSaved(true);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <SectionHeader title="1. Identité du club" description="Nom, ville et discipline : contactez votre conseiller SportVision pour les corriger." />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Adresse" full>
          <input value={adresse} onChange={(e) => setAdresse(e.target.value)} disabled={!canEdit} placeholder="Non renseignée" className={fieldClass} />
        </Field>
        <Field label="SIRET (si association)">
          <input value={siretVal} onChange={(e) => setSiretVal(e.target.value)} disabled={!canEdit} placeholder="Non renseigné" className={fieldClass} />
        </Field>
      </div>
      {canEdit && (
        <div className="flex items-center gap-3">
          <Button className="h-9 px-4 text-[12.5px]" loading={saving} onClick={save}>
            Enregistrer
          </Button>
          {saved && <span className="text-[12px] font-bold text-success-fg">Enregistré.</span>}
        </div>
      )}
    </Card>
  );
}

// ── Responsables ──

const CLUB_INVITE_ROLES: MembershipRole[] = [
  "president",
  "secretary",
  "treasurer",
  "sports_director",
  "communication_manager",
  "team_manager",
  "board_member",
  "admin_staff",
];

function ResponsablesCard({ clubId, canEdit, onSaved }: { clubId: string; canEdit: boolean; onSaved: () => void }) {
  const [members, setMembers] = useState<OrgUser[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [role, setRole] = useState<MembershipRole>("president");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    fetchClubMembers(createClient(), clubId).then(setMembers).catch(() => setMembers([]));
  }
  useEffect(reload, [clubId]);

  async function handleInvite() {
    if (!email.trim() || !firstName.trim() || !lastName.trim()) {
      setError("Prénom, nom et e-mail sont obligatoires.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      await inviteClubMember(createClient(), clubId, { email: email.trim(), firstName: firstName.trim(), lastName: lastName.trim(), role });
      setEmail("");
      setFirstName("");
      setLastName("");
      setShowForm(false);
      reload();
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible d'envoyer l'invitation.");
    } finally {
      setSending(false);
    }
  }

  const active = (members ?? []).filter((m) => m.status !== "disabled");

  return (
    <Card className="flex flex-col gap-4 p-5">
      <SectionHeader title="2. Responsables" description="Président, secrétaire, trésorier, directeur sportif, communication... Chacun reçoit un accès Club+ à son niveau." />
      {active.length === 0 && members !== null && <p className="text-[12.5px] text-text-soft">Aucun responsable renseigné pour le moment.</p>}
      {active.length > 0 && (
        <div className="flex flex-col divide-y divide-divider">
          {active.map((m) => (
            <div key={m.membershipId} className="flex flex-wrap items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <span className="w-40 flex-none text-[12.5px] font-bold text-text">{ROLE_LABELS[m.role] ?? m.role}</span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-text">
                {m.firstName || m.lastName ? `${m.firstName} ${m.lastName}`.trim() : "—"}
              </span>
              <span className="flex-none text-[12.5px] text-text-soft">{m.phone || "—"}</span>
              {m.status === "invited" && <Badge tone="warning">Invitation envoyée</Badge>}
            </div>
          ))}
        </div>
      )}
      {canEdit && !showForm && (
        <Button variant="secondary" className="h-9 self-start px-4 text-[12.5px]" onClick={() => setShowForm(true)}>
          + Ajouter un responsable
        </Button>
      )}
      {canEdit && showForm && (
        <div className="flex flex-col gap-3 rounded-xl border border-border-strong p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Prénom">
              <input value={firstName} onChange={(e) => setFirstName(e.target.value)} className={fieldClass} />
            </Field>
            <Field label="Nom">
              <input value={lastName} onChange={(e) => setLastName(e.target.value)} className={fieldClass} />
            </Field>
            <Field label="E-mail" full>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={fieldClass} />
            </Field>
            <Field label="Fonction" full>
              <select value={role} onChange={(e) => setRole(e.target.value as MembershipRole)} className={fieldClass}>
                {CLUB_INVITE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r] ?? r}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {error && <p className="text-[12.5px] font-bold text-danger-fg">{error}</p>}
          <div className="flex items-center gap-3">
            <Button className="h-9 px-4 text-[12.5px]" loading={sending} onClick={handleInvite}>
              Envoyer l&apos;invitation
            </Button>
            <Button variant="secondary" className="h-9 px-4 text-[12.5px]" onClick={() => setShowForm(false)}>
              Annuler
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Équipes + entraînements ──

function EquipesCard({ clubId, canEdit, onSaved }: { clubId: string; canEdit: boolean; onSaved: () => void }) {
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [venues, setVenues] = useState<ClubVenue[] | null>(null);
  const [slots, setSlots] = useState<TrainingSlot[]>([]);
  const [showTeamForm, setShowTeamForm] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [teamCategorie, setTeamCategorie] = useState("");
  const [teamCoach, setTeamCoach] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showVenueForm, setShowVenueForm] = useState(false);
  const [venueName, setVenueName] = useState("");
  const [venueVille, setVenueVille] = useState("");
  const [slotForm, setSlotForm] = useState<{ teamId: string; jour: string; heureDebut: string; heureFin: string; venueId: string } | null>(null);

  async function reload() {
    const supabase = createClient();
    const [t, v] = await Promise.all([fetchClubTeams(supabase, clubId), fetchClubVenues(supabase, clubId)]);
    setTeams(t);
    setVenues(v);
    setSlots(await fetchTrainingSlotsForClub(supabase, t.map((x) => x.id)));
  }
  useEffect(() => {
    reload().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubId]);

  async function handleCreateTeam() {
    if (!teamName.trim()) {
      setError("Le nom de l'équipe est obligatoire.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createClubTeam(createClient(), clubId, { name: teamName.trim(), categorie: teamCategorie.trim() || undefined, coach: teamCoach.trim() || undefined });
      setTeamName("");
      setTeamCategorie("");
      setTeamCoach("");
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
    await createClubVenue(createClient(), clubId, { nom: venueName.trim(), ville: venueVille.trim() || undefined });
    setVenueName("");
    setVenueVille("");
    setShowVenueForm(false);
    await reload();
  }

  async function handleCreateSlot() {
    if (!slotForm || !slotForm.heureDebut) return;
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
  }

  async function handleDeleteSlot(id: string) {
    await deleteTrainingSlot(createClient(), id);
    await reload();
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <SectionHeader title="3. Équipes & entraînements" description="Une équipe créée ici est réutilisée telle quelle par la Production, la Communication et Connect." />

      {(teams ?? []).length === 0 && teams !== null && <p className="text-[12.5px] text-text-soft">Aucune équipe renseignée.</p>}

      <div className="flex flex-col gap-3">
        {(teams ?? []).map((team) => {
          const teamSlots = slots.filter((s) => s.teamId === team.id).sort((a, b) => JOURS_ORDER.indexOf(a.jour as never) - JOURS_ORDER.indexOf(b.jour as never));
          return (
            <div key={team.id} className="rounded-xl border border-border-strong p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-[13.5px] font-extrabold">{team.name}</span>
                  {team.category !== "—" && <span className="ml-2 text-[11.5px] text-text-soft">{team.category}</span>}
                </div>
                {canEdit && (
                  <Button
                    variant="tertiary"
                    className="h-7 px-2 text-[11.5px]"
                    onClick={() => setSlotForm({ teamId: team.id, jour: "mardi", heureDebut: "", heureFin: "", venueId: "" })}
                  >
                    + Créneau d&apos;entraînement
                  </Button>
                )}
              </div>
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
                  <Button className="h-9 px-3 text-[12px]" onClick={handleCreateSlot}>
                    Ajouter
                  </Button>
                  <Button variant="secondary" className="h-9 px-3 text-[12px]" onClick={() => setSlotForm(null)}>
                    Annuler
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {canEdit && (venues ?? []).length === 0 && !showVenueForm && (
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
          <Button className="h-9 px-3 text-[12px]" onClick={handleCreateVenue}>
            Ajouter
          </Button>
        </div>
      )}

      {canEdit && !showTeamForm && (
        <Button variant="secondary" className="h-9 self-start px-4 text-[12.5px]" onClick={() => setShowTeamForm(true)}>
          + Ajouter une équipe
        </Button>
      )}
      {canEdit && showTeamForm && (
        <div className="flex flex-col gap-3 rounded-xl border border-border-strong p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Nom" full>
              <input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="U15 R1" className={fieldClass} />
            </Field>
            <Field label="Catégorie">
              <input value={teamCategorie} onChange={(e) => setTeamCategorie(e.target.value)} placeholder="U15" className={fieldClass} />
            </Field>
            <Field label="Coach">
              <input value={teamCoach} onChange={(e) => setTeamCoach(e.target.value)} className={fieldClass} />
            </Field>
          </div>
          {error && <p className="text-[12.5px] font-bold text-danger-fg">{error}</p>}
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
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"match" | "event" | "training">("event");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [location, setLocation] = useState("");
  const [saving, setSaving] = useState(false);

  function reload() {
    fetchClubCalendarEvents(createClient(), clubId).then(setEvents).catch(() => setEvents([]));
  }
  useEffect(reload, [clubId]);

  async function handleCreate() {
    if (!title.trim() || !date) return;
    setSaving(true);
    try {
      await createClubCalendarEvent(createClient(), clubId, { title: title.trim(), kind, date, time: time || undefined, location: location.trim() || undefined });
      setTitle("");
      setDate("");
      setTime("");
      setLocation("");
      setShowForm(false);
      reload();
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  const upcoming = (events ?? []).filter((e) => e.startsAt >= new Date().toISOString().slice(0, 10)).slice(0, 8);

  return (
    <Card className="flex flex-col gap-4 p-5">
      <SectionHeader title="4. Calendrier & événements" description="Matchs, tournois, stages, portes ouvertes — ce qui aide le CM à préparer le planning éditorial et la Production à organiser les présences terrain." />
      {upcoming.length === 0 && events !== null && <p className="text-[12.5px] text-text-soft">Aucun événement à venir renseigné.</p>}
      {upcoming.length > 0 && (
        <div className="flex flex-col divide-y divide-divider">
          {upcoming.map((e) => (
            <div key={e.id} className="flex flex-wrap items-center gap-3 py-2 first:pt-0 last:pb-0 text-[12.5px]">
              <span className="w-24 flex-none font-bold text-text">{e.startsAt.slice(0, 10)}</span>
              <span className="min-w-0 flex-1 truncate">{e.title}</span>
              {e.location && <span className="text-text-soft">{e.location}</span>}
            </div>
          ))}
        </div>
      )}
      {canEdit && !showForm && (
        <Button variant="secondary" className="h-9 self-start px-4 text-[12.5px]" onClick={() => setShowForm(true)}>
          + Ajouter un événement
        </Button>
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
          </div>
          <div className="flex items-center gap-3">
            <Button className="h-9 px-4 text-[12.5px]" loading={saving} onClick={handleCreate}>
              Ajouter
            </Button>
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
  const [logoUrl, setLogoUrl] = useState(initialLogoUrl);
  const [colors, setColors] = useState(initialColors);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleLogoChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadClubLogo(createClient(), clubId, file);
      setLogoUrl(url);
      onSaved();
    } catch {
      // erreur déjà loggée par uploadClubLogo, formulaire déjà lisible sans message dédié ici
    } finally {
      setUploading(false);
    }
  }

  async function saveColors() {
    setSaving(true);
    try {
      await updateClubOrganization(createClient(), clubId, { couleurPrimaire: colors[0], couleurSecondaire: colors[1] });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <SectionHeader title="5. Branding" description="Logo et couleurs officielles — utilisés automatiquement dans le Studio et vos créations." />
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
        <Button className="h-9 self-start px-4 text-[12.5px]" loading={saving} onClick={saveColors}>
          Enregistrer les couleurs
        </Button>
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

  function reload() {
    fetchClubSponsors(createClient(), clubId).then(setSponsors).catch(() => setSponsors([]));
  }
  useEffect(reload, [clubId]);

  async function handleCreate() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await createClubSponsor(createClient(), clubId, { name: name.trim(), niveau });
      setName("");
      setShowForm(false);
      reload();
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <SectionHeader title="6. Sponsors" description="Logos et noms des partenaires actuels du club — modifiables plus en détail depuis Sponsors." />
      {(sponsors ?? []).length === 0 && sponsors !== null && <p className="text-[12.5px] text-text-soft">Aucun sponsor renseigné.</p>}
      {(sponsors ?? []).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {(sponsors ?? []).map((s) => (
            <span key={s.id} className="rounded-full border border-border-strong px-3 py-1.5 text-[12px] font-semibold">
              {s.name}
            </span>
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
    await createClubSocialAccount(createClient(), clubId, { plateforme: platform, handleOuUrl: handle.trim(), accesSportvision: acces });
    setHandle("");
    setAcces(false);
    await reload();
    onSaved();
  }

  async function handleRemoveAccount(id: string) {
    await deleteClubSocialAccount(createClient(), id);
    await reload();
  }

  function toggleObjectif(value: string) {
    setObjectifs((prev) => (prev.includes(value) ? prev.filter((o) => o !== value) : [...prev, value]));
  }

  async function savePrefs() {
    setSavingPrefs(true);
    try {
      await updateClubCommunicationPrefs(createClient(), clubId, { objectifsCommunication: objectifs, tonCommunication: ton, sujetsSensibles });
      onSaved();
    } finally {
      setSavingPrefs(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <SectionHeader title="7. Communication" description="Réseaux sociaux, objectifs et ton — jamais de mot de passe demandé ici." />

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
          <Button className="h-9 px-3 text-[12px]" onClick={handleAddAccount}>
            Ajouter
          </Button>
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
        <Button className="h-9 self-start px-4 text-[12.5px]" loading={savingPrefs} onClick={savePrefs}>
          Enregistrer
        </Button>
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

  useEffect(() => {
    fetchClubImageRights(createClient(), clubId).then((r) => {
      setMode(r.mode);
      setLicenciesExclus(r.licenciesExclus);
      setNotes(r.notes ?? "");
    });
  }, [clubId]);

  async function save() {
    setSaving(true);
    try {
      await updateClubImageRights(createClient(), clubId, { mode, licenciesExclus, notes });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <SectionHeader title="8. Droit à l'image" description="Notes internes, jamais publiées — visibles uniquement par SportVision et l'administrateur du club." />
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
        <Button className="h-9 self-start px-4 text-[12.5px]" loading={saving} onClick={save}>
          Enregistrer
        </Button>
      )}
    </Card>
  );
}
