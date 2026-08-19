"use client";

import { useState } from "react";
import { Badge } from "@/components/demo/DemoBlocks";

// Miroir du vrai flow (team-requests/page.tsx + confirm_request_educateur/
// validate_team_membership/reject_team_membership/request_membership_info, migration-clubplus-
// v14/v15/v46) : Valider, Refuser ou Demander une information — la démo montrait auparavant une
// simple liste sans aucune action.
export function AffiliationAction({ name, team }: { name: string; team: string }) {
  const [status, setStatus] = useState<"en_attente" | "validee" | "refusee" | "info_demandee">("en_attente");
  const [mode, setMode] = useState<"none" | "refus" | "info">("none");
  const [note, setNote] = useState("");

  if (status === "validee") {
    return (
      <div className="flex items-center justify-between gap-3 border-b border-divider py-3 last:border-0">
        <div>
          <div className="text-[13.5px] font-semibold text-text">{name}</div>
          <div className="text-[12.5px] text-text-secondary">{team}</div>
        </div>
        <Badge label="Validée" tone="success" />
      </div>
    );
  }

  if (status === "refusee") {
    return (
      <div className="flex items-center justify-between gap-3 border-b border-divider py-3 last:border-0">
        <div>
          <div className="text-[13.5px] font-semibold text-text">{name}</div>
          <div className="text-[12.5px] text-text-secondary">{team}</div>
        </div>
        <Badge label="Refusée" tone="danger" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5 border-b border-divider py-3 last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[13.5px] font-semibold text-text">{name}</div>
          <div className="text-[12.5px] text-text-secondary">{team}</div>
        </div>
        {mode === "none" && (
          <div className="flex flex-none flex-wrap gap-2">
            {status === "info_demandee" && <Badge label="Info demandée" tone="info" />}
            <button type="button" onClick={() => setStatus("validee")} className="h-8 rounded-sv border border-success-fg/30 bg-success-bg px-3 text-[12px] font-bold text-success-fg">
              Valider
            </button>
            <button type="button" onClick={() => setMode("info")} className="h-8 rounded-sv border border-border-strong px-3 text-[12px] font-bold text-text-secondary">
              Demander une info
            </button>
            <button type="button" onClick={() => setMode("refus")} className="h-8 rounded-sv border border-danger-fg/30 px-3 text-[12px] font-bold text-danger-fg">
              Refuser
            </button>
          </div>
        )}
      </div>
      {mode !== "none" && (
        <div className="flex gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={mode === "info" ? "Ce qui manque (obligatoire)" : "Motif du refus (optionnel)"}
            className="h-9 flex-1 rounded-sv border border-border-strong bg-input-bg px-3 text-[12.5px] outline-none"
          />
          <button
            type="button"
            disabled={mode === "info" && !note.trim()}
            onClick={() => {
              setStatus(mode === "info" ? "info_demandee" : "refusee");
              setMode("none");
            }}
            className="h-9 rounded-sv bg-warning-bg px-3 text-[12px] font-bold text-warning-fg disabled:opacity-40"
          >
            Envoyer
          </button>
          <button type="button" onClick={() => setMode("none")} className="h-9 rounded-sv border border-border-strong px-3 text-[12px] font-bold text-text-secondary">
            Annuler
          </button>
        </div>
      )}
    </div>
  );
}
