"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { createClient } from "@/lib/supabase/client";
import {
  type CatalogueOffer,
  MONTAGE_COMPILATION_SLUG,
  estimatedTtc,
  estimatedTtcLienMatch,
  tarifLienMatchMax,
} from "@/lib/prestations/catalogue";
import { formatEUR, needsRetractationWaiver } from "@/lib/prestations/format";
import type { AgentDiscountInfo } from "@/lib/supabase/agentSubscription";
import type { AthleteProfileInfo } from "@/lib/prestations/athleteProfile";
import { LEGAL_URLS } from "@/lib/legal-links";

// Couleurs de maillot courantes (suggestions <datalist>, champ texte libre — voir le commentaire
// du bloc "Informations pour le montage" plus bas pour le choix texte libre + suggestions plutôt
// qu'un <select> fermé : un maillot peut être bicolore/à motif, une liste fermée aurait forcé un
// choix "Autre" dans trop de cas réels).
const COULEURS_MAILLOT_COURANTES = [
  "Blanc",
  "Noir",
  "Rouge",
  "Bleu",
  "Vert",
  "Jaune",
  "Orange",
  "Violet",
  "Rose",
  "Gris",
  "Bleu et blanc",
  "Rouge et noir",
];

export interface Beneficiary {
  kind: "self" | "linked" | "managed";
  id: string | null;
  label: string;
  club: string | null;
  categorie: string | null;
}

const STEPS = ["Informations", "Options", "Paiement", "Confirmation"] as const;

type PaiementMode = "seul" | "collectif";
type ModePaiementChoisi = "carte" | "especes";

