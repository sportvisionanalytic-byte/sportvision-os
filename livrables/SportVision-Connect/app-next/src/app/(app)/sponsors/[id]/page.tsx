"use client";

import { useState } from "react";
import Link from "next/link";
import { FileText, Inbox, Images } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { LockedModule } from "@/components/ui/LockedModule";
import { SPONSOR_LEVEL_LABEL, SPONSOR_LEVEL_TONE, SPONSOR_STATUS_LABEL, SPONSOR_STATUS_TONE, formatEuro } from "@/components/sponsors/format";
import {
  deliverablesForSponsor,
  mockSponsorDocuments,
  mockSponsorPublications,
  mockSponsors,
  visibilityGauge,
} from "@/lib/mock/sponsors";
import { cn } from "@/lib/cn";

// Fiche sponsor — 4 onglets : Livrables · Contrat · Publications · Documents. ACTIONS.md § 17.

const TABS = ["livrables", "contrat", "publications", "documents"] as const;
type TabKey = (typeof TABS)[number];
const TAB_LABEL: Record<TabKey, string> = {
  livrables: "Livrables",
  contrat: "Contrat",
  publications: "Publications",
  documents: "Documents",
};

const PAYMENT_SCHEDULE_LABEL: Record<string, string> = {
  annual: "Annuel",
  biannual: "Semestriel",
  quarterly: "Trimestriel",
  monthly: "Mensuel",
};

export default function SponsorDetailPage({ params }: { params: { id: string } }) {
  const { ctx } = useSession();
  const [tab, setTab] = useState<TabKey>("livrables");

  const isPartner = ctx.organization.type === "sponsor";
  if (!isPartner && !canAccess(ctx, "sponsors")) return <LockedModule />;

  const sponsor = mockSponsors.find((s) => s.id === params.id && (isPartner || s.organizationId === ctx.organization.id));

  if (!sponsor) {
    return (
      <Card className="flex flex-col items-center gap-3 px-8 py-16 text-center">
        <div className="text-[15px] font-extrabold">Sponsor introuvable.</div>
        <Link href="/sponsors">
          <Button variant="secondary">Retour aux sponsors</Button>
        </Link>
      </Card>
    );
  }

  const gauge = visibilityGauge(sponsor.id);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/sponsors" className="text-[12px] font-bold text-text-soft hover:text-brand-blue-electric">
            ← Sponsors
          </Link>
          <h1 className="mt-1.5 text-[29px] font-extrabold leading-tight tracking-tight">{sponsor.name}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Badge tone={SPONSOR_LEVEL_TONE[sponsor.level]}>{SPONSOR_LEVEL_LABEL[sponsor.level]}</Badge>
            <Badge tone={SPONSOR_STATUS_TONE[sponsor.status]}>{SPONSOR_STATUS_LABEL[sponsor.status]}</Badge>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] font-bold uppercase tracking-[.04em] text-text-faint">Visibilité livrée</div>
          <div className="text-[24px] font-extrabold tracking-tight">{gauge} %</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-divider pb-0.5">
        {TABS.map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "rounded-t-[10px] px-3.5 py-2.5 text-[13px] font-bold transition-colors duration-sv",
              tab === key
                ? "border-b-2 border-brand-blue bg-surface-alt text-text"
                : "border-b-2 border-transparent text-text-soft hover:text-text",
            )}
          >
            {TAB_LABEL[key]}
          </button>
        ))}
      </div>

      {tab === "livrables" && <DeliverablesTab sponsorId={sponsor.id} />}
      {tab === "contrat" && <ContractTab sponsor={sponsor} />}
      {tab === "publications" && <PublicationsTab sponsorId={sponsor.id} />}
      {tab === "documents" && <DocumentsTab sponsorId={sponsor.id} />}
    </div>
  );
}

