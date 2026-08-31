"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, FileText, Receipt } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canViewClubFinancialDocuments } from "@/lib/permissions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { LockedModule } from "@/components/ui/LockedModule";
import { RestrictedToBureau } from "@/components/ui/RestrictedToBureau";
import { Toast, useToast } from "@/components/feedback/Toast";
import { INVOICE_STATUS_LABEL, INVOICE_STATUS_TONE, formatEuroTTC, remainingAmount } from "@/components/billing/format";
import { CGV_URL, CGV_VERSION, CONTRACT_STATUS_LABEL, CONTRACT_STATUS_TONE, needsExecutionAnticipee } from "@/components/contracts/format";
import { createClient } from "@/lib/supabase/client";
import {
  decideDevis,
  fetchClientContracts,
  fetchClientDevis,
  fetchClientInvoices,
  type ClientContract,
  type ClientDevis,
} from "@/lib/data/projet/billing";
import { resolveClubPortailClientId } from "@/lib/data/club/portail-link";
import { resolveOrgLegacyClientId } from "@/lib/data/shared/org-legacy-link";
import { ClubSubscriptionCard } from "@/components/billing/ClubSubscriptionCard";
import type { Invoice } from "@/lib/types/billing";

function daysLate(dueDate: string): number {
  const diff = Date.now() - new Date(dueDate).getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

// Écran Factures — ACTIONS.md § 19. Un seul flux réel (vues client_devis/client_factures/
// client_contrats) pour deux personas : Espace Projet (client_id = organization.id directement)
// et Club (client_id = clubs.portail_client_id, résolu — un club n'est pas lui-même une ligne
// `clients`, voir portail-link.ts). Le joueur affilié n'a pas de facturation propre (portée par
// son club). Les autres types restent verrouillés (aucune donnée financière réelle à leur nom).
export default function BillingPage() {
  const { ctx } = useSession();

  const isAffiliatedPlayer = ctx.organization.type === "player" && !!ctx.organization.parentOrganizationId;
  if (isAffiliatedPlayer) return <AffiliatedPlayerNotice />;

  if (ctx.organization.type === "generic") return <BillingDocumentsView clientId={ctx.organization.id} allowDevisDecision />;
  if (ctx.organization.type === "club") return <ClubBillingView />;
  // 17/08/2026 — tournoi/stage n'avaient aucune vue Facturation (LockedModule quoi qu'il arrive) :
  // le lien "Payer" ajouté ce soir au dashboard (PersonaDashboard.tsx, remplace les données
  // fictives "Contrat de prestation... 12 août") aurait pointé dans le vide sans ceci. Même
  // rattachement best-effort que le dashboard (organizations.legacy_client_id,
  // resolveOrgLegacyClientId), pas de porte bureau (pas de notion de rôles bureau pour ces types).
  if (ctx.organization.type === "tournament_organizer" || ctx.organization.type === "camp") return <EventBillingView />;

  return <LockedModule />;
}

function EventBillingView() {
  const { ctx } = useSession();
  const [clientId, setClientId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    const supabase = createClient();
    resolveOrgLegacyClientId(supabase, ctx.organization.id).then(setClientId);
  }, [ctx.organization.id]);

  if (clientId === undefined) {
    return <div className="py-16 text-center text-[13px] text-text-soft">Chargement…</div>;
  }

  if (clientId === null) {
    return (
      <Card className="flex flex-col items-center gap-3 px-8 py-16 text-center">
        <Receipt className="h-6 w-6 text-text-faint" aria-hidden />
        <div className="max-w-md">
          <h2 className="text-[18px] font-extrabold tracking-tight">Facturation pas encore reliée</h2>
          <p className="mt-2 text-[13.5px] leading-relaxed text-text-soft">
            SportVision n&apos;a pas encore relié {ctx.organization.name} à un espace Facturation. Contactez votre
            interlocuteur SportVision pour l&apos;activer.
          </p>
        </div>
      </Card>
    );
  }

  return <BillingDocumentsView clientId={clientId} allowDevisDecision={false} />;
}

