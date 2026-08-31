import Link from "next/link";
import { gradientFor } from "@/lib/avatarGradients";
import { ShareFundingButtons } from "./ShareFundingButtons";
import { ParticipateButton } from "./ParticipateButton";

export interface Contribution {
  id: string;
  name: string;
  is_guest: boolean;
  montant: number;
  created_at: string;
}

export interface FundingDetail {
  id: string;
  group_id: string | null;
  group_name: string | null;
  created_by: string;
  is_creator: boolean;
  titre: string;
  contexte: string | null;
  catalogue_offre_nom: string | null;
  montant_cible: number;
  montant_collecte: number;
  repartition_mode: "egale" | "libre";
  nb_participants_prevu: number | null;
  date_limite: string | null;
  statut: "ouverte" | "objectif_atteint" | "expiree" | "annulee";
  share_token: string;
  created_at: string;
  my_contribution_amount: number | null;
  contributions: Contribution[];
  beneficiary_label?: string | null;
}

function euros(n: number) {
  return `${n.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`;
}
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

const PAY_REST_THRESHOLD = 48;

// Extrait de cotisations/[id]/page.tsx (Espace joueur, 14/08) pour être réutilisé tel quel par
// l'Espace particulier (/particulier/cotisations/[id]/page.tsx) — même détail, mêmes actions
// (partager/participer/payer le reste), seul `listHref` change ("/cotisations" vs
// "/particulier/cotisations") et `beneficiary_label` s'affiche en plus quand présent
// (migration-connect-v51-espace-particulier.sql §6).
export function FundingDetailView({
  funding,
  paiement,
  listHref = "/cotisations",
  demoMode = false,
}: {
  funding: FundingDetail;
  paiement?: string;
  listHref?: string;
  // /demo/cotisations/[id] (audit du 31/08/2026) : la démo réutilise ce composant avec un
  // share_token factice ("demo-token", voir mock-data.ts) — le lien "Aperçu du lien" ci-dessous
  // pointait vers la vraie page publique /cotisation/demo-token, qui affiche un 404 réel
  // (aucune ligne group_fundings n'a ce token en base). Sans conséquence pour l'utilisateur
  // (aucune donnée exposée, juste un cul-de-sac), mais un écran démo n'est censé mener nulle
  // part de cassé — demoMode désactive ce lien précis au lieu de le pointer vers une 404.
  demoMode?: boolean;
}) {
  const pct = Math.min(100, Math.round((funding.montant_collecte / funding.montant_cible) * 100));
  const reached = funding.statut === "objectif_atteint";
  const remaining = Math.max(0, Math.round((funding.montant_cible - funding.montant_collecte) * 100) / 100);
  const canParticipate = funding.statut === "ouverte" && remaining > 0;
  const canPayRest = canParticipate && remaining <= PAY_REST_THRESHOLD;
  const isTerminal = funding.statut === "expiree" || funding.statut === "annulee";

  return (
    <div className="flex flex-col gap-[22px] animate-sv-in">
      <Link href={listHref} className="flex items-center gap-2 self-start text-[14px] font-medium text-text-tertiary hover:text-text lg:text-[13px]">
        <span className="material-symbols-rounded !text-[18px]" aria-hidden="true">arrow_back</span>
        Paiements collectifs
      </Link>

      {paiement === "succes" && (
        <div className="flex items-start gap-2.5 rounded-sv border border-affiliations/40 bg-affiliations-bg px-4 py-3.5">
          <span className="material-symbols-rounded !text-[19px] text-affiliations" aria-hidden="true">hourglass_top</span>
          <span className="text-[14px] leading-relaxed text-text-secondary lg:text-[13px]">
            Votre paiement est en cours de confirmation par Stripe. Le montant collecté ci-dessous se mettra à jour
            automatiquement dès la confirmation — rafraîchissez la page dans quelques instants si besoin.
          </span>
        </div>
      )}
      {paiement === "annule" && (
        <div className="flex items-start gap-2.5 rounded-sv border border-attente/40 bg-attente-bg px-4 py-3.5">
          <span className="material-symbols-rounded !text-[19px] text-attente" aria-hidden="true">info</span>
          <span className="text-[14px] leading-relaxed text-text-secondary lg:text-[13px]">Paiement annulé, vous pouvez réessayer.</span>
        </div>
      )}

      <div
        className="rounded-sv-card p-px"
        style={{ background: `linear-gradient(150deg,${reached ? "rgba(34,211,238,.5)" : "rgba(244,114,182,.5)"},rgba(168,85,247,.28) 55%,transparent)` }}
      >
        <div className="flex flex-col gap-[18px] rounded-[calc(theme(borderRadius.sv-modal)-1px)] bg-bg-elevated-accent p-6">
          <div className="flex flex-col gap-2">
            <span
              className="self-start rounded-sv-pill px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[.06em]"
              style={{
                color: reached ? "#22D3EE" : isTerminal ? "#9A9AB8" : "#F472B6",
                background: reached ? "rgba(34,211,238,.14)" : isTerminal ? "rgba(255,255,255,.08)" : "rgba(244,114,182,.14)",
              }}
            >
              {{ ouverte: "En cours", objectif_atteint: "Objectif atteint", expiree: "Expirée", annulee: "Annulée" }[funding.statut]}
            </span>
            <h1 className="font-sora text-[24px] font-bold tracking-tight lg:text-[27px]">{funding.titre}</h1>
            <span className="text-[14px] text-text-tertiary">
              {funding.group_name || funding.contexte || "Partage libre"}
              {funding.beneficiary_label ? ` · Pour ${funding.beneficiary_label}` : ""}
            </span>
          </div>

          {reached && (
            <div className="flex items-center gap-3 rounded-sv border border-affiliations/30 bg-affiliations-bg px-[17px] py-[15px]">
              <span className="material-symbols-rounded !text-[22px] text-affiliations" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">
                check_circle
              </span>
              <span className="text-[14px] leading-relaxed text-text-secondary">
                Objectif atteint 🎉 Votre prestation est entièrement financée.
              </span>
            </div>
          )}

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div className="flex items-baseline gap-2">
                <span className="font-sora text-[38px] font-bold tracking-tight">{euros(funding.montant_collecte)}</span>
                <span className="text-[16px] text-text-tertiary">/ {euros(funding.montant_cible)}</span>
              </div>
              <span className="font-sora text-[17px] font-semibold" style={{ color: reached ? "#22D3EE" : "#F472B6" }}>
                {pct}%
              </span>
            </div>
            <div className="h-3 overflow-hidden rounded-sv-pill bg-white/[.08]">
              <div className={`h-full rounded-sv-pill transition-[width] duration-300 motion-reduce:transition-none ${reached ? "bg-sv-gradient-financee" : "bg-sv-gradient-cotisation"}`} style={{ width: `${pct}%` }} />
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <span className="text-[14px] text-text-secondary">
                {reached ? "Objectif atteint" : `Reste ${euros(remaining)}`}
              </span>
              <span className="text-[14px] text-text-tertiary">
                {funding.contributions.length} participation{funding.contributions.length > 1 ? "s" : ""}
              </span>
              {funding.date_limite && (
                <span className="text-[14px]" style={{ color: isTerminal ? "#F472B6" : "#9A9AB8" }}>
                  Jusqu&apos;au {formatDate(funding.date_limite)}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2.5">
            {!isTerminal && <ShareFundingButtons shareToken={funding.share_token} titre={funding.titre} />}
            {canParticipate && !canPayRest && (
              <ParticipateButton
                fundingId={funding.id}
                remaining={remaining}
                suggested={funding.repartition_mode === "egale" && funding.nb_participants_prevu ? Math.ceil((funding.montant_cible / funding.nb_participants_prevu) * 100) / 100 : null}
              />
            )}
            {canPayRest && <ParticipateButton fundingId={funding.id} remaining={remaining} suggested={remaining} payRestLabel={`Payer le reste — ${euros(remaining)}`} />}
            {reached && (
              <Link
                href="/prestations"
                className="flex h-[50px] items-center rounded-sv border border-border-strong bg-white/[.06] px-5 font-sora text-[15px] font-semibold hover:bg-white/[.12]"
              >
                Voir ma prestation
              </Link>
            )}
          </div>

          {isTerminal && (
            <div className="flex items-start gap-2.5 rounded-sv border border-dashed border-border-strong bg-white/[.04] px-4 py-3.5">
              <span className="material-symbols-rounded !text-[19px] text-text-tertiary" aria-hidden="true">construction</span>
              <span className="text-[14px] leading-relaxed text-text-tertiary lg:text-[13px]">
                Ce paiement collectif est {funding.statut === "expiree" ? "expiré" : "annulé"}. Les actions « demander
                malgré tout » et « rembourser les participants » sont en cours de finalisation et ne sont pas encore
                disponibles ici — contactez SportVision depuis Messages pour un traitement manuel.
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-[18px] lg:grid-cols-[minmax(0,1.62fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-[13px]">
          <div className="flex items-center gap-2.5">
            <h2 className="font-sora text-[18px] font-semibold tracking-tight">Participants</h2>
            <span className="rounded-sv-pill bg-white/[.07] px-2.5 py-1 text-[12px] font-medium text-text-tertiary">
              {funding.contributions.length}
            </span>
          </div>
          {funding.contributions.length > 0 ? (
            <div className="flex flex-col gap-2.5">
              {funding.contributions.map((c) => (
                <div key={c.id} className="flex items-center gap-3 rounded-sv border border-border bg-surface px-3.5 py-3">
                  <span
                    className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-full font-sora text-[13px] font-semibold text-white"
                    style={{ background: gradientFor(c.id) }}
                  >
                    {c.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-[14px] font-medium">{c.name}</span>
                    <span className="text-[12px] text-text-tertiary">{formatDate(c.created_at)}</span>
                  </div>
                  <span className="ml-auto flex-none text-[14px] font-semibold text-affiliations lg:text-[13px]">{euros(c.montant)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-2 rounded-sv border border-dashed border-border-strong bg-white/[.04] p-[18px]">
              <span className="text-[14px] leading-relaxed text-text-tertiary lg:text-[13px]">Aucune participation pour le moment.</span>
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-[18px]">
          <div className="flex flex-col gap-3 rounded-sv border border-border bg-surface p-5">
            <span className="text-[11px] font-medium uppercase tracking-[.1em] text-text-label">Détails</span>
            <RecapLine label="Prestation" value={funding.catalogue_offre_nom || "—"} />
            <RecapLine label="Groupe" value={funding.group_name || "Partage libre"} />
            <RecapLine label="Répartition" value={funding.repartition_mode === "egale" ? `Parts égales${funding.nb_participants_prevu ? ` · ${funding.nb_participants_prevu} participants` : ""}` : "Participation libre"} />
            <RecapLine label="Créée le" value={formatDate(funding.created_at)} />
            {funding.date_limite && <RecapLine label="Date limite" value={formatDate(funding.date_limite)} />}
            {funding.my_contribution_amount != null && (
              <RecapLine label="Ma participation" value={euros(funding.my_contribution_amount)} />
            )}
          </div>

          {!isTerminal && (
            <div className="flex flex-col gap-2.5 rounded-sv border border-border bg-white/[.04] p-5">
              <span className="font-sora text-[15px] font-semibold">Page publique</span>
              <span className="text-[14px] leading-relaxed text-text-tertiary lg:text-[13px]">
                Voici ce que voient vos coéquipiers en ouvrant le lien.
              </span>
              {demoMode ? (
                <span
                  title="Indisponible en démonstration"
                  className="flex h-11 w-fit cursor-not-allowed items-center gap-2 rounded-sv border border-border-strong bg-white/[.03] px-4 font-sora text-[14px] font-semibold text-text-faint"
                >
                  <span className="material-symbols-rounded !text-[18px]" aria-hidden="true">open_in_new</span>
                  Aperçu du lien
                </span>
              ) : (
                <Link
                  href={`/cotisation/${funding.share_token}`}
                  target="_blank"
                  className="flex h-11 w-fit items-center gap-2 rounded-sv border border-border-strong bg-white/[.06] px-4 font-sora text-[14px] font-semibold hover:bg-white/[.12]"
                >
                  <span className="material-symbols-rounded !text-[18px]" aria-hidden="true">open_in_new</span>
                  Aperçu du lien
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RecapLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-[14px] text-text-tertiary">{label}</span>
      <span className="ml-auto text-right text-[14px] font-medium">{value}</span>
    </div>
  );
}
