"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, MessageSquarePlus, Sparkles } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess, canCreate } from "@/lib/permissions";
import { LockedModule } from "@/components/ui/LockedModule";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Toast, useToast } from "@/components/feedback/Toast";
import { cn } from "@/lib/cn";
import { fetchClubNewsroomItems, updateClubNewsroomItemStatus } from "@/lib/data/club/newsroom";
import { createClient } from "@/lib/supabase/client";
import { NEWSROOM_STATUS_LABELS, NEWSROOM_STATUS_TONE, type NewsroomItem, type NewsroomStatus } from "@/lib/types/studio";

// Newsroom — remontées des équipes, transformation en publication ou en demande de visuel.
// Voir ACTIONS.md § 7 et DATA_MODEL.md § NewsroomItem.

type FilterKey = "all" | NewsroomStatus;

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "Tout" },
  { key: "received", label: "Reçu" },
  { key: "to_process", label: "À traiter" },
  { key: "transformed", label: "Transformé" },
  { key: "archived", label: "Archivé" },
];

/** Le modèle Studio proposé pour la transformation n'est pas déterminé par la maquette : mots-clés
 * simples sur le titre, avec un modèle générique en repli. */
function inferTemplateCode(item: NewsroomItem): string {
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
  const { toastMessage, showToast } = useToast();
  const [filter, setFilter] = useState<FilterKey>("all");

  const allowed = canAccess(ctx, "newsroom");
  const canWrite = canCreate(ctx, "newsroom_item");

  const [items, setItems] = useState<NewsroomItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    fetchClubNewsroomItems(supabase, ctx.organization.id).then((rows) => {
      if (!cancelled) setItems(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [ctx.organization.id]);

  const filtered = filter === "all" ? items : items.filter((i) => i.status === filter);

  function applyStatus(item: NewsroomItem, status: "transformed" | "info_requested" | "archived") {
    const supabase = createClient();
    updateClubNewsroomItemStatus(supabase, item.id, status)
      .then(() => {
        setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status } : i)));
      })
      .catch(() => showToast("Action impossible, réessayez."));
  }

  function handleTransform(item: NewsroomItem, into: "publication" | "visual_request") {
    applyStatus(item, "transformed");
    if (into === "publication") {
      const code = inferTemplateCode(item);
      router.push(`/studio/${code}?prefillBody=${encodeURIComponent(item.body)}`);
    } else {
      router.push(`/requests/new?prefillBody=${encodeURIComponent(item.body)}&teamName=${encodeURIComponent(item.teamName ?? "")}`);
    }
  }

  function handleRequestInfo(item: NewsroomItem) {
    applyStatus(item, "info_requested");
    showToast(`Complément demandé à ${item.submittedByName}.`);
  }

  function handleArchive(item: NewsroomItem) {
    applyStatus(item, "archived");
    showToast("Remontée archivée.");
  }

  if (!allowed) return <LockedModule title="Newsroom" />;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="text-[12px] font-bold text-text-soft">Club+</div>
        <h1 className="mt-1.5 text-[29px] font-extrabold leading-tight tracking-tight">Newsroom</h1>
        <p className="mt-1.5 max-w-2xl text-[13.5px] text-text-soft">
          Les remontées de vos équipes, prêtes à devenir une publication ou une demande de visuel.
        </p>
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

      {filtered.length === 0 ? (
        <Card className="p-8 text-center">
          <div className="text-[14px] font-extrabold">Aucune remontée à traiter</div>
          <p className="mt-1.5 text-[13px] text-text-soft">Tout est à jour dans cette vue.</p>
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
                  </div>
                  <div className="mt-1 text-[12px] font-semibold text-text-faint">
                    {item.submittedByName}
                    {item.teamName ? ` · ${item.teamName}` : ""} ·{" "}
                    {new Date(item.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}
                  </div>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-text-soft">{item.body}</p>
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

      <Toast message={toastMessage} />
    </div>
  );
}
