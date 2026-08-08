"use client";

import { useState } from "react";
import { Download, PenLine, ShieldCheck, Upload } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { childDocumentsByChild, childImageRightsByChild, childrenByParentOrg } from "@/lib/mock/persona";
import { IMAGE_RIGHT_SCOPE_LABELS, type ImageRightScope } from "@/lib/types/persona";
import { LockedModule } from "@/components/persona/LockedModule";
import { ToggleSwitch } from "@/components/persona/ToggleSwitch";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

// /authorizations — documents par enfant + 5 interrupteurs de droit à l'image + mention RGPD.
// ACTIONS.md § 20 « Autorisations ». Les interrupteurs s'appliquent immédiatement (pas de
// bouton d'enregistrement séparé : aucun n'est spécifié dans ACTIONS.md).

const SCOPE_KEYS = Object.keys(IMAGE_RIGHT_SCOPE_LABELS) as ImageRightScope[];

const EMPTY_SCOPES: Record<ImageRightScope, boolean> = {
  team_match_photos: false,
  videos_highlights: false,
  individual_portraits: false,
  commercial_use: false,
  off_club_distribution: false,
};

const DOC_ACTION_LABEL: Record<"download" | "sign" | "upload", string> = {
  download: "Télécharger",
  sign: "Signer",
  upload: "Déposer",
};

const DOC_ACTION_ICON: Record<"download" | "sign" | "upload", typeof Download> = {
  download: Download,
  sign: PenLine,
  upload: Upload,
};

export default function AuthorizationsPage() {
  const { ctx } = useSession();
  const children = childrenByParentOrg[ctx.organization.id] ?? [];

  const [scopesByChild, setScopesByChild] = useState<Record<string, Record<ImageRightScope, boolean>>>(() => {
    const initial: Record<string, Record<ImageRightScope, boolean>> = {};
    for (const child of children) {
      initial[child.id] = childImageRightsByChild[child.id]?.scopes ?? EMPTY_SCOPES;
    }
    return initial;
  });

  if (!canAccess(ctx, "authorizations")) return <LockedModule ctx={ctx} />;

  function toggleScope(childId: string, scope: ImageRightScope) {
    setScopesByChild((prev) => ({
      ...prev,
      [childId]: { ...(prev[childId] ?? EMPTY_SCOPES), [scope]: !(prev[childId] ?? EMPTY_SCOPES)[scope] },
    }));
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[29px] font-extrabold leading-tight tracking-tight">Autorisations</h1>
        <p className="mt-1.5 max-w-2xl text-[13.5px] text-text-soft">
          Documents et droit à l&apos;image de vos enfants. Chaque périmètre peut être activé ou retiré
          indépendamment.
        </p>
      </div>

      {children.length === 0 && (
        <Card className="p-8 text-center text-[13.5px] text-text-soft">Aucun enfant associé à votre espace.</Card>
      )}

      {children.map((child) => {
        const documents = childDocumentsByChild[child.id] ?? [];
        const scopes = scopesByChild[child.id] ?? EMPTY_SCOPES;
        const rightsMeta = childImageRightsByChild[child.id];
        return (
          <Card key={child.id} className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-divider pb-4">
              <div>
                <div className="text-[15px] font-extrabold tracking-tight">
                  {child.firstName} {child.lastName}
                </div>
                <div className="text-[12px] text-text-soft">
                  {child.teamName} · {child.clubName}
                </div>
              </div>
              {rightsMeta?.signedByName ? (
                <span className="flex items-center gap-1.5 text-[12px] font-semibold text-success-fg">
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                  Signé par {rightsMeta.signedByName} le {rightsMeta.signedAt}
                </span>
              ) : (
                <Badge tone="warning">Aucune signature enregistrée</Badge>
              )}
            </div>

            <div className="mt-4">
              <div className="text-[12.5px] font-bold text-text-soft">Documents</div>
              <div className="mt-2 flex flex-col gap-2">
                {documents.map((doc) => {
                  const Icon = DOC_ACTION_ICON[doc.action];
                  return (
                    <div
                      key={doc.id}
                      className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-alt px-3.5 py-2.5"
                    >
                      <span className="min-w-0 flex-1 text-[13px] font-semibold text-text">{doc.label}</span>
                      <Badge tone={doc.status === "up_to_date" ? "success" : "warning"}>
                        {doc.status === "up_to_date" ? "À jour" : "Action requise"}
                      </Badge>
                      <Button variant="secondary" className="h-8 flex-none gap-1.5 px-3 text-[12px]">
                        <Icon className="h-3.5 w-3.5" aria-hidden />
                        {DOC_ACTION_LABEL[doc.action]}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-5">
              <div className="text-[12.5px] font-bold text-text-soft">Étendue du droit à l&apos;image</div>
              <div className="mt-2 flex flex-col gap-2.5">
                {SCOPE_KEYS.map((scope) => (
                  <div
                    key={scope}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border px-3.5 py-2.5"
                  >
                    <span className="text-[13px] font-semibold text-text">{IMAGE_RIGHT_SCOPE_LABELS[scope]}</span>
                    <ToggleSwitch
                      checked={scopes[scope]}
                      onChange={() => toggleScope(child.id, scope)}
                      label={`${IMAGE_RIGHT_SCOPE_LABELS[scope]} — ${child.firstName}`}
                    />
                  </div>
                ))}
              </div>
            </div>
          </Card>
        );
      })}

      <Card className="p-5 text-[12.5px] leading-relaxed text-text-soft">
        <span className="font-bold text-text">RGPD</span> — le retrait d&apos;une autorisation entraîne le retrait
        des contenus déjà publiés sous 72 heures.
      </Card>
    </div>
  );
}
