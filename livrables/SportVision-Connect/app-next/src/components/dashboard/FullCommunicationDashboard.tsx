"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Calendar, Camera, FileBarChart, ListChecks, MessageCircle, Send } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { Button } from "@/components/ui/Button";
import { Card, CardPremium } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { MetricCard } from "@/components/communication/MetricCard";
import { TransmitInfoModal } from "@/components/communication/TransmitInfoModal";
import { ToastViewport } from "@/components/communication/ToastViewport";
import { useToast } from "@/components/communication/useToast";
import { publicationStatusTone } from "@/components/communication/statusTone";
import {
  ELITE_CUP_EVENT_DATE,
  getCommunityManagerProfile,
  getPresencesByOrg,
  getPublicationsByOrg,
  getReportsByOrg,
  getThreadForOrg,
} from "@/lib/mock/communication";
import { PLATFORM_LABELS, PUBLICATION_STATUS_LABELS } from "@/lib/types/communication";

// Tableau de bord Full Communication — ACTIONS.md § 5 « Full Communication ». Le titre et le
// contenu varient par type d'organisation : club, coach, académie, événement (voir README.md
// § Les treize expériences). Une seule action principale par écran : « Transmettre une
// information » (les autres CTA en secondaire/discret, cohérent avec CHARTE.md § Boutons).
export function FullCommunicationDashboard() {
  const { ctx } = useSession();
  const router = useRouter();
  const { toasts, showToast } = useToast();
  const [transmitOpen, setTransmitOpen] = useState(false);

  const publications = useMemo(() => getPublicationsByOrg(ctx.organization.id), [ctx.organization.id]);
  const presences = useMemo(() => getPresencesByOrg(ctx.organization.id), [ctx.organization.id]);
  const reports = useMemo(() => getReportsByOrg(ctx.organization.id), [ctx.organization.id]);
  const cm = getCommunityManagerProfile(ctx.organization.id);
  const thread = getThreadForOrg(ctx.organization.id);

  const now = Date.now();
  const inSevenDays = now + 7 * 86_400_000;

  const toValidate = publications.filter((p) => p.status === "to_validate");
  const scheduledThisWeek = publications.filter((p) => {
    const t = new Date(p.scheduledAt).getTime();
    return t >= now - 86_400_000 && t <= inSevenDays && p.status !== "cancelled";
  });
  const nextPresence = presences.find((p) => p.status === "scheduled");
  const latestReport = reports[0];

  const upcoming = publications
    .filter((p) => p.status !== "published" && p.status !== "cancelled" && p.status !== "publish_error")
    .slice(0, 4);

  const { title, subtitle } = heroContent(ctx.organization);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <div className="text-[12px] font-bold text-text-soft">{ctx.organization.name}</div>
          <h1 className="mt-1.5 max-w-2xl text-balance text-[29px] font-extrabold leading-tight tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 max-w-xl text-[13.5px] leading-relaxed text-text-soft">{subtitle}</p>}
        </div>
        <Button variant="primary" onClick={() => setTransmitOpen(true)}>
          <Send className="h-3.5 w-3.5" aria-hidden />
          Transmettre une information
        </Button>
      </div>

      {toValidate.length > 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-brand-blue/30 bg-info-bg px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-white/60 text-info-fg dark:bg-white/10">
              <ListChecks className="h-4 w-4" aria-hidden />
            </span>
            <div>
              <div className="text-[14px] font-extrabold tracking-tight text-info-fg">
                {toValidate.length} contenu{toValidate.length > 1 ? "s" : ""} en attente de votre validation
              </div>
              <div className="text-[12.5px] font-semibold text-info-fg/80">Un œil rapide suffit, on s&apos;occupe du reste.</div>
            </div>
          </div>
          <Button variant="dark" onClick={() => router.push("/validations")}>
            Voir ce qui attend ma validation
          </Button>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <MetricCard
          icon={Calendar}
          label="Publications programmées"
          value={String(scheduledThisWeek.length)}
          hint="Sur les 7 prochains jours"
        />
        <MetricCard icon={ListChecks} label="Contenu à valider" value={String(toValidate.length)} hint="File de validation" />
        <MetricCard
          icon={Camera}
          label="Présence"
          value={nextPresence ? formatDateShort(nextPresence.date) : "Aucune prévue"}
          hint={nextPresence?.eventLabel ?? "Aucune présence programmée"}
        />
        <MetricCard
          icon={FileBarChart}
          label="Rapport"
          value={latestReport ? formatPeriod(latestReport.period) : "À venir"}
          hint={latestReport ? (latestReport.status === "available" ? "Disponible" : "Déjà consulté") : "Après le premier mois"}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.35fr_1fr]">
        <Card>
          <div className="flex items-center justify-between border-b border-divider px-5 py-4">
            <span className="text-[15px] font-extrabold tracking-tight">Ce que nous préparons</span>
            <button
              onClick={() => router.push("/communication")}
              className="text-[12.5px] font-bold text-brand-blue-electric"
            >
              Planning complet
            </button>
          </div>
          {upcoming.length === 0 ? (
            <div className="px-5 py-8 text-center text-[13px] text-text-soft">Rien de programmé pour le moment.</div>
          ) : (
            upcoming.map((p) => (
              <button
                key={p.id}
                onClick={() => router.push(`/communication/publications/${p.id}`)}
                className="flex w-full items-center gap-3.5 border-b border-divider px-5 py-3.5 text-left last:border-0 hover:bg-row-hover"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-bold text-text">{p.title}</span>
                  <span className="mt-0.5 block text-[12px] text-text-soft">
                    {PLATFORM_LABELS[p.platform]} · {formatDateTime(p.scheduledAt)}
                  </span>
                </span>
                <Badge tone={publicationStatusTone(p.status)}>{PUBLICATION_STATUS_LABELS[p.status]}</Badge>
              </button>
            ))
          )}
        </Card>

        <div className="flex flex-col gap-4">
          {cm && (
            <CardPremium>
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-white/15 text-[13px] font-extrabold text-white">
                  {cm.avatarInitials}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-extrabold tracking-tight">{cm.name}</div>
                  <div className="truncate text-[12px] text-[#B9C7EB]">{cm.role}</div>
                </div>
                <span
                  className={`inline-flex flex-none items-center gap-1.5 rounded-full px-2 py-1 text-[10.5px] font-extrabold ${
                    cm.availability === "available" ? "bg-[rgba(40,201,149,.2)] text-[#7BE8C3]" : "bg-white/10 text-[#C6D3F0]"
                  }`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  {cm.availability === "available" ? "Disponible" : cm.availability === "filming" ? "En tournage" : "Absente"}
                </span>
              </div>
              <div className="mt-4 flex justify-between text-[12px] font-semibold text-[#C6D3F0]">
                <span>Délai de réponse habituel</span>
                <span className="font-extrabold text-white">{cm.responseTime}</span>
              </div>
              <Button
                variant="secondary"
                className="mt-4 w-full border-white/25 bg-white/[.12] text-white hover:border-white/40"
                onClick={() => router.push("/mycm")}
              >
                <MessageCircle className="h-3.5 w-3.5" aria-hidden />
                Envoyer un message
              </Button>
              {thread && (
                <button
                  onClick={() => router.push("/messages")}
                  className="mt-2.5 w-full text-center text-[12px] font-bold text-brand-blue-pale hover:text-white"
                >
                  Écrire à {cm.name.split(" ")[0]}
                </button>
              )}
            </CardPremium>
          )}

          {latestReport && (
            <Card className="p-4">
              <div className="text-[13.5px] font-extrabold tracking-tight">Dernier rapport</div>
              <div className="mt-1 text-[12.5px] text-text-soft">{formatPeriod(latestReport.period)} — {latestReport.summary}</div>
              <Button variant="secondary" className="mt-3.5 w-full" onClick={() => router.push("/reports")}>
                Lire le rapport
              </Button>
            </Card>
          )}
        </div>
      </div>

      <TransmitInfoModal
        open={transmitOpen}
        onClose={() => setTransmitOpen(false)}
        onSubmitted={() => {
          setTransmitOpen(false);
          showToast("Information transmise à votre Community Manager.");
        }}
      />
      <ToastViewport toasts={toasts} />
    </div>
  );
}

function heroContent(organization: { type: string; name: string }): { title: string; subtitle: string } {
  if (organization.type === "coach") {
    return {
      title: "Développez votre image professionnelle",
      subtitle: "Un aperçu de votre communication et de ce qui attend votre validation.",
    };
  }
  if (organization.type === "academy") {
    return {
      title: "Pilotez le calendrier de votre académie",
      subtitle: "Le calendrier éditorial et la production en cours, en un coup d'œil.",
    };
  }
  if (organization.type === "event") {
    const daysLeft = Math.max(0, Math.ceil((new Date(ELITE_CUP_EVENT_DATE).getTime() - Date.now()) / 86_400_000));
    return {
      title: `${organization.name} — J-${daysLeft} avant l'événement`,
      subtitle: "Toute la communication de l'événement, du teasing au bilan.",
    };
  }
  return {
    title: `Bonjour, voici votre communication de la semaine.`,
    subtitle: `Ce qui est prévu pour ${organization.name} cette semaine.`,
  };
}

function formatDateShort(date: string): string {
  return new Date(date).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function formatPeriod(period: string): string {
  const [yearPart, monthPart] = period.split("-");
  const year = Number(yearPart);
  const month = Number(monthPart);
  return new Date(year, month - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}
