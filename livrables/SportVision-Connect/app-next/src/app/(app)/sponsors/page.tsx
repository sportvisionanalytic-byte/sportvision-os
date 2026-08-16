"use client";

import { useEffect, useState } from "react";
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
import { visibilityGauge } from "@/lib/mock/sponsors";
import {
  fetchClubSponsors,
  fetchSponsorOperationsForPartner,
  fetchSponsorPublicationsForPartner,
} from "@/lib/data/club/sponsors";
import { fetchSponsorPartnerships } from "@/lib/data/sponsor/sponsorships";
import { createClient } from "@/lib/supabase/client";
import type { Sponsor, SponsorOperation, SponsorPublication } from "@/lib/types/sponsors";
import { SPONSOR_LEVEL_LABEL, SPONSOR_LEVEL_TONE } from "@/components/sponsors/format";

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
  const [sponsors, setSponsors] = useState<Sponsor[] | null>(null);

  useEffect(() => {
    if (ctx.organization.type !== "club") return;
    let cancelled = false;
    const supabase = createClient();
    fetchClubSponsors(supabase, ctx.organization.id).then((rows) => {
      if (!cancelled) setSponsors(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [ctx.organization.id, ctx.organization.type]);

  if (ctx.organization.type === "sponsor") {
    return <PartnerView organizationId={ctx.organization.id} partnerName={ctx.organization.name} />;
  }

  const isAffiliatedPlayer = ctx.organization.type === "player" && !!ctx.organization.parentOrganizationId;
  if (isAffiliatedPlayer) return <AffiliatedPlayerNotice />;

  if (!canAccess(ctx, "sponsors")) return <LockedModule />;

  const sponsorsList = sponsors ?? [];
  const active = sponsorsList.filter((s) => s.status === "active").length;
  const toRenew = sponsorsList.filter((s) => s.status === "to_renew").length;
  const totalAmount = sponsorsList.reduce((sum, s) => sum + s.annualAmount, 0);
  // Aucun sponsor réel n'a de livrables suivis (pas de table backend, voir
  // lib/mock/sponsors.ts § visibilityGauge) : ne pas fabriquer une moyenne à 0 % qui
  // affirmerait « rien n'a été livré » plutôt que « on ne suit rien ».
  const gauges = sponsorsList.map((s) => visibilityGauge(s.id)).filter((g): g is number => g !== null);
  const avgGauge = gauges.length ? Math.round(gauges.reduce((sum, g) => sum + g, 0) / gauges.length) : null;

  const stats = [
    { label: "Sponsors actifs", value: String(active), icon: Award },
    { label: "Visibilité moyenne", value: avgGauge === null ? "Non suivi" : `${avgGauge} %`, icon: Gauge },
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

      {sponsors === null ? (
        <div className="py-16 text-center text-[13px] text-text-soft">Chargement…</div>
      ) : sponsorsList.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 px-8 py-16 text-center">
          <Award className="h-6 w-6 text-text-faint" aria-hidden />
          <div className="mt-1 text-[15px] font-extrabold">Aucun sponsor pour le moment.</div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sponsorsList.map((s) => (
            <SponsorCard key={s.id} sponsor={s} />
          ))}
        </div>
      )}
    </div>
  );
}

function PartnerView({ organizationId, partnerName }: { organizationId: string; partnerName: string }) {
  // club_sponsors filtré par sponsor_organization_id (Phase 4) — un sponsor peut avoir plusieurs
  // partenariats (un par club), traités comme une liste. Livrables détaillés (SponsorDeliverable)
  // restent hors périmètre (pas de table réelle, voir data/sponsor/sponsorships.ts) : cette
  // section reste honnêtement vide. Publications et Opérations ont un vrai backend depuis
  // migration-clubplus-v38-studio-sponsors.sql (voir data/club/sponsors.ts).
  const [partnerships, setPartnerships] = useState<Sponsor[] | null>(null);
  const [publications, setPublications] = useState<SponsorPublication[] | null>(null);
  const [operations, setOperations] = useState<SponsorOperation[] | null>(null);

  useEffect(() => {
    const supabase = createClient();
    fetchSponsorPartnerships(supabase, organizationId).then(setPartnerships);
    fetchSponsorPublicationsForPartner(supabase, organizationId)
      .then(setPublications)
      .catch(() => setPublications([]));
    fetchSponsorOperationsForPartner(supabase, organizationId)
      .then(setOperations)
      .catch(() => setOperations([]));
  }, [organizationId]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="text-[12px] font-bold text-text-soft">Mon partenariat</div>
        <h1 className="mt-1.5 text-[29px] font-extrabold leading-tight tracking-tight">
          Bonjour {partnerName}
        </h1>
      </div>

      <Card className="p-4.5">
        <div className="text-[14px] font-extrabold tracking-tight">Mes partenariats</div>
        {partnerships === null ? (
          <p className="mt-3 text-[12.5px] text-text-soft">Chargement…</p>
        ) : partnerships.length === 0 ? (
          <p className="mt-3 text-[12.5px] text-text-soft">Aucun partenariat enregistré pour le moment.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-2.5">
            {partnerships.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-alt px-3.5 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold text-text">{s.name}</span>
                  <span className="block text-[11.5px] text-text-soft">{formatEuro(s.annualAmount)} / an</span>
                </span>
                <Badge tone={SPONSOR_LEVEL_TONE[s.level]}>{SPONSOR_LEVEL_LABEL[s.level]}</Badge>
                <Badge tone={SPONSOR_STATUS_TONE[s.status]}>{SPONSOR_STATUS_LABEL[s.status]}</Badge>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-4.5">
          <div className="text-[14px] font-extrabold tracking-tight">Contenus sponsorisés</div>
          {publications === null ? (
            <p className="mt-3 text-[12.5px] text-text-soft">Chargement…</p>
          ) : publications.length === 0 ? (
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
          {operations === null ? (
            <p className="mt-3 text-[12.5px] text-text-soft">Chargement…</p>
          ) : operations.length === 0 ? (
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
  const [clubName, setClubName] = useState<string | null>(null);

  useEffect(() => {
    if (!ctx.organization.parentOrganizationId) return;
    const supabase = createClient();
    supabase
      .from("organizations")
      .select("nom")
      .eq("id", ctx.organization.parentOrganizationId)
      .maybeSingle()
      .then(({ data }) => setClubName((data as { nom: string } | null)?.nom ?? null));
  }, [ctx.organization.parentOrganizationId]);

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
      {clubName && <div className="text-[12.5px] font-bold text-text-soft">Club : {clubName}</div>}
    </Card>
  );
}
