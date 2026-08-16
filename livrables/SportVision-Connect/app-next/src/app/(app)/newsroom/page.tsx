"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, MessageSquarePlus, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess, canCreate } from "@/lib/permissions";
import { LockedModule } from "@/components/ui/LockedModule";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Toast, useToast } from "@/components/feedback/Toast";
import { NewsroomItemModal } from "@/components/newsroom/NewsroomItemModal";
import { cn } from "@/lib/cn";
import {
  createClubNewsroomItem,
  deleteClubNewsroomItem,
  fetchClubNewsroomItems,
  updateClubNewsroomItemDetails,
  updateClubNewsroomItemStatus,
  type NewsroomItemDetails,
  type NewsroomItemInput,
} from "@/lib/data/club/newsroom";
import { createClient } from "@/lib/supabase/client";
import { NEWSROOM_STATUS_LABELS, NEWSROOM_STATUS_TONE, type NewsroomStatus } from "@/lib/types/studio";

// Newsroom — remontées des équipes, transformation en publication ou en demande de visuel.
// Voir ACTIONS.md § 7 et DATA_MODEL.md § NewsroomItem.
//
// 16/08/2026 (chantier Matchcenter/Newsroom) : ajout du cycle de vie complet — avant ce chantier,
// aucune action de ce module ne permettait de créer, modifier ou supprimer une remontée (seuls les
// statuts d'une remontée déjà existante pouvaient changer). La table le permettait déjà (RLS
// cni_member_insert / cni_admin_delete, migration-clubplus-v3.sql), voir data/club/newsroom.ts.
// "Supprimer" reste réservé à role==="admin" côté UI (masquage de confort — la RLS refuse déjà
// l'action pour tout autre rôle, is_club_admin) ; "Modifier" et "Créer" restent ouverts à tout
// membre actif (canWrite), cohérent avec cni_member_insert/update.

type FilterKey = "all" | NewsroomStatus;

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "Tout" },
  { key: "received", label: "Reçu" },
  { key: "to_process", label: "À traiter" },
  { key: "info_requested", label: "Complément demandé" },
  { key: "transformed", label: "Transformé" },
  { key: "archived", label: "Archivé" },
];

/** Le modèle Studio proposé pour la transformation n'est pas déterminé par la maquette : mots-clés
 * simples sur le titre, avec un modèle générique en repli. Le champ `type` (Résultat/Actualité) de
 * la remontée est prioritaire quand il est renseigné explicitement. */
function inferTemplateCode(item: NewsroomItemDetails): string {
  if (item.itemType === "resultat") return "resultat";
  const text = `${item.title} ${item.body}`.toLowerCase();
  if (text.includes("porte")) return "portes-ouvertes";
  if (text.includes("recrut")) return "recrutement-joueurs";
  if (text.includes("stage")) return "stage";
  if (text.includes("partenaire") || text.includes("sponsor")) return "nouveau-partenaire";
  if (text.includes("anniversaire")) return "joueur-anniversaire";
  if (text.includes("victoire") || text.includes("score") || text.includes("gagné")) return "resultat";
  return "communique";
}

