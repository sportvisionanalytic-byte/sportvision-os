"use client";

import { ImagePlus } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { cn } from "@/lib/cn";
import { Card } from "@/components/ui/Card";
import { LockedModule } from "@/components/ui/LockedModule";

// /settings/organization — voir ACTIONS.md § 25 « Organisation ». Logo, nom, adresse, Instagram,
// SIRET, couleurs du club.
export default function OrganizationSettingsPage() {
  const { ctx } = useSession();

  if (!canAccess(ctx, "settings")) return <LockedModule title="Paramètres" />;

  const { organization } = ctx;
  const name = organization.name;
  const address = organization.address ?? "";
  const instagram = organization.instagramHandle ?? "";
  const siret = organization.siret ?? "";
  const colors = organization.brandColors ?? ["#2454FF", "#832DFF"];

  // Pas de colonne réelle (adresse/instagram/siret/couleurs) ni de policy d'écriture club-admin
  // sur `clubs` à ce jour — seule la lecture est autorisée (clubs_member_select), écrire
  // nécessiterait une policy/RPC dédiée (changement de schéma, hors scope d'un correctif ; à
  // faire suivre au conseiller SportVision). Champs en lecture seule plutôt qu'un faux
  // "enregistré" : voir le plan Phase 1 § pas de fabrication de données.

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <Card className="flex items-center gap-4 p-5">
        <div className="flex h-16 w-16 flex-none items-center justify-center rounded-2xl border border-dashed border-border-strong bg-surface-alt text-text-faint">
          <ImagePlus className="h-6 w-6" aria-hidden />
        </div>
        <div>
          <div className="text-[13.5px] font-extrabold">Logo</div>
          <div className="text-[12px] text-text-soft">Utilisé dans le Studio, les documents et les e-mails.</div>
        </div>
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <div className="text-[13.5px] font-extrabold">Informations générales</div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Nom" full>
            <input value={name} disabled className={cn(fieldClass, "cursor-not-allowed text-text-faint")} />
          </Field>
          <Field label="Adresse" full>
            <input value={address} disabled placeholder="Non renseignée" className={cn(fieldClass, "cursor-not-allowed text-text-faint")} />
          </Field>
          <Field label="Instagram">
            <input value={instagram} disabled placeholder="Non renseigné" className={cn(fieldClass, "cursor-not-allowed text-text-faint")} />
          </Field>
          <Field label="SIRET">
            <input value={siret} disabled placeholder="Non renseigné" className={cn(fieldClass, "cursor-not-allowed text-text-faint")} />
          </Field>
        </div>
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <div className="text-[13.5px] font-extrabold">Couleurs du club</div>
        <div className="flex flex-wrap gap-3">
          {colors.map((color, i) => (
            <div key={`${color}-${i}`} className="flex items-center gap-2 rounded-xl border border-border-strong px-2.5 py-2">
              <span className="h-6 w-6 flex-none rounded-full border border-white/20" style={{ backgroundColor: color }} />
              <span className="w-24 font-mono text-[12.5px] text-text-faint">{color}</span>
            </div>
          ))}
        </div>
      </Card>

      <p className="text-[12.5px] text-text-soft">
        Ces informations ne sont pas encore modifiables depuis Connect. Contactez votre conseiller SportVision pour les mettre à jour.
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
