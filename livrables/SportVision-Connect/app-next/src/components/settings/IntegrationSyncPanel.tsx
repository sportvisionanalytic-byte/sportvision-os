"use client";

import { useState } from "react";
import { CheckCircle2, RefreshCw, X, XCircle } from "lucide-react";
import type { Integration } from "@/lib/types/settings";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

// Panneau de synchronisation d'une intégration — voir ACTIONS.md § 25 « Panneau de
// synchronisation ». Modale : Synchroniser maintenant, Déconnecter, autorisations demandées
// (mention explicite que la suppression d'événements n'est jamais demandée), table de
// correspondance des calendriers, historique.
interface IntegrationSyncPanelProps {
  integration: Integration;
  onClose: () => void;
  onDisconnect: (id: string) => void;
  onSync: (id: string) => void;
}

export function IntegrationSyncPanel({ integration, onClose, onDisconnect, onSync }: IntegrationSyncPanelProps) {
  const [syncing, setSyncing] = useState(false);

  function handleSync() {
    setSyncing(true);
    setTimeout(() => {
      setSyncing(false);
      onSync(integration.id);
    }, 900);
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(7,10,23,.65)] p-4">
      <Card className="animate-svfade relative flex w-full max-w-[520px] flex-col gap-5 rounded-sv-modal p-6 shadow-sv-modal">
        <button
          aria-label="Fermer"
          onClick={onClose}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-text-faint hover:bg-surface-sunken hover:text-text"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>

        <div>
          <div className="text-[11px] font-extrabold uppercase tracking-[.09em] text-text-faint">Intégration</div>
          <h2 className="mt-1 text-[19px] font-extrabold tracking-tight">{integration.name}</h2>
          {integration.accountLabel && <div className="mt-1 text-[13px] text-text-soft">{integration.accountLabel}</div>}
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={handleSync} loading={syncing} className="h-9 px-3.5 text-[12.5px]">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Synchroniser maintenant
          </Button>
          <Button variant="danger" className="h-9 px-3.5 text-[12.5px]" onClick={() => onDisconnect(integration.id)}>
            Déconnecter
          </Button>
        </div>

        <div>
          <div className="text-[12.5px] font-extrabold">Autorisations demandées</div>
          <ul className="mt-2 flex flex-col gap-1.5">
            {integration.scopes.map((scope) => (
              <li key={scope.label} className="flex items-center gap-2 text-[12.5px] text-text-soft">
                {scope.granted ? (
                  <CheckCircle2 className="h-3.5 w-3.5 flex-none text-success-fg" aria-hidden />
                ) : (
                  <XCircle className="h-3.5 w-3.5 flex-none text-text-faint" aria-hidden />
                )}
                {scope.label}
              </li>
            ))}
          </ul>
          {integration.provider === "google_calendar" && (
            <p className="mt-2.5 rounded-lg bg-surface-alt px-3 py-2 text-[11.5px] leading-relaxed text-text-soft">
              La suppression d&apos;événements n&apos;est jamais demandée : SportVision Club+ ne peut ni
              modifier ni effacer le contenu existant de votre agenda personnel au-delà de ce qu&apos;il y a ajouté.
            </p>
          )}
        </div>

        {integration.calendarMapping && integration.calendarMapping.length > 0 && (
          <div>
            <div className="text-[12.5px] font-extrabold">Correspondance des calendriers</div>
            <div className="mt-2 flex flex-col gap-1.5">
              {integration.calendarMapping.map((m) => (
                <div key={m.source} className="flex items-center justify-between rounded-lg bg-surface-alt px-3 py-2 text-[12px]">
                  <span className="text-text-soft">{m.source}</span>
                  <span className="font-bold">{m.target}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="text-[12.5px] font-extrabold">Historique</div>
          <div className="mt-2 flex flex-col gap-1.5">
            {integration.syncLog.length === 0 && (
              <EmptyState variant="compact" title="Aucune synchronisation pour le moment" className="border-none px-0 py-1 text-left" />
            )}
            {integration.syncLog.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between text-[12px]">
                <span className="text-text-soft">{entry.label}</span>
                <Badge tone={entry.success ? "success" : "danger"}>{entry.success ? "Réussie" : "Échec"}</Badge>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}
