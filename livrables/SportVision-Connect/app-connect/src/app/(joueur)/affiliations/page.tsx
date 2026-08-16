import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { buildPlayerContext, requireJoueurAccount } from "@/lib/supabase/session";
import { LeaveAffiliationButton } from "./LeaveAffiliationButton";

const STATUS_LABEL: Record<"affilie" | "attente" | "refuse", { label: string; color: string; bg: string }> = {
  affilie: { label: "✓ Affilié", color: "#22D3EE", bg: "rgba(34,211,238,.14)" },
  attente: { label: "En attente", color: "#FBBF24", bg: "rgba(251,191,36,.14)" },
  refuse: { label: "Demande refusée", color: "#F472B6", bg: "rgba(244,114,182,.14)" },
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

// Mes affiliations — voir design-connect-personnel-12-08/README.md § Espace joueur → Mes
// affiliations. Une seule affiliation possible pour l'instant (voir note dans session.ts) —
// pas les sections "Actives/En attente/Clubs déclarés" du design complet, une seule fiche.
export default async function AffiliationsPage() {
  const supabase = await createClient();
  const { user } = await requireJoueurAccount(supabase);

  const player = await buildPlayerContext(supabase, user.id);

  return (
    <div className="flex flex-col gap-6 animate-sv-in">
        <div className="flex flex-col gap-2">
          <h1 className="font-sora text-[27px] font-bold tracking-tight lg:text-[33px]">Mes affiliations</h1>
          <p className="max-w-[560px] text-[15px] text-text-tertiary">
            Retrouvez les clubs et structures sportives liés à votre profil.
          </p>
        </div>

        {player?.club ? (
          <div
            className="rounded-sv-card p-px"
            style={{ background: "linear-gradient(130deg, rgba(34,211,238,.55), rgba(79,125,255,.2) 60%, transparent)" }}
          >
            <div className="flex flex-col gap-4 rounded-[calc(theme(borderRadius.sv-card)-1px)] bg-bg-elevated p-5">
              <div className="flex flex-wrap items-center gap-4">
                {player.club.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- logo club distant (bucket Storage clubplus-media), pas un asset local optimisable par next/image
                  <img
                    src={player.club.logoUrl}
                    alt={`Logo ${player.club.nom}`}
                    className="h-[52px] w-[52px] flex-none rounded-sv bg-white/5 object-cover"
                  />
                ) : (
                  <span className="flex h-[52px] w-[52px] flex-none items-center justify-center rounded-sv bg-white/5 font-mono text-[8px] text-text-faint">
                    logo
                  </span>
                )}
                <div className="flex min-w-0 flex-col gap-1.5">
                  <span className="font-sora text-[20px] font-semibold tracking-tight">{player.club.nom}</span>
                  <div className="flex flex-wrap items-center gap-2">
                    {player.club.ville && <span className="text-[13px] text-text-tertiary">{player.club.ville}</span>}
                    <span
                      className="rounded-sv-pill px-2.5 py-1 text-[12px] font-medium"
                      style={{ color: STATUS_LABEL[player.club.status].color, background: STATUS_LABEL[player.club.status].bg }}
                    >
                      {STATUS_LABEL[player.club.status].label}
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Fact label="Structure" value={player.club.nom} />
                <Fact label="Statut" value={STATUS_LABEL[player.club.status].label.replace("✓ ", "")} />
                <Fact label="Depuis" value={formatDate(player.club.since)} />
                <Fact label="SportVision Club+" value="Structure partenaire" />
              </div>

              {player.club.status === "attente" && (
                <p className="text-[13px] leading-relaxed text-text-tertiary">
                  Votre demande d&apos;affiliation doit encore être confirmée par le club. Vous
                  pouvez utiliser Connect normalement pendant ce temps.
                </p>
              )}

              <div className="mt-1 flex flex-wrap items-center gap-4 rounded-sv border border-danger-border bg-danger-bg px-4 py-3.5">
                <div className="flex flex-col gap-1">
                  <span className="font-sora text-[14px] font-semibold">Quitter cette affiliation</span>
                  <span className="text-[13px] text-text-tertiary">Votre compte Connect est conservé.</span>
                </div>
                <LeaveAffiliationButton clubName={player.club.nom} />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3.5 rounded-sv-card border border-dashed border-border-strong bg-surface p-6 max-w-[560px]">
            <span className="flex h-12 w-12 items-center justify-center rounded-sv bg-affiliations-bg">
              <span className="material-symbols-rounded !text-[24px] text-affiliations" aria-hidden="true">shield</span>
            </span>
            <span className="font-sora text-[18px] font-semibold">Aucun club associé</span>
            <p className="text-[14px] leading-relaxed text-text-tertiary">
              Rejoignez votre club ou ajoutez votre structure actuelle pour retrouver les
              contenus et événements liés à votre équipe.
            </p>
            <Link
              href="/affiliations/ajouter"
              className="self-start rounded-sv bg-sv-gradient px-4 py-2.5 font-sora text-[14px] font-semibold text-white hover:brightness-[1.12]"
            >
              Ajouter un club
            </Link>
          </div>
        )}
      </div>
    );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-sv border border-border bg-surface p-3.5">
      <span className="text-[11px] font-medium uppercase tracking-[.1em] text-text-label">{label}</span>
      <span className="font-sora text-[14px] font-semibold">{value}</span>
    </div>
  );
}
