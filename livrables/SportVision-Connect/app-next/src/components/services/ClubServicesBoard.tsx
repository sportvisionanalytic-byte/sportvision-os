"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Toast, useToast } from "@/components/feedback/Toast";
import { cn } from "@/lib/cn";
import { createClient } from "@/lib/supabase/client";
import { subscribeTable } from "@/lib/supabase/realtime";
import {
  fetchCatalogueOffres,
  fetchClubBookings,
  fetchClubPlan,
  isOfferLocked,
  submitClubBooking,
} from "@/lib/data/club/bookings";
import {
  BOOKING_STATUS_LABEL,
  BOOKING_STATUS_TONE,
  type ClubBooking,
  type ClubCatalogueOffre,
  type ClubPlan,
} from "@/lib/types/club-bookings";
import { ClubOfferCard } from "./ClubOfferCard";
import { ClubBookingWizard, type BookingDraft } from "./ClubBookingWizard";
import { ClubBookingDetail } from "./ClubBookingDetail";

const LOCKED_OFFER_MESSAGE =
  "Cette prestation prioritaire est incluse dans la formule Club+ Performance. Contactez votre interlocuteur SportVision pour l’ajouter à votre contrat.";

// Écran club "Prestations SportVision" — port de window.ClubModules.services (référence vanille
// fonctionnelle livrables/SportVision-Connect/app/modules/club-services-documents-rapports.js,
// lignes 189-436) vers les conventions React/TS de ce repo : catalogue (catalogue_offres) →
// réservation (assistant 3 étapes) → suivi (club_bookings, pipeline terrain 6 étapes). Monté par
// /services (page.tsx), /services/new (autoOpenWizard) et /services/[id] (autoOpenBookingId) pour
// organization.type === "club" — voir chaque page.tsx pour le branchement exact. Table distincte de
// `prestations`/ServicesBoard.tsx (Espace Projet, "generic") : voir entitlements.ts § "services"
// pour le mismatch qui a motivé un module club séparé plutôt qu'un mapping forcé.
export function ClubServicesBoard({
  autoOpenWizard,
  autoOpenBookingId,
}: {
  autoOpenWizard?: boolean;
  autoOpenBookingId?: string;
}) {
  const { ctx } = useSession();
  const { toastMessage, toastTone, showToast } = useToast();

  const [view, setView] = useState<"catalogue" | "reservations">("catalogue");
  const [offers, setOffers] = useState<ClubCatalogueOffre[] | null>(null);
  const [bookings, setBookings] = useState<ClubBooking[] | null>(null);
  const [plan, setPlan] = useState<ClubPlan>("club");
  const [loadError, setLoadError] = useState(false);
  const [openBookingId, setOpenBookingId] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardPresetOfferId, setWizardPresetOfferId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    setLoadError(false);
    Promise.all([
      fetchCatalogueOffres(supabase),
      fetchClubBookings(supabase, ctx.organization.id),
      fetchClubPlan(supabase, ctx.organization.id),
    ])
      .then(([offerRows, bookingRows, clubPlan]) => {
        if (cancelled) return;
        setOffers(offerRows);
        setBookings(bookingRows);
        setPlan(clubPlan);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.organization.id]);

  // Sync temps réel (migration-connect-v42-enable-realtime-sync.sql) : `club_bookings` change
  // quand le staff avance une réservation (confirmée, équipe affectée, terminée…) — même colonne
  // de scoping que fetchClubBookings (RLS is_club_member(club_id), migration-clubplus-v6.sql).
  // Ne rejoue que fetchClubBookings (pas offres/plan, jamais modifiés par ce type d'événement) —
  // rejoue le fetch existant, ne duplique aucune logique de requête. Dégrade silencieusement tant
  // que la migration v42 n'a pas été exécutée (voir realtime.ts).
  useEffect(() => {
    const supabase = createClient();
    const channel = subscribeTable(
      supabase,
      `services-club-bookings-${ctx.organization.id}`,
      "club_bookings",
      `club_id=eq.${ctx.organization.id}`,
      () => {
        fetchClubBookings(supabase, ctx.organization.id)
          .then(setBookings)
          .catch(() => {
            // Échec d'un rechargement déclenché par un événement Realtime : pas d'erreur
            // utilisateur pour un enrichissement live, l'affichage reste à sa dernière valeur
            // connue (déjà chargée par le fetch initial ci-dessus).
          });
      },
    );
    return () => {
      supabase.removeChannel(channel);
    };
  }, [ctx.organization.id]);

  // /services/new — ouvre directement l'assistant de réservation au montage.
  useEffect(() => {
    if (autoOpenWizard) {
      setWizardPresetOfferId(null);
      setWizardOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // /services/[id] — ouvre le panneau de suivi de la réservation ciblée une fois chargée. Sécurité
  // (voir DATA_MODEL.md § Sécurité, même garde que ServiceDetailPage) : bookings est déjà filtré
  // par club_id côté fetchClubBookings, donc un id d'une autre organisation n'apparaîtra jamais ici.
  useEffect(() => {
    if (!autoOpenBookingId || bookings === null) return;
    const match = bookings.find((b) => b.id === autoOpenBookingId);
    if (match) {
      setView("reservations");
      setOpenBookingId(match.id);
    } else {
      setNotFound(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenBookingId, bookings]);

  function openWizard(presetOfferId: string | null) {
    if (presetOfferId) {
      const preset = offers?.find((o) => o.id === presetOfferId);
      if (preset && isOfferLocked(preset, plan)) {
        showToast(LOCKED_OFFER_MESSAGE, "error");
        return;
      }
    }
    setWizardPresetOfferId(presetOfferId);
    setWizardOpen(true);
  }

  async function handleSubmitBooking(draft: BookingDraft) {
    setSubmitting(true);
    try {
      const supabase = createClient();
      const offer = draft.offerId ? (offers?.find((o) => o.id === draft.offerId) ?? null) : null;
      const created = await submitClubBooking(supabase, {
        clubId: ctx.organization.id,
        offer,
        team: draft.team,
        eventDate: draft.eventDate,
        heure: draft.heure,
        adresse: draft.adresse,
        plan,
      });
      setBookings((prev) => [created, ...(prev ?? [])]);
      setWizardOpen(false);
      setView("reservations");
      showToast("Demande de présence envoyée — en attente de confirmation SportVision.");
    } catch {
      showToast("Erreur lors de l'envoi de la demande.", "error");
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <Card className="p-8 text-center">
        <div className="text-[14px] font-extrabold text-danger-fg">Chargement impossible</div>
        <p className="mt-1.5 text-[13px] text-text-soft">
          Une erreur réseau empêche d&apos;afficher les prestations. Réessayez.
        </p>
      </Card>
    );
  }

  if (notFound) {
    return (
      <Card className="mx-auto flex max-w-[480px] flex-col items-center gap-3 p-9 text-center">
        <div className="text-[16px] font-extrabold tracking-tight">Réservation introuvable</div>
        <p className="text-[13.5px] text-text-soft">
          Cette réservation n&apos;existe pas ou n&apos;est pas rattachée à {ctx.organization.name}.
        </p>
      </Card>
    );
  }

  const openBooking = openBookingId && bookings ? (bookings.find((b) => b.id === openBookingId) ?? null) : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[12px] font-bold text-text-soft">Prestations</div>
          <h1 className="mt-1.5 text-[27px] font-extrabold leading-tight tracking-tight">Prestations SportVision</h1>
        </div>
        <Button variant="primary" onClick={() => openWizard(null)}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Réserver une présence
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Pill active={view === "catalogue"} onClick={() => setView("catalogue")}>
          Catalogue
        </Pill>
        <Pill active={view === "reservations"} onClick={() => setView("reservations")}>
          Mes réservations
        </Pill>
      </div>

      {view === "catalogue" ? (
        offers === null ? (
          <div className="py-16 text-center text-[13px] text-text-soft">Chargement…</div>
        ) : offers.length === 0 ? (
          <Card className="p-8 text-center text-[13px] text-text-soft">
            Catalogue en cours de préparation par SportVision.
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {offers.map((offer) => (
              <ClubOfferCard key={offer.id} offer={offer} plan={plan} onReserve={() => openWizard(offer.id)} />
            ))}
          </div>
        )
      ) : bookings === null ? (
        <div className="py-16 text-center text-[13px] text-text-soft">Chargement…</div>
      ) : bookings.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 px-8 py-16 text-center">
          <div className="text-[15px] font-extrabold">Aucune réservation pour le moment.</div>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {bookings.map((b) => (
            <button
              key={b.id}
              onClick={() => setOpenBookingId(b.id)}
              className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-left transition-colors hover:border-brand-blue-electric"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-bold text-text">{b.serviceLabel}</span>
                <span className="block truncate text-[12px] text-text-soft">
                  {b.team ?? "—"} · {b.eventDate ? new Date(b.eventDate).toLocaleDateString("fr-FR") : "—"} ·{" "}
                  {b.priceLabel ?? "—"}
                </span>
              </span>
              <Badge tone={BOOKING_STATUS_TONE[b.status]}>{BOOKING_STATUS_LABEL[b.status]}</Badge>
            </button>
          ))}
        </div>
      )}

      {wizardOpen && (
        <ClubBookingWizard
          offers={offers ?? []}
          plan={plan}
          initialOfferId={wizardPresetOfferId}
          submitting={submitting}
          onClose={() => setWizardOpen(false)}
          onSubmit={handleSubmitBooking}
          onLockedOffer={() => showToast(LOCKED_OFFER_MESSAGE, "error")}
        />
      )}

      {openBooking && <ClubBookingDetail booking={openBooking} onClose={() => setOpenBookingId(null)} />}

      <Toast message={toastMessage} tone={toastTone} />
    </div>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full border px-3.5 py-1.5 text-[12.5px] font-bold transition-colors duration-sv",
        active
          ? "border-transparent bg-gradient-to-br from-brand-blue to-brand-violet text-white"
          : "border-border-strong bg-transparent text-text-soft hover:border-brand-blue-electric",
      )}
    >
      {children}
    </button>
  );
}
