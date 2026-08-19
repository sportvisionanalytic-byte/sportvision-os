"use client";

import { useState } from "react";
import { Card } from "@/components/demo/DemoBlocks";

// Reproduit fidèlement URGENCY_META (src/lib/types/studio.ts) et le comportement réel de
// requests/new/page.tsx : coût en crédits par palier, solde restant après envoi, bouton
// désactivé si le solde est insuffisant. "Express" volontairement absent, comme dans le vrai
// formulaire (club_requests.urgency n'accepte que normale/haute en base, voir le commentaire
// original) — audit du 19/08/2026 : la démo ne montrait aucun aperçu de coût avant validation.
const URGENCY_META = {
  standard: { label: "Standard", creditCost: 1, delayLabel: "5 jours" },
  priority: { label: "Prioritaire", creditCost: 2, delayLabel: "48 heures" },
} as const;

type Urgency = keyof typeof URGENCY_META;

export function CreditRequestPreview({ available }: { available: number }) {
  const [urgency, setUrgency] = useState<Urgency>("standard");
  const [sent, setSent] = useState(false);
  const cost = URGENCY_META[urgency].creditCost;
  const after = available - cost;
  const hasEnough = after >= 0;

  return (
    <Card title="Nouvelle demande de visuel">
      <div className="flex flex-col gap-3.5">
        <div className="flex gap-2">
          {(Object.keys(URGENCY_META) as Urgency[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setUrgency(key);
                setSent(false);
              }}
              className={`flex-1 rounded-sv border px-3 py-2.5 text-left text-[12.5px] font-bold transition-colors ${
                urgency === key ? "border-brand-blue-electric bg-info-bg text-text" : "border-border text-text-secondary hover:border-border-strong"
              }`}
            >
              {URGENCY_META[key].label}
              <span className="block text-[11px] font-semibold text-text-faint">{URGENCY_META[key].delayLabel} · {URGENCY_META[key].creditCost} crédit{URGENCY_META[key].creditCost > 1 ? "s" : ""}</span>
            </button>
          ))}
        </div>
        <div className="rounded-sv bg-surface-alt px-3.5 py-3 text-[12.5px]">
          <div className="flex justify-between">
            <span className="text-text-secondary">Coût de cette demande</span>
            <span className="font-bold text-text">{cost} crédit{cost > 1 ? "s" : ""}</span>
          </div>
          <div className="mt-1 flex justify-between">
            <span className="text-text-secondary">Solde après envoi</span>
            <span className={`font-bold ${hasEnough ? "text-text" : "text-danger-fg"}`}>{after} / {available} crédits</span>
          </div>
        </div>
        <button
          type="button"
          disabled={!hasEnough}
          onClick={() => setSent(true)}
          className="h-10 w-fit rounded-sv px-4 text-[13px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: "linear-gradient(120deg,#A855F7,#4F7DFF 55%,#22D3EE)" }}
        >
          {sent ? "Demande envoyée ✓" : hasEnough ? "Envoyer la demande" : "Solde de crédits insuffisant"}
        </button>
      </div>
    </Card>
  );
}
