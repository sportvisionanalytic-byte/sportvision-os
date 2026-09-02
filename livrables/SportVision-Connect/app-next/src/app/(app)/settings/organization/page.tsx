"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ImagePlus, Loader2 } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess, isClubNonBureauRole } from "@/lib/permissions";
import { cn } from "@/lib/cn";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { LockedModule } from "@/components/ui/LockedModule";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonRow } from "@/components/ui/Skeleton";
import { createClient } from "@/lib/supabase/client";
import { updateClubOrganization, uploadClubLogo } from "@/lib/data/club/organization";
import { fetchClubMembers } from "@/lib/data/club/users";
import { ROLE_LABELS, type OrgUser } from "@/lib/types/settings";

// /settings/organization — voir ACTIONS.md § 25 « Organisation ». Logo, nom, adresse, Instagram,
// SIRET, couleurs du club.
//
// 19/08/2026 (audit pré-lancement) : intégralement en lecture seule jusqu'ici faute de colonnes
// réelles et de bucket Storage pour le logo — voir migration-clubplus-v46-organisation-editable.sql
// et migration-clubplus-v47-club-logo-storage.sql. Le nom du club reste en lecture seule (pas de
// colonne clubs.nom éditable dans cette migration ni de policy dédiée : organizations.nom, source
// affichée ici, est une table distincte hors périmètre de ce chantier).
export default function OrganizationSettingsPage() {
  const { ctx } = useSession();

  if (!canAccess(ctx, "settings")) return <LockedModule title="Paramètres" />;

  // Espace personnel (Joueur/Famille) : pas de vraie organisation derrière (organization.name
  // reprend le nom de la personne, voir buildPlayerActiveContext/buildParentActiveContext). Cet
  // onglet est déjà masqué depuis settings/layout.tsx dans ce cas — ce garde-fou couvre un accès
  // direct par URL ou retour navigateur, pour ne jamais afficher un formulaire club (SIRET,
  // couleurs du club) au nom d'un joueur ou d'un parent.
  if (ctx.organization.type === "player" || ctx.organization.type === "parent") {
    return (
      <Card className="p-8 text-center text-[13.5px] text-text-soft">
        Cet espace personnel n&apos;a pas d&apos;organisation associée.
      </Card>
    );
  }

  // §31 : Communication/Coach/Secrétaire/Trésorier/Directeur sportif n'ont "pas d'onglet
  // organisation complet par défaut" — déjà masqué dans settings/layout.tsx (isClubNonBureauRole),
  // même garde-fou pour un accès direct par URL. Administratif fait exception (Bible §10 :
  // "informations structure" listée explicitement dans son périmètre) mais reste en LECTURE SEULE
  // (voir canEdit plus bas) — seul role==="admin" peut écrire, cohérent avec clubs_admin_update
  // (RLS, USING is_club_admin(id)) qui rejetterait de toute façon une tentative d'un autre rôle.
  if (isClubNonBureauRole(ctx) && ctx.membership.role !== "admin_staff") {
    return (
      <Card className="p-8 text-center text-[13.5px] text-text-soft">
        Les informations de l&apos;organisation sont réservées à l&apos;administrateur du club.
      </Card>
    );
  }

  return <OrganizationForm />;
}

