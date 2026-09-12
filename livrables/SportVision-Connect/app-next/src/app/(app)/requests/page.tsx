"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Columns3, Download, SlidersHorizontal, X } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess, canCreate } from "@/lib/permissions";
import { LockedModule } from "@/components/ui/LockedModule";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Toast, useToast } from "@/components/feedback/Toast";
import { cn } from "@/lib/cn";
import {
  cancelClubRequest,
  fetchClubRequests,
  fetchContenusDesDemandes,
  statutBrutDemande,
  transformerDemandeEnContenu,
  type ContenuDeDemande,
} from "@/lib/data/club/requests";
import { etatParcours } from "@/lib/communication/parcours";
import { ParcoursCommunication } from "@/components/communication/ParcoursCommunication";
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
  const { toastMessage, toastTone, showToast } = useToast();

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
  // Le CM SportVision lit cet ecran a l'envers : ce ne sont pas SES demandes, ce sont celles que
  // le club lui adresse. Meme donnee, perspective inverse — pas un second module.
  const estCmSportVision = ctx.membership.role === "external_cm";
  // club_requests (Espace Club) vs requests générique (Coach/Académie/Sponsor, et désormais
  // Projet/"generic" — migration-connect-v24-projet-credits.sql) — même forme VisualRequest en
  // sortie, source différente selon le type d'organisation. Doit rester en phase avec
  // usesGenericRequestsTable de requests/new/page.tsx : une demande Projet est écrite dans
  // `requests`, elle doit être relue depuis `requests`, pas `club_requests` (vide pour cet id).
  const isGenericOrg = ["coach", "academy", "sponsor", "generic"].includes(ctx.organization.type);

  const loadRequests = useCallback(() => {
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

  useEffect(() => loadRequests(), [loadRequests]);

  // Le contenu né de chaque demande (v125) : c'est ce qui relie « Demandes » et le Centre
  // communication. Un refus (rôle qui n'opère pas le club) laisse simplement la carte vide.
  const [contenusParDemande, setContenusParDemande] = useState<Map<string, ContenuDeDemande>>(new Map());
  const chargerContenus = useCallback(() => {
    if (isGenericOrg) return;
    fetchContenusDesDemandes(createClient(), ctx.organization.id)
      .then(setContenusParDemande)
      .catch(() => setContenusParDemande(new Map()));
  }, [isGenericOrg, ctx.organization.id]);
  useEffect(() => chargerContenus(), [chargerContenus]);

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
      .catch(() => showToast("Cette demande ne peut plus être annulée, elle est déjà prise en charge.", "error"));
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
      showToast("Aucune demande annulable dans la sélection.", "error");
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
        showToast("Aucune annulation n'a abouti, ces demandes sont déjà prises en charge.", "error");
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
    // Bible §10/§16 : "Compléter les informations demandées sans rouvrir tout le workflow" pour
    // une demande "À compléter" — le libellé du bouton l'annonce dès la liste, avant même d'ouvrir
    // le détail (voir le panneau ci-dessous pour l'action réelle).
    if (r.status === "À compléter") return "Compléter";
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
          <h1 className="mt-1.5 text-[29px] font-extrabold leading-tight tracking-tight">
            {estCmSportVision ? "Demandes du club" : "Demandes de visuels"}
          </h1>
          {estCmSportVision && (
            <p className="mt-1 text-[13px] text-text-soft">
              Ce que le club vous demande de produire. Vous ne commandez rien ici : c&apos;est vous qui créez.
            </p>
          )}
        </div>
        {!estCmSportVision && (
          <Link href="/requests/new">
            <Button variant="primary" disabled={!canWrite}>
              Nouvelle demande de visuel
            </Button>
          </Link>
        )}
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
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-sv border border-brand-blue-electric/50 bg-info-bg px-4 py-2.5">
          <span className="text-[12.5px] font-bold text-info-fg">{selected.size} sélectionnée{selected.size > 1 ? "s" : ""}</span>
          <div className="flex items-center gap-2">
            {/* 12/09/2026 — Le seul bouton s'appelait « Annuler la sélection », ce qui se lit
                « vider ma sélection », et envoyait en réalité autant d'annulations de demandes en
                base. Le dirigeant qui cochait dix demandes pour comparer, puis se ravisait,
                annulait ses dix demandes. Le bouton dit maintenant ce qu'il fait, et le geste
                inoffensif existe à côté. */}
            <Button variant="secondary" className="h-8 px-3 text-[12px]" onClick={() => setSelected(new Set())}>
              Vider la sélection
            </Button>
            <Button variant="danger" className="h-8 px-3 text-[12px]" onClick={handleValidateSelection}>
              Annuler ces {selected.size} demande{selected.size > 1 ? "s" : ""}
            </Button>
          </div>
        </div>
      )}

      {loadError ? (
        <Card>
          <ErrorState message="Une erreur réseau empêche d'afficher vos demandes." onRetry={loadRequests} />
        </Card>
      ) : orgRequests === null ? (
        <Card className="overflow-hidden p-0">
          <div className="border-b border-divider bg-bg-alt px-4 py-3">
            <Skeleton className="h-3 w-32" />
          </div>
          <div className="divide-y divide-divider">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3.5">
                <Skeleton className="h-4 w-4 rounded" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="ml-auto h-5 w-16 rounded-full" />
              </div>
            ))}
          </div>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          {estCmSportVision ? (
            <EmptyState
              title="Aucune demande du club pour le moment"
              description="Les demandes du président, des coachs et des dirigeants arriveront ici."
            />
          ) : (
            <EmptyState title="Vous n'avez encore créé aucune demande" description="Commencez par demander votre premier visuel.">
              <Link href="/requests/new">
                <Button variant="primary" disabled={!canWrite}>
                  Demander un visuel
                </Button>
              </Link>
            </EmptyState>
          )}
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
            {!isGenericOrg && (
              <SuiviDemande
                demandeId={detailRequest.id}
                statut={detailRequest.status}
                titreParDefaut={`${VISUAL_TYPE_LABELS[detailRequest.visualType]}${detailRequest.teamName ? ` — ${detailRequest.teamName}` : ""}`}
                contenu={contenusParDemande.get(detailRequest.id) ?? null}
                peutTransformer={estCmSportVision}
                onTransforme={() => {
                  chargerContenus();
                  loadRequests();
                }}
              />
            )}
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
            {/* Bible §10/§16 : "Compléter les informations demandées sans rouvrir tout le
                workflow" — pas de RPC client pour modifier/répondre directement sur une demande
                (update_club_request_status/update_request_status ne permettent qu'une transition
                vers 'refusee' côté client, voir data/club/requests.ts et data/shared/requests.ts :
                toute autre transition est staff-only). Réutilise le mécanisme déjà câblé ailleurs
                (billing/page.tsx, documents/page.tsx, MediaDetail.tsx) pour "Contacter le
                support" avec contexte repris automatiquement (Bible §21) — un ticket réel
                (createClubSupportTicket) plutôt qu'un renvoi vers /requests/new, qui rouvrirait le
                formulaire de création complet. */}
            {detailRequest.status === "À compléter" && (
              <div className="mt-4 flex flex-col gap-2.5 rounded-xl border border-warning-fg/30 bg-warning-bg px-3.5 py-3">
                <p className="text-[12.5px] font-semibold text-warning-fg">
                  SportVision attend une information complémentaire sur cette demande.
                </p>
                <Link
                  href={`/support?ctx_type=request&ctx_id=${encodeURIComponent(detailRequest.id)}&ctx_label=${encodeURIComponent(detailRequest.reference)}`}
                >
                  <Button variant="primary" className="w-full">
                    Compléter les informations
                  </Button>
                </Link>
              </div>
            )}
          </div>
        </div>
      )}

      <Toast message={toastMessage} tone={toastTone} />
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

