"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Columns3, Download, SlidersHorizontal, X } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess, canCreate } from "@/lib/permissions";
import { LockedModule } from "@/components/ui/LockedModule";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Toast, useToast } from "@/components/feedback/Toast";
import { cn } from "@/lib/cn";
import { cancelClubRequest, fetchClubRequests } from "@/lib/data/club/requests";
import { cancelOrgRequest, fetchOrgRequests } from "@/lib/data/shared/requests";
import { createClient } from "@/lib/supabase/client";
import {
  URGENCY_META,
  VISUAL_REQUEST_STATUS_TONE,
  VISUAL_TYPE_LABELS,
  type VisualRequest,
  type VisualRequestUrgency,
} from "@/lib/types/studio";

// Demandes de visuels — liste avec filtres, colonnes, export et sélection multiple.
// Voir ACTIONS.md § 11 et DATA_MODEL.md § VisualRequest.
//
// Statuts réellement produits par le backend (STATUS_MAP, data/club/requests.ts et
// data/shared/requests.ts) : Envoyée, À compléter, En traitement, Acceptée, Terminée, Refusée.
// "À valider"/"Brouillon"/"En production"/"Correction"/"Annulée" n'existent dans aucun mapper —
// tout onglet/filtre construit dessus serait structurellement toujours vide.

type FilterKey = "all" | "in_creation" | "delivered";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "Toutes" },
  { key: "in_creation", label: "En cours" },
  { key: "delivered", label: "Livrées" },
];

/** "Express" n'a pas d'équivalent réel côté colonne (urgency ne supporte que
 * normale/haute, voir migration-clubplus-v4.sql) — retiré du formulaire de création
 * (requests/new), donc jamais produit par de vraies données ici non plus. */
const REAL_URGENCIES: VisualRequestUrgency[] = ["standard", "priority"];

function matchesFilter(r: VisualRequest, filter: FilterKey): boolean {
  switch (filter) {
    case "all":
      return true;
    case "in_creation":
      return ["Acceptée", "En traitement"].includes(r.status);
    case "delivered":
      return r.status === "Terminée";
    default:
      return true;
  }
}

type ColumnKey = "team" | "urgency" | "credits";

const OPTIONAL_COLUMNS: { key: ColumnKey; label: string }[] = [
  { key: "team", label: "Équipe" },
  { key: "urgency", label: "Urgence" },
  { key: "credits", label: "Crédits" },
];

const PAGE_SIZE = 8;

