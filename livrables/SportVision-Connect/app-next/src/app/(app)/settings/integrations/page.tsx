"use client";

import { useState } from "react";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { mockIntegrations } from "@/lib/mock/settings";
import type { Integration } from "@/lib/types/settings";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { LockedModule } from "@/components/ui/LockedModule";
import { IntegrationSyncPanel } from "@/components/settings/IntegrationSyncPanel";

// /settings/integrations — voir ACTIONS.md § 25 « Intégrations ». 6 services avec état, compte
// lié, dernière synchronisation, Connecter / Reconnecter. Le panneau de synchronisation est une
// modale, voir IntegrationSyncPanel.
const STATUS_LABEL: Record<Integration["status"], { label: string; tone: "success" | "neutral" | "danger" }> = {
  connected: { label: "Connecté", tone: "success" },
  disconnected: { label: "Non connecté", tone: "neutral" },
  error: { label: "Erreur", tone: "danger" },
};

export default function IntegrationsSettingsPage() {
  const { ctx } = useSession();
  const [integrations, setIntegrations] = useState<Integration[]>(
    () => mockIntegrations[ctx.organization.id] ?? [],
  );
  const [openId, setOpenId] = useState<string | null>(null);

  if (!canAccess(ctx, "settings")) return <LockedModule title="Paramètres" />;

  const open = integrations.find((i) => i.id === openId) ?? null;

  function handleSync(id: string) {
    setIntegrations((prev) =>
      prev.map((i) => (i.id === id ? { ...i, status: "connected", lastSyncedAt: new Date().toISOString() } : i)),
    );
  }

  function handleDisconnect(id: string) {
    setIntegrations((prev) => prev.map((i) => (i.id === id ? { ...i, status: "disconnected", accountLabel: undefined } : i)));
    setOpenId(null);
  }

  function handleConnect(id: string) {
    setIntegrations((prev) => prev.map((i) => (i.id === id ? { ...i, status: "connected" } : i)));
  }

  if (integrations.length === 0) {
    // mockIntegrations n'est peuplé que pour 3 organisations de démo (voir src/lib/mock/settings.ts,
    // "à remplacer par de vraies requêtes plus tard" — jamais branché sur de vraies données pour
    // cet écran) : toute organisation réelle tombe ici. Un état vide honnête plutôt qu'un écran
    // qui semble cassé (trouvé en testant avec un vrai club) — voir le rapport pour le vrai trou
    // fonctionnel derrière (aucune intégration n'est réellement branchée à ce jour).
    return (
      <Card className="p-9 text-center text-[13.5px] text-text-soft">
        Aucune intégration disponible pour le moment.
      </Card>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        {integrations.map((integration) => {
          const status = STATUS_LABEL[integration.status];
          return (
            <Card key={integration.id} className="flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[14px] font-extrabold tracking-tight">{integration.name}</div>
                  <div className="mt-1 text-[12px] leading-relaxed text-text-soft">{integration.description}</div>
                </div>
                <Badge tone={status.tone}>{status.label}</Badge>
              </div>

              {integration.status === "connected" && (
                <div className="text-[11.5px] text-text-faint">
                  {integration.accountLabel && <div>{integration.accountLabel}</div>}
                  {integration.lastSyncedAt && (
                    <div>Dernière synchronisation {new Date(integration.lastSyncedAt).toLocaleString("fr-FR")}</div>
                  )}
                </div>
              )}

              <div className="mt-auto flex gap-2">
                {integration.status === "connected" ? (
                  <Button variant="secondary" className="h-9 flex-1 px-3 text-[12.5px]" onClick={() => setOpenId(integration.id)}>
                    Gérer
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    className="h-9 flex-1 px-3 text-[12.5px]"
                    onClick={() => handleConnect(integration.id)}
                  >
                    {integration.status === "error" ? "Reconnecter" : "Connecter"}
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {open && (
        <IntegrationSyncPanel
          integration={open}
          onClose={() => setOpenId(null)}
          onSync={handleSync}
          onDisconnect={handleDisconnect}
        />
      )}
    </>
  );
}
