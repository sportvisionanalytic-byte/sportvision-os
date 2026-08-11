"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Shield, User as UserIcon } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { applyTheme, getStoredTheme, type Theme } from "@/lib/theme";
import { updateUserProfile } from "@/lib/data/shared/profile";
import { createClient } from "@/lib/supabase/client";
import { fetchPlayerClubInfo, type PlayerClubInfo } from "@/lib/data/player/club-info";
import { cn } from "@/lib/cn";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/settings/Switch";
import { LockedModule } from "@/components/ui/LockedModule";

// /settings/profile — voir ACTIONS.md § 25 « Personnel ». Photo, nom, téléphone, e-mail, langue,
// apparence sombre, Enregistrer (seule action principale de l'écran).
//
// Double authentification retirée le 11/08/2026 (brief Fouka § 17 : "à J-5 du lancement, je
// masquerais ça [...] soit ça fonctionne, soit ce n'est pas affiché") — user.mfaEnabled vaut
// TOUJOURS false (posé en dur dans buildUserFromAuth, session.ts, aucune vraie double
// authentification n'est branchée), la carte n'affichait donc jamais que "Bientôt disponible".
// Directive appliquée globalement (tous types d'organisation), pas seulement à l'espace Joueur —
// Fouka a explicitement dit "évite toutes les mentions bientôt disponible dans la V1".
export default function ProfileSettingsPage() {
  const { ctx } = useSession();
  const router = useRouter();

  if (!canAccess(ctx, "settings")) return <LockedModule title="Paramètres" />;

  const { user } = ctx;
  const isPlayer = ctx.organization.type === "player";
  const [firstName, setFirstName] = useState(user.firstName);
  const [lastName, setLastName] = useState(user.lastName);
  const [phone, setPhone] = useState(user.phone ?? "");
  const [locale, setLocale] = useState<"fr" | "en">(user.locale);
  const [theme, setTheme] = useState<Theme>("dark");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [clubInfo, setClubInfo] = useState<PlayerClubInfo | null>(null);
  const [leaveClubOpen, setLeaveClubOpen] = useState(false);

  useEffect(() => setTheme(getStoredTheme()), []);

  useEffect(() => {
    if (!isPlayer || !ctx.organization.parentOrganizationId) return;
    const supabase = createClient();
    fetchPlayerClubInfo(supabase, ctx.organization.parentOrganizationId, ctx.organization.id)
      .then(setClubInfo)
      .catch(() => setClubInfo(null));
  }, [isPlayer, ctx.organization.parentOrganizationId, ctx.organization.id]);

  function toggleTheme(checked: boolean) {
    const next: Theme = checked ? "dark" : "light";
    setTheme(next);
    applyTheme(next);
  }

  function handleSave() {
    setSaving(true);
    setError(null);
    const supabase = createClient();
    updateUserProfile(supabase, { firstName, lastName, phone, locale })
      .then(() => {
        setSaving(false);
        setSaved(true);
        setTimeout(() => setSaved(false), 3200);
        router.refresh();
      })
      .catch(() => {
        setSaving(false);
        setError("Enregistrement impossible, réessayez.");
      });
  }

  const initials = `${user.firstName[0] ?? ""}${user.lastName[0] ?? ""}`.toUpperCase();

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <Card className="flex items-center gap-4 p-5">
        <span className="flex h-16 w-16 flex-none items-center justify-center rounded-full bg-gradient-to-br from-brand-violet to-brand-blue-electric text-[20px] font-extrabold text-white">
          {initials || <UserIcon className="h-6 w-6" aria-hidden />}
        </span>
        <div>
          <div className="text-[14px] font-extrabold">Photo de profil</div>
          <div className="text-[12px] text-text-soft">JPG ou PNG, 2 Mo maximum.</div>
        </div>
        <Button variant="secondary" className="ml-auto h-9 px-3.5 text-[12.5px]">
          Changer la photo
        </Button>
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <div className="text-[13.5px] font-extrabold">Informations personnelles</div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Prénom">
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} className={fieldClass} />
          </Field>
          <Field label="Nom">
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} className={fieldClass} />
          </Field>
          <Field label="Téléphone">
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className={fieldClass} placeholder="06 12 34 56 78" />
          </Field>
          <Field label="Adresse e-mail">
            <input value={user.email} disabled className={cn(fieldClass, "cursor-not-allowed text-text-faint")} />
          </Field>
          <Field label="Langue">
            <select value={locale} onChange={(e) => setLocale(e.target.value as "fr" | "en")} className={fieldClass}>
              <option value="fr">Français</option>
              <option value="en">English</option>
            </select>
          </Field>
        </div>
      </Card>

      {isPlayer && (
        <Card className="flex flex-col gap-4 p-5">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-info-bg text-info-fg">
              <Shield className="h-4 w-4" aria-hidden />
            </span>
            <div className="text-[13.5px] font-extrabold">Mon club</div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Club">
              <input value={clubInfo?.clubName ?? "…"} disabled className={cn(fieldClass, "cursor-not-allowed text-text-faint")} />
            </Field>
            <Field label="Rôle">
              <input value="Joueur" disabled className={cn(fieldClass, "cursor-not-allowed text-text-faint")} />
            </Field>
            {clubInfo?.teamName && (
              <Field label="Équipe">
                <input
                  value={clubInfo.categorie ? `${clubInfo.teamName} · ${clubInfo.categorie}` : clubInfo.teamName}
                  disabled
                  className={cn(fieldClass, "cursor-not-allowed text-text-faint")}
                />
              </Field>
            )}
          </div>
          <p className="text-[11.5px] text-text-faint">
            Ces informations sont gérées par votre club. Pour les modifier, contactez un administrateur.
          </p>

          {!leaveClubOpen ? (
            <Button variant="secondary" className="self-start" onClick={() => setLeaveClubOpen(true)}>
              Quitter le club
            </Button>
          ) : (
            <div className="flex flex-col gap-2.5 rounded-xl border border-border-strong bg-surface-alt p-4">
              <div className="flex gap-2.5">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-none text-warning-fg" aria-hidden />
                <p className="text-[12.5px] leading-relaxed text-text-soft">
                  Quitter un club retire votre accès à ses contenus et n&apos;est pas automatique : contactez l&apos;équipe
                  SportVision via Messages, elle traite votre demande avec votre club.
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" className="h-9 px-3.5 text-[12.5px]" onClick={() => router.push("/messages")}>
                  Aller à Messages
                </Button>
                <Button variant="tertiary" className="h-9 px-3.5 text-[12.5px]" onClick={() => setLeaveClubOpen(false)}>
                  Annuler
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      <Card className="flex items-center justify-between gap-4 p-5">
        <div>
          <div className="text-[13.5px] font-extrabold">Apparence sombre</div>
          <div className="mt-0.5 text-[12px] text-text-soft">Sombre par défaut, bascule disponible à tout moment.</div>
        </div>
        <Switch checked={theme === "dark"} onChange={toggleTheme} label="Apparence sombre" />
      </Card>

      <div className="flex items-center gap-3">
        <Button loading={saving} onClick={handleSave}>
          Enregistrer
        </Button>
        {saved && <span className="text-[12.5px] font-bold text-success-fg">Modifications enregistrées.</span>}
        {error && <span className="text-[12.5px] font-bold text-danger-fg">{error}</span>}
      </div>
    </div>
  );
}

const fieldClass =
  "h-11 rounded-xl border border-border-strong bg-input-bg px-3.5 text-[14px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,84,255,.12)]";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-bold text-text-soft">{label}</span>
      {children}
    </label>
  );
}