export default function RequestsPage() {
  const { ctx } = useSession();
  const { toastMessage, showToast } = useToast();

  const [filter, setFilter] = useState<FilterKey>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
  const [urgencyFilter, setUrgencyFilter] = useState<Set<VisualRequestUrgency>>(new Set());
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(new Set(["team", "urgency", "credits"]));
  const [detailId, setDetailId] = useState<string | null>(null);
  const [orgRequests, setOrgRequests] = useState<VisualRequest[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  const allowed = canAccess(ctx, "visual_requests");
  const canWrite = canCreate(ctx, "visual_request");
  // club_requests (Espace Club) vs requests générique (Coach/Académie/Sponsor, Phase 4) — même
  // forme VisualRequest en sortie, source différente selon le type d'organisation.
  const isGenericOrg = ["coach", "academy", "sponsor"].includes(ctx.organization.type);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    setLoadError(false);
    const fetcher = isGenericOrg ? fetchOrgRequests(supabase, ctx.organization.id) : fetchClubRequests(supabase, ctx.organization.id);
    fetcher
      .then((rows) => {
        if (!cancelled) setOrgRequests(rows);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.organization.id, isGenericOrg]);

  if (!allowed) return <LockedModule title="Demandes de visuels" />;

  function handleCancel(r: VisualRequest) {
    if (!window.confirm(`Annuler la demande ${r.reference} ?`)) return;
    const supabase = createClient();
    const cancelFn = isGenericOrg ? cancelOrgRequest : cancelClubRequest;
    cancelFn(supabase, r.id, ctx.organization.id)
      .then((updated) => {
        setOrgRequests((prev) => (prev ? prev.map((row) => (row.id === updated.id ? updated : row)) : prev));
        setDetailId(null);
        showToast(`Demande ${r.reference} annulée.`);
      })
      .catch(() => showToast("Cette demande ne peut plus être annulée — elle est déjà prise en charge."));
  }

  const requests = orgRequests ?? [];
  const filteredByTab = requests.filter((r) => matchesFilter(r, filter));
  const filtered = filteredByTab.filter((r) => (urgencyFilter.size === 0 ? true : urgencyFilter.has(r.urgency)));

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const detailRequest = detailId ? requests.find((r) => r.id === detailId) ?? null : null;

  function toggleSelectAll() {
    if (selected.size === pageRows.length && pageRows.every((r) => selected.has(r.id))) {
      setSelected(new Set());
    } else {
      setSelected(new Set(pageRows.map((r) => r.id)));
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Un membre club ne peut agir que sur une demande encore "Envoyée" (annulation) — toute autre
  // transition est staff-only côté RPC (voir data/club/requests.ts). Pas de validation/
  // téléchargement en masse possible depuis Connect en Phase 1.
  function handleValidateSelection() {
    const targets = requests.filter((r) => selected.has(r.id) && r.status === "Envoyée");
    if (targets.length === 0) {
      setSelected(new Set());
      showToast("Aucune demande annulable dans la sélection.");
      return;
    }
    if (!window.confirm(`Annuler ${targets.length} demande${targets.length > 1 ? "s" : ""} ?`)) return;
    setSelected(new Set());
    const supabase = createClient();
    const cancelFn = isGenericOrg ? cancelOrgRequest : cancelClubRequest;
    Promise.allSettled(targets.map((r) => cancelFn(supabase, r.id, ctx.organization.id))).then((results) => {
      const updated = results
        .filter((r): r is PromiseFulfilledResult<VisualRequest> => r.status === "fulfilled")
        .map((r) => r.value);
      const updatedById = new Map(updated.map((r) => [r.id, r]));
      setOrgRequests((prev) => (prev ? prev.map((row) => updatedById.get(row.id) ?? row) : prev));
      const failedCount = results.length - updated.length;
      if (updated.length > 0 && failedCount === 0) {
        showToast(`${updated.length} demande${updated.length > 1 ? "s" : ""} annulée${updated.length > 1 ? "s" : ""}.`);
      } else if (updated.length > 0) {
        showToast(
          `${updated.length} demande${updated.length > 1 ? "s" : ""} annulée${updated.length > 1 ? "s" : ""}, ${failedCount} déjà prise${failedCount > 1 ? "s" : ""} en charge.`,
        );
      } else {
        showToast("Aucune annulation n'a abouti — ces demandes sont déjà prises en charge.");
      }
    });
  }

  function handleRowAction(r: VisualRequest) {
    if (r.status === "Envoyée") {
      handleCancel(r);
      return;
    }
    setDetailId(r.id);
  }

  function rowActionLabel(r: VisualRequest): string {
    if (r.status === "Envoyée") return "Annuler";
    return "Suivre";
  }

  function exportCsv() {
    const cols = ["Référence", "Type", "Équipe", "Urgence", "Statut", "Créée le", "Crédits réservés"];
    const rows = filtered.map((r) => [
      r.reference,
      VISUAL_TYPE_LABELS[r.visualType],
      r.teamName ?? "",
      URGENCY_META[r.urgency].label,
      r.status,
      r.createdAt,
      String(r.creditsReserved),
    ]);
    const csv = [cols, ...rows].map((row) => row.map((v) => `"${v.replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "demandes-visuels.csv";
    a.click();
    URL.revokeObjectURL(url);
    showToast("Export CSV téléchargé.");
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[12px] font-bold text-text-soft">Communication</div>
          <h1 className="mt-1.5 text-[29px] font-extrabold leading-tight tracking-tight">Demandes de visuels</h1>
        </div>
        <Link href="/requests/new">
          <Button variant="primary" disabled={!canWrite}>
            Nouvelle demande de visuel
          </Button>
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => {
                setFilter(f.key);
                setPage(1);
              }}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-[12.5px] font-bold transition-colors duration-sv",
                filter === f.key
                  ? "border-transparent bg-gradient-to-br from-brand-blue to-brand-violet text-white"
                  : "border-border-strong bg-transparent text-text-soft hover:border-brand-blue-electric",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="relative">
            <Button variant="secondary" className="h-9 px-3 text-[12.5px]" onClick={() => setShowFilters((s) => !s)}>
              <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              Filtres
            </Button>
            {showFilters && (
              <div className="absolute right-0 top-11 z-20 w-56 rounded-sv border border-border-strong bg-elevated p-3 shadow-sv-dropdown">
                <div className="text-[11px] font-extrabold uppercase tracking-wide text-text-faint">Urgence</div>
                <div className="mt-2 flex flex-col gap-1.5">
                  {REAL_URGENCIES.map((u) => (
                    <label key={u} className="flex items-center gap-2 text-[13px] font-semibold text-text-soft">
                      <input
                        type="checkbox"
                        checked={urgencyFilter.has(u)}
                        onChange={() =>
                          setUrgencyFilter((prev) => {
                            const next = new Set(prev);
                            if (next.has(u)) next.delete(u);
                            else next.add(u);
                            return next;
                          })
                        }
                      />
                      {URGENCY_META[u].label}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="relative">
            <Button variant="secondary" className="h-9 px-3 text-[12.5px]" onClick={() => setShowColumns((s) => !s)}>
              <Columns3 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              Colonnes
            </Button>
            {showColumns && (
              <div className="absolute right-0 top-11 z-20 w-56 rounded-sv border border-border-strong bg-elevated p-3 shadow-sv-dropdown">
                {OPTIONAL_COLUMNS.map((c) => (
                  <label key={c.key} className="flex items-center gap-2 py-1 text-[13px] font-semibold text-text-soft">
                    <input
                      type="checkbox"
                      checked={visibleColumns.has(c.key)}
                      onChange={() =>
                        setVisibleColumns((prev) => {
                          const next = new Set(prev);
                          if (next.has(c.key)) next.delete(c.key);
                          else next.add(c.key);
                          return next;
                        })
                      }
                    />
                    {c.label}
                  </label>
                ))}
              </div>
            )}
          </div>

          <Button variant="secondary" className="h-9 px-3 text-[12.5px]" onClick={exportCsv}>
            <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            Exporter
          </Button>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center justify-between rounded-sv border border-brand-blue-electric/50 bg-info-bg px-4 py-2.5">
          <span className="text-[12.5px] font-bold text-info-fg">{selected.size} sélectionnée{selected.size > 1 ? "s" : ""}</span>
          <Button variant="primary" className="h-8 px-3 text-[12px]" onClick={handleValidateSelection}>
            Annuler la sélection
          </Button>
        </div>
      )}

      {loadError ? (
        <Card className="p-8 text-center">
          <div className="text-[14px] font-extrabold text-danger-fg">Chargement impossible</div>
          <p className="mt-1.5 text-[13px] text-text-soft">Une erreur réseau empêche d&apos;afficher vos demandes. Réessayez.</p>
        </Card>
      ) : orgRequests === null ? (
        <div className="py-16 text-center text-[13px] text-text-soft">Chargement des demandes…</div>
      ) : filtered.length === 0 ? (
        <Card className="p-8 text-center">
          <div className="text-[14px] font-extrabold">Vous n&apos;avez encore créé aucune demande.</div>
          <p className="mt-1.5 text-[13px] text-text-soft">Commencez par demander votre premier visuel.</p>
          <Link href="/requests/new" className="mt-4 inline-block">
            <Button variant="primary" disabled={!canWrite}>
              Demander un visuel
            </Button>
          </Link>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-divider bg-bg-alt text-left text-[11px] font-extrabold uppercase tracking-wide text-text-faint">
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={pageRows.length > 0 && pageRows.every((r) => selected.has(r.id))}
                      onChange={toggleSelectAll}
                      aria-label="Tout sélectionner"
                    />
                  </th>
                  <th className="px-3 py-3">Référence</th>
                  <th className="px-3 py-3">Type</th>
                  {visibleColumns.has("team") && <th className="px-3 py-3">Équipe</th>}
                  {visibleColumns.has("urgency") && <th className="px-3 py-3">Urgence</th>}
                  <th className="px-3 py-3">Statut</th>
                  <th className="px-3 py-3">Créée le</th>
                  {visibleColumns.has("credits") && <th className="px-3 py-3">Crédits</th>}
                  <th className="px-3 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-divider last:border-0 hover:bg-row-hover"
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(r.id)}
                        onChange={() => toggleSelect(r.id)}
                        aria-label={`Sélectionner ${r.reference}`}
                      />
                    </td>
                    <td className="px-3 py-3 font-mono text-[12.5px] font-medium">{r.reference}</td>
                    <td className="px-3 py-3 font-semibold">{VISUAL_TYPE_LABELS[r.visualType]}</td>
                    {visibleColumns.has("team") && <td className="px-3 py-3 text-text-soft">{r.teamName ?? "—"}</td>}
                    {visibleColumns.has("urgency") && (
                      <td className="px-3 py-3 text-text-soft">{URGENCY_META[r.urgency].label}</td>
                    )}
                    <td className="px-3 py-3">
                      <Badge tone={VISUAL_REQUEST_STATUS_TONE[r.status]}>{r.status}</Badge>
                    </td>
                    <td className="px-3 py-3 text-text-soft">
                      {new Date(r.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                    </td>
                    {visibleColumns.has("credits") && (
                      <td className="px-3 py-3 font-mono text-text-soft">{r.creditsReserved}</td>
                    )}
                    <td className="px-3 py-3 text-right">
                      <button
                        onClick={() => handleRowAction(r)}
                        className="text-[12.5px] font-bold text-brand-blue-electric hover:text-brand-violet"
                      >
                        {rowActionLabel(r)}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between border-t border-divider px-4 py-3 text-[12.5px] text-text-soft">
            <span>
              Page {currentPage} / {totalPages} · {filtered.length} demande{filtered.length > 1 ? "s" : ""}
            </span>
            <div className="flex gap-1.5">
              <button
                disabled={currentPage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                aria-label="Page précédente"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-strong disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </button>
              <button
                disabled={currentPage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                aria-label="Page suivante"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-strong disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>
        </Card>
      )}

      {detailRequest && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50" role="dialog" aria-modal="true">
          <div className="animate-svfade h-full w-full max-w-md overflow-y-auto border-l border-border bg-elevated p-6 shadow-sv-panel">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-mono text-[12.5px] text-text-faint">{detailRequest.reference}</div>
                <div className="mt-1 text-[18px] font-extrabold tracking-tight">
                  {VISUAL_TYPE_LABELS[detailRequest.visualType]}
                </div>
              </div>
              <button
                aria-label="Fermer"
                onClick={() => setDetailId(null)}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-strong text-text-soft"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <div className="mt-4">
              <Badge tone={VISUAL_REQUEST_STATUS_TONE[detailRequest.status]}>{detailRequest.status}</Badge>
            </div>
            <dl className="mt-4 flex flex-col gap-2.5 text-[13px]">
              <Row label="Équipe" value={detailRequest.teamName ?? "—"} />
              <Row label="Urgence" value={URGENCY_META[detailRequest.urgency].label} />
              <Row label="Crédits réservés" value={String(detailRequest.creditsReserved)} />
              <Row label="Créée le" value={new Date(detailRequest.createdAt).toLocaleDateString("fr-FR")} />
              <Row label="Corrections" value={`${detailRequest.revisionCount} / 2 incluses`} />
            </dl>
            {detailRequest.bodyText && (
              <div className="mt-4 rounded-xl border border-border bg-surface-alt p-3 text-[13px] text-text-soft">
                {detailRequest.bodyText}
              </div>
            )}
            {detailRequest.status === "Envoyée" && (
              <Button variant="secondary" className="mt-4 w-full" onClick={() => handleCancel(detailRequest)}>
                Annuler la demande
              </Button>
            )}
          </div>
        </div>
      )}

      <Toast message={toastMessage} />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-divider pb-2">
      <dt className="font-bold text-text-soft">{label}</dt>
      <dd className="text-right text-text">{value}</dd>
    </div>
  );
}
