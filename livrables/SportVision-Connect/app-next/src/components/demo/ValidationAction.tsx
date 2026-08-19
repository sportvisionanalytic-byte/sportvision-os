"use client";

import { useState } from "react";
import { Badge } from "@/components/demo/DemoBlocks";

// Miroir du vrai flow (validations/page.tsx + RPC client_valider_contenu) : "Valider" ou
// "Demander une correction" (commentaire obligatoire dans ce cas) — la première version de
// cette démo montrait une simple liste sans aucune action, alors que ce flow existe et
// fonctionne réellement en production (audit du 19/08/2026).
export function ValidationAction({ title, platform }: { title: string; platform: string }) {
  const [decision, setDecision] = useState<"pending" | "valide" | "corrections">("pending");
  const [comment, setComment] = useState("");
  const [asking, setAsking] = useState(false);

  if (decision === "valide") {
    return (
      <div className="flex items-center justify-between gap-3 border-b border-divider py-3 last:border-0">
        <div>
          <div className="text-[13.5px] font-semibold text-text">{title}</div>
          <div className="text-[12.5px] text-text-secondary">{platform}</div>
        </div>
        <Badge label="Validé" tone="success" />
      </div>
    );
  }

  if (decision === "corrections") {
    return (
      <div className="flex flex-col gap-1.5 border-b border-divider py-3 last:border-0">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[13.5px] font-semibold text-text">{title}</div>
          <Badge label="Correction demandée" tone="warning" />
        </div>
        <p className="text-[12px] text-text-faint">« {comment} »</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5 border-b border-divider py-3 last:border-0">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[13.5px] font-semibold text-text">{title}</div>
          <div className="text-[12.5px] text-text-secondary">{platform}</div>
        </div>
        {!asking && (
          <div className="flex flex-none gap-2">
            <button
              type="button"
              onClick={() => setDecision("valide")}
              className="h-8 rounded-sv border border-success-fg/30 bg-success-bg px-3 text-[12px] font-bold text-success-fg"
            >
              Valider
            </button>
            <button type="button" onClick={() => setAsking(true)} className="h-8 rounded-sv border border-border-strong px-3 text-[12px] font-bold text-text-secondary">
              Demander une correction
            </button>
          </div>
        )}
      </div>
      {asking && (
        <div className="flex gap-2">
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Ce qui doit être corrigé (obligatoire)"
            className="h-9 flex-1 rounded-sv border border-border-strong bg-input-bg px-3 text-[12.5px] outline-none"
          />
          <button
            type="button"
            disabled={!comment.trim()}
            onClick={() => setDecision("corrections")}
            className="h-9 rounded-sv bg-warning-bg px-3 text-[12px] font-bold text-warning-fg disabled:opacity-40"
          >
            Envoyer
          </button>
        </div>
      )}
    </div>
  );
}