function OrganizationForm() {
  const { ctx } = useSession();
  const { organization } = ctx;
  // updateClubOrganization (data/club/organization.ts) n'écrit QUE dans `clubs` (adresse,
  // instagram_handle, siret, couleurs) — une table qui n'a de ligne que pour organization.type
  // ==="club" (coach/académie/sponsor/agence CM/tournoi/stage vivent uniquement dans
  // `organizations`, sans ces colonnes). Écriture donc réellement impossible hors club, quel que
  // soit le rôle : `role === "admin"` reste le bon test pour un club (seul rôle réel autorisé par
  // clubs_admin_update, RLS), mais pour tout autre type d'organisation canEdit doit rester false
  // — jamais dérivé du rôle, qui n'a de toute façon aucun équivalent "admin" littéral pour un
  // coach/une agence CM (rôle réel "owner") ou un tournoi/stage ("event_admin", voir mappers.ts).
  const canEdit = ctx.organization.type === "club" && ctx.membership.role === "admin";
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [address, setAddress] = useState(organization.address ?? "");
  const [instagram, setInstagram] = useState(organization.instagramHandle ?? "");
  const [siret, setSiret] = useState(organization.siret ?? "");
  const [colors, setColors] = useState(organization.brandColors ?? ["#4F7DFF", "#A855F7"]);
  const [logoUrl, setLogoUrl] = useState(organization.logoUrl ?? null);
  const [members, setMembers] = useState<OrgUser[] | null>(null);

  useEffect(() => {
    if (ctx.organization.type !== "club") return;
    const supabase = createClient();
    fetchClubMembers(supabase, organization.id)
      .then(setMembers)
      .catch(() => setMembers([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization.id]);

  const [savingInfo, setSavingInfo] = useState(false);
  const [savingColors, setSavingColors] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<"info" | "colors" | null>(null);

  const infoDirty =
    address !== (organization.address ?? "") ||
    instagram !== (organization.instagramHandle ?? "") ||
    siret !== (organization.siret ?? "");
  const originalColors = organization.brandColors ?? ["#4F7DFF", "#A855F7"];
  const colorsDirty = colors[0] !== originalColors[0] || colors[1] !== originalColors[1];

  async function handleSaveInfo() {
    setSavingInfo(true);
    setError(null);
    setSaved(null);
    try {
      const supabase = createClient();
      await updateClubOrganization(supabase, organization.id, { adresse: address, instagramHandle: instagram, siret });
      setSaved("info");
    } catch {
      setError("Impossible d'enregistrer ces informations. Réessayez.");
    } finally {
      setSavingInfo(false);
    }
  }

  async function handleSaveColors() {
    setSavingColors(true);
    setError(null);
    setSaved(null);
    try {
      const supabase = createClient();
      await updateClubOrganization(supabase, organization.id, { couleurPrimaire: colors[0], couleurSecondaire: colors[1] });
      setSaved("colors");
    } catch {
      setError("Impossible d'enregistrer ces couleurs. Réessayez.");
    } finally {
      setSavingColors(false);
    }
  }

  async function handleLogoChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploadingLogo(true);
    setError(null);
    try {
      const supabase = createClient();
      const url = await uploadClubLogo(supabase, organization.id, file);
      setLogoUrl(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible d'envoyer ce logo. Réessayez.");
    } finally {
      setUploadingLogo(false);
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      {canEdit && (
        <Card className="flex items-center justify-between gap-4 p-5">
          <div>
            <div className="text-[13.5px] font-extrabold">Onboarding SportVision</div>
            <p className="mt-0.5 text-[12px] text-text-soft">
              Équipes, entraînements, calendrier, réseaux sociaux, droit à l&apos;image... tout ce dont SportVision a besoin pour démarrer la communication.
            </p>
          </div>
          <Link href="/onboarding" className="flex-none text-[12.5px] font-bold text-brand-blue-electric hover:underline">
            Compléter →
          </Link>
        </Card>
      )}
      <Card className="flex items-center gap-4 p-5">
        <button
          type="button"
          aria-label={logoUrl ? "Changer le logo" : "Ajouter un logo"}
          disabled={!canEdit || uploadingLogo}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "relative flex h-16 w-16 flex-none items-center justify-center overflow-hidden rounded-2xl border border-dashed border-border-strong bg-surface-alt text-text-faint",
            canEdit && "cursor-pointer hover:border-brand-blue-electric hover:text-brand-blue-electric",
          )}
        >
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="Logo du club" className="h-full w-full object-cover" />
          ) : (
            <ImagePlus className="h-6 w-6" aria-hidden />
          )}
          {uploadingLogo && (
            <span className="absolute inset-0 flex items-center justify-center bg-black/50">
              <Loader2 className="h-5 w-5 animate-spin text-white" aria-hidden />
            </span>
          )}
        </button>
        <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={handleLogoChange} />
        <div>
          <div className="text-[13.5px] font-extrabold">Logo</div>
          <div className="text-[12px] text-text-soft">
            Utilisé dans le Studio, les documents et les e-mails.
            {canEdit && " PNG, JPEG, WebP ou SVG, 2 Mo maximum."}
          </div>
        </div>
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <div className="text-[13.5px] font-extrabold">Informations générales</div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Nom" full>
            <input value={organization.name} disabled className={cn(fieldClass, "cursor-not-allowed text-text-faint")} />
          </Field>
          <Field label="Adresse" full>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              disabled={!canEdit}
              placeholder="Non renseignée"
              className={cn(fieldClass, !canEdit && "cursor-not-allowed text-text-faint")}
            />
          </Field>
          <Field label="Instagram">
            <input
              value={instagram}
              onChange={(e) => setInstagram(e.target.value)}
              disabled={!canEdit}
              placeholder="@moncompte"
              className={cn(fieldClass, !canEdit && "cursor-not-allowed text-text-faint")}
            />
          </Field>
          <Field label="SIRET">
            <input
              value={siret}
              onChange={(e) => setSiret(e.target.value)}
              disabled={!canEdit}
              placeholder="Non renseigné"
              className={cn(fieldClass, !canEdit && "cursor-not-allowed text-text-faint")}
            />
          </Field>
        </div>
        {canEdit && (
          <div className="flex items-center gap-3">
            <Button variant="primary" className="h-9 px-4 text-[12.5px]" disabled={!infoDirty || savingInfo} loading={savingInfo} onClick={handleSaveInfo}>
              Enregistrer
            </Button>
            {saved === "info" && <span className="text-[12px] font-bold text-success-fg">Enregistré.</span>}
          </div>
        )}
      </Card>

      <Card className="flex flex-col gap-5 p-5">
        <div className="text-[13.5px] font-extrabold">Couleurs du club</div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="flex flex-col gap-2.5">
              <div className="flex items-center gap-2">
                <label
                  className={cn(
                    "relative flex h-8 w-8 flex-none items-center justify-center overflow-hidden rounded-full border border-white/20",
                    canEdit && "cursor-pointer",
                  )}
                  style={{ backgroundColor: colors[i] }}
                  title="Choisir une couleur personnalisée"
                >
                  {canEdit && (
                    <input
                      type="color"
                      value={colors[i]}
                      onChange={(e) => setColors((prev) => (prev[0] && prev[1] ? [i === 0 ? e.target.value : prev[0], i === 1 ? e.target.value : prev[1]] : prev))}
                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                      aria-label={i === 0 ? "Couleur principale, personnalisée" : "Couleur secondaire, personnalisée"}
                    />
                  )}
                </label>
                <span className="text-[12.5px] font-bold text-text">{i === 0 ? "Couleur principale" : "Couleur secondaire"}</span>
                <span className="font-mono text-[12px] text-text-faint">{colors[i]}</span>
              </div>
              {canEdit && (
                <div className="flex flex-wrap gap-1.5" role="group" aria-label={i === 0 ? "Palette — couleur principale" : "Palette — couleur secondaire"}>
                  {BASIC_COLORS.map((preset) => {
                    const active = colors[i]?.toLowerCase() === preset.toLowerCase();
                    return (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setColors((prev) => (prev[0] && prev[1] ? [i === 0 ? preset : prev[0], i === 1 ? preset : prev[1]] : prev))}
                        className={cn(
                          "h-6 w-6 flex-none rounded-full border-2 transition-transform hover:scale-110",
                          active ? "border-text" : "border-white/20",
                        )}
                        style={{ backgroundColor: preset }}
                        aria-label={preset}
                        aria-pressed={active}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
        {canEdit && (
          <div className="flex items-center gap-3">
            <Button
              variant="primary"
              className="h-9 px-4 text-[12.5px]"
              disabled={!colorsDirty || savingColors}
              loading={savingColors}
              onClick={handleSaveColors}
            >
              Enregistrer
            </Button>
            {saved === "colors" && <span className="text-[12px] font-bold text-success-fg">Enregistré.</span>}
          </div>
        )}
      </Card>

      {ctx.organization.type === "club" && (
        <Card className="flex flex-col gap-3.5 p-5">
          <div>
            <div className="text-[13.5px] font-extrabold">Organigramme</div>
            <p className="mt-0.5 text-[12px] text-text-soft">
              Rôle, nom et téléphone des membres actifs de {organization.name}.
            </p>
          </div>
          {members === null ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <SkeletonRow key={i} />
              ))}
            </div>
          ) : members.filter((m) => m.status !== "disabled").length === 0 ? (
            <EmptyState title="Aucun membre pour le moment" />
          ) : (
            <div className="flex flex-col divide-y divide-divider">
              {members
                .filter((m) => m.status !== "disabled")
                .map((m) => (
                  <div key={m.membershipId} className="flex flex-wrap items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                    <span className="w-40 flex-none text-[12.5px] font-bold text-text">{ROLE_LABELS[m.role] ?? m.role}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-text">
                      {m.firstName || m.lastName ? `${m.firstName} ${m.lastName}`.trim() : "—"}
                    </span>
                    <span className="flex-none text-[12.5px] text-text-soft">{m.phone || "—"}</span>
                  </div>
                ))}
            </div>
          )}
          <Link href="/users" className="text-[12.5px] font-bold text-brand-blue-electric hover:underline">
            Gérer les membres et les accès →
          </Link>
        </Card>
      )}

      {error && <p className="text-[12.5px] font-bold text-danger-fg">{error}</p>}

      {!canEdit && (
        <p className="text-[12.5px] text-text-soft">
          {ctx.organization.type === "club"
            ? "Ces informations sont réservées en écriture à l'administrateur du club."
            : "Ces informations ne sont pas encore modifiables depuis Club+ pour ce type d'espace. Contactez votre conseiller SportVision pour les mettre à jour."}
        </p>
      )}
      <p className="text-[12.5px] text-text-soft">
        {ctx.organization.type === "club"
          ? "Le nom du club n'est pas modifiable depuis Club+. Contactez votre conseiller SportVision pour le mettre à jour."
          : "Le nom de votre organisation n'est pas modifiable depuis Club+. Contactez votre conseiller SportVision pour le mettre à jour."}
      </p>
    </div>
  );
}

// Palette de base (19/08/2026, sur demande Fouka) — en plus du sélecteur natif (<input
// type="color">, pas d'aperçu tant qu'on ne l'ouvre pas), pour choisir une couleur courante en un
// clic sans quitter la page. Set volontairement resserré (12) plutôt qu'une roue chromatique
// complète : l'objectif est un raccourci pour les cas courants, le sélecteur natif reste
// disponible pour une couleur de marque précise.
const BASIC_COLORS = [
  "#F5222D",
  "#FA8C16",
  "#FADB14",
  "#52C41A",
  "#13C2C2",
  "#4F7DFF",
  "#2F54EB",
  "#722ED1",
  "#A855F7",
  "#EB2F96",
  "#8C8C8C",
  "#1A1A2E",
];

const fieldClass =
  "h-11 rounded-xl border border-border-strong bg-input-bg px-3.5 text-[14px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,84,255,.12)]";

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <label className={`flex flex-col gap-1.5 ${full ? "sm:col-span-2" : ""}`}>
      <span className="text-[12.5px] font-bold text-text-soft">{label}</span>
      {children}
    </label>
  );
}
