"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { defaultNotificationPreferences } from "@/lib/mock/settings";
import {
  NOTIFICATION_CATEGORY_LABELS,
  type NotificationCategory,
  type NotificationFrequency,
  type NotificationPreferences,
} from "@/lib/types/settings";
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
  const [prefs, setPrefs] = useState<NotificationPreferences>(defaultNotificationPreferences);
  const [saved, setSaved] = useState(false);

  function updateCategory(category: NotificationCategory, patch: Partial<NotificationPreferences[NotificationCategory]>) {
    setPrefs((prev) => ({ ...prev, [category]: { ...prev[category], ...patch } }));
  }

  function handleSave() {
    setSaved(true);
    setTimeout(() => setSaved(false), 3200);
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

      <Card className="divide-y divide-divider">
        {CATEGORY_ORDER.map((category) => {
          const pref = prefs[category];
          return (
            <div key={category} className="flex flex-col gap-3 p-4">
              <div className="flex items-center justify-between">
                <span className="text-[13.5px] font-extrabold">{NOTIFICATION_CATEGORY_LABELS[category]}</span>
                <select
                  value={pref.frequency}
                  onChange={(e) => updateCategory(category, { frequency: e.target.value as NotificationFrequency })}
                  className="h-9 rounded-lg border border-border-strong bg-input-bg px-2.5 text-[12.5px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,84,255,.12)]"
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
                  <Switch checked={pref.email} onChange={(v) => updateCategory(category, { email: v })} label={`E-mail — ${NOTIFICATION_CATEGORY_LABELS[category]}`} />
                  E-mail
                </label>
                <label className="flex items-center gap-2.5 text-[12.5px] font-semibold text-text-soft">
                  <Switch checked={pref.inApp} onChange={(v) => updateCategory(category, { inApp: v })} label={`Application — ${NOTIFICATION_CATEGORY_LABELS[category]}`} />
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
              value={prefs.quietHours.notBefore}
              onChange={(e) => setPrefs((prev) => ({ ...prev, quietHours: { ...prev.quietHours, notBefore: e.target.value } }))}
              className="h-10 rounded-xl border border-border-strong bg-input-bg px-3 text-[13px] outline-none focus-visible:border-brand-blue"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-bold text-text-soft">Pas après</span>
            <input
              type="time"
              value={prefs.quietHours.notAfter}
              onChange={(e) => setPrefs((prev) => ({ ...prev, quietHours: { ...prev.quietHours, notAfter: e.target.value } }))}
              className="h-10 rounded-xl border border-border-strong bg-input-bg px-3 text-[13px] outline-none focus-visible:border-brand-blue"
            />
          </label>
        </div>
        <label className="flex items-center gap-2.5 text-[12.5px] font-semibold text-text-soft">
          <Switch
            checked={prefs.quietHours.sundayUrgentOnly}
            onChange={(v) => setPrefs((prev) => ({ ...prev, quietHours: { ...prev.quietHours, sundayUrgentOnly: v } }))}
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
        <Button onClick={handleSave}>Enregistrer les préférences</Button>
        {saved && <span className="text-[12.5px] font-bold text-success-fg">Préférences enregistrées.</span>}
      </div>
    </div>
  );
}
