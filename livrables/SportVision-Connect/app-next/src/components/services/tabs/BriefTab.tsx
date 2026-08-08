"use client";

import { useState } from "react";
import type { Service } from "@/lib/types/services";
import { Button } from "@/components/ui/Button";

export function BriefTab({
  service,
  onProposeChange,
}: {
  service: Service;
  onProposeChange: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState("");

  function submit() {
    if (!message.trim()) return;
    onProposeChange(message.trim());
    setMessage("");
    setEditing(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <BriefField label="Objectif" value={service.brief.objective} />
      <BriefField label="Contraintes" value={service.brief.constraints} />
      <BriefField label="Références" value={service.brief.references} />
      <BriefField label="À éviter" value={service.brief.toAvoid} />

      {editing ? (
        <div className="rounded-sv-card border border-border bg-surface-alt p-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-bold text-text-soft">Modification proposée</span>
            <textarea
              rows={3}
              autoFocus
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Décrivez la modification souhaitée…"
              className="resize-none rounded-xl border border-border-strong bg-surface px-3.5 py-2.5 text-[14px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,84,255,.12)]"
            />
          </label>
          <div className="mt-3 flex justify-end gap-2.5">
            <Button variant="secondary" onClick={() => setEditing(false)}>
              Annuler
            </Button>
            <Button variant="primary" onClick={submit} disabled={!message.trim()}>
              Envoyer la proposition
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" className="self-start" onClick={() => setEditing(true)}>
          Proposer une modification
        </Button>
      )}
    </div>
  );
}

function BriefField({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded-sv-card border border-border bg-surface-alt p-4">
      <div className="text-[11px] font-extrabold uppercase tracking-[.03em] text-text-faint">{label}</div>
      <p className="mt-1.5 text-[13.5px] leading-relaxed text-text">{value || "Non renseigné"}</p>
    </div>
  );
}