function DeliverablesTab({ sponsorId }: { sponsorId: string }) {
  const items = deliverablesForSponsor(sponsorId);
  if (items.length === 0) return <EmptyTab icon={Inbox} label="Aucun livrable planifié." />;
  return (
    <Card>
      {items.map((d) => {
        const pct = d.plannedCount > 0 ? Math.round((d.deliveredCount / d.plannedCount) * 100) : 0;
        return (
          <div key={d.id} className="flex items-center gap-3.5 border-b border-divider px-5 py-3.5 last:border-0">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-bold text-text">{d.label}</span>
              <span className="mt-0.5 block text-[12px] text-text-soft">{d.period}</span>
            </span>
            <span className="w-24 flex-none text-right text-[12.5px] font-bold text-text-soft">
              {d.deliveredCount} / {d.plannedCount}
            </span>
            <span className="w-24 flex-none">
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                <div className="h-full rounded-full bg-gradient-to-r from-brand-cyan to-brand-violet" style={{ width: `${pct}%` }} />
              </div>
            </span>
          </div>
        );
      })}
    </Card>
  );
}

function ContractTab({ sponsor }: { sponsor: (typeof mockSponsors)[number] }) {
  return (
    <Card className="p-4.5">
      <div className="text-[14px] font-extrabold tracking-tight">Conditions du partenariat</div>
      <dl className="mt-3.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Info label="Niveau" value={SPONSOR_LEVEL_LABEL[sponsor.level]} />
        <Info label="Statut" value={SPONSOR_STATUS_LABEL[sponsor.status]} />
        <Info label="Montant annuel" value={formatEuro(sponsor.annualAmount)} />
        <Info label="Rythme de paiement" value={PAYMENT_SCHEDULE_LABEL[sponsor.paymentSchedule] ?? sponsor.paymentSchedule} />
        <Info label="Début" value={sponsor.startsAt} />
        <Info label="Fin" value={sponsor.endsAt} />
        <Info label="Signataire(s)" value={sponsor.signatories.join(", ")} />
      </dl>
    </Card>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-bold uppercase tracking-[.04em] text-text-faint">{label}</dt>
      <dd className="mt-1 text-[13.5px] font-bold text-text">{value}</dd>
    </div>
  );
}

function PublicationsTab({ sponsorId }: { sponsorId: string }) {
  const items = mockSponsorPublications.filter((p) => p.sponsorId === sponsorId);
  if (items.length === 0) return <EmptyTab icon={Images} label="Aucune publication où le logo apparaît." />;
  return (
    <Card>
      {items.map((p) => (
        <div key={p.id} className="flex items-center gap-3.5 border-b border-divider px-5 py-3.5 last:border-0">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-bold text-text">{p.label}</span>
            {p.publishedAt && <span className="mt-0.5 block text-[12px] text-text-soft">Publié le {p.publishedAt}</span>}
          </span>
          {typeof p.reach === "number" && <span className="text-[12.5px] font-bold text-text-soft">{p.reach.toLocaleString("fr-FR")} vues</span>}
          <Badge tone={p.status === "publie" ? "success" : p.status === "programme" ? "info" : "accent"}>
            {p.status === "publie" ? "Publié" : p.status === "programme" ? "Programmé" : "En création"}
          </Badge>
        </div>
      ))}
    </Card>
  );
}

const DOC_KIND_LABEL: Record<string, string> = {
  contract: "Contrat",
  brand_guidelines: "Charte graphique",
  logo_pack: "Pack logos",
  invoice: "Facture",
  other: "Document",
};

function DocumentsTab({ sponsorId }: { sponsorId: string }) {
  const items = mockSponsorDocuments.filter((d) => d.sponsorId === sponsorId);
  if (items.length === 0) return <EmptyTab icon={FileText} label="Aucun document pour ce sponsor." />;
  return (
    <Card>
      {items.map((d) => (
        <div key={d.id} className="flex items-center gap-3.5 border-b border-divider px-5 py-3.5 last:border-0">
          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-neutral-bg text-neutral-fg">
            <FileText className="h-4 w-4" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-bold text-text">{d.name}</span>
            <span className="mt-0.5 block text-[12px] text-text-soft">{DOC_KIND_LABEL[d.kind]} · mis à jour le {d.updatedAt}</span>
          </span>
          <Button variant="tertiary" className="h-8 flex-none px-2 text-[12px]">
            Télécharger
          </Button>
        </div>
      ))}
    </Card>
  );
}

function EmptyTab({ icon: Icon, label }: { icon: typeof Inbox; label: string }) {
  return (
    <Card className="flex flex-col items-center gap-2 px-8 py-14 text-center">
      <Icon className="h-5 w-5 text-text-faint" aria-hidden />
      <div className="text-[14px] font-extrabold">{label}</div>
    </Card>
  );
}
