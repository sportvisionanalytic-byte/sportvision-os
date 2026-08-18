import Link from "next/link";
import {
  DEMO_CALENDAR_EVENTS,
  DEMO_CLUB,
  DEMO_CONTENT_ITEMS,
  DEMO_FIRST_NAME,
  DEMO_FUNDING,
} from "@/lib/demo/mock-data";

// Démo /demo/dashboard — version simplifiée à données fictives de (joueur)/dashboard/page.tsx.
// Temporaire (demandé par Fouka le 19/08).
export default function DemoDashboardPage() {
  const nextEvent = DEMO_CALENDAR_EVENTS[0]!;
  const funding = DEMO_FUNDING[0]!;
  const pct = Math.round((funding.montant_collecte / funding.montant_cible) * 100);

  return (
    <div className="flex flex-col gap-6 animate-sv-in">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="flex flex-col gap-2">
          <h1 className="font-sora text-[27px] font-bold tracking-tight lg:text-[33px]">Bonjour {DEMO_FIRST_NAME} 👋</h1>
          <p className="text-[15px] text-text-tertiary">Retrouvez votre univers SportVision en un coup d&apos;œil.</p>
        </div>
        <Link
          href="/demo/prestations"
          className="hidden h-[46px] flex-none items-center gap-2 rounded-sv bg-sv-gradient px-5 font-sora text-[15px] font-semibold text-white hover:brightness-[1.12] lg:flex"
        >
          <span className="material-symbols-rounded !text-[20px]" aria-hidden="true">add</span>
          Réserver une prestation
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4.5 lg:grid-cols-[minmax(0,1.62fr)_minmax(0,1fr)] lg:items-start">
        <div className="flex flex-col gap-4.5">
          <div className="rounded-sv-card p-px" style={{ background: "linear-gradient(130deg, rgba(34,211,238,.55), rgba(79,125,255,.2) 60%, transparent)" }}>
            <div className="flex flex-col gap-4 rounded-[calc(theme(borderRadius.sv-card)-1px)] bg-bg-elevated p-5">
              <div className="flex flex-wrap items-center gap-4">
                <span className="flex h-[52px] w-[52px] flex-none items-center justify-center rounded-sv bg-white/5 font-mono text-[8px] text-text-faint">logo</span>
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="text-[11px] font-medium uppercase tracking-[.1em] text-affiliations">Mon club</span>
                  <span className="font-sora text-[20px] font-semibold tracking-tight">{DEMO_CLUB.nom}</span>
                  <span className="text-[13px] text-text-tertiary">{DEMO_CLUB.ville}</span>
                </div>
              </div>
              <span className="self-start rounded-sv-pill bg-affiliations-bg px-2.5 py-1 text-[12px] font-medium text-affiliations">✓ Affilié</span>
            </div>
          </div>

          <div className="flex flex-col gap-3.5">
            <div className="flex items-baseline justify-between gap-3.5">
              <h2 className="font-sora text-[20px] font-semibold tracking-tight">Nouveaux contenus</h2>
              <Link href="/demo/contenus" className="text-[14px] font-medium text-contenus hover:brightness-110 lg:text-[13px]">
                Tout voir
              </Link>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {DEMO_CONTENT_ITEMS.slice(0, 2).map((item) => (
                <Link
                  key={item.id}
                  href="/demo/contenus"
                  className="flex flex-col overflow-hidden rounded-sv-card border border-border bg-surface transition-colors duration-150 hover:border-[rgba(192,132,252,.5)]"
                >
                  <div className="relative h-[158px]" style={{ background: "linear-gradient(155deg,#131a3d,#3a1868)" }}>
                    <span className="absolute right-3 top-3 rounded-sv-pill bg-black/45 px-2.5 py-1 text-[11px] font-medium text-text">1</span>
                  </div>
                  <div className="flex flex-col gap-1.5 p-4.5">
                    <span className="font-sora text-[16px] font-semibold">{item.title}</span>
                    <span className="text-[13px] text-text-tertiary">{item.type === "video" ? "1 vidéo" : "1 photo"}</span>
                    <span className="mt-0.5 flex items-center gap-1.5 font-sora text-[14px] font-semibold text-contenus">
                      Découvrir
                      <span className="material-symbols-rounded !text-[17px]" aria-hidden="true">arrow_forward</span>
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 rounded-sv-card border border-border bg-surface p-5">
            <div className="flex h-16 w-16 flex-none flex-col items-center justify-center rounded-sv" style={{ background: "linear-gradient(150deg,rgba(79,125,255,.32),rgba(34,211,238,.14))" }}>
              <span className="font-sora text-[21px] font-bold leading-none">24</span>
              <span className="text-[11px] font-medium uppercase tracking-[.06em] text-prestations">AOÛT</span>
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="text-[11px] font-medium uppercase tracking-[.1em] text-text-label">Prochainement</span>
              <span className="font-sora text-[18px] font-semibold tracking-tight">{nextEvent.title}</span>
              <span className="text-[14px] text-text-tertiary lg:text-[13px]">
                Lundi 24 août · {nextEvent.time?.slice(0, 5)} · {nextEvent.location}
              </span>
            </div>
            <div className="ml-auto flex flex-none flex-col items-end gap-2.5">
              <span className="rounded-sv-pill bg-prestations-bg px-2.5 py-1 text-[12px] font-medium text-prestations">📸 SportVision présent</span>
              <Link href="/demo/calendrier" className="text-[14px] font-medium text-text-secondary hover:text-text lg:text-[13px]">
                Voir l&apos;événement
              </Link>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4.5">
          <div className="rounded-sv-card p-px" style={{ background: "linear-gradient(150deg,rgba(244,114,182,.6),rgba(168,85,247,.25) 55%,transparent)" }}>
            <div className="flex flex-col gap-3.5 rounded-[calc(theme(borderRadius.sv-card)-1px)] bg-bg-elevated p-5">
              <span className="text-[11px] font-medium uppercase tracking-[.1em] text-cotisations">Paiement collectif</span>
              <span className="font-sora text-[19px] font-semibold tracking-tight">{funding.titre}</span>
              <div className="flex flex-col gap-2.5">
                <div className="flex items-baseline justify-between gap-2.5">
                  <div className="flex items-baseline gap-1.5">
                    <span className="font-sora text-[27px] font-bold tracking-tight">{funding.montant_collecte} €</span>
                    <span className="text-[14px] text-text-tertiary">/ {funding.montant_cible} €</span>
                  </div>
                  <span className="text-[13px] font-medium text-cotisations">{pct} %</span>
                </div>
                <div className="h-2 overflow-hidden rounded-sv-pill bg-white/[.08]">
                  <div className="h-full rounded-sv-pill bg-sv-gradient-cotisation" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-[13px] text-text-tertiary lg:text-[12.5px]">
                  Plus que {funding.montant_cible - funding.montant_collecte} € pour atteindre l&apos;objectif · {funding.participants_count} participants
                </span>
              </div>
              <Link
                href="/demo/cotisations"
                className="flex h-12 items-center justify-center rounded-sv border border-border-strong bg-white/5 font-sora text-[14px] font-semibold hover:bg-white/10"
              >
                Voir le paiement collectif
              </Link>
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-sv-card border border-border bg-surface p-5">
            <span className="text-[11px] font-medium uppercase tracking-[.1em] text-text-label">Messages</span>
            <p className="text-[14px] leading-relaxed text-text-tertiary">1 message non lu de SportVision.</p>
            <Link href="/demo/messages" className="self-start text-[14px] font-semibold text-[#8CA9FF]">
              Ouvrir la messagerie
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
