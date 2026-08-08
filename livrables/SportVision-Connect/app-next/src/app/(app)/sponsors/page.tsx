"use client";

import Link from "next/link";
import { Award, Download, Gauge, RefreshCw, Wallet } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { LockedModule } from "@/components/ui/LockedModule";
import { SponsorCard } from "@/components/sponsors/SponsorCard";
import { SPONSOR_STATUS_LABEL, SPONSOR_STATUS_TONE, formatEuro } from "@/components/sponsors/format";
import {
  deliverablesForSponsor,
  mockSponsorOperations,
  mockSponsorPublications,
  mockSponsorSelfView,
  sponsorsForOrganization,
  visibilityGauge,
} from "@/lib/mock/sponsors";
import { mockOrganizations } from "@/lib/mock-data";

// Écran Sponsors — ACTIONS.md § 17 (vue club) et § 20 bis (espace partenaire). Le partenaire a
// son propre espace, séparé du club : jauge de visibilité, contenus sponsorisés, opérations,
// contrat, messages — jamais les équipes ni les factures du club.
//
// Décision : la vue partenaire (`organization.type === 'sponsor'`) n'est pas soumise au palier
// minimum de `canAccess('sponsors')` — ce garde-fou protège la fonctionnalité CRM du club
// (réservée à Club+ Performance / Full Communication), pas le propre espace du partenaire, qui
// n'est pas une fonctionnalité vendue en option. Voir DATA_MODEL.md § Plan : les organisations
// sponsor sont toujours sur l'offre « Accès via le club » (tier 1).
export default function SponsorsPage() {
  const { ctx } = useSession();

  if (ctx.organization.type === "sponsor") {
    return <PartnerView organizationId={ctx.organization.id} partnerName={ctx.organization.name} />;
  }

  const isAffiliatedPlayer = ctx.organization.type === "player" && !!ctx.organization.parentOrganizationId;
  if (isAffiliatedPlayer) return <AffiliatedPlayerNotice />;

  if (!canAccess(ctx, "sponsors")) return <LockedModule />;

  const sponsors = sponsorsForOrganization(ctx.organization.id);
  const active = sponsors.filter((s) => s.status === "active").length;
  const toRenew = sponsors.filter((s) => s.status === "to_renew").length;
  const totalAmount = sponsors.reduce((sum, s) => sum + s.annualAmount, 0);
  const avgGauge = sponsors.length
    ? Math.round(sponsors.reduce((sum, s) => sum + visibilityGauge(s.id), 0) / sponsors.length)
    : 0;

  const stats = [
    { label: "Sponsors actifs", value: String(active), icon: Award },
    { label: "Visibilité moyenne", value: `${avgGauge} %`, icon: Gauge },
    { label: "Montant annuel total", value: formatEuro(totalAmount), icon: Wallet },
    { label: "À renouveler", value: String(toRenew), icon: RefreshCw },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[12px] font-bold text-text-soft">Sponsors</div>
          <h1 className="mt-1.5 text-[29px] font-extrabold leading-tight tracking-tight">
            Partenaires de {ctx.organization.name}
          </h1>
        </div>
        <Button variant="secondary">
          <Download className="h-3.5 w-3.5" aria-hidden />
          Exporter le bilan
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        {stats.map(({ label, value, icon: Icon }) => (
          <Card key={label} className="p-4">
            <div className="flex items-center gap-2 text-text-soft">
              <Icon className="h-3.5 w-3.5" aria-hidden />
              <span className="text-[11.5px] font-bold uppercase tracking-[.04em]">{label}</span>
            </div>
            <div className="mt-2 text-[22px] font-extrabold tracking-tight">{value}</div>
          </Card>
        ))}
      </div>

      {sponsors.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 px-8 py-16 text-center">
          <Award className="h-6 w-6 text-text-faint" aria-hidden />
          <div className="mt-1 text-[15px] font-extrabold">Aucun sponsor pour le moment.</div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sponsors.map((s) => (
            <SponsorCard key={s.id} sponsor={s} />
          ))}
        </div>
      )}
    </div>
  );
}