// Adapté de prestations/[id]/reserver/ReservationWizard.tsx (Espace joueur) — voir le
// commentaire de page.tsx pour ce qui a été repris à l'identique vs. ajouté. Différence
// principale : le récapitulatif distingue explicitement bénéficiaire / commanditaire / payeur
// (README § Réservation pour un sportif), et le body envoyé à connect-player-prestations porte
// `beneficiary` (voir l'en-tête de l'edge function, extension du 14/08).
export function ReservationWizardParticulier({
  offer,
  beneficiary,
  commanditaireLabel,
  agentDiscount,
  athleteProfile,
}: {
  offer: CatalogueOffer;
  beneficiary: Beneficiary | null;
  commanditaireLabel: string;
  // Remises Agent (Espace particulier, migration-connect-v57 §2 + v63) — résolues côté serveur
  // (page.tsx, connect_agent_discount du PAYEUR authentifié) et transmises ici pour AFFICHAGE
  // uniquement. Le montant réellement facturé est toujours recalculé côté serveur par
  // create-checkout-session au moment du paiement, jamais depuis cette prop.
  agentDiscount: AgentDiscountInfo;
  // Pré-remplissage "Informations pour le montage" (migration-connect-v68), Montage Compilation
  // UNIQUEMENT — résolu côté serveur (page.tsx) depuis player_profiles/managed_athlete_profiles
  // selon beneficiary.kind. null si aucune donnée trouvée (profil absent ou colonnes NULL) : tous
  // les champs du bloc deviennent alors de simples champs de saisie vides.
  athleteProfile: AthleteProfileInfo | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [touched, setTouched] = useState(false);

  const [equipe, setEquipe] = useState(beneficiary?.club || "");
  const [adversaire, setAdversaire] = useState("");
  const [date, setDate] = useState("");
  const [heureDebut, setHeureDebut] = useState("");
  const [lieu, setLieu] = useState("");
  const [categorie, setCategorie] = useState(beneficiary?.categorie || "");
  const [notes, setNotes] = useState("");

  // "Informations pour le montage" (migration-connect-v68) — Montage Compilation UNIQUEMENT.
  // Taille/poids/poste PRÉ-REMPLIS depuis athleteProfile quand connus (affichés en lecture seule
  // tant que editTaille/editPoids/editPoste restent false, voir PhysiqueField plus bas) ; numéro
  // de maillot pré-rempli mais TOUJOURS un champ de saisie normal (peut différer du profil pour
  // ce match précis — sélection nationale, maillot extérieur...) ; couleur de maillot jamais
  // pré-remplie (aucune colonne profil pour ça).
  const [tailleCm, setTailleCm] = useState(athleteProfile?.tailleCm != null ? String(athleteProfile.tailleCm) : "");
  const [poidsKg, setPoidsKg] = useState(athleteProfile?.poidsKg != null ? String(athleteProfile.poidsKg) : "");
  const [poste, setPoste] = useState(athleteProfile?.poste || "");
  const [numeroMaillot, setNumeroMaillot] = useState(athleteProfile?.numeroMaillot || "");
  const [couleurMaillot, setCouleurMaillot] = useState("");
  const [editTaille, setEditTaille] = useState(false);
  const [editPoids, setEditPoids] = useState(false);
  const [editPoste, setEditPoste] = useState(false);

  const [optionNames, setOptionNames] = useState<string[]>([]);

  // Montage Compilation propose 2 modes de livraison (migration-connect-v63/v64), choisis par le
  // client : rushs déjà découpés (durée déclarée) ou lien vers le/les match(s) complet(s) (nombre
  // de matchs + lien). 'rushs_decoupes' par défaut (mode historique, v63).
  const [modeLivraisonMontage, setModeLivraisonMontage] = useState<"rushs_decoupes" | "lien_match">("rushs_decoupes");
  // Durée totale de rush déclarée (minutes) — mode 'rushs_decoupes' uniquement. Déclaratif :
  // jamais de détection automatique de durée vidéo, hors scope.
  const [dureeRushMinutes, setDureeRushMinutes] = useState("");
  // Nombre de matchs + lien(s) — mode 'lien_match' uniquement (migration-connect-v64).
  const [nombreMatchsLien, setNombreMatchsLien] = useState("");
  const [lienMatchUrl, setLienMatchUrl] = useState("");
  // Remise mensuelle Agent (-10%, palier Pro, une fois par période) — case à cocher, uniquement
  // affichée/activable si `agentDiscount.monthlyPct > 0` (donc ni déjà utilisée, ni palier < Pro).
  const [applyMonthlyDiscount, setApplyMonthlyDiscount] = useState(false);

  const [paiementMode, setPaiementMode] = useState<PaiementMode>("seul");
  // Sous-choix carte/espèces, uniquement affiché et transmis quand paiementMode==="seul" — voir
  // le commentaire de connect-player-prestations/index.ts (create_request) et l'équivalent dans
  // ReservationWizard.tsx (Espace joueur). "carte" par défaut : reproduit exactement le
  // comportement historique (redirection Stripe) tant que le client ne change rien.
  const [modePaiementChoisi, setModePaiementChoisi] = useState<ModePaiementChoisi>("carte");
  const [retractationRenoncee, setRetractationRenoncee] = useState(false);
  const [cgvAcceptee, setCgvAcceptee] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; reference: string } | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const isMontageCompilation = offer.slug === MONTAGE_COMPILATION_SLUG;
  const dureeRushMinutesNum = dureeRushMinutes.trim() !== "" ? Number(dureeRushMinutes) : null;
  const nombreMatchsLienNum = nombreMatchsLien.trim() !== "" ? Number(nombreMatchsLien) : null;
  const lienMatchMax = tarifLienMatchMax(offer.tarifLienMatch);
  const dureeValid =
    !isMontageCompilation ||
    (modeLivraisonMontage === "rushs_decoupes"
      ? dureeRushMinutesNum != null && Number.isFinite(dureeRushMinutesNum) && dureeRushMinutesNum > 0
      : nombreMatchsLienNum != null && Number.isFinite(nombreMatchsLienNum) && nombreMatchsLienNum > 0 && lienMatchUrl.trim() !== "");

  // montage_pct : -5% permanent, UNIQUEMENT sur "Montage Compilation" (jamais sur une autre
  // offre, même pour un abonné Agent). monthly_pct : -10% une fois par période, applicable à
  // N'IMPORTE QUELLE offre, uniquement si le payeur coche la case (jamais automatique — c'est au
  // payeur de choisir sur quelle prestation la consommer).
  const montagePctApplicable = isMontageCompilation && agentDiscount.montagePct > 0;
  const monthlyPctApplicable = agentDiscount.monthlyPct > 0 && !agentDiscount.monthlyUsedThisPeriod;
  const monthlyDiscountSelected = monthlyPctApplicable && applyMonthlyDiscount;
  const remisePct = (montagePctApplicable ? agentDiscount.montagePct : 0) + (monthlyDiscountSelected ? agentDiscount.monthlyPct : 0);

  const ttc =
    isMontageCompilation && modeLivraisonMontage === "lien_match"
      ? estimatedTtcLienMatch(offer, nombreMatchsLienNum, optionNames, remisePct)
      : estimatedTtc(offer, dureeRushMinutesNum, optionNames, remisePct);
  const waiverNeeded = needsRetractationWaiver(date);

  // Lieu retiré des champs requis pour Montage Compilation (aucun déplacement SportVision) — voir
  // le bloc step 1 plus bas, où le champ lui-même n'est plus rendu du tout pour cette offre.
  const step1Valid = isMontageCompilation ? !!equipe.trim() && !!date && dureeValid : !!equipe.trim() && !!date && !!lieu.trim() && dureeValid;
  const step3Valid = cgvAcceptee && (!waiverNeeded || retractationRenoncee);

  if (!beneficiary) {
    return (
      <div className="mx-auto flex max-w-[520px] flex-col gap-4 py-10 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-sv bg-attente-bg">
          <span className="material-symbols-rounded !text-[24px] text-attente" aria-hidden="true">lock</span>
        </span>
        <span className="font-sora text-[19px] font-semibold">Autorisation de réservation manquante</span>
        <p className="text-[14px] leading-relaxed text-text-tertiary">
          Vous n&apos;êtes pas autorisé à réserver pour ce sportif. Demandez-lui d&apos;activer l&apos;autorisation
          « Réserver une prestation » depuis sa page Accès à mon profil.
        </p>
        <Link href="/particulier/prestations" className="mx-auto mt-2 rounded-sv bg-sv-gradient px-5 py-3 font-sora text-[15px] font-semibold text-white">
          Retour aux prestations
        </Link>
      </div>
    );
  }

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
    if (!step3Valid || !beneficiary) return;
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
        modePaiementChoisi: paiementMode === "seul" ? modePaiementChoisi : undefined,
        beneficiary: { kind: beneficiary.kind, refId: beneficiary.id },
        // Montage Compilation uniquement — connect-player-prestations exige et persiste ces
        // champs selon le mode choisi ; create-checkout-session relira CES valeurs en base au
        // moment du paiement, jamais une valeur reçue ici.
        modeLivraisonMontage: isMontageCompilation ? modeLivraisonMontage : undefined,
        dureeRushMinutes: isMontageCompilation && modeLivraisonMontage === "rushs_decoupes" ? dureeRushMinutesNum : undefined,
        nombreMatchsLien: isMontageCompilation && modeLivraisonMontage === "lien_match" ? nombreMatchsLienNum : undefined,
        lienMatchUrl: isMontageCompilation && modeLivraisonMontage === "lien_match" ? lienMatchUrl.trim() : undefined,
        // "Informations pour le montage" (migration-connect-v68) — Montage Compilation
        // uniquement, mêmes garde-fous que ci-dessus (undefined pour toute autre offre).
        // connect-player-prestations persiste numeroMaillot/couleurMaillot sur CETTE prestation
        // et réécrit taille/poids/poste/numéro sur le profil du bénéficiaire UNIQUEMENT si ces
        // champs y sont encore NULL (jamais un écrasement d'une valeur déjà connue).
        tailleCm: isMontageCompilation && tailleCm.trim() !== "" ? Number(tailleCm) : undefined,
        poidsKg: isMontageCompilation && poidsKg.trim() !== "" ? Number(poidsKg) : undefined,
        poste: isMontageCompilation && poste.trim() !== "" ? poste.trim() : undefined,
        numeroMaillot: isMontageCompilation && numeroMaillot.trim() !== "" ? numeroMaillot.trim() : undefined,
        couleurMaillot: isMontageCompilation && couleurMaillot.trim() !== "" ? couleurMaillot.trim() : undefined,
      },
    });

    if (fnError || data?.error) {
      setBusy(false);
      setError(data?.error || "Impossible d'enregistrer votre demande pour le moment. Réessayez dans un instant.");
      return;
    }

    setResult({ id: data.id, reference: data.reference });
    setStep(4);

    // "espèces" : la demande est créée et confirmée tout de suite (comme le tunnel guest), aucune
    // redirection Stripe — voir le bloc de confirmation step 4 plus bas.
    if (paiementMode === "seul" && modePaiementChoisi === "carte") {
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
      // apply_monthly_discount : simple intention transmise au serveur — create-checkout-session
      // revérifie l'éligibilité (connect_agent_discount) avant de l'honorer, jamais un montant
      // ou un pourcentage transmis ici (voir son en-tête).
      body: { prestation_id: prestationId, type_paiement: "totalite", apply_monthly_discount: monthlyDiscountSelected },
    });
    setBusy(false);
    if (fnError || data?.error || !data?.url) {
      setCheckoutError(data?.error || "Le paiement en ligne est momentanément indisponible. Votre demande est bien enregistrée.");
      return;
    }
    window.location.href = data.url;
  }

  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link href="/particulier/prestations" className="flex items-center gap-2 self-start text-[13px] font-medium text-text-tertiary hover:text-text">
          <span className="material-symbols-rounded !text-[18px]" aria-hidden="true">arrow_back</span>
          {offer.nom}
        </Link>
        <h1 className="font-sora text-[26px] font-bold tracking-tight">
          Réserver {beneficiary.kind === "self" ? "" : `pour ${beneficiary.label}`}
        </h1>
      </div>

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
            <h2 className="font-sora text-[17px] font-semibold">{isMontageCompilation ? "Informations du montage" : "Informations du match"}</h2>
            <Field id="rw-equipe" label="Équipe" value={equipe} onChange={(e) => setEquipe(e.target.value)} error={touched && !equipe.trim() ? "Requis." : null} />
            {!isMontageCompilation && (
              <Field id="rw-adversaire" label="Adversaire · facultatif" value={adversaire} onChange={(e) => setAdversaire(e.target.value)} />
            )}
            {isMontageCompilation ? (
              // Adversaire/Heure/Lieu retirés pour Montage Compilation — aucun déplacement
              // SportVision, ces champs n'ont aucune utilité pour un montage. Date conservée
              // (référence utile du match) mais seule, sans la grille 2 colonnes avec Heure.
              <Field id="rw-date" label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} error={touched && !date ? "Requise." : null} />
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Field id="rw-date" label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} error={touched && !date ? "Requise." : null} />
                <Field id="rw-heure" label="Heure · facultatif" type="time" value={heureDebut} onChange={(e) => setHeureDebut(e.target.value)} />
              </div>
            )}
            {!isMontageCompilation && (
              <Field id="rw-lieu" label="Lieu" placeholder="Stade, adresse" value={lieu} onChange={(e) => setLieu(e.target.value)} error={touched && !lieu.trim() ? "Requis." : null} />
            )}
            {isMontageCompilation && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-2">
                  <span className="text-[13px] font-medium text-text-secondary">Comment nous envoyez-vous vos images ?</span>
                  <div className="flex flex-col gap-2">
                    <ModeLivraisonChoice
                      label="Je fournis mes rushs déjà découpés"
                      sub="Vous avez déjà sélectionné vos meilleures actions."
                      selected={modeLivraisonMontage === "rushs_decoupes"}
                      onClick={() => setModeLivraisonMontage("rushs_decoupes")}
                    />
                    <ModeLivraisonChoice
                      label="Je vous envoie le lien de mon/mes match(s)"
                      sub="SportVision repère et découpe les temps forts pour vous."
                      selected={modeLivraisonMontage === "lien_match"}
                      onClick={() => setModeLivraisonMontage("lien_match")}
                    />
                  </div>
                </div>

                {modeLivraisonMontage === "rushs_decoupes" ? (
                  <div className="flex flex-col gap-2">
                    <Field
                      id="rw-duree-rush"
                      label="Durée totale de vos rushs (minutes)"
                      type="number"
                      min={1}
                      inputMode="numeric"
                      value={dureeRushMinutes}
                      onChange={(e) => setDureeRushMinutes(e.target.value)}
                      error={touched && !dureeValid ? "Requise (en minutes, supérieure à 0)." : null}
                    />
                    <span className="text-[12px] leading-relaxed text-text-tertiary">
                      Durée totale de vos rushs, en minutes — au-delà de {offer.tarifPalier?.seuilMinutes ?? 6} min,
                      {(() => {
                        const prixAuDela = offer.tarifPalier?.prixHtAuDela;
                        return prixAuDela != null
                          ? ` le tarif passe à ${formatEUR(Math.round(prixAuDela * (1 + offer.tvaPct / 100) * 100) / 100)} TTC.`
                          : " cette demande passe par un devis personnalisé (livraison expresse) — contactez SportVision après l'envoi de votre demande.";
                      })()}
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    <Field
                      id="rw-nb-matchs-lien"
                      label="Nombre de matchs"
                      type="number"
                      min={1}
                      inputMode="numeric"
                      value={nombreMatchsLien}
                      onChange={(e) => setNombreMatchsLien(e.target.value)}
                      error={touched && !dureeValid && !nombreMatchsLienNum ? "Requis, supérieur à 0." : null}
                    />
                    <div className="flex flex-col gap-2">
                      <label htmlFor="rw-lien-match" className="text-[13px] font-medium text-text-secondary">
                        Lien(s) vers votre/vos match(s)
                      </label>
                      <textarea
                        id="rw-lien-match"
                        value={lienMatchUrl}
                        onChange={(e) => setLienMatchUrl(e.target.value)}
                        rows={2}
                        className="w-full rounded-sv border border-border-strong bg-surface px-4 py-3 text-[15px] text-text outline-none focus:border-[#8CA9FF] focus:shadow-[0_0_0_3px_rgba(79,125,255,.28)]"
                        placeholder="Un lien par ligne (Veo, YouTube, Drive…)"
                      />
                      {touched && !dureeValid && nombreMatchsLienNum && !lienMatchUrl.trim() && (
                        <span className="text-[12px] text-danger">Lien(s) requis.</span>
                      )}
                    </div>
                    {lienMatchMax != null && nombreMatchsLienNum != null && nombreMatchsLienNum > lienMatchMax && (
                      <span className="text-[12px] leading-relaxed text-attente">
                        Au-delà de {lienMatchMax} matchs, cette demande passe par un devis personnalisé (livraison
                        expresse) — contactez SportVision après l&apos;envoi de votre demande.
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
            {isMontageCompilation && (
              <div className="flex flex-col gap-3 border-t border-border pt-4">
                <span className="text-[13px] font-medium text-text-secondary">
                  Informations pour le montage
                </span>
                <span className="-mt-2 text-[12px] leading-relaxed text-text-tertiary">
                  Pour identifier le sportif dans les rushs. Les infos déjà connues de son profil
                  ne sont demandées qu&apos;une fois.
                </span>
                <PhysiqueField
                  id="rw-taille"
                  label="Taille"
                  unit="cm"
                  profileValue={athleteProfile?.tailleCm ?? null}
                  editing={editTaille}
                  onEdit={() => setEditTaille(true)}
                  inputType="number"
                  inputProps={{ min: 100, max: 250, inputMode: "numeric" }}
                  value={tailleCm}
                  onChange={setTailleCm}
                />
                <PhysiqueField
                  id="rw-poids"
                  label="Poids"
                  unit="kg"
                  profileValue={athleteProfile?.poidsKg ?? null}
                  editing={editPoids}
                  onEdit={() => setEditPoids(true)}
                  inputType="number"
                  inputProps={{ min: 20, max: 200, step: 0.1, inputMode: "decimal" }}
                  value={poidsKg}
                  onChange={setPoidsKg}
                />
                <PhysiqueField
                  id="rw-poste"
                  label="Poste"
                  profileValue={athleteProfile?.poste ?? null}
                  editing={editPoste}
                  onEdit={() => setEditPoste(true)}
                  inputProps={{ placeholder: "Attaquant, Gardien…" }}
                  value={poste}
                  onChange={setPoste}
                />
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    id="rw-numero-maillot"
                    label="N° de maillot"
                    inputMode="numeric"
                    placeholder="9"
                    value={numeroMaillot}
                    onChange={(e) => setNumeroMaillot(e.target.value)}
                  />
                  <div className="flex flex-col gap-2">
                    <label htmlFor="rw-couleur-maillot" className="text-[13px] font-medium text-text-secondary">
                      Couleur de maillot
                    </label>
                    <input
                      id="rw-couleur-maillot"
                      list="rw-couleurs-maillot-particulier"
                      value={couleurMaillot}
                      onChange={(e) => setCouleurMaillot(e.target.value)}
                      placeholder="Bleu, Domicile…"
                      className="h-[54px] w-full rounded-sv border border-border-strong bg-surface px-4 font-sans text-[15px] text-text outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-text-label focus:border-[#8CA9FF] focus:shadow-[0_0_0_3px_rgba(79,125,255,.28)]"
                    />
                    <datalist id="rw-couleurs-maillot-particulier">
                      {COULEURS_MAILLOT_COURANTES.map((c) => (
                        <option key={c} value={c} />
                      ))}
                    </datalist>
                  </div>
                </div>
              </div>
            )}
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
                sub="Partagez le coût via une cotisation."
                selected={paiementMode === "collectif"}
                onClick={() => setPaiementMode("collectif")}
              />
            </div>

            {paiementMode === "seul" && (
              <div className="flex flex-col gap-2 pl-1">
                <span className="text-[12.5px] font-medium text-text-tertiary">Comment réglez-vous ?</span>
                <div className="flex flex-col gap-2">
                  <PaymentChoice
                    label="Carte bancaire"
                    sub="Paiement en ligne sécurisé, immédiat."
                    selected={modePaiementChoisi === "carte"}
                    onClick={() => setModePaiementChoisi("carte")}
                  />
                  <PaymentChoice
                    label="Espèces sur place"
                    sub="Réglez le jour de la prestation. Votre demande est confirmée tout de suite."
                    selected={modePaiementChoisi === "especes"}
                    onClick={() => setModePaiementChoisi("especes")}
                  />
                </div>
              </div>
            )}

            {paiementMode === "collectif" && (
              <div className="flex items-start gap-2.5 rounded-sv border border-attente/40 bg-attente-bg px-4 py-3.5">
                <span className="material-symbols-rounded !text-[19px] text-attente" aria-hidden="true">info</span>
                <span className="text-[12.5px] leading-relaxed text-text-secondary">
                  Votre demande sera tout de même enregistrée au statut « En validation ». Créez ensuite une
                  cotisation depuis « Voir mes commandes » pour partager le coût.
                </span>
              </div>
            )}

            {(montagePctApplicable || monthlyPctApplicable || agentDiscount.monthlyUsedThisPeriod) && (
              <div className="flex flex-col gap-2.5 rounded-sv border border-[rgba(140,169,255,.35)] bg-[rgba(79,125,255,.08)] p-3.5">
                <span className="flex items-center gap-2 font-sora text-[13.5px] font-semibold text-text">
                  <span className="material-symbols-rounded !text-[18px] text-prestations" aria-hidden="true">percent</span>
                  Réduction Agent
                </span>
                {montagePctApplicable && (
                  <span className="text-[12.5px] leading-relaxed text-text-secondary">
                    -{agentDiscount.montagePct}% appliqués automatiquement sur Montage Compilation (abonnement Agent actif).
                  </span>
                )}
                {monthlyPctApplicable ? (
                  <label className="flex items-start gap-2.5 text-[12.5px] leading-relaxed text-text-secondary">
                    <input
                      type="checkbox"
                      checked={applyMonthlyDiscount}
                      onChange={(e) => setApplyMonthlyDiscount(e.target.checked)}
                      className="mt-0.5 h-4 w-4 accent-[#8CA9FF]"
                    />
                    Appliquer ma remise mensuelle Agent (-{agentDiscount.monthlyPct}%, une fois par période, valable sur
                    n&apos;importe quelle prestation — palier Pro).
                  </label>
                ) : (
                  agentDiscount.monthlyUsedThisPeriod && (
                    <span className="text-[12px] text-text-faint">Remise mensuelle Agent déjà utilisée cette période.</span>
                  )
                )}
              </div>
            )}

            <div className="flex flex-col gap-2 border-t border-border pt-4">
              <SummaryRow label="Prestation" value={offer.nom} />
              <SummaryRow label="Bénéficiaire" value={beneficiary.label} />
              <SummaryRow label="Commandée par" value={commanditaireLabel} />
              <SummaryRow label="Payée par" value={commanditaireLabel} />
              <SummaryRow label="Date" value={date || "—"} />
              {isMontageCompilation ? (
                <SummaryRow label="Maillot" value={numeroMaillot || couleurMaillot ? `${numeroMaillot ? `#${numeroMaillot}` : ""} ${couleurMaillot}`.trim() : "—"} />
              ) : (
                <SummaryRow label="Lieu" value={lieu || "—"} />
              )}
              <SummaryRow label="Options" value={optionNames.length ? optionNames.join(", ") : "Aucune"} />
              {remisePct > 0 && <SummaryRow label="Remise Agent" value={`-${remisePct}%`} />}
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
              J&apos;accepte les{" "}
              <a href={LEGAL_URLS.cgv} target="_blank" rel="noopener noreferrer" className="font-medium text-[#8CA9FF] hover:text-[#B6C7FF] underline" onClick={(e) => e.stopPropagation()}>
                conditions générales de prestation SportVision
              </a>
              .
            </label>
            {touched && !cgvAcceptee && <span className="text-[12px] text-danger">L&apos;acceptation des CGV est requise.</span>}

            {error && (
              <div className="flex items-start gap-2.5 rounded-sv border border-danger-border bg-danger-bg px-4 py-3.5">
                <span className="material-symbols-rounded !text-[19px] text-danger" aria-hidden="true">error</span>
                <span className="text-[13px] leading-relaxed text-[#FBCFE8]">{error}</span>
              </div>
            )}
          </div>
        )}

        {step === 4 && result && (
          <div className="flex flex-col items-center gap-4 py-4 text-center animate-sv-in">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-affiliations-bg">
              <span className="material-symbols-rounded !text-[28px] text-affiliations" aria-hidden="true">check_circle</span>
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

            {paiementMode === "seul" && modePaiementChoisi === "carte" && busy && (
              <span className="text-[13px] text-text-tertiary">Redirection vers le paiement sécurisé…</span>
            )}
            {paiementMode === "seul" && modePaiementChoisi === "carte" && checkoutError && (
              <div className="flex w-full flex-col gap-3 rounded-sv border border-danger-border bg-danger-bg px-4 py-3.5 text-left">
                <span className="text-[13px] leading-relaxed text-[#FBCFE8]">{checkoutError}</span>
                <Button variant="secondary" onClick={() => launchCheckout(result.id)} loading={busy}>
                  Réessayer le paiement
                </Button>
              </div>
            )}
            {paiementMode === "seul" && modePaiementChoisi === "especes" && (
              <div className="flex w-full items-start gap-2.5 rounded-sv border border-affiliations/40 bg-affiliations-bg px-4 py-3.5 text-left">
                <span className="material-symbols-rounded !text-[19px] text-affiliations" aria-hidden="true">payments</span>
                <span className="text-[12.5px] leading-relaxed text-text-secondary">
                  Réservation confirmée — réglez sur place le jour de la prestation.
                </span>
              </div>
            )}
            {paiementMode === "collectif" && (
              <Button onClick={() => router.push(`/particulier/cotisations/creer?offreId=${offer.id}&benefKind=${beneficiary.kind}&benefId=${beneficiary.id || ""}`)} className="w-full max-w-[320px]">
                Créer une cotisation
              </Button>
            )}

            <Button variant="secondary" onClick={() => router.push("/particulier/commandes")} className="w-full max-w-[320px]">
              Voir mes commandes
            </Button>
          </div>
        )}
      </div>

      {step < 4 && (
        <div className="flex gap-2.5">
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
    </div>
  );
}

// Réutilise exactement le même style que PaymentChoice (juste en dessous) — deux choix
// exclusifs, même pattern visuel.
function ModeLivraisonChoice({ label, sub, selected, onClick }: { label: string; sub: string; selected: boolean; onClick: () => void }) {
  return <PaymentChoice label={label} sub={sub} selected={selected} onClick={onClick} />;
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

// Champ "Informations pour le montage" (migration-connect-v68) — taille/poids/poste. Si une
// valeur est DÉJÀ connue du profil (profileValue non nul) ET que l'utilisateur n'a pas cliqué
// "Modifier", affichée en lecture seule avec un ✓ plutôt qu'un champ de saisie — jamais
// redemandée une fois connue (principe posé par Fouka, voir l'en-tête de la migration). Sinon,
// simple <Field> normal. Le numéro de maillot n'utilise volontairement PAS ce composant : il
// reste TOUJOURS un champ de saisie classique (peut différer du profil pour ce match précis).
function PhysiqueField({
  id,
  label,
  unit,
  profileValue,
  editing,
  onEdit,
  value,
  onChange,
  inputType = "text",
  inputProps,
}: {
  id: string;
  label: string;
  unit?: string;
  profileValue: number | string | null;
  editing: boolean;
  onEdit: () => void;
  value: string;
  onChange: (value: string) => void;
  inputType?: string;
  inputProps?: Record<string, unknown>;
}) {
  const known = profileValue != null && String(profileValue).trim() !== "" && !editing;
  if (known) {
    return (
      <div className="flex items-center justify-between rounded-sv border border-border bg-bg-elevated px-4 py-3.5">
        <span className="flex items-center gap-1.5 text-[13.5px] text-text-secondary">
          <span className="material-symbols-rounded !text-[16px] text-affiliations" aria-hidden="true">check_circle</span>
          {label} : <strong className="font-sora text-text">{profileValue}{unit ? ` ${unit}` : ""}</strong>
        </span>
        <button type="button" onClick={onEdit} className="text-[12.5px] font-medium text-[#8CA9FF] hover:underline">
          Modifier
        </button>
      </div>
    );
  }
  return (
    <Field
      id={id}
      label={unit ? `${label} (${unit})` : label}
      type={inputType}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      {...inputProps}
    />
  );
}
