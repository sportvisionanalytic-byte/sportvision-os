"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { createClient } from "@/lib/supabase/client";
import { type CatalogueOffer, totalTtcWithOptions } from "@/lib/prestations/catalogue";
import { formatEUR, needsRetractationWaiver } from "@/lib/prestations/format";

// Wizard « Demander une prestation » — 4 étapes (MASTER-CONNECT-V1.md §18, design-connect-
// personnel-12-08/README.md § Réservation) : informations du match, options, paiement
// (récapitulatif + choix seul/à plusieurs + garde-fous légaux), confirmation. Crée une VRAIE
// ligne `prestations` via l'edge function connect-player-prestations (jamais une simulation
// frontend) — voir son commentaire d'en-tête pour le détail du calcul de prix et de la
// résolution client_id.
//
// Paiement collectif ("à plusieurs") : le backend cotisations existe depuis le 14/08
// (migration-connect-v50/v51, group_fundings/funding_contributions) mais reste un objet
// indépendant, rattaché à un `catalogue_offre_id` — PAS à une ligne `prestations` précise
// (pas de colonne group_fundings.prestation_id). On ne peut donc pas relier automatiquement
// "cette cotisation a atteint son objectif" à "cette demande précise est payée" : sélectionner
// "à plusieurs" crée quand même la demande (statut En validation), puis propose de créer une
// cotisation pré-remplie avec cette offre (même pattern que ReservationWizardParticulier.tsx →
// /particulier/cotisations/creer?offreId=), avec un repli explicite vers "payer seul".
const STEPS = ["Informations", "Options", "Paiement", "Confirmation"] as const;

type PaiementMode = "seul" | "collectif";

