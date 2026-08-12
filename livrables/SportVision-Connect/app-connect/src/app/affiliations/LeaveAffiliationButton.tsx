"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Confirmation obligatoire avant de quitter — voir README design § Interactions et
// comportements. `account_status` est protégé par un trigger (guard_player_profile_update,
// migration-clubplus-v13.sql) — seul un admin de club peut le modifier directement, jamais le
// joueur lui-même (empêche l'auto-activation). Passe donc par l'edge function
// connect-player-onboarding (action "leave"), pas un update client direct.
export function LeaveAffiliationButton({ clubName }: { clubName: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data, error: fnError } = await supabase.functions.invoke("connect-player-onboarding", {
      body: { action: "leave" },
    });
    setBusy(false);
    if (fnError || data?.error) {
      setError("Impossible de quitter l'affiliation pour le moment.");
      return;
    }
    setConfirming(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="ml-auto flex h-11 flex-none items-center rounded-sv border border-danger-border bg-danger-bg px-4 font-sora text-[14px] font-semibold text-danger hover:bg-[rgba(244,114,182,.16)]"
      >
        Quitter
      </button>

      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/66 p-6"
          onClick={() => !busy && setConfirming(false)}
        >
          <div
            className="flex w-full max-w-[420px] flex-col gap-4 rounded-sv-modal border border-border bg-bg-elevated p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-sv bg-danger-bg">
              <span className="material-symbols-rounded !text-[24px] text-danger">warning</span>
            </span>
            <div className="flex flex-col gap-2">
              <span className="font-sora text-[19px] font-semibold">Quitter {clubName} ?</span>
              <span className="text-[14px] leading-relaxed text-text-tertiary">
                Vous perdrez l&apos;accès aux contenus et événements liés à cette structure. Votre
                compte Connect est conservé.
              </span>
            </div>
            {error && <span className="text-[13px] text-danger">{error}</span>}
            <div className="mt-1 flex gap-2.5">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={busy}
                className="flex-1 rounded-sv border border-border-strong bg-surface py-2.5 font-sora text-[14px] font-semibold hover:bg-surface-hover"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={busy}
                className="flex-1 rounded-sv border border-danger-border bg-danger-bg py-2.5 font-sora text-[14px] font-semibold text-danger hover:bg-[rgba(244,114,182,.16)]"
              >
                {busy ? "…" : "Quitter"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
