"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { defaultNotificationPreferences } from "@/lib/mock/settings";
import {
  NOTIFICATION_CATEGORY_LABELS,
  type NotificationCategory,
  type NotificationFrequency,
  type NotificationPreferences,
} from "@/lib/types/settings";
import { fetchQuietHours, saveQuietHours, type QuietHours } from "@/lib/data/shared/notification-quiet-hours";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/settings/Switch";

// /notifications/preferences — voir ACTIONS.md § 23 « Modale de préférences » (devenue une route
// à part entière dans l'arborescence, voir README.md § Arborescence des routes). Par catégorie :
// bascule e-mail, bascule application, fréquence. Heures calmes. Les notifications critiques sont
// toujours envoyées, quelles que soient les préférences. Pas de garde `canAccess` : voir la note
// sur /notifications, même raisonnement (fonctionnalité de compte, pas de module lié à l'offre).
const FREQUENCY_LABELS: Record<NotificationFrequency, string> = {
  immediate: "Immédiat",
  daily_digest: "Résumé quotidien",
  weekly_digest: "Résumé hebdomadaire",
  monthly: "Résumé mensuel",
  never: "Jamais",
};

const CATEGORY_ORDER: NotificationCategory[] = [
  "content",
  "services",
  "contracts",
  "payments",
  "requests",
  "users",
  "calendar",
  "system",
];

export default function NotificationPreferencesPage() {
  const { ctx } = useSession();
  // Préférences par catégorie : mock uniquement — notification_preferences (réel) a une
  // taxonomie incompatible (SECURITY/LEGAL/BILLING/OPERATIONS/SUPPORT/PRODUCT/MARKETING, pas de
  // notion de fréquence ni de canal in-app), pas de mapping honnête possible vers les 8
  // catégories du design. Affiché à titre indicatif, non modifiable (voir plus bas).
  const [prefs] = useState<NotificationPreferences>(defaultNotificationPreferences);

  const [quietHours, setQuietHours] = useState<QuietHours>({ notBefore: "08:00", notAfter: "21:00", sundayUrgentOnly: true });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    fetchQuietHours(supabase, ctx.user.id).then((row) => {
      if (row) setQuietHours(row);
    });
  }, [ctx.user.id]);

  function handleSaveQuietHours() {
    setSaving(true);
    setError(null);
    const supabase = createClient();
    saveQuietHours(supabase, ctx.user.id, quietHours)
      .then(() => {
        setSaving(false);
        setSaved(true);
        setTimeout(() => setSaved(false), 3200);
      })
      .catch(() => {
        setSaving(false);
        setError("Enregistrement impossible, réessayez.");
      });
  }

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <div>
        <Link href="/notifications" className="flex items-center gap-1.5 text-[12.5px] font-bold text-brand-blue-electric">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Retour aux notifications
        </Link>
        <h1 className="mt-3 text-[24px] font-extrabold tracking-tight">Préférences de notification</h1>
        <p className="mt-1 text-[13.5px] text-text-soft">Choisissez comment et quand être prévenu, par catégorie.</p>
      </div>

      <p className="text-[12.5px] text-text-soft">
        Le détail par catégorie ci-dessous n&apos;est pas encore modifiable depuis Connect (affiché à titre indicatif).
        Les heures calmes, elles, sont réellement enregistrées.
      </p>

      <Card className="divide-y divide-divider opacity-60">
        {CATEGORY_ORDER.map((category) => {
          const pref = prefs[category];
          return (
            <div key={category} className="flex flex-col gap-3 p-4">
              <div className="flex items-center justify-between">
                <span className="text-[13.5px] font-extrabold">{NOTIFICATION_CATEGORY_LABELS[category]}</span>
                <select
                  value={pref.frequency}
                  disabled
                  className="h-9 cursor-not-allowed rounded-lg border border-border-strong bg-input-bg px-2.5 text-[12.5px] outline-none"
                >
                  {Object.entries(FREQUENCY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2.5 text-[12.5px] font-semibold text-text-soft">
                  <Switch checked={pref.email} onChange={() => {}} disabled label={`E-mail — ${NOTIFICATION_CATEGORY_LABELS[category]}`} />
                  E-mail
                </label>
                <label className="flex items-center gap-2.5 text-[12.5px] font-semibold text-text-soft">
                  <Switch checked={pref.inApp} onChange={() => {}} disabled label={`Application — ${NOTIFICATION_CATEGORY_LABELS[category]}`} />
                  Application
                </label>
              </div>
            </div>
          );
        })}
      </Card>

      <Card className="flex flex-col gap-3 p-5">
        <div className="text-[13.5px] font-extrabold">Heures calmes</div>
        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-bold text-text-soft">Pas avant</span>
            <input
              type="time"
              value={quietHours.notBefore}
              onChange={(e) => setQuietHours((prev) => ({ ...prev, notBefore: e.target.value }))}
              className="h-10 rounded-xl border border-border-strong bg-input-bg px-3 text-[13px] outline-none focus-visible:border-brand-blue"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-bold text-text-soft">Pas après</span>
            <input
              type="time"
              value={quietHours.notAfter}
              onChange={(e) => setQuietHours((prev) => ({ ...prev, notAfter: e.target.value }))}
              className="h-10 rounded-xl border border-border-strong bg-input-bg px-3 text-[13px] outline-none focus-visible:border-brand-blue"
            />
          </label>
        </div>
        <label className="flex items-center gap-2.5 text-[12.5px] font-semibold text-text-soft">
          <Switch
            checked={quietHours.sundayUrgentOnly}
            onChange={(v) => setQuietHours((prev) => ({ ...prev, sundayUrgentOnly: v }))}
            label="Dimanche en urgences uniquement"
          />
          Dimanche : urgences uniquement
        </label>
        <div className="flex items-start gap-2.5 rounded-xl bg-info-bg px-3.5 py-3 text-[12px] leading-relaxed text-info-fg">
          <ShieldAlert className="mt-0.5 h-4 w-4 flex-none" aria-hidden />
          Les notifications critiques (impayé, suspension, contrat expiré) sont toujours envoyées, quelles que
          soient vos préférences et vos heures calmes.
        </div>
      </Card>

      <div className="flex items-center gap-3">
        <Button loading={saving} onClick={handleSaveQuietHours}>
          Enregistrer les heures calmes
        </Button>
        {saved && <span className="text-[12.5px] font-bold text-success-fg">Heures calmes enregistrées.</span>}
        {error && <span className="text-[12.5px] font-bold text-danger-fg">{error}</span>}
      </div>
    </div>
  );
}
