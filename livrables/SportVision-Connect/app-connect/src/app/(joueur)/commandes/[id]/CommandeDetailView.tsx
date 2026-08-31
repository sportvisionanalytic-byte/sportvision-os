"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import type { PlayerOrder, PlayerOrderDocument } from "@/lib/prestations/types";
import { TIMELINE_STAGES, STAGE_LABEL, STAGE_COLOR, stageFromStatut, type OrderStage } from "@/lib/prestations/status";
import { formatDateLong, formatEUR } from "@/lib/prestations/format";

const SUPPORT_EMAIL = "contact@sportvision-an.fr";

// multi/backHref (Espace particulier, migration-connect-v51) : quand multi=true, interroge la
// commande parmi TOUS les client_id accessibles à l'appelant (pas seulement les siens) — voir
// l'en-tête de l'edge function pour le détail. Défauts inchangés : reproduit exactement le
// comportement existant côté Espace joueur.
// Lien "Créer une cotisation" (migration-connect-v74-commande-lien-cotisation.sql) — résolu à
// part de get_order (pas de champ dessus, voir la migration) via une RPC dédiée, additive,
// jamais un ajout sur connect-player-prestations (fichier hors périmètre, un autre agent y
// travaille en parallèle sur le paiement espèces des réservations solo).
interface OrderFundingLink {
  offre_id: string | null;
  is_collectif: boolean;
  existing_funding_id: string | null;
  existing_funding_share_token: string | null;
}

