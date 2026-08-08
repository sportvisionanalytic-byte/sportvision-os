"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, MessageCircle, Sparkles } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { Button } from "@/components/ui/Button";
import { Card, CardPremium } from "@/components/ui/Card";
import { LockedModule } from "@/components/ui/LockedModule";
import { ScheduleSlotModal } from "@/components/communication/ScheduleSlotModal";
import { ToastViewport } from "@/components/communication/ToastViewport";
import { useToast } from "@/components/communication/useToast";
import { getCommunityManagerProfile } from "@/lib/mock/communication";

// /mycm — fiche Community Manager. ACTIONS.md § 9. « Envoyer un message » renvoie vers
// /messages (fil du CM), en dehors du périmètre de ce module — voir le rapport final.
export default function MyCmPage() {
  const { ctx } = useSession();
  if (!canAccess(ctx, "mycm")) return <LockedModule />;
  return <MyCmScreen organizationId={ctx.organization.id} />;
}

const AVAILABILITY_LABEL: Record<string, string> = {
  available: "Disponible",
  filming: "En tournage",
  off: "Absente",
};

function MyCmScreen({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const { toasts, showToast } = useToast();
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const cm = getCommunityManagerProfile(organizationId);

  if (!cm) {
    return <p className="text-[13.5px] text-text-soft">Aucun Community Manager n&apos;est encore assigné à cet espace.</p>;
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="text-[12px] font-bold text-text-soft">Full Communication</div>
        <h1 className="mt-1 text-[24px] font-extrabold tracking-tight">Mon Community Manager</h1>
      </div>

      <CardPremium>
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex h-16 w-16 flex-none items-center justify-center rounded-full bg-white/15 text-[19px] font-extrabold text-white">
            {cm.avatarInitials}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[20px] font-extrabold tracking-tight">{cm.name}</div>
            <div className="text-[13px] text-[#B9C7EB]">{cm.role}</div>
          </div>
          <span
            className={`inline-flex flex-none items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-extrabold ${
              cm.availability === "available" ? "bg-[rgba(40,201,149,.2)] text-[#7BE8C3]" : "bg-white/10 text-[#C6D3F0]"
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {AVAILABILITY_LABEL[cm.availability]}
          </span>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3.5 border-t border-white/10 pt-4">
          <div>
            <div className="text-[11px] font-semibold text-[#B9C7EB]">Contenus produits</div>
            <div className="mt-1 text-[18px] font-extrabold">{cm.contentsProducedThisMonth}</div>
            <div className="text-[11px] text-[#8B9BBE]">ce mois-ci</div>
          </div>
          <div>
            <div className="text-[11px] font-semibold text-[#B9C7EB]">Délai de réponse</div>
            <div className="mt-1 text-[18px] font-extrabold">{cm.responseTime}</div>
          </div>
          <div>
            <div className="text-[11px] font-semibold text-[#B9C7EB]">Prochain point</div>
            <div className="mt-1 text-[15px] font-extrabold leading-tight">
              {cm.nextMeetingAt ? formatDateTime(cm.nextMeetingAt) : "À planifier"}
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2.5">
          <Button variant="primary" onClick={() => router.push("/messages")}>
            <MessageCircle className="h-3.5 w-3.5" aria-hidden />
            Envoyer un message
          </Button>
          <Button
            variant="secondary"
            className="border-white/25 bg-white/[.12] text-white hover:border-white/40"
            onClick={() => setScheduleOpen(true)}
          >
            <CalendarPlus className="h-3.5 w-3.5" aria-hidden />
            Planifier un échange
          </Button>
        </div>
      </CardPremium>

      <Card className="p-5">
        <div className="flex items-center gap-2 text-[15px] font-extrabold tracking-tight">
          <Sparkles className="h-4 w-4 text-brand-blue-electric" aria-hidden />
          Comment travailler ensemble
        </div>
        <ol className="mt-3.5 flex flex-col gap-3">
          {cm.workingTogether.map((point, i) => (
            <li key={point} className="flex gap-3">
              <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-info-bg text-[11px] font-extrabold text-info-fg">
                {i + 1}
              </span>
              <span className="text-[13.5px] leading-relaxed text-text-soft">{point}</span>
            </li>
          ))}
        </ol>
      </Card>

      <ScheduleSlotModal
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        onConfirm={(label) => {
          setScheduleOpen(false);
          showToast(`Échange confirmé : ${label}.`);
        }}
      />
      <ToastViewport toasts={toasts} />
    </div>
  );
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
