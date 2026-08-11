"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { LockedModule } from "@/components/ui/LockedModule";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Toast, useToast } from "@/components/feedback/Toast";
import { useClientId } from "@/lib/data/shared/use-client-id";
import { createClient } from "@/lib/supabase/client";
import { decideContenu, fetchContenus, type Contenu } from "@/lib/data/shared/contenus";

// /validations — file réelle des contenus `a_valider_client` (table `contenus`), décision écrite
// via la RPC client_valider_contenu (autorisation club étendue par migration-clubplus-v34).
export default function ValidationsPage() {
  const { ctx } = useSession();
  const resolution = useClientId();

  if (resolution.status === "locked") return <LockedModule />;
  if (resolution.status === "loading") return <div className="py-16 text-center text-[13px] text-text-soft">Chargement…</div>;

  if (resolution.status === "not_linked") {
    return (
      <div className="flex flex-col gap-5">
        <h1 className="text-[29px] font-extrabold tracking-tight">Validations</h1>
        <Card className="flex flex-col items-center gap-3 px-8 py-16 text-center">
          <CheckCircle2 className="h-6 w-6 text-text-faint" aria-hidden />
          <div className="max-w-md">
            <h2 className="text-[18px] font-extrabold tracking-tight">Validations pas encore reliées</h2>
            <p className="mt-2 text-[13.5px] leading-relaxed text-text-soft">
              SportVision n&apos;a pas encore relié {ctx.organization.name} à un espace Validations. Contactez votre
              interlocuteur SportVision pour l&apos;activer.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  return <ValidationQueue clientId={resolution.clientId} />;
}

function ValidationQueue({ clientId }: { clientId: string }) {
  const { ctx } = useSession();
  const { toastMessage, toastTone, showToast } = useToast();
  const [items, setItems] = useState<Contenu[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [correctionDraft, setCorrectionDraft] = useState<Record<string, string>>({});

  async function reload() {
    setLoadError(false);
    try {
      const supabase = createClient();
      const all = await fetchContenus(supabase, clientId);
      setItems(all.filter((c) => c.statut === "a_valider_client"));
    } catch {
      setLoadError(true);
      setItems([]);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function handleDecision(id: string, decision: "valide" | "corrections") {
    const commentaire = correctionDraft[id]?.trim();
    if (decision === "corrections" && !commentaire) {
      showToast("Précisez ce qui doit être corrigé.", "error");
      return;
    }
    setBusyId(id);
    try {
      const supabase = createClient();
      await decideContenu(supabase, id, decision, commentaire);
      await reload();
      showToast(decision === "valide" ? "Contenu validé." : "Corrections demandées.");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Action impossible, réessayez.", "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="text-[12px] font-bold text-text-soft">Validations</div>
        <h1 className="mt-1.5 text-[29px] font-extrabold leading-tight tracking-tight">
          Contenus à valider pour {ctx.organization.name}
        </h1>
      </div>

      {loadError && (
        <Card className="flex flex-wrap items-center gap-3 border-danger-fg/30 bg-danger-bg px-5 py-4">
          <AlertTriangle className="h-[18px] w-[18px] flex-none text-danger-fg" aria-hidden />
          <span className="min-w-0 flex-1 text-[13px] font-semibold text-danger-fg">Impossible de charger la file de validation.</span>
          <Button variant="secondary" className="h-8 flex-none px-3 text-[12px]" onClick={reload}>
            Réessayer
          </Button>
        </Card>
      )}

      {items === null ? (
        <Card className="flex flex-col items-center gap-2 px-8 py-16 text-center">
          <div className="text-[13.5px] font-bold text-text-soft">Chargement…</div>
        </Card>
      ) : items.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 px-8 py-16 text-center">
          <CheckCircle2 className="h-6 w-6 text-text-faint" aria-hidden />
          <div className="mt-1 text-[15px] font-extrabold">Rien à valider pour le moment.</div>
        </Card>
      ) : (
        <div className="flex flex-col gap-3.5">
          {items.map((c) => (
            <Card key={c.id} className="flex flex-col gap-3 p-5">
              <div>
                <div className="text-[14px] font-extrabold tracking-tight">{c.titre}</div>
                <div className="mt-0.5 text-[12px] text-text-soft">
                  {[c.plateforme, c.typeContenu].filter(Boolean).join(" · ") || "—"}
                </div>
                {c.description && <p className="mt-2 text-[13px] text-text-soft">{c.description}</p>}
              </div>
              <textarea
                value={correctionDraft[c.id] ?? ""}
                onChange={(e) => setCorrectionDraft((prev) => ({ ...prev, [c.id]: e.target.value }))}
                placeholder="Si vous demandez une correction, précisez ici ce qui doit changer…"
                rows={2}
                className="rounded-sv border border-border-strong bg-input-bg px-3 py-2 text-[13px] outline-none focus-visible:border-brand-blue"
              />
              <div className="flex justify-end gap-2.5">
                <Button
                  variant="secondary"
                  disabled={busyId === c.id}
                  loading={busyId === c.id}
                  onClick={() => handleDecision(c.id, "corrections")}
                >
                  Demander une correction
                </Button>
                <Button variant="primary" disabled={busyId === c.id} loading={busyId === c.id} onClick={() => handleDecision(c.id, "valide")}>
                  Valider
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Toast message={toastMessage} tone={toastTone} />
    </div>
  );
}
