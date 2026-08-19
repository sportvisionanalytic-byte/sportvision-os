"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2 } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess, isClubNonBureauRole } from "@/lib/permissions";
import { cn } from "@/lib/cn";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { LockedModule } from "@/components/ui/LockedModule";
import { createClient } from "@/lib/supabase/client";
import { updateClubOrganization, uploadClubLogo } from "@/lib/data/club/organization";

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
  const canEdit = ctx.membership.role === "admin";
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [address, setAddress] = useState(organization.address ?? "");
  const [instagram, setInstagram] = useState(organization.instagramHandle ?? "");
  const [siret, setSiret] = useState(organization.siret ?? "");
  const [colors, setColors] = useState(organization.brandColors ?? ["#4F7DFF", "#A855F7"]);
  const [logoUrl, setLogoUrl] = useState(organization.logoUrl ?? null);

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
      <Card className="flex items-center gap-4 p-5">
        <button
          type="button"
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

      <Card className="flex flex-col gap-4 p-5">
        <div className="text-[13.5px] font-extrabold">Couleurs du club</div>
        <div className="flex flex-wrap gap-3">
          {[0, 1].map((i) => (
            <label
              key={i}
              className={cn(
                "flex items-center gap-2 rounded-xl border border-border-strong px-2.5 py-2",
                canEdit && "cursor-pointer hover:border-brand-blue-electric",
              )}
            >
              <span className="relative h-6 w-6 flex-none overflow-hidden rounded-full border border-white/20" style={{ backgroundColor: colors[i] }}>
                {canEdit && (
                  <input
                    type="color"
                    value={colors[i]}
                    onChange={(e) => setColors((prev) => (prev[0] && prev[1] ? [i === 0 ? e.target.value : prev[0], i === 1 ? e.target.value : prev[1]] : prev))}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    aria-label={i === 0 ? "Couleur principale" : "Couleur secondaire"}
                  />
                )}
              </span>
              <span className="w-24 font-mono text-[12.5px] text-text-faint">{colors[i]}</span>
            </label>
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

      {error && <p className="text-[12.5px] font-bold text-danger-fg">{error}</p>}

      {!canEdit && (
        <p className="text-[12.5px] text-text-soft">
          Ces informations sont réservées en écriture à l&apos;administrateur du club.
        </p>
      )}
      <p className="text-[12.5px] text-text-soft">
        Le nom du club n&apos;est pas modifiable depuis Connect. Contactez votre conseiller SportVision pour le mettre à jour.
      </p>
    </div>
  );
}

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