function ClubBillingView() {
  const { ctx } = useSession();
  const [clientId, setClientId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    const supabase = createClient();
    resolveClubPortailClientId(supabase, ctx.organization.id).then(setClientId);
  }, [ctx.organization.id]);

  // Communication ("Permission spéciale", pas automatique) et Éducateur ("Non") — §11/§13/§14 :
  // toujours refusés. Secrétaire/Trésorier/Administratif (Bible §10, 17/08/2026) voient désormais
  // cette page en LECTURE — canViewClubFinancialDocuments élargit l'accès sans donner de droit
  // d'action : aucune action de décision (Accepter un devis) n'est câblée pour un club aujourd'hui
  // (allowDevisDecision={false} juste en dessous, y compris pour le bureau historique — décision
  // produit antérieure à ce chantier, voir commit 28f74c6, ces actions restent réservées à l'Espace
  // Projet). Comme documents/page.tsx, cette lecture reste symbolique tant que migration-clubplus-
  // v41-secretaire-administratif-lecture-financiere.sql (écrite par ce chantier, NON ENCORE
  // EXÉCUTÉE) n'a pas été jouée : la RLS des vues client_devis/client_factures/client_contrats
  // reste bureau-strict jusque-là (club_member_has_financial_access, migration-connect-v41).
  // "Mon offre" (§19) : abonnement Club+ du club lui-même, distinct des devis/factures/contrats
  // SportVision ci-dessous — visible pour l'admin seul (seul rôle que create-clubplus-
  // subscription-checkout / clubplus-billing-portal acceptent côté serveur), avant la porte
  // bureau-strict des documents financiers, qui ne le concerne pas.
  // Full Communication (19/08/2026, audit démo Club+) : bug produit trouvé — ClubSubscriptionCard
  // lit clubs.plan (jamais mis à jour au passage en Full Communication, ce plan est vendu par
  // contrat séparé, voir session.ts:buildClubActiveContext) et proposait donc "Club+ Performance
  // — 129 €/mois — S'abonner" à un club qui a en réalité un contrat Full Communication actif, sans
  // rapport avec un abonnement Club+. ctx.subscription.planCode, lui, reflète déjà correctement ce
  // contrat (dérivé côté serveur de client_contrats) : condition la plus simple et la plus fiable,
  // pas de nouvelle requête.
  const isFullCommunication = ctx.subscription.planCode === "full_communication";
  const subscriptionCard =
    ctx.membership.role === "admin" ? (
      isFullCommunication ? (
        <Card className="p-5">
          <div className="text-[12px] font-bold text-text-soft">Mon offre</div>
          <h2 className="mt-1 text-[19px] font-extrabold tracking-tight">Full Communication</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-text-soft">
            Club+ est inclus dans votre contrat Full Communication, sans abonnement séparé. Voir votre contrat dans l&apos;onglet Contrats.
          </p>
        </Card>
      ) : (
        <ClubSubscriptionCard clubId={ctx.organization.id} />
      )
    ) : null;

  if (!canViewClubFinancialDocuments(ctx)) {
    return subscriptionCard ?? <RestrictedToBureau title="Factures" />;
  }

  if (clientId === undefined) {
    return (
      <div className="flex flex-col gap-5">
        {subscriptionCard}
        <div className="py-16 text-center text-[13px] text-text-soft">Chargement…</div>
      </div>
    );
  }

  if (clientId === null) {
    return (
      <div className="flex flex-col gap-5">
        {subscriptionCard}
        <Card className="flex flex-col items-center gap-3 px-8 py-16 text-center">
          <Receipt className="h-6 w-6 text-text-faint" aria-hidden />
          <div className="max-w-md">
            <h2 className="text-[18px] font-extrabold tracking-tight">Facturation pas encore reliée</h2>
            <p className="mt-2 text-[13.5px] leading-relaxed text-text-soft">
              SportVision n&apos;a pas encore relié {ctx.organization.name} à un espace Facturation. Contactez votre
              interlocuteur SportVision pour l&apos;activer.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {subscriptionCard}
      <BillingDocumentsView clientId={clientId} allowDevisDecision={false} />
    </div>
  );
}

