"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { Button } from "@/components/ui/Button";
import { LockedModule } from "@/components/ui/LockedModule";
import { EmptyState } from "@/components/communication/EmptyState";
import { Modal } from "@/components/communication/Modal";
import { ValidationCard } from "@/components/communication/ValidationCard";
import { ToastViewport } from "@/components/communication/ToastViewport";
import { useToast } from "@/components/communication/useToast";
import { getPublicationsByOrg } from "@/lib/mock/communication";
import { FORMAT_LABELS, PLATFORM_LABELS, type Publication } from "@/lib/types/communication";

// /validations — file de validation Full Communication. ACTIONS.md § 9. Aucun contenu à
// valider → état vide qui rassure plutôt que de constater l'absence (README.md § États vides).
export default function ValidationsPage() {
  const { ctx } = useSession();
  if (!canAccess(ctx, "validations")) return <LockedModule />;
  return <ValidationsQueue organizationId={ctx.organization.id} />;
}

function ValidationsQueue({ organizationId }: { organizationId: string }) {
  const { toasts, showToast } = useToast();
  const [queue, setQueue] = useState<Publication[]>(() =>
    getPublicationsByOrg(organizationId).filter((p) => p.status === "to_validate"),
  );
  const orgRef = useRef(organizationId);
  useEffect(() => {
    if (orgRef.current !== organizationId) {
      orgRef.current = organizationId;
      setQueue(getPublicationsByOrg(organizationId).filter((p) => p.status === "to_validate"));
    }
  }, [organizationId]);

  const [preview, setPreview] = useState<Publication | null>(null);
  const [correctionTarget, setCorrectionTarget] = useState<Publication | null>(null);
  const [correctionDraft, setCorrectionDraft] = useState("");

  function handleValidate(pub: Publication) {
    setQueue((prev) => prev.filter((p) => p.id !== pub.id));
    showToast(`« ${pub.title} » validée, elle part en programmation.`);
  }

  function handleSubmitCorrection(e: React.FormEvent) {
    e.preventDefault();
    if (!correctionTarget || !correctionDraft.trim()) return;
    setQueue((prev) => prev.filter((p) => p.id !== correctionTarget.id));
    showToast(`Correction demandée pour « ${correctionTarget.title} ».`);
    setCorrectionTarget(null);
    setCorrectionDraft("");
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="text-[12px] font-bold text-text-soft">Full Communication</div>
        <h1 className="mt-1 text-[24px] font-extrabold tracking-tight">À valider</h1>
        <p className="mt-1 text-[13.5px] text-text-soft">
          {queue.length > 0
            ? `${queue.length} contenu${queue.length > 1 ? "s" : ""} en attente de votre décision.`
            : "Rien à valider pour le moment."}
        </p>
      </div>

      {queue.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="Aucun contenu à valider" subtitle="Tout est à jour." />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {queue.map((p) => (
            <ValidationCard
              key={p.id}
              publication={p}
              onValidate={() => handleValidate(p)}
              onRequestCorrection={() => setCorrectionTarget(p)}
              onPreview={() => setPreview(p)}
            />
          ))}
        </div>
      )}

      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview?.title ?? ""} widthClassName="max-w-2xl">
        {preview && (
          <div>
            <div
              className="h-[280px] w-full rounded-xl"
              style={{
                backgroundImage: "repeating-linear-gradient(125deg, #2454FF 0px, #2454FF 16px, #832DFF 16px, #832DFF 32px)",
              }}
            />
            <div className="mt-4 flex items-center gap-2 text-[12.5px] font-semibold text-text-soft">
              <span>{PLATFORM_LABELS[preview.platform]}</span>
              <span>·</span>
              <span>{FORMAT_LABELS[preview.format]}</span>
              <span>·</span>
              <span>Par {preview.ownerName}</span>
            </div>
            {preview.bodyText && <p className="mt-3 text-[14px] leading-relaxed text-text">{preview.bodyText}</p>}
          </div>
        )}
      </Modal>

      <Modal
        open={!!correctionTarget}
        onClose={() => {
          setCorrectionTarget(null);
          setCorrectionDraft("");
        }}
        title="Demander une correction"
      >
        <form onSubmit={handleSubmitCorrection} className="flex flex-col gap-3">
          <p className="text-[13px] text-text-soft">« {correctionTarget?.title} »</p>
          <textarea
            required
            rows={3}
            value={correctionDraft}
            onChange={(e) => setCorrectionDraft(e.target.value)}
            placeholder="Décrivez la correction attendue…"
            className="resize-none rounded-xl border border-border-strong bg-surface px-3.5 py-3 text-[14px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,75,255,.12)]"
          />
          <div className="flex justify-end gap-2.5">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setCorrectionTarget(null);
                setCorrectionDraft("");
              }}
            >
              Annuler
            </Button>
            <Button type="submit" variant="dark">
              Envoyer la demande
            </Button>
          </div>
        </form>
      </Modal>

      <ToastViewport toasts={toasts} />
    </div>
  );
}