export default function NewsroomPage() {
  const { ctx } = useSession();
  const router = useRouter();
  const { toastMessage, toastTone, showToast } = useToast();
  const [filter, setFilter] = useState<FilterKey>("all");

  const allowed = canAccess(ctx, "newsroom");
  const canWrite = canCreate(ctx, "newsroom_item");
  // is_club_admin() (migration-clubplus-v2.sql) vérifie role==='admin' exactement — voir
  // data/club/newsroom.ts § deleteClubNewsroomItem.
  const canDelete = canWrite && ctx.membership.role === "admin";

  const [items, setItems] = useState<NewsroomItemDetails[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<NewsroomItemDetails | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    setLoadError(false);
    fetchClubNewsroomItems(supabase, ctx.organization.id)
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.organization.id]);

  const filtered = (items ?? []).filter((i) => filter === "all" || i.status === filter);

  function applyStatus(item: NewsroomItemDetails, status: "transformed" | "info_requested" | "archived") {
    const supabase = createClient();
    return updateClubNewsroomItemStatus(supabase, item.id, ctx.organization.id, status).then(() => {
      setItems((prev) => (prev ? prev.map((i) => (i.id === item.id ? { ...i, status } : i)) : prev));
    });
  }

  function handleTransform(item: NewsroomItemDetails, into: "publication" | "visual_request") {
    applyStatus(item, "transformed")
      .then(() => {
        if (into === "publication") {
          const code = inferTemplateCode(item);
          router.push(`/studio/${code}?prefillBody=${encodeURIComponent(item.body)}`);
        } else {
          router.push(
            `/requests/new?prefillBody=${encodeURIComponent(item.body)}&teamName=${encodeURIComponent(item.teamName ?? "")}`,
          );
        }
      })
      .catch(() => showToast("Action impossible, réessayez.", "error"));
  }

  function handleRequestInfo(item: NewsroomItemDetails) {
    applyStatus(item, "info_requested")
      .then(() => showToast(`Complément demandé à ${item.submittedByName}.`))
      .catch(() => showToast("Action impossible, réessayez."));
  }

  function handleArchive(item: NewsroomItemDetails) {
    applyStatus(item, "archived")
      .then(() => showToast("Remontée archivée."))
      .catch(() => showToast("Action impossible, réessayez."));
  }

  function handleCreate(input: NewsroomItemInput) {
    const supabase = createClient();
    const authorName = `${ctx.user.firstName} ${ctx.user.lastName}`.trim();
    createClubNewsroomItem(supabase, ctx.organization.id, ctx.user.id, authorName, input)
      .then(() => fetchClubNewsroomItems(supabase, ctx.organization.id))
      .then((rows) => {
        setItems(rows);
        setCreateOpen(false);
        showToast("Remontée créée.");
      })
      .catch(() => showToast("Création impossible, réessayez.", "error"));
  }

  function handleEdit(input: NewsroomItemInput) {
    if (!editingItem) return;
    const supabase = createClient();
    updateClubNewsroomItemDetails(supabase, editingItem.id, ctx.organization.id, input)
      .then(() => {
        setItems((prev) =>
          prev
            ? prev.map((i) =>
                i.id === editingItem.id
                  ? { ...i, title: input.title, body: input.body, teamName: input.teamName, itemType: input.itemType, priority: input.priority }
                  : i,
              )
            : prev,
        );
        setEditingItem(null);
        showToast("Remontée modifiée.");
      })
      .catch(() => showToast("Modification impossible, réessayez.", "error"));
  }

  function handleDelete(item: NewsroomItemDetails) {
    if (!window.confirm(`Supprimer définitivement « ${item.title} » ?`)) return;
    const supabase = createClient();
    deleteClubNewsroomItem(supabase, item.id, ctx.organization.id)
      .then(() => {
        setItems((prev) => (prev ? prev.filter((i) => i.id !== item.id) : prev));
        showToast("Remontée supprimée.");
      })
      .catch(() => showToast("Suppression impossible, réessayez.", "error"));
  }

  if (!allowed) return <LockedModule title="Newsroom" />;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[12px] font-bold text-text-soft">Club+</div>
          <h1 className="mt-1.5 text-[29px] font-extrabold leading-tight tracking-tight">Newsroom</h1>
          <p className="mt-1.5 max-w-2xl text-[13.5px] text-text-soft">
            Les remontées de vos équipes, prêtes à devenir une publication ou une demande de visuel.
          </p>
        </div>
        <Button variant="primary" disabled={!canWrite} onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          Nouvelle remontée
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
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

      {loadError ? (
        <Card className="p-8 text-center">
          <div className="text-[14px] font-extrabold text-danger-fg">Chargement impossible</div>
          <p className="mt-1.5 text-[13px] text-text-soft">Une erreur réseau empêche d&apos;afficher les remontées. Réessayez.</p>
        </Card>
      ) : items === null ? (
        <div className="py-16 text-center text-[13px] text-text-soft">Chargement des remontées…</div>
      ) : filtered.length === 0 ? (
        <Card className="p-8 text-center">
          <div className="text-[14px] font-extrabold">
            {filter === "all" ? "Aucune remontée pour le moment" : "Aucune remontée dans cette vue"}
          </div>
          <p className="mt-1.5 text-[13px] text-text-soft">
            {filter === "all" ? "Créez la première remontée de votre club." : "Rien à traiter pour l'instant."}
          </p>
          {filter === "all" && canWrite && (
            <Button variant="secondary" className="mt-4" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              Nouvelle remontée
            </Button>
          )}
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((item) => (
            <Card key={item.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14.5px] font-extrabold tracking-tight">{item.title}</span>
                    <Badge tone={NEWSROOM_STATUS_TONE[item.status]}>{NEWSROOM_STATUS_LABELS[item.status]}</Badge>
                    {item.priority === "high" && <Badge tone="danger">Priorité haute</Badge>}
                  </div>
                  <div className="mt-1 text-[12px] font-semibold text-text-faint">
                    {item.submittedByName}
                    {item.teamName ? ` · ${item.teamName}` : ""} ·{" "}
                    {new Date(item.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}
                  </div>
                  {item.body && <p className="mt-2 text-[13.5px] leading-relaxed text-text-soft">{item.body}</p>}
                </div>
                <div className="flex flex-none items-center gap-1">
                  {canWrite && (
                    <button
                      aria-label="Modifier la remontée"
                      onClick={() => setEditingItem(item)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-text-soft hover:text-brand-blue-electric"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  )}
                  {canDelete && (
                    <button
                      aria-label="Supprimer la remontée"
                      onClick={() => handleDelete(item)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-text-soft hover:text-danger-fg"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  )}
                </div>
              </div>

              {item.status !== "archived" && item.status !== "transformed" && (
                <div className="mt-3.5 flex flex-wrap gap-2 border-t border-divider pt-3.5">
                  <Button
                    variant="primary"
                    className="h-9 px-3.5 text-[12.5px]"
                    disabled={!canWrite}
                    onClick={() => handleTransform(item, "publication")}
                  >
                    <Sparkles className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                    Transformer en publication
                  </Button>
                  <Button
                    variant="secondary"
                    className="h-9 px-3.5 text-[12.5px]"
                    disabled={!canWrite}
                    onClick={() => handleTransform(item, "visual_request")}
                  >
                    Créer une demande
                  </Button>
                  {item.status !== "info_requested" && (
                    <button
                      onClick={() => handleRequestInfo(item)}
                      className="inline-flex h-9 items-center gap-1.5 px-2 text-[12.5px] font-bold text-text-soft hover:text-brand-blue-electric"
                    >
                      <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden />
                      Demander un complément
                    </button>
                  )}
                  <button
                    onClick={() => handleArchive(item)}
                    className="inline-flex h-9 items-center gap-1.5 px-2 text-[12.5px] font-bold text-text-soft hover:text-danger-fg"
                  >
                    <Archive className="h-3.5 w-3.5" aria-hidden />
                    Archiver
                  </button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {createOpen && <NewsroomItemModal onClose={() => setCreateOpen(false)} onSubmit={handleCreate} />}
      {editingItem && <NewsroomItemModal item={editingItem} onClose={() => setEditingItem(null)} onSubmit={handleEdit} />}

      <Toast message={toastMessage} tone={toastTone} />
    </div>
  );
}