export function ReservationWizard({ offer, defaultTeamLabel }: { offer: CatalogueOffer; defaultTeamLabel: string }) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [touched, setTouched] = useState(false);

  const [equipe, setEquipe] = useState(defaultTeamLabel);
  const [adversaire, setAdversaire] = useState("");
  const [date, setDate] = useState("");
  const [heureDebut, setHeureDebut] = useState("");
  const [lieu, setLieu] = useState("");
  const [categorie, setCategorie] = useState("");
  const [notes, setNotes] = useState("");

  const [optionNames, setOptionNames] = useState<string[]>([]);

  const [paiementMode, setPaiementMode] = useState<PaiementMode>("seul");
  const [retractationRenoncee, setRetractationRenoncee] = useState(false);
  const [cgvAcceptee, setCgvAcceptee] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; reference: string } | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const ttc = totalTtcWithOptions(offer, optionNames);
  const waiverNeeded = needsRetractationWaiver(date);

  const step1Valid = !!equipe.trim() && !!date && !!lieu.trim();
  const step3Valid = cgvAcceptee && (!waiverNeeded || retractationRenoncee);

  function toggleOption(nom: string) {
    setOptionNames((prev) => (prev.includes(nom) ? prev.filter((n) => n !== nom) : [...prev, nom]));
  }

  function goNext() {
    setTouched(true);
    if (step === 1 && !step1Valid) return;
    setTouched(false);
    setStep((s) => Math.min(s + 1, 4));
  }

  async function submit() {
    setTouched(true);
    if (!step3Valid) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();

    const { data, error: fnError } = await supabase.functions.invoke("connect-player-prestations", {
      body: {
        action: "create_request",
        offerId: offer.id,
        dateMatch: date,
        heureDebut: heureDebut || null,
        lieu: lieu || null,
        adversaire: adversaire || null,
        categorie: categorie || null,
        equipe: equipe || null,
        notes: notes || null,
        optionNames,
        retractationRenoncee,
        paiementMode,
      },
    });

    if (fnError || data?.error) {
      setBusy(false);
      setError(data?.error || "Impossible d'enregistrer votre demande pour le moment. Réessayez dans un instant.");
      return;
    }

    setResult({ id: data.id, reference: data.reference });
    setStep(4);

    if (paiementMode === "seul") {
      await launchCheckout(data.id);
    } else {
      setBusy(false);
    }
  }

  async function launchCheckout(prestationId: string) {
    setBusy(true);
    setCheckoutError(null);
    const supabase = createClient();
    const { data, error: fnError } = await supabase.functions.invoke("create-checkout-session", {
      body: { prestation_id: prestationId, type_paiement: "totalite" },
    });
    setBusy(false);
    if (fnError || data?.error || !data?.url) {
      setCheckoutError(data?.error || "Le paiement en ligne est momentanément indisponible. Votre demande est bien enregistrée.");
      return;
    }
    window.location.href = data.url;
  }

  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-6 pb-24 animate-sv-in lg:pb-0">
      <div className="flex flex-col gap-2">
        <Link href={`/prestations/${offer.id}`} className="flex items-center gap-2 self-start text-[13px] font-medium text-text-tertiary hover:text-text">
          <span className="material-symbols-rounded !text-[18px]">arrow_back</span>
          {offer.nom}
        </Link>
        <h1 className="font-sora text-[26px] font-bold tracking-tight">Demander une prestation</h1>
      </div>

      {/* Fil d'Ariane */}
      <div className="flex items-center gap-2">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const active = n === step;
          const done = n < step;
          return (
            <div key={label} className="flex flex-1 flex-col gap-1.5">
              <div className={`h-1.5 rounded-full ${done || active ? "bg-sv-gradient" : "bg-white/8"}`} />
              <span className={`text-[11px] font-medium ${active ? "text-text" : "text-text-faint"}`}>{label}</span>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-5 rounded-sv-card border border-border bg-surface p-5">
        {step === 1 && (
          <div className="flex flex-col gap-4 animate-sv-in">
            <h2 className="font-sora text-[17px] font-semibold">Informations du match</h2>
            <Field id="rw-equipe" label="Équipe" value={equipe} onChange={(e) => setEquipe(e.target.value)} error={touched && !equipe.trim() ? "Requis." : null} />
            <Field id="rw-adversaire" label="Adversaire · facultatif" value={adversaire} onChange={(e) => setAdversaire(e.target.value)} />
            <div className="grid grid-cols-2 gap-3">
              <Field id="rw-date" label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} error={touched && !date ? "Requise." : null} />
              <Field id="rw-heure" label="Heure · facultatif" type="time" value={heureDebut} onChange={(e) => setHeureDebut(e.target.value)} />
            </div>
            <Field id="rw-lieu" label="Lieu" placeholder="Stade, adresse" value={lieu} onChange={(e) => setLieu(e.target.value)} error={touched && !lieu.trim() ? "Requis." : null} />
            <Field id="rw-categorie" label="Catégorie · facultatif" placeholder="U18 R2" value={categorie} onChange={(e) => setCategorie(e.target.value)} />
            <div className="flex flex-col gap-2">
              <label htmlFor="rw-notes" className="text-[13px] font-medium text-text-secondary">Notes · facultatif</label>
              <textarea
                id="rw-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="w-full rounded-sv border border-border-strong bg-surface px-4 py-3 text-[15px] text-text outline-none focus:border-[#8CA9FF] focus:shadow-[0_0_0_3px_rgba(79,125,255,.28)]"
                placeholder="Précisions utiles pour l'équipe SportVision"
              />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-4 animate-sv-in">
            <h2 className="font-sora text-[17px] font-semibold">Options</h2>
            {offer.options.length === 0 ? (
              <p className="text-[13.5px] text-text-tertiary">Aucune option disponible pour cette prestation.</p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {offer.options.map((opt) => {
                  const checked = optionNames.includes(opt.nom);
                  const optTtc = Math.round(opt.prixHt * (1 + offer.tvaPct / 100) * 100) / 100;
                  return (
                    <label
                      key={opt.nom}
                      className={`flex items-center gap-3 rounded-sv border p-4 transition-colors duration-150 ${
                        checked ? "border-[#8CA9FF]/60 bg-[rgba(79,125,255,.12)]" : "border-border bg-surface hover:bg-surface-hover"
                      }`}
                    >
                      <input type="checkbox" checked={checked} onChange={() => toggleOption(opt.nom)} className="h-5 w-5 accent-[#8CA9FF]" />
                      <span className="flex-1 text-[14px] text-text">{opt.nom}</span>
                      <span className="font-sora text-[14px] font-semibold">+{formatEUR(optTtc)}</span>
                    </label>
                  );
                })}
              </div>
            )}
            <div className="mt-1 flex items-center justify-between rounded-sv border border-border bg-bg-elevated px-4 py-3.5">
              <span className="text-[13px] text-text-tertiary">Total estimé</span>
              <span className="font-sora text-[18px] font-bold">{ttc !== null ? `${formatEUR(ttc)} TTC` : "Sur devis"}</span>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col gap-4 animate-sv-in">
            <h2 className="font-sora text-[17px] font-semibold">Paiement</h2>

            <div className="flex flex-col gap-2.5">
              <PaymentChoice label="Payer seul" sub="Réglez le montant total dès maintenant." selected={paiementMode === "seul"} onClick={() => setPaiementMode("seul")} />
              <PaymentChoice
                label="Payer à plusieurs"
                sub="Partagez le coût avec votre équipe via une cotisation."
                selected={paiementMode === "collectif"}
                onClick={() => setPaiementMode("collectif")}
              />
            </div>

            {paiementMode === "collectif" && (
              <div className="flex items-start gap-2.5 rounded-sv border border-attente/40 bg-attente-bg px-4 py-3.5">
                <span className="material-symbols-rounded !text-[19px] text-attente">info</span>
                <span className="text-[12.5px] leading-relaxed text-text-secondary">
                  Votre demande sera tout de même enregistrée au statut « En validation ». Créez ensuite une cotisation
                  depuis cette page pour partager le coût, ou basculez sur « Payer seul ».
                </span>
              </div>
            )}

            <div className="flex flex-col gap-2 border-t border-border pt-4">
              <SummaryRow label="Prestation" value={offer.nom} />
              <SummaryRow label="Date" value={date || "—"} />
              <SummaryRow label="Lieu" value={lieu || "—"} />
              <SummaryRow label="Options" value={optionNames.length ? optionNames.join(", ") : "Aucune"} />
              <SummaryRow label="Montant" value={ttc !== null ? `${formatEUR(ttc)} TTC` : "Sur devis"} strong />
            </div>

            {waiverNeeded && (
              <label className="flex items-start gap-2.5 rounded-sv border border-attente/40 bg-attente-bg p-3.5 text-[12.5px] leading-relaxed text-text-secondary">
                <input type="checkbox" checked={retractationRenoncee} onChange={(e) => setRetractationRenoncee(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#8CA9FF]" />
                Votre prestation est prévue dans moins de 14 jours. Je demande l&apos;exécution immédiate de la prestation et je
                renonce expressément à mon droit de rétractation de 14 jours (article L221-18 du Code de la consommation).
              </label>
            )}
            {touched && waiverNeeded && !retractationRenoncee && <span className="text-[12px] text-danger">Cette case est requise pour continuer.</span>}

            <label className="flex items-start gap-2.5 rounded-sv border border-border bg-bg-elevated p-3.5 text-[12.5px] leading-relaxed text-text-secondary">
              <input type="checkbox" checked={cgvAcceptee} onChange={(e) => setCgvAcceptee(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#8CA9FF]" />
              J&apos;accepte les conditions générales de prestation SportVision.
            </label>
            {touched && !cgvAcceptee && <span className="text-[12px] text-danger">L&apos;acceptation des CGV est requise.</span>}

            {error && (
              <div className="flex items-start gap-2.5 rounded-sv border border-danger-border bg-danger-bg px-4 py-3.5">
                <span className="material-symbols-rounded !text-[19px] text-danger">error</span>
                <span className="text-[13px] leading-relaxed text-[#FBCFE8]">{error}</span>
              </div>
            )}
          </div>
        )}

        {step === 4 && result && (
          <div className="flex flex-col items-center gap-4 py-4 text-center animate-sv-in">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-affiliations-bg">
              <span className="material-symbols-rounded !text-[28px] text-affiliations">check_circle</span>
            </span>
            <div className="flex flex-col gap-1.5">
              <span className="font-sora text-[20px] font-semibold">Demande enregistrée</span>
              <span className="text-[13.5px] text-text-tertiary">
                Réf. {result.reference} · Statut <strong className="text-text">En validation</strong>
              </span>
              <span className="mx-auto mt-1 max-w-[420px] text-[13px] leading-relaxed text-text-tertiary">
                Des frais de déplacement peuvent s&apos;ajouter selon la localisation du match. Vous serez notifié à chaque étape.
              </span>
            </div>

            {paiementMode === "seul" && busy && <span className="text-[13px] text-text-tertiary">Redirection vers le paiement sécurisé…</span>}
            {paiementMode === "seul" && checkoutError && (
              <div className="flex w-full flex-col gap-3 rounded-sv border border-danger-border bg-danger-bg px-4 py-3.5 text-left">
                <span className="text-[13px] leading-relaxed text-[#FBCFE8]">{checkoutError}</span>
                <Button variant="secondary" onClick={() => launchCheckout(result.id)} loading={busy}>
                  Réessayer le paiement
                </Button>
              </div>
            )}
            {paiementMode === "collectif" && (
              <Button onClick={() => router.push(`/cotisations/creer?offreId=${offer.id}`)} className="w-full max-w-[320px]">
                Créer une cotisation
              </Button>
            )}

            <Button variant="secondary" onClick={() => router.push("/commandes")} className="w-full max-w-[320px]">
              Voir mes commandes
            </Button>
          </div>
        )}
      </div>

      {step < 4 && (
        <div className="hidden gap-2.5 lg:flex">
          {step > 1 && (
            <button
              type="button"
              onClick={() => setStep((s) => Math.max(1, s - 1))}
              className="h-14 rounded-sv border border-border-strong bg-surface px-5 font-sora text-[15px] font-semibold text-text hover:bg-surface-hover"
            >
              Retour
            </button>
          )}
          {step < 3 ? (
            <Button onClick={goNext} className="flex-1">
              Continuer
            </Button>
          ) : (
            <Button onClick={submit} loading={busy} className="flex-1">
              Envoyer ma demande
            </Button>
          )}
        </div>
      )}

      {/* CTA sticky mobile (README § Mobile : "wizard de réservation") — même offset que la
          fiche prestation, au-dessus de la bottom nav de l'AppShell (safe-area incluse). */}
      {step < 4 && (
        <div className="fixed inset-x-0 bottom-[calc(60px+env(safe-area-inset-bottom))] z-20 flex gap-2.5 border-t border-border bg-bg/95 p-3.5 backdrop-blur-md lg:hidden">
          {step > 1 && (
            <button
              type="button"
              onClick={() => setStep((s) => Math.max(1, s - 1))}
              className="h-14 flex-none rounded-sv border border-border-strong bg-surface px-5 font-sora text-[15px] font-semibold text-text hover:bg-surface-hover"
            >
              Retour
            </button>
          )}
          {step < 3 ? (
            <Button onClick={goNext} className="flex-1">
              Continuer
            </Button>
          ) : (
            <Button onClick={submit} loading={busy} className="flex-1">
              Envoyer ma demande
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function PaymentChoice({ label, sub, selected, onClick }: { label: string; sub: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-3.5 rounded-sv-card border p-4 text-left transition-colors duration-150 ${
        selected ? "border-[#8CA9FF]/60 bg-[rgba(79,125,255,.12)]" : "border-border bg-surface hover:bg-surface-hover"
      }`}
    >
      <span className={`flex h-5 w-5 flex-none items-center justify-center rounded-full border-2 ${selected ? "border-[#8CA9FF]" : "border-border-strong"}`}>
        {selected && <span className="h-2.5 w-2.5 rounded-full bg-[#8CA9FF]" />}
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="font-sora text-[14.5px] font-semibold text-text">{label}</span>
        <span className="text-[12.5px] text-text-tertiary">{sub}</span>
      </span>
    </button>
  );
}

function SummaryRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="flex-none text-[12.5px] font-medium text-text-tertiary">{label}</span>
      <span className={strong ? "text-right font-sora text-[15px] font-bold text-text" : "text-right text-[13px] text-text"}>{value}</span>
    </div>
  );
}
