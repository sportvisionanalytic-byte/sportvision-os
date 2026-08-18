"use client";

import { useState } from "react";
import { Toggle } from "@/components/ui/Toggle";
import { createClient } from "@/lib/supabase/client";

type PrefKey = "notif_contenus" | "notif_cotisations" | "notif_prestations" | "notif_messages" | "notif_affiliations";

const PREFS: { key: PrefKey; label: string }[] = [
  { key: "notif_contenus", label: "Contenus disponibles" },
  { key: "notif_cotisations", label: "Paiements collectifs" },
  { key: "notif_prestations", label: "Prestations" },
  { key: "notif_messages", label: "Messages" },
  { key: "notif_affiliations", label: "Affiliations" },
];

// Bascules réelles — chaque clic persiste immédiatement en base (upsert connect_profile_settings),
// pas un état local qui s'oublierait au rechargement. Optimiste avec retour arrière en cas d'échec.
export function NotificationsSection({
  initial,
}: {
  initial: Record<PrefKey, boolean>;
}) {
  const [prefs, setPrefs] = useState(initial);
  const [pending, setPending] = useState<PrefKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(key: PrefKey) {
    const next = !prefs[key];
    setPrefs((p) => ({ ...p, [key]: next }));
    setPending(key);
    setError(null);
    const supabase = createClient();
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      setPrefs((p) => ({ ...p, [key]: !next }));
      setPending(null);
      setError("Session expirée, reconnectez-vous.");
      return;
    }
    const { error: upsertError } = await supabase
      .from("connect_profile_settings")
      .upsert({ user_id: userId, [key]: next }, { onConflict: "user_id" });
    setPending(null);
    if (upsertError) {
      setPrefs((p) => ({ ...p, [key]: !next }));
      setError("Impossible de mettre à jour cette préférence pour le moment.");
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-sv-card border border-border bg-surface p-5">
      <h2 className="font-sora text-[17px] font-semibold">Notifications</h2>
      <div className="flex flex-col gap-1">
        {PREFS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => toggle(p.key)}
            disabled={pending === p.key}
            className="flex min-h-[48px] items-center gap-3 text-left"
          >
            <span className="text-[14px] font-medium">{p.label}</span>
            <span className="ml-auto flex-none">
              <Toggle on={prefs[p.key]} disabled={pending === p.key} />
            </span>
          </button>
        ))}
      </div>
      {error && <span className="text-[13px] text-danger lg:text-[12px]">{error}</span>}
    </div>
  );
}