function BillingDocumentsView({ clientId, allowDevisDecision }: { clientId: string; allowDevisDecision: boolean }) {
  const { ctx } = useSession();
  const { toastMessage, toastTone, showToast } = useToast();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [devis, setDevis] = useState<ClientDevis[]>([]);
  const [contracts, setContracts] = useState<ClientContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [decidingDevisId, setDecidingDevisId] = useState<string | null>(null);
  // Écran de consentement à l'acceptation (CGV Art. 6.3 : c'est cette acceptation, pas la simple
  // demande initiale, qui forme le contrat) — voir decideDevis (data/projet/billing.ts) et
  // migration-devis-cgv-execution-anticipee-11-08.sql. Même logique que le module vanilla
  // équivalent (SportVision-Connect/app/modules/projet-dashboard-devis-contrats-factures.js),
  // reconstruite ici pour app-next qui est le vrai point d'entrée de production
  // (connect.sportvision-an.fr) — l'app vanilla n'est plus atteinte par de vrais clients.
  const [confirmingDevisId, setConfirmingDevisId] = useState<string | null>(null);
  const [cgvChecked, setCgvChecked] = useState(false);
  const [execChecked, setExecChecked] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  async function reload() {
    setLoadError(false);
    try {
      const supabase = createClient();
      const [inv, dev, con] = await Promise.all([
        fetchClientInvoices(supabase, clientId),
        fetchClientDevis(supabase, clientId),
        fetchClientContracts(supabase, clientId),
      ]);
      setInvoices(inv);
      setDevis(dev);
      setContracts(con);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const pendingDevisList = allowDevisDecision ? devis.filter((d) => d.decidable) : [];
  const overdue = invoices.find((i) => i.status === "en_retard");
  // "emise" seulement : les factures en_retard ont déjà leur propre carte ci-dessous, les
  // reprendre ici doublonnerait le même montant sous deux étiquettes différentes.
  const upcoming = invoices.filter((i) => i.status === "emise").sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))[0];

  async function handleRefuse(devisId: string) {
    setDecidingDevisId(devisId);
    try {
      const supabase = createClient();
      await decideDevis(supabase, devisId, "refusé");
      await reload();
    } catch {
      showToast("Action impossible, réessayez.", "error");
    } finally {
      setDecidingDevisId(null);
    }
  }

  function openConfirm(devisId: string) {
    setConfirmingDevisId(devisId);
    setCgvChecked(false);
    setExecChecked(false);
    setConfirmError(null);
  }

  function cancelConfirm() {
    setConfirmingDevisId(null);
    setConfirmError(null);
  }

  async function handleConfirmAccept(d: ClientDevis) {
    if (!cgvChecked) {
      setConfirmError("Merci d'accepter les CGV pour confirmer ce devis.");
      return;
    }
    if (needsExecutionAnticipee(d.datePrestation) && !execChecked) {
      setConfirmError("Cette prestation a lieu dans moins de 14 jours : merci de cocher la case d'exécution anticipée pour confirmer.");
      return;
    }
    setConfirmError(null);
    setDecidingDevisId(d.id);
    try {
      const supabase = createClient();
      await decideDevis(supabase, d.id, "accepté", { cgvVersion: CGV_VERSION, executionAnticipeeDemandee: execChecked });
      setConfirmingDevisId(null);
      await reload();
    } catch {
      showToast("Action impossible, réessayez.", "error");
    } finally {
      setDecidingDevisId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-5">
        <div>
          <div className="text-[12px] font-bold text-text-soft">Facturation</div>
          <h1 className="mt-1.5 text-[29px] font-extrabold leading-tight tracking-tight">
            Devis, contrats et factures de {ctx.organization.name}
          </h1>
        </div>
        <Card className="flex flex-col items-center gap-2 px-8 py-16 text-center">
          <div className="text-[13.5px] font-bold text-text-soft">Chargement de vos informations…</div>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="text-[12px] font-bold text-text-soft">Facturation</div>
        <h1 className="mt-1.5 text-[29px] font-extrabold leading-tight tracking-tight">
          Devis, contrats et factures de {ctx.organization.name}
        </h1>
      </div>

      {loadError && (
        <Card className="flex flex-wrap items-center gap-3 border-danger-fg/30 bg-danger-bg px-5 py-4">
          <AlertTriangle className="h-[18px] w-[18px] flex-none text-danger-fg" aria-hidden />
          <span className="min-w-0 flex-1 text-[13px] font-semibold text-danger-fg">
            Impossible de charger certaines de vos informations. Les montants ci-dessous peuvent être incomplets.
          </span>
          <Button variant="secondary" className="h-8 flex-none px-3 text-[12px]" onClick={reload}>
            Réessayer
          </Button>
        </Card>
      )}

      {pendingDevisList.map((d) =>
        confirmingDevisId === d.id ? (
          <Card key={d.id} className="flex flex-col gap-3 border-brand-blue-pale/40 bg-info-bg px-5 py-4">
            <span className="text-[13px] font-semibold text-info-fg">
              Devis {d.numero} · {formatEuroTTC(d.totalTtc)}
            </span>
            <label className="flex items-start gap-2.5 text-[12.5px] leading-relaxed text-text">
              <input
                type="checkbox"
                className="mt-0.5 flex-none"
                checked={cgvChecked}
                onChange={(e) => setCgvChecked(e.target.checked)}
              />
              <span>
                J&apos;ai lu et j&apos;accepte les{" "}
                <a href={CGV_URL} target="_blank" rel="noopener noreferrer" className="font-bold text-info-fg underline">
                  Conditions Générales de Vente
                </a>{" "}
                (version en vigueur : {CGV_VERSION}).
              </span>
            </label>
            {needsExecutionAnticipee(d.datePrestation) && (
              <label className="flex items-start gap-2.5 text-[12.5px] leading-relaxed text-text">
                <input
                  type="checkbox"
                  className="mt-0.5 flex-none"
                  checked={execChecked}
                  onChange={(e) => setExecChecked(e.target.checked)}
                />
                <span>
                  Je demande expressément que l&apos;exécution de la prestation commence avant l&apos;expiration de
                  mon délai légal de rétractation de 14 jours. Si je me rétracte ensuite, un montant proportionnel
                  au service déjà fourni pourra rester dû (
                  <a href={`${CGV_URL}#article-35`} target="_blank" rel="noopener noreferrer" className="font-bold text-info-fg underline">
                    Article 35 des CGV
                  </a>
                  ).
                </span>
              </label>
            )}
            {confirmError && <p className="text-[12.5px] font-semibold text-danger-fg">{confirmError}</p>}
            <div className="flex justify-end gap-2.5">
              <Button variant="secondary" className="h-8 flex-none px-3 text-[12px]" onClick={cancelConfirm} disabled={decidingDevisId === d.id}>
                Annuler
              </Button>
              <Button
                variant="primary"
                className="h-8 flex-none px-3 text-[12px]"
                disabled={decidingDevisId === d.id}
                onClick={() => handleConfirmAccept(d)}
              >
                Confirmer l&apos;acceptation
              </Button>
            </div>
          </Card>
        ) : (
          <Card key={d.id} className="flex flex-wrap items-center gap-3 border-brand-blue-pale/40 bg-info-bg px-5 py-4">
            <FileText className="h-[18px] w-[18px] flex-none text-info-fg" aria-hidden />
            <span className="min-w-0 flex-1 text-[13px] font-semibold text-info-fg">
              Devis {d.numero} · {formatEuroTTC(d.totalTtc)} — en attente de votre décision.
            </span>
            <Button
              variant="secondary"
              className="h-8 flex-none px-3 text-[12px]"
              disabled={decidingDevisId === d.id}
              onClick={() => handleRefuse(d.id)}
            >
              Refuser
            </Button>
            <Button
              variant="primary"
              className="h-8 flex-none px-3 text-[12px]"
              disabled={decidingDevisId === d.id}
              onClick={() => openConfirm(d.id)}
            >
              Accepter
            </Button>
          </Card>
        ),
      )}

      {contracts.length > 0 && (
        <Card>
          {contracts.map((c) => (
            <div key={c.id} className="flex flex-col gap-1.5 border-b border-divider px-5 py-3.5 last:border-0">
              <div className="flex items-center gap-3.5">
                <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-text">{c.name}</span>
                <Badge tone={CONTRACT_STATUS_TONE[c.status]}>{CONTRACT_STATUS_LABEL[c.status]}</Badge>
              </div>
              {c.awaitingSignature && (
                <p className="text-[12px] text-text-soft">
                  Signature demandée — vous avez reçu un e-mail de notre partenaire de signature électronique
                  (Youtrust) avec un lien pour signer. Vérifiez votre boîte mail, y compris les spams.
                </p>
              )}
            </div>
          ))}
        </Card>
      )}

      {invoices.length === 0 && contracts.length === 0 && pendingDevisList.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 px-8 py-16 text-center">
          <FileText className="h-6 w-6 text-text-faint" aria-hidden />
          <div className="mt-1 text-[15px] font-extrabold">Rien à afficher pour le moment.</div>
          <p className="max-w-sm text-[13px] text-text-soft">
            Vos devis, contrats et factures apparaîtront ici dès qu&apos;un premier document sera émis.
          </p>
        </Card>
      ) : (
        <>
          {invoices.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Card className={overdue ? "border-danger-fg/30 bg-danger-bg p-4.5" : "p-4.5"}>
                <div className={overdue ? "flex items-center gap-2 text-danger-fg" : "flex items-center gap-2 text-text-soft"}>
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                  <span className="text-[11.5px] font-bold uppercase tracking-[.04em]">Facture en retard</span>
                </div>
                {overdue ? (
                  <>
                    <div className="mt-2 text-[20px] font-extrabold tracking-tight text-danger-fg">{formatEuroTTC(overdue.totalInclVat)}</div>
                    <div className="mt-0.5 text-[12px] font-semibold text-danger-fg">
                      {overdue.number} · en retard depuis {daysLate(overdue.dueDate)} j
                    </div>
                  </>
                ) : (
                  <div className="mt-2 text-[13.5px] font-bold text-success-fg">Aucune facture en retard.</div>
                )}
              </Card>

              <Card className="p-4.5">
                <div className="flex items-center gap-2 text-text-soft">
                  <Receipt className="h-3.5 w-3.5" aria-hidden />
                  <span className="text-[11.5px] font-bold uppercase tracking-[.04em]">Prochaine échéance</span>
                </div>
                {upcoming ? (
                  <>
                    <div className="mt-2 text-[20px] font-extrabold tracking-tight">{formatEuroTTC(upcoming.totalInclVat)}</div>
                    <div className="mt-0.5 text-[12px] font-semibold text-text-soft">Échéance le {upcoming.dueDate}</div>
                  </>
                ) : (
                  <div className="mt-2 text-[13.5px] font-bold text-text-soft">Aucune échéance à venir.</div>
                )}
              </Card>
            </div>
          )}

          {invoices.length > 0 && (
            <Card>
              {invoices.map((inv) => (
            <div key={inv.id} className="flex flex-wrap items-center gap-3.5 border-b border-divider px-5 py-3.5 last:border-0">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[12.5px] font-bold text-text">{inv.number}</span>
                <span className="mt-0.5 block truncate text-[12px] text-text-soft">{inv.subject}</span>
              </span>
              <span className="w-24 flex-none text-right">
                <span className="block text-[13px] font-bold text-text">{formatEuroTTC(inv.totalInclVat)}</span>
                {/* "reste à régler" — §19 : n'a de sens que si un montant a réellement été
                    partiellement versé (donnée alimentée depuis SportVision OS/Stripe, hors
                    périmètre de ce chantier ; voir data/projet/billing.ts). */}
                {inv.status === "partiellement_payee" && (
                  <span className="mt-0.5 block text-[11px] font-semibold text-warning-fg">
                    Reste {formatEuroTTC(remainingAmount(inv.totalInclVat, inv.paidAmount))}
                  </span>
                )}
              </span>
              <span className="w-28 flex-none text-right text-[12px] text-text-soft">Échéance {inv.dueDate}</span>
              <Badge tone={INVOICE_STATUS_TONE[inv.status]}>{INVOICE_STATUS_LABEL[inv.status]}</Badge>
              {inv.pdfUrl && (
                <a
                  href={inv.pdfUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-none text-[12px] font-bold text-info-fg hover:underline"
                >
                  Voir le PDF
                </a>
              )}
              {/* Contexte repris automatiquement sur le ticket — Bible §21, voir
                  NewTicketModal.tsx (initialContext) et support/page.tsx (lecture des query
                  params ctx_type/ctx_id/ctx_label). */}
              <Link
                href={`/support?ctx_type=invoice&ctx_id=${encodeURIComponent(inv.id)}&ctx_label=${encodeURIComponent(inv.number)}`}
                className="flex-none text-[12px] font-bold text-text-soft hover:text-info-fg hover:underline"
              >
                Contacter le support
              </Link>
            </div>
              ))}
            </Card>
          )}
        </>
      )}

      <Toast message={toastMessage} tone={toastTone} />
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
      <Receipt className="h-6 w-6 text-text-faint" aria-hidden />
      <div className="max-w-md">
        <h2 className="text-[18px] font-extrabold tracking-tight">Vos factures sont gérées par votre club</h2>
        <p className="mt-2 text-[13.5px] leading-relaxed text-text-soft">
          En tant que joueur rattaché à un club abonné, votre facturation est portée par
          l&apos;organisation qui vous accueille — voir README.md § Joueur affilié vs indépendant.
        </p>
      </div>
      {clubName && <div className="text-[12.5px] font-bold text-text-soft">Club : {clubName}</div>}
    </Card>
  );
}