const PLATEFORMES = ["Instagram", "Facebook", "TikTok", "LinkedIn", "YouTube", "Autre"];

/** Le suivi d'une demande : la frise de son parcours, et le geste qui la fait avancer. Pour le CM,
 *  « Transformer en contenu » crée le brouillon relié à la demande ; ce contenu apparaît aussitôt
 *  dans le Centre communication. Un seul parcours, pas deux écrans à tenir à jour. */
function SuiviDemande({
  demandeId,
  statut,
  titreParDefaut,
  contenu,
  peutTransformer,
  onTransforme,
}: {
  demandeId: string;
  statut: string;
  titreParDefaut: string;
  contenu: ContenuDeDemande | null;
  peutTransformer: boolean;
  onTransforme: () => void;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [titre, setTitre] = useState(titreParDefaut);
  const [date, setDate] = useState("");
  const [plateforme, setPlateforme] = useState("Instagram");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function transformer() {
    setEnvoi(true);
    setErreur(null);
    try {
      await transformerDemandeEnContenu(createClient(), demandeId, { titre, datePrevue: date, plateforme: plateforme.toLowerCase() });
      setOuvert(false);
      onTransforme();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "La transformation a échoué.");
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      <ParcoursCommunication etat={etatParcours(statutBrutDemande(statut), contenu?.statut ?? null)} />
      {contenu ? (
        <div className="rounded-xl border border-border bg-surface-alt px-3.5 py-3 text-[12.5px]">
          <div className="font-bold">{contenu.titre}</div>
          <div className="mt-0.5 text-text-soft">
            Contenu relié à cette demande{contenu.datePrevue ? ` · prévu le ${new Date(contenu.datePrevue).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}` : ""}
          </div>
          <Link href={`/communication/publications/${contenu.contenuId}`} className="mt-1.5 inline-block font-bold text-info-fg hover:underline">
            Ouvrir dans le Centre communication →
          </Link>
        </div>
      ) : peutTransformer && statut !== "Refusée" ? (
        !ouvert ? (
          <Button className="w-full" onClick={() => setOuvert(true)}>
            Transformer en contenu
          </Button>
        ) : (
          <div className="flex flex-col gap-2.5 rounded-xl border border-border-strong p-3.5">
            <label className="flex flex-col gap-1 text-[12px] font-bold text-text-soft">
              Titre du contenu
              <input value={titre} onChange={(e) => setTitre(e.target.value)} className="h-10 rounded-lg border border-border-strong bg-input-bg px-3 text-[13.5px] font-normal text-text" />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-[12px] font-bold text-text-soft">
                Date prévue
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-10 rounded-lg border border-border-strong bg-input-bg px-3 text-[13px] font-normal text-text" />
              </label>
              <label className="flex flex-col gap-1 text-[12px] font-bold text-text-soft">
                Plateforme
                <select value={plateforme} onChange={(e) => setPlateforme(e.target.value)} className="h-10 rounded-lg border border-border-strong bg-input-bg px-2 text-[13px] font-normal text-text">
                  {PLATEFORMES.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </label>
            </div>
            <p className="text-[11.5px] text-text-faint">
              Le contenu naît en brouillon, relié à cette demande, et apparaît dans le Centre communication. La demande passe
              « En traitement ».
            </p>
            {erreur && <p className="text-[12.5px] font-bold text-danger-fg">{erreur}</p>}
            <div className="flex gap-2">
              <Button loading={envoi} onClick={transformer}>
                Créer le contenu
              </Button>
              <Button variant="secondary" disabled={envoi} onClick={() => setOuvert(false)}>
                Annuler
              </Button>
            </div>
          </div>
        )
      ) : null}
    </div>
  );
}