function PartnerView({ organizationId, partnerName }: { organizationId: string; partnerName: string }) {
  const sponsorIds = mockSponsorSelfView[organizationId] ?? [];
  const deliverables = sponsorIds.flatMap((id) => deliverablesForSponsor(id));
  const planned = deliverables.reduce((sum, d) => sum + d.plannedCount, 0);
  const delivered = deliverables.reduce((sum, d) => sum + d.deliveredCount, 0);
  const gauge = planned > 0 ? Math.round((delivered / planned) * 100) : 0;
  const publications = mockSponsorPublications.filter((p) => sponsorIds.includes(p.sponsorId));
  const operations = mockSponsorOperations.filter((o) => sponsorIds.includes(o.sponsorId));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="text-[12px] font-bold text-text-soft">Mon partenariat</div>
        <h1 className="mt-1.5 text-[29px] font-extrabold leading-tight tracking-tight">
          Bonjour {partnerName}
        </h1>
      </div>

      <Card className="p-4.5">
        <div className="flex items-baseline justify-between">
          <span className="text-[14px] font-extrabold tracking-tight">Ma visibilité</span>
          <span className="text-[22px] font-extrabold tracking-tight">{gauge} %</span>
        </div>
        <p className="mt-1 text-[12.5px] text-text-soft">
          {delivered} livrable{delivered > 1 ? "s" : ""} réalisé{delivered > 1 ? "s" : ""} sur {planned} prévu{planned > 1 ? "s" : ""}.
        </p>
        <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-surface-sunken">
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand-cyan to-brand-violet"
            style={{ width: `${Math.min(100, Math.max(0, gauge))}%` }}
          />
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-4.5">
          <div className="text-[14px] font-extrabold tracking-tight">Contenus sponsorisés</div>
          {publications.length === 0 ? (
            <p className="mt-3 text-[12.5px] text-text-soft">Aucune publication où votre logo apparaît pour le moment.</p>
          ) : (
            <div className="mt-3 flex flex-col gap-2.5">
              {publications.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 rounded-xl bg-surface-alt px-3 py-2.5">
                  <span className="min-w-0 truncate text-[12.5px] font-bold text-text">{p.label}</span>
                  <Badge tone={p.status === "publie" ? "success" : p.status === "programme" ? "info" : "accent"}>
                    {p.status === "publie" ? "Publié" : p.status === "programme" ? "Programmé" : "En création"}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-4.5">
          <div className="text-[14px] font-extrabold tracking-tight">Opérations</div>
          {operations.length === 0 ? (
            <p className="mt-3 text-[12.5px] text-text-soft">Aucune activation prévue pour le moment.</p>
          ) : (
            <div className="mt-3 flex flex-col gap-2.5">
              {operations.map((o) => (
                <div key={o.id} className="flex items-center justify-between gap-3 rounded-xl bg-surface-alt px-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] font-bold text-text">{o.label}</span>
                    <span className="block text-[11.5px] text-text-soft">{o.date}</span>
                  </span>
                  <Badge tone={o.status === "realisee" ? "success" : "info"}>
                    {o.status === "realisee" ? "Réalisée" : "Prévue"}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card className="flex flex-wrap items-center justify-between gap-4 p-4.5">
        <div>
          <div className="text-[14px] font-extrabold tracking-tight">Une question sur votre partenariat ?</div>
          <p className="mt-0.5 text-[12.5px] text-text-soft">Échangez directement avec le club et SportVision.</p>
        </div>
        <div className="flex items-center gap-2.5">
          <Link href="/documents">
            <Button variant="secondary">Contrat et documents</Button>
          </Link>
          <Link href="/messages">
            <Button variant="primary">Contacter</Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}

function AffiliatedPlayerNotice() {
  const { ctx } = useSession();
  const club = mockOrganizations.find((o) => o.id === ctx.organization.parentOrganizationId);
  return (
    <Card className="flex flex-col items-center gap-3 px-8 py-16 text-center">
      <Award className="h-6 w-6 text-text-faint" aria-hidden />
      <div className="max-w-md">
        <h2 className="text-[18px] font-extrabold tracking-tight">Les sponsors sont gérés par votre club</h2>
        <p className="mt-2 text-[13.5px] leading-relaxed text-text-soft">
          En tant que joueur rattaché à un club abonné, les partenariats sponsors sont portés par
          l&apos;organisation qui vous accueille — voir README.md § Joueur affilié vs indépendant.
        </p>
      </div>
      {club && <div className="text-[12.5px] font-bold text-text-soft">Club : {club.name}</div>}
    </Card>
  );
}
