"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Toggle } from "@/components/ui/Toggle";
import { createClient } from "@/lib/supabase/client";

const RELATION_LABEL: Record<string, string> = {
  parent: "Parent",
  tuteur_legal: "Tuteur légal",
  proche: "Proche",
  agent: "Agent",
  autre: "Autre",
};

const RIGHTS: { key: string; label: string }[] = [
  { key: "voir", label: "Voir mes contenus" },
  { key: "download", label: "Télécharger mes contenus" },
  { key: "reserver", label: "Réserver une prestation pour moi" },
  { key: "commandes", label: "Suivre mes commandes" },
  { key: "factures", label: "Voir mes factures" },
];

export interface GrantRights {
  voir: boolean;
  download: boolean;
  reserver: boolean;
  commandes: boolean;
  factures: boolean;
}

// Bascules réelles par droit (connect_update_profile_access_right, RPC SECURITY DEFINER) +
// retrait avec confirmation obligatoire (README design § Interactions et comportements) — la
// confirmation est ici, pas seulement une promesse UI : le retrait n'appelle le RPC qu'après le
// clic sur "Confirmer" dans la modale.
export function GrantCard({
  id,
  name,
  relationType,
  since,
  initialRights,
}: {
  id: string;
  name: string;
  relationType: string;
  since: string;
  initialRights: GrantRights;
}) {
  const router = useRouter();
  const [rights, setRights] = useState(initialRights);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [revoking, setRevoking] = useState(false);

  async function toggleRight(key: keyof GrantRights) {
    const next = !rights[key];
    setRights((r) => ({ ...r, [key]: next }));
    setPending(key);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("connect_update_profile_access_right", {
      p_id: id,
      p_right: key,
      p_value: next,
    });
    setPending(null);
    if (rpcError) {
      setRights((r) => ({ ...r, [key]: !next }));
      setError("Impossible de mettre à jour ce droit pour le moment.");
    }
  }

  async function confirmRevoke() {
    setRevoking(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("connect_revoke_profile_access", { p_id: id });
    setRevoking(false);
    if (rpcError) {
      setError("Impossible de retirer cet accès pour le moment.");
      return;
    }
    setConfirming(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4 rounded-sv-card border border-border bg-surface p-4.5">
      <div className="flex flex-wrap items-center gap-3.5">
        <span className="flex h-11 w-11 flex-none items-center justify-center rounded-sv bg-sv-gradient font-sora text-[14px] font-semibold text-white">
          {(name[0] || "?").toUpperCase()}
        </span>
        <div className="flex flex-col gap-0.5">
          <span className="font-sora text-[16px] font-semibold">{name}</span>
          <span className="text-[13px] text-text-tertiary">{RELATION_LABEL[relationType] || relationType} · depuis {since}</span>
        </div>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="ml-auto flex h-[42px] flex-none items-center rounded-sv border border-danger-border bg-danger-bg px-3.5 font-sora text-[13px] font-semibold text-danger hover:bg-[rgba(244,114,182,.16)]"
        >
          Retirer l&apos;accès
        </button>
      </div>

      {error && <span className="text-[13px] text-danger">{error}</span>}

      <div className="flex flex-col gap-0.5">
        {RIGHTS.map((r) => {
          const on = rights[r.key as keyof GrantRights];
          return (
            <button
              key={r.key}
              type="button"
              onClick={() => toggleRight(r.key as keyof GrantRights)}
              disabled={pending === r.key}
              className="flex min-h-[46px] items-center gap-2.5 text-left"
            >
              <span className="material-symbols-rounded !text-[19px]" style={{ color: on ? "#22D3EE" : "#7A7A9C" }}>
                {on ? "check_circle" : "cancel"}
              </span>
              <span className="text-[14px]" style={{ color: on ? "#F7F7FB" : "#9A9AB8" }}>
                {r.label}
              </span>
              <span className="ml-auto flex-none">
                <Toggle on={on} disabled={pending === r.key} />
              </span>
            </button>
          );
        })}
      </div>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/66 p-6" onClick={() => !revoking && setConfirming(false)}>
          <div
            className="flex w-full max-w-[420px] flex-col gap-4 rounded-sv-modal border border-border bg-bg-elevated p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-sv bg-danger-bg">
              <span className="material-symbols-rounded !text-[24px] text-danger">warning</span>
            </span>
            <div className="flex flex-col gap-2">
              <span className="font-sora text-[19px] font-semibold">Retirer l&apos;accès de {name} ?</span>
              <span className="text-[14px] leading-relaxed text-text-tertiary">
                {name} ne pourra plus voir aucune de vos données. Vous pourrez accorder à nouveau
                l&apos;accès plus tard si {name} refait une demande.
              </span>
            </div>
            <div className="mt-1 flex gap-2.5">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={revoking}
                className="flex-1 rounded-sv border border-border-strong bg-surface py-2.5 font-sora text-[14px] font-semibold hover:bg-surface-hover"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={confirmRevoke}
                disabled={revoking}
                className="flex-1 rounded-sv border border-danger-border bg-danger-bg py-2.5 font-sora text-[14px] font-semibold text-danger hover:bg-[rgba(244,114,182,.16)]"
              >
                {revoking ? "…" : "Retirer l'accès"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