export function CommandeDetailView({ id, multi = false, backHref = "/commandes" }: { id: string; multi?: boolean; backHref?: string }) {
  const [order, setOrder] = useState<(PlayerOrder & { forWho?: string | null }) | null>(null);
  const [documents, setDocuments] = useState<PlayerOrderDocument[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [fundingLink, setFundingLink] = useState<OrderFundingLink | null>(null);

  // Racine des routes Cotisations : /particulier/cotisations côté Espace particulier (multi=true
  // sur ce composant, voir son en-tête), /cotisations côté Espace joueur — même convention que
  // backHref/listHref déjà utilisée par ce composant et FundingDetailView.tsx.
  const cotisationsBase = multi ? "/particulier/cotisations" : "/cotisations";

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase.functions.invoke("connect-player-prestations", { body: { action: "get_order", id, multi } })
      .then(({ data, error: fnError }) => {
        if (cancelled) return;
        if (fnError || data?.error) {
          setError(data?.error || "Commande introuvable.");
          return;
        }
        setOrder(data.order as PlayerOrder);
        setDocuments((data.documents || []) as PlayerOrderDocument[]);
      })
      .catch(() => {
        if (!cancelled) setError("Commande introuvable.");
      });
    // Best-effort : un échec ne doit pas bloquer l'affichage de la commande elle-même, le bloc
    // "Payer à plusieurs" reste simplement masqué (fundingLink?.is_collectif). IIFE async plutôt
    // qu'un .then().catch() : le PostgrestFilterBuilder de .rpc() est seulement "thenable"
    // (PromiseLike), son .then() ne renvoie pas un objet chaînable avec .catch().
    (async () => {
      try {
        const { data } = await supabase.rpc("connect_get_order_funding_link", { p_prestation_id: id });
        if (cancelled || !data) return;
        setFundingLink(data as OrderFundingLink);
      } catch {
        // Best-effort — voir le commentaire ci-dessus.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, multi]);

  async function payNow() {
    if (!order) return;
    setBusy(true);
    setCheckoutError(null);
    const supabase = createClient();
    const { data, error: fnError } = await supabase.functions.invoke("create-checkout-session", {
      body: { prestation_id: order.id, type_paiement: "totalite" },
    });
    setBusy(false);
    if (fnError || data?.error || !data?.url) {
      setCheckoutError(data?.error || "Le paiement en ligne est momentanément indisponible.");
      return;
    }
    window.location.href = data.url;
  }

  // Choix espèces fait APRÈS la réservation, depuis cette fiche (migration-connect-v75) —
  // symétrique au choix carte/espèces du wizard (mode_paiement_choisi), mais pour une commande
  // déjà créée (avant ce chantier, ou créée en "carte"/"à plusieurs" jamais soldée). Met à jour
  // l'état local plutôt qu'un refetch complet : la RPC ne renvoie que { ok: true }, order.
  // modePaiementChoisi est la seule donnée qui change réellement côté affichage (voir
  // showEspecesNotice/canPay ci-dessous, dérivés de ce champ).
  async function payEspeces() {
    if (!order) return;
    setBusy(true);
    setCheckoutError(null);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("connect_choose_especes_for_prestation", { p_prestation_id: order.id });
    setBusy(false);
    if (rpcError || !data?.ok) {
      setCheckoutError("Impossible d'enregistrer ce choix pour le moment. Réessayez dans un instant.");
      return;
    }
    setOrder({ ...order, modePaiementChoisi: "especes" });
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-sv-card border border-dashed border-border-strong bg-surface p-8 text-center">
        <span className="material-symbols-rounded !text-[24px] text-danger" aria-hidden="true">error</span>
        <span className="text-[14px] text-text-tertiary">{error}</span>
        <Link href={backHref} className="text-[14px] font-semibold text-[#8CA9FF] lg:text-[13px]">Retour à mes commandes</Link>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="flex flex-col gap-3">
        <div className="h-8 w-48 animate-pulse rounded-sv bg-surface" />
        <div className="h-[280px] animate-pulse rounded-sv-card border border-border bg-surface" />
      </div>
    );
  }

  const stage = stageFromStatut(order.statut);
  const color = STAGE_COLOR[stage];
  const amount = order.montantTtc ?? order.montantEstime;
  const isPaid = order.statutFinancier === "payée" || order.statutFinancier === "partiellement_payée" || order.acompteRecu;
  // Espèces choisies (mode_paiement_choisi, migration-prestations-choix-paiement-guest.sql) : le
  // client a déjà exprimé son choix de régler sur place — lui montrer un bouton "Payer maintenant"
  // (Stripe) serait confus. Si un paiement carte a malgré tout eu lieu depuis (isPaid), le bloc
  // paiement disparaît normalement (comportement inchangé) : le bloc "espèces" ci-dessous ne
  // s'affiche donc, lui aussi, que tant que la commande n'est pas déjà payée.
  const especesChoisies = order.modePaiementChoisi === "especes";
  const canPay = stage !== "annulee" && amount !== null && !isPaid && !especesChoisies;
  const showEspecesNotice = especesChoisies && stage !== "annulee" && amount !== null && !isPaid;

  return (
    <div className="flex flex-col gap-6 animate-sv-in">
      <Link href={backHref} className="flex items-center gap-2 self-start text-[14px] font-medium text-text-tertiary hover:text-text lg:text-[13px]">
        <span className="material-symbols-rounded !text-[18px]" aria-hidden="true">arrow_back</span>
        Mes commandes
      </Link>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-sora text-[26px] font-bold tracking-tight">{order.offreNom || "Prestation"}</h1>
          <span className="rounded-sv-pill px-2.5 py-1 text-[12px] font-medium" style={{ color: color.fg, background: color.bg }}>
            {STAGE_LABEL[stage]}
          </span>
          {order.forWho && (
            <span className="rounded-sv-pill bg-white/[.07] px-2.5 py-1 text-[12px] font-medium text-text-tertiary">Pour {order.forWho}</span>
          )}
        </div>
        <span className="text-[13px] text-text-tertiary">Réf. {order.reference}</span>
      </div>

      {/* Timeline */}
      {stage !== "annulee" ? (
        <div className="flex flex-col gap-2 rounded-sv-card border border-border bg-surface p-5">
          <div className="flex items-center">
            {TIMELINE_STAGES.map((s, i) => (
              <TimelineStep key={s} stage={s} active={TIMELINE_STAGES.indexOf(stage) >= i} isLast={i === TIMELINE_STAGES.length - 1} />
            ))}
          </div>
          {/* Sur mobile, les 6 libellés ("En production", 13 caractères) se retrouvaient sur
              ~50px de colonne chacun — repliés sur 2-3 lignes, quasi illisibles (voir
              TimelineStep : labels masqués sous sm: ci-dessous). Un résumé texte unique "Étape
              X/6 · Libellé" reste toujours lisible, quelle que soit la longueur du libellé. */}
          <span className="text-center text-[13.5px] font-medium text-text-secondary sm:hidden">
            Étape {TIMELINE_STAGES.indexOf(stage) + 1}/{TIMELINE_STAGES.length} · {STAGE_LABEL[stage]}
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2.5 rounded-sv border border-danger-border bg-danger-bg px-4 py-3.5">
          <span className="material-symbols-rounded !text-[19px] text-danger" aria-hidden="true">cancel</span>
          <span className="text-[14px] text-text-secondary lg:text-[13.5px]">Cette commande a été annulée.</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Fact label="Date" value={formatDateLong(order.datePrestation)} />
        <Fact label="Heure" value={order.heureDebut || "—"} />
        <Fact label="Lieu" value={order.lieu || order.adresseComplete || "—"} />
        <Fact label="Équipe" value={order.equipes || "—"} />
        <Fact label="Montant" value={amount !== null ? `${formatEUR(amount)} TTC${order.montantTtc === null ? " (estimé)" : ""}` : "Sur devis"} />
        <Fact label="Options" value={order.optionsSelectionnees.length ? order.optionsSelectionnees.join(", ") : "Aucune"} />
      </div>

      {order.descriptionBesoin && (
        <div className="flex flex-col gap-2 rounded-sv-card border border-border bg-surface p-5">
          <h2 className="font-sora text-[15px] font-semibold">Détails de la demande</h2>
          <p className="whitespace-pre-line text-[13.5px] leading-relaxed text-text-tertiary">{order.descriptionBesoin}</p>
        </div>
      )}

      {fundingLink?.is_collectif && stage !== "annulee" && (
        <div className="flex flex-col gap-3 rounded-sv-card border border-cotisations/40 bg-cotisations-bg p-5">
          <h2 className="font-sora text-[15px] font-semibold">Payer à plusieurs</h2>
          {fundingLink.existing_funding_id ? (
            <>
              <p className="text-[14px] text-text-tertiary lg:text-[13px]">Un paiement collectif est déjà ouvert pour cette prestation.</p>
              <Link
                href={`${cotisationsBase}/${fundingLink.existing_funding_id}`}
                className="flex h-11 w-fit items-center gap-2 rounded-sv border border-border-strong bg-white/[.06] px-4 font-sora text-[14px] font-semibold hover:bg-white/[.12]"
              >
                <span className="material-symbols-rounded !text-[18px]" aria-hidden="true">volunteer_activism</span>
                Voir le paiement collectif
              </Link>
            </>
          ) : (
            <>
              <p className="text-[14px] text-text-tertiary lg:text-[13px]">
                Vous aviez demandé à partager le coût de cette prestation. Créez le paiement collectif pour inviter vos proches à contribuer.
              </p>
              <Link
                href={
                  fundingLink.offre_id
                    ? `${cotisationsBase}/creer?offreId=${fundingLink.offre_id}&prestationId=${id}${order.equipes ? `&contexte=${encodeURIComponent(order.equipes)}` : ""}`
                    : `${cotisationsBase}/creer`
                }
                className="flex h-11 w-fit items-center gap-2 rounded-sv bg-sv-gradient px-4 font-sora text-[14px] font-semibold text-white hover:brightness-[1.12]"
              >
                <span className="material-symbols-rounded !text-[18px]" aria-hidden="true">volunteer_activism</span>
                Créer un paiement collectif
              </Link>
            </>
          )}
        </div>
      )}

      {canPay && (
        <div className="flex flex-col gap-3 rounded-sv-card border border-border bg-surface p-5">
          <h2 className="font-sora text-[15px] font-semibold">Paiement</h2>
          <p className="text-[14px] text-text-tertiary lg:text-[13px]">Cette commande n&apos;a pas encore été réglée.</p>
          {checkoutError && <span className="text-[13.5px] text-danger lg:text-[12.5px]">{checkoutError}</span>}
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={payNow} loading={busy} className="self-start">
              Payer {formatEUR(amount)}
            </Button>
            <button
              type="button"
              onClick={payEspeces}
              disabled={busy}
              className="flex h-11 items-center gap-2 rounded-sv border border-border-strong bg-white/[.06] px-4 font-sora text-[14px] font-semibold text-text-secondary hover:bg-white/[.12] disabled:opacity-60"
            >
              <span className="material-symbols-rounded !text-[18px]" aria-hidden="true">payments</span>
              Régler en espèces sur place
            </button>
          </div>
        </div>
      )}

      {showEspecesNotice && (
        <div className="flex items-center gap-3 rounded-sv-card border border-border bg-surface p-5">
          <span className="material-symbols-rounded !text-[19px] text-text-tertiary" aria-hidden="true">payments</span>
          <div className="flex flex-col gap-0.5">
            <span className="font-sora text-[14.5px] font-semibold">Réglé en espèces sur place</span>
            <span className="text-[14px] text-text-tertiary lg:text-[13px]">
              Vous avez choisi de régler {formatEUR(amount)} le jour de la prestation.
            </span>
          </div>
        </div>
      )}

      {documents.some((d) => d.kind === "livrable") && (
        <div className="flex flex-col gap-2.5">
          <h2 className="font-sora text-[15px] font-semibold">Vos livrables</h2>
          {documents.filter((d) => d.kind === "livrable").map((doc) => (
            <div key={`${doc.kind}-${doc.id}`} className="flex items-center gap-3.5 rounded-sv border border-border bg-surface px-4 py-3.5">
              <span className="material-symbols-rounded !text-[19px] text-text-tertiary" aria-hidden="true">photo_library</span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[14px] font-medium text-text lg:text-[13.5px]">{doc.reference}</span>
                <span className="text-[12px] text-text-tertiary">{formatDateLong(doc.date)} · {doc.statut === "consulte" ? "Consulté" : "Livré"}</span>
                {doc.expiresAt && (
                  <span className="text-[12px] text-text-tertiary">Disponible jusqu&apos;au {formatDateLong(doc.expiresAt)}</span>
                )}
              </div>
              {doc.pdfUrl && (
                <a href={doc.pdfUrl} target="_blank" rel="noreferrer" className="flex-none text-[#8CA9FF]">
                  <span className="material-symbols-rounded !text-[20px]" aria-hidden="true">download</span>
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {documents.some((d) => d.kind === "facture" || d.kind === "paiement") && (
        <div className="flex flex-col gap-2.5">
          <h2 className="font-sora text-[15px] font-semibold">Documents liés</h2>
          {documents.filter((d) => d.kind === "facture" || d.kind === "paiement").map((doc) => (
            <div key={`${doc.kind}-${doc.id}`} className="flex items-center gap-3.5 rounded-sv border border-border bg-surface px-4 py-3.5">
              <span className="material-symbols-rounded !text-[19px] text-text-tertiary" aria-hidden="true">{doc.kind === "facture" ? "description" : "payments"}</span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[14px] font-medium text-text lg:text-[13.5px]">{doc.kind === "facture" ? `Facture ${doc.reference}` : `Paiement ${doc.reference}`}</span>
                <span className="text-[12px] text-text-tertiary">{formatDateLong(doc.date)} · {doc.statut}</span>
              </div>
              <span className="flex-none font-sora text-[13px] font-semibold">{formatEUR(doc.montant)}</span>
              {doc.pdfUrl && (
                <a href={doc.pdfUrl} target="_blank" rel="noreferrer" className="flex-none text-[#8CA9FF]">
                  <span className="material-symbols-rounded !text-[20px]" aria-hidden="true">download</span>
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Empilé sur mobile : le titre + bouton "Contacter SportVision" côte à côte se
          chevauchaient en dessous de ~400px de large (justify-between sans wrap). Revient à une
          seule ligne dès sm:, même pattern que les listes Factures/Paiements (fix du 15/08). */}
      <div className="flex flex-col items-start gap-3 rounded-sv-card border border-border bg-surface p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-0.5">
          <span className="font-sora text-[14.5px] font-semibold">Une question sur cette commande ?</span>
          <span className="text-[14px] text-text-tertiary lg:text-[13px]">L&apos;équipe SportVision vous répond rapidement.</span>
        </div>
        <a href={`mailto:${SUPPORT_EMAIL}`} className="flex-none rounded-sv border border-border-strong bg-bg-elevated px-4 py-2.5 font-sora text-[14px] font-semibold hover:bg-surface-hover lg:text-[13px]">
          Contacter SportVision
        </a>
      </div>
    </div>
  );
}

function TimelineStep({ stage, active, isLast }: { stage: OrderStage; active: boolean; isLast: boolean }) {
  const color = STAGE_COLOR[stage];
  return (
    <div className="flex flex-1 flex-col items-center gap-1.5">
      <div className="flex w-full items-center">
        <span
          className="flex h-6 w-6 flex-none items-center justify-center rounded-full border-2 text-[11px] font-bold"
          style={active ? { borderColor: color.fg, background: color.bg, color: color.fg } : { borderColor: "rgba(255,255,255,.16)", color: "#6C6C90" }}
        >
          {active && <span className="material-symbols-rounded !text-[14px]" aria-hidden="true">check</span>}
        </span>
        {!isLast && <span className="mx-1 h-[2px] flex-1" style={{ background: active ? color.fg : "rgba(255,255,255,.12)" }} />}
      </div>
      {/* Masqué sur mobile (6 colonnes ~50px chacune, libellés jusqu'à "En production" qui s'y
          repliaient sur plusieurs lignes) — résumé texte unique affiché juste en dessous à la
          place, voir l'appelant. */}
      <span className="hidden text-center text-[10.5px] leading-tight text-text-faint sm:block">{STAGE_LABEL[stage]}</span>
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
