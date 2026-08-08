"use client";

import { useMemo, useState } from "react";
import { FileText, Upload } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { mockDocuments } from "@/lib/mock/settings";
import { DOCUMENT_KIND_LABELS, type AppDocument, type DocumentKind, type DocumentStatus } from "@/lib/types/settings";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import { LockedModule } from "@/components/ui/LockedModule";

// /documents — voir DATA_MODEL.md § Document (pas de section ACTIONS.md dédiée : cohérence
// gardée avec les autres listes de l'app — filtres en puces, recherche, actions de ligne
// dépendantes du statut, une seule action principale).
const STATUS_META: Record<DocumentStatus, { label: string; tone: "success" | "warning" | "info" | "danger"; action: string }> = {
  to_review: { label: "À consulter", tone: "info", action: "Consulter" },
  to_sign: { label: "À signer", tone: "warning", action: "Signer" },
  to_complete: { label: "À compléter", tone: "warning", action: "Compléter" },
  valid: { label: "Valide", tone: "success", action: "Télécharger" },
  expired: { label: "Expiré", tone: "danger", action: "Renouveler" },
};

const KIND_FILTERS: (DocumentKind | "all")[] = [
  "all",
  "contract",
  "invoice",
  "quote",
  "image_right",
  "brand_guidelines",
  "logo_pack",
  "insurance",
  "medical",
  "roster",
  "report",
  "other",
];

function formatSize(bytes: number): string {
  if (bytes === 0) return "—";
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} Ko`;
  return `${(bytes / 1_000_000).toFixed(1)} Mo`;
}

export default function DocumentsPage() {
  const { ctx } = useSession();
  const [documents, setDocuments] = useState<AppDocument[]>(() => mockDocuments[ctx.organization.id] ?? []);
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<DocumentKind | "all">("all");

  if (!canAccess(ctx, "documents")) return <LockedModule title="Documents" />;

  const filtered = useMemo(
    () =>
      documents
        .filter((d) => kindFilter === "all" || d.kind === kindFilter)
        .filter((d) => !query.trim() || d.name.toLowerCase().includes(query.trim().toLowerCase())),
    [documents, kindFilter, query],
  );

  function handleImport() {
    setDocuments((prev) => [
      {
        id: `doc-local-${Date.now()}`,
        organizationId: ctx.organization.id,
        name: "Nouveau document.pdf",
        kind: "other",
        mimeType: "application/pdf",
        sizeBytes: 240_000,
        uploadedByName: `${ctx.user.firstName} ${ctx.user.lastName}`,
        uploadedAt: new Date().toISOString(),
        status: "to_review",
      },
      ...prev,
    ]);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[29px] font-extrabold tracking-tight">Documents</h1>
          <p className="mt-1 text-[13.5px] text-text-soft">Contrats, factures, autorisations et pièces partagées avec SportVision.</p>
        </div>
        <Button onClick={handleImport}>
          <Upload className="h-4 w-4" aria-hidden />
          Importer un document
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher un document…"
          className="h-10 w-full max-w-xs rounded-xl border border-border-strong bg-input-bg px-3.5 text-[13.5px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,84,255,.12)]"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {KIND_FILTERS.map((kind) => (
          <button
            key={kind}
            onClick={() => setKindFilter(kind)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-[12px] font-bold transition-colors duration-sv",
              kindFilter === kind ? "border-brand-blue bg-info-bg text-info-fg" : "border-border text-text-soft hover:border-border-strong",
            )}
          >
            {kind === "all" ? "Tous" : DOCUMENT_KIND_LABELS[kind]}
          </button>
        ))}
      </div>

      <Card>
        {filtered.length === 0 ? (
          <div className="p-9 text-center text-[13.5px] text-text-soft">
            Aucun document ne correspond à votre recherche.
          </div>
        ) : (
          filtered.map((doc) => {
            const meta = STATUS_META[doc.status];
            return (
              <div
                key={doc.id}
                className="flex flex-wrap items-center gap-3.5 border-b border-divider px-5 py-3.5 last:border-0 hover:bg-row-hover"
              >
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-info-bg text-info-fg">
                  <FileText className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-bold">{doc.name}</span>
                  <span className="mt-0.5 block text-[12px] text-text-soft">
                    {DOCUMENT_KIND_LABELS[doc.kind]} · {doc.uploadedByName} ·{" "}
                    {new Date(doc.uploadedAt).toLocaleDateString("fr-FR")}
                    {doc.teamName ? ` · ${doc.teamName}` : ""}
                    {doc.playerName ? ` · ${doc.playerName}` : ""}
                  </span>
                </span>
                <span className="w-16 flex-none text-right font-mono text-[11.5px] text-text-faint">
                  {formatSize(doc.sizeBytes)}
                </span>
                <Badge tone={meta.tone}>{meta.label}</Badge>
                <Button variant="secondary" className="h-8 flex-none px-3 text-[12px]">
                  {meta.action}
                </Button>
              </div>
            );
          })
        )}
      </Card>
    </div>
  );
}
