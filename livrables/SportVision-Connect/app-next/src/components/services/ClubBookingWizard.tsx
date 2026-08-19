"use client";

import { type ReactNode, useState } from "react";
import { CreditCard, Banknote, Lock, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { fullPriceLabel, isOfferLocked, offerPriceLabel } from "@/lib/data/club/bookings";
import { BOOKING_MODE_PAIEMENT_LABEL, type BookingModePaiement, type ClubCatalogueOffre, type ClubPlan } from "@/lib/types/club-bookings";

// Assistant de réservation en 3 étapes (type → détails → récapitulatif) — port de wizardHtml()
// (référence vanille club-services-documents-rapports.js), aligné sur le pattern déjà établi par
// l'assistant "Nouvelle demande" de Connect (étape 1 = grille de cartes). L'état du formulaire vit
// ici, local au composant (comme TransmitInfoModal.tsx) : le parent ne reçoit le résultat qu'à la
// soumission finale, via onSubmit.
//
// `modePaiement` (19/08/2026) : réintroduit sur demande explicite de Fouka — une préférence
// déclarative facultative, PAS un paiement réel (aucune intégration Stripe ici). Ce choix avait
// été retiré du tunnel public le 09/08/2026 (voir tunnel/types.ts § TunnelState) ; décision
// consciente de revenir dessus côté Club+ uniquement, pas le tunnel générique Espace Projet.
export interface BookingDraft {
  offerId: string | null;
  team: string;
  eventDate: string;
  heure: string;
  adresse: string;
  modePaiement: BookingModePaiement | null;
}

const inputClass =
  "h-10 rounded-sv border border-border-strong bg-input-bg px-3 text-[13.5px] outline-none focus-visible:border-brand-blue";

export function ClubBookingWizard({
  offers,
  plan,
  initialOfferId,
  submitting,
  onClose,
  onSubmit,
  onLockedOffer,
}: {
  offers: ClubCatalogueOffre[];
  plan: ClubPlan;
  initialOfferId: string | null;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (draft: BookingDraft) => void;
  onLockedOffer: () => void;
}) {
  const initialOffer = initialOfferId ? (offers.find((o) => o.id === initialOfferId) ?? null) : null;
  const [step, setStep] = useState<1 | 2 | 3>(initialOffer ? 2 : 1);
  const [offerId, setOfferId] = useState<string | null>(initialOffer?.id ?? null);
  const [team, setTeam] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [heure, setHeure] = useState("");
  const [adresse, setAdresse] = useState("");
  const [modePaiement, setModePaiement] = useState<BookingModePaiement | null>(null);

  const offer = offerId ? (offers.find((o) => o.id === offerId) ?? null) : null;

  function selectOffer(o: ClubCatalogueOffre) {
    if (isOfferLocked(o, plan)) {
      onLockedOffer();
      return;
    }
    setOfferId(o.id);
    setStep(2);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <button aria-label="Fermer la fenêtre" className="absolute inset-0" onClick={onClose} tabIndex={-1} />
      <div className="animate-svfade relative max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-sv-modal border border-border bg-surface p-6 shadow-sv-modal">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[17px] font-extrabold tracking-tight">Réserver une présence — étape {step}/3</h2>
          <button
            aria-label="Fermer"
            onClick={onClose}
            className="flex h-8 w-8 flex-none items-center justify-center rounded-lg text-text-faint transition-colors hover:bg-surface-sunken"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="mt-4">
          {step === 1 &&
            (offers.length === 0 ? (
              <p className="py-8 text-center text-[13px] text-text-soft">
                Catalogue en cours de préparation par SportVision.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {offers.map((o) => {
                  const locked = isOfferLocked(o, plan);
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => selectOffer(o)}
                      className="rounded-xl border border-border-strong bg-surface-alt p-3 text-left transition-colors hover:border-brand-blue-electric"
                    >
                      <div className="flex items-center gap-1.5 text-[13px] font-bold text-text">
                        {o.nom}
                        {locked && <Lock className="h-3 w-3 text-text-faint" aria-hidden />}
                      </div>
                      <div className="mt-1.5 text-[11.5px] font-semibold text-brand-blue-electric">
                        {offerPriceLabel(o)}
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}

          {step === 2 && (
            <div className="flex flex-col gap-3.5">
              <Field label="Équipe">
                <input
                  value={team}
                  onChange={(e) => setTeam(e.target.value)}
                  placeholder="ex : Seniors R1"
                  className={inputClass}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Date">
                  <input
                    type="date"
                    value={eventDate}
                    onChange={(e) => setEventDate(e.target.value)}
                    className={inputClass}
                  />
                </Field>
                <Field label="Heure">
                  <input
                    value={heure}
                    onChange={(e) => setHeure(e.target.value)}
                    placeholder="15:00"
                    className={inputClass}
                  />
                </Field>
              </div>
              <Field label="Adresse">
                <input
                  value={adresse}
                  onChange={(e) => setAdresse(e.target.value)}
                  placeholder="Stade Municipal, Sens"
                  className={inputClass}
                />
              </Field>
              <Field label="Mode de paiement souhaité (optionnel)">
                <div className="grid grid-cols-2 gap-2.5">
                  {(Object.keys(BOOKING_MODE_PAIEMENT_LABEL) as BookingModePaiement[]).map((mode) => {
                    const active = modePaiement === mode;
                    const Icon = mode === "carte" ? CreditCard : Banknote;
                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setModePaiement(active ? null : mode)}
                        className={cn(
                          "flex items-center justify-center gap-2 rounded-sv border px-3 py-2.5 text-[12.5px] font-bold transition-colors",
                          active
                            ? "border-transparent bg-gradient-to-br from-brand-blue to-brand-violet text-white"
                            : "border-border-strong bg-input-bg text-text-soft hover:border-brand-blue-electric",
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" aria-hidden />
                        {BOOKING_MODE_PAIEMENT_LABEL[mode]}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1 text-[11px] text-text-faint">
                  Indicatif — le règlement effectif reste géré avec SportVision (devis ou facture).
                </p>
              </Field>
            </div>
          )}

          {step === 3 && (
            <div>
              <div className="rounded-xl border border-border bg-surface-alt p-3.5 text-[13px]">
                <div className="mb-1.5 font-extrabold text-text">{offer?.nom ?? "Prestation"}</div>
                <div className="leading-relaxed text-text-soft">
                  Équipe : {team || "—"}
                  <br />
                  Date : {eventDate || "—"} à {heure || "—"}
                  <br />
                  Lieu : {adresse || "—"}
                  {modePaiement && (
                    <>
                      <br />
                      Paiement souhaité : {BOOKING_MODE_PAIEMENT_LABEL[modePaiement]}
                    </>
                  )}
                </div>
                <div className="mt-2 text-[14px] font-extrabold text-text">{fullPriceLabel(offer, plan)}</div>
              </div>
              <p className="mt-3 text-[12px] text-text-soft">
                Tarif indicatif, sous réserve de disponibilité. Vous recevrez une confirmation ou un devis de
                SportVision.
              </p>
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-between">
          <Button
            variant="secondary"
            className={cn(step === 1 && "invisible")}
            onClick={() => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2) : s))}
          >
            ← Retour
          </Button>
          {step === 2 && (
            <Button variant="primary" onClick={() => setStep(3)}>
              Continuer →
            </Button>
          )}
          {step === 3 && (
            <Button
              variant="primary"
              loading={submitting}
              onClick={() => onSubmit({ offerId, team, eventDate, heure, adresse, modePaiement })}
            >
              Envoyer la demande
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-bold text-text-soft">{label}</span>
      {children}
    </label>
  );
}
