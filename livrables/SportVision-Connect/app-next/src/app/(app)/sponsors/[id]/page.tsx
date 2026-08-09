"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FileText, Inbox, Images } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { LockedModule } from "@/components/ui/LockedModule";
import { SPONSOR_LEVEL_LABEL, SPONSOR_LEVEL_TONE, SPONSOR_STATUS_LABEL, SPONSOR_STATUS_TONE, formatEuro } from "@/components/sponsors/format";
import { deliverablesForSponsor, visibilityGauge } from "@/lib/mock/sponsors";
import { fetchClubSponsors } from "@/lib/data/club/sponsors";
import { fetchSponsorPartnerships } from "@/lib/data/sponsor/sponsorships";
import { createClient } from "@/lib/supabase/client";
import type { Sponsor } from "@/lib/types/sponsors";
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
  const [clubSponsors, setClubSponsors] = useState<Sponsor[] | null>(null);

  const isPartner = ctx.organization.type === "sponsor";

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    const fetcher = isPartner
      ? fetchSponsorPartnerships(supabase, ctx.organization.id)
      : fetchClubSponsors(supabase, ctx.organization.id);
    fetcher.then((rows) => {
      if (!cancelled) setClubSponsors(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [isPartner, ctx.organization.id]);

  if (!isPartner && !canAccess(ctx, "sponsors")) return <LockedModule />;

  if (clubSponsors === null) {
    return <div className="py-16 text-center text-[13px] text-text-soft">Chargement…</div>;
  }

  const sponsor = isPartner
    ? clubSponsors.find((s) => s.id === params.id)
    : clubSponsors.find((s) => s.id === params.id && s.organizationId === ctx.organization.id);

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
          <div className="text-[24px] font-extrabold tracking-tight">{gauge === null ? "Non suivi" : `${gauge} %`}</div>
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

function ContractTab({ sponsor }: { sponsor: Sponsor }) {
  return (
    <Card className="p-4.5">
      <div className="text-[14px] font-extrabold tracking-tight">Conditions du partenariat</div>
      <dl className="mt-3.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Info label="Niveau" value={SPONSOR_LEVEL_LABEL[sponsor.level]} />
        <Info label="Statut" value={SPONSOR_STATUS_LABEL[sponsor.status]} />
        <Info label="Montant annuel" value={formatEuro(sponsor.annualAmount)} />
        <Info
          label="Rythme de paiement"
          value={sponsor.paymentSchedule ? (PAYMENT_SCHEDULE_LABEL[sponsor.paymentSchedule] ?? sponsor.paymentSchedule) : ""}
        />
        <Info label="Début" value={sponsor.startsAt} />
        <Info label="Fin" value={sponsor.endsAt} />
        <Info label="Signataire(s)" value={sponsor.signatories.join(", ")} />
      </dl>
    </Card>
  );
}

// `value` vide (colonne absente côté club_sponsors : paymentSchedule/signataires, voir
// data/club/sponsors.ts) → "Non renseigné" plutôt qu'un champ blanc muet ou une valeur
// fabriquée. Ne jamais passer une valeur par défaut inventée à ce composant.
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-bold uppercase tracking-[.04em] text-text-faint">{label}</dt>
      <dd className="mt-1 text-[13.5px] font-bold text-text">{value || "Non renseigné"}</dd>
    </div>
  );
}

// Publications et Documents : pas de table backend pour ces entités par sponsor (voir le plan
// Phase 4 § Gaps de données, même limite que "Contenus sponsorisés"/"Opérations" dans la vue
// partenaire de /sponsors). Listes honnêtement vides plutôt que d'afficher les exemples fictifs
// de lib/mock/sponsors.ts sur un sponsor réel — sponsorId gardé dans la signature pour le jour
// où une vraie table existera.
function PublicationsTab({ sponsorId: _sponsorId }: { sponsorId: string }) {
  return <EmptyTab icon={Images} label="Aucune publication où le logo apparaît." />;
}

function DocumentsTab({ sponsorId: _sponsorId }: { sponsorId: string }) {
  return <EmptyTab icon={FileText} label="Aucun document pour ce sponsor." />;
}

function EmptyTab({ icon: Icon, label }: { icon: typeof Inbox; label: string }) {
  return (
    <Card className="flex flex-col items-center gap-2 px-8 py-14 text-center">
      <Icon className="h-5 w-5 text-text-faint" aria-hidden />
      <div className="text-[14px] font-extrabold">{label}</div>
    </Card>
  );
}
