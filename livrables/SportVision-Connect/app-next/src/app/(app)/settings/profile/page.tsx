"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, User as UserIcon } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { applyTheme, getStoredTheme, type Theme } from "@/lib/theme";
import { updateUserProfile } from "@/lib/data/shared/profile";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/cn";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Switch } from "@/components/settings/Switch";
import { LockedModule } from "@/components/ui/LockedModule";

// /settings/profile — voir ACTIONS.md § 25 « Personnel ». Photo, nom, téléphone, e-mail, langue,
// double authentification, apparence sombre, Enregistrer (seule action principale de l'écran).
export default function ProfileSettingsPage() {
  const { ctx } = useSession();
  const router = useRouter();

  if (!canAccess(ctx, "settings")) return <LockedModule title="Paramètres" />;

  const { user } = ctx;
  const [firstName, setFirstName] = useState(user.firstName);
  const [lastName, setLastName] = useState(user.lastName);
  const [phone, setPhone] = useState(user.phone ?? "");
  const [locale, setLocale] = useState<"fr" | "en">(user.locale);
  const [mfaEnabled] = useState(user.mfaEnabled);
  const [theme, setTheme] = useState<Theme>("dark");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setTheme(getStoredTheme()), []);

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

      <Card className="flex items-center justify-between gap-4 p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-info-bg text-info-fg">
            <ShieldCheck className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <div className="text-[13.5px] font-extrabold">Double authentification</div>
            <div className="mt-0.5 text-[12px] text-text-soft">Ajoute une vérification par code à chaque connexion.</div>
          </div>
        </div>
        {mfaEnabled ? (
          <Badge tone="success">Activée</Badge>
        ) : (
          <Badge tone="neutral">Bientôt disponible</Badge>
        )}
      </Card>

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
