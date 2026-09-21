"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, PencilLine, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import {
  confirmerMatch,
  fetchEtatConfirmation,
  retirerConfirmation,
  type EtatConfirmation,
} from "@/lib/data/club/match-confirmation";

// « Le match est-il au bon horaire, au bon endroit ? » (v241, 21/09/2026)
//
// Fouka, après plusieurs déplacements sur des matchs qui n'avaient pas lieu à l'heure annoncée :
// « les coachs doivent pouvoir confirmer si c'est la bonne horaire, le bon lieu, qu'ils puissent
// modifier ou ajouter un match, comme ça moi sur le calendrier je vois le match exact ».
//
// Deux partis pris d'écran :
//
// 1. Confirmer et corriger sont le MÊME geste, pas deux écrans. Un coach ne se demande pas s'il
//    fait une « validation » ou une « modification » : il dit ce qui est vrai. Le formulaire de
//    correction est donc à un clic, pré-rempli avec ce que la fédération annonce, et l'enregistrer
//    vaut confirmation.
// 2. Le droit de confirmer vient de la base (peut_confirmer_match), jamais du rôle lu côté React.
//    Un bouton affiché puis refusé par le serveur est pire que pas de bouton du tout.

interface ConfirmationMatchProps {
  matchId: string;
  /** Ce que le calendrier annonce aujourd'hui, pour pré-remplir la correction. */
  date: string;
  heure?: string;
  lieu?: string;
  adversaire?: string;
  /** Rappelé après une CORRECTION seulement : la date ou l'heure ont changé, le calendrier
   *  derrière la fiche ne dit plus la vérité. Une simple confirmation ne déplace rien, et fermer
   *  la fiche à ce moment-là priverait le coach de la réponse à son propre clic. */
  onCorrige?: () => void;
}

function dateLisible(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
}

export function ConfirmationMatch({ matchId, date, heure, lieu, adversaire, onCorrige }: ConfirmationMatchProps) {
  const [etat, setEtat] = useState<EtatConfirmation | null>(null);
  const [correction, setCorrection] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const [fDate, setFDate] = useState(date);
  const [fHeure, setFHeure] = useState(heure ?? "");
  const [fLieu, setFLieu] = useState(lieu ?? "");
  const [fAdversaire, setFAdversaire] = useState(adversaire ?? "");

  useEffect(() => {
    let vivant = true;
    fetchEtatConfirmation(createClient(), matchId)
      .then((e) => vivant && setEtat(e))
      .catch(() => vivant && setEtat({ confirmable: false }));
    return () => {
      vivant = false;
    };
  }, [matchId]);

  async function agir(action: () => Promise<void>, aCorrige = false) {
    setEnCours(true);
    setErreur(null);
    try {
      await action();
      setEtat(await fetchEtatConfirmation(createClient(), matchId));
      setCorrection(false);
      if (aCorrige) onCorrige?.();
    } catch (e) {
      // Le message de la base est écrit pour être lu par un humain (« Seul le coach de cette
      // équipe… »), on le montre tel quel plutôt qu'un « une erreur est survenue » qui n'apprend
      // rien à celui qui vient de cliquer.
      setErreur(e instanceof Error ? e.message : "La confirmation n'a pas pu être enregistrée.");
    } finally {
      setEnCours(false);
    }
  }

  // Tant que la réponse n'est pas là, on n'affiche rien : annoncer « à confirmer » puis le
  // remplacer par « confirmé » ferait clignoter la fiche à chaque ouverture.
  if (!etat) return null;

  if (etat.confirmeLe && !correction) {
    return (
      <div className="flex flex-col gap-2 rounded-xl bg-success-bg px-3.5 py-3">
        <div className="flex items-start gap-2.5">
          <CheckCircle2 className="mt-[1px] h-4 w-4 flex-none text-success-fg" aria-hidden />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[12.5px] font-extrabold text-success-fg">Horaire et lieu confirmés</span>
            <span className="text-[11.5px] text-success-fg/80">
              {etat.confirmePar ? `Par ${etat.confirmePar}` : "Par le club"} le {dateLisible(etat.confirmeLe)}
            </span>
          </div>
        </div>
        {etat.confirmable && (
          <button
            type="button"
            disabled={enCours}
            onClick={() => setCorrection(true)}
            className="self-start text-[11.5px] font-bold text-success-fg/80 underline underline-offset-2 hover:text-success-fg disabled:opacity-50"
          >
            Ce n&apos;est plus exact
          </button>
        )}
        {erreur && <span className="text-[11.5px] font-bold text-danger-fg">{erreur}</span>}
      </div>
    );
  }

  if (correction) {
    const champ =
      "w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-[12.5px] text-text outline-none focus:border-accent";
    return (
      <div className="flex flex-col gap-3 rounded-xl bg-surface-alt px-3.5 py-3">
        <span className="text-[12.5px] font-extrabold">Corriger ce match</span>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[10.5px] font-bold uppercase tracking-[.05em] text-text-faint">Date</span>
            <input type="date" className={champ} value={fDate} onChange={(e) => setFDate(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10.5px] font-bold uppercase tracking-[.05em] text-text-faint">Heure</span>
            <input type="time" className={champ} value={fHeure} onChange={(e) => setFHeure(e.target.value)} />
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-[10.5px] font-bold uppercase tracking-[.05em] text-text-faint">Lieu</span>
          <input className={champ} value={fLieu} placeholder="Stade, gymnase…" onChange={(e) => setFLieu(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10.5px] font-bold uppercase tracking-[.05em] text-text-faint">Adversaire</span>
          <input className={champ} value={fAdversaire} onChange={(e) => setFAdversaire(e.target.value)} />
        </label>
        {erreur && <span className="text-[11.5px] font-bold text-danger-fg">{erreur}</span>}
        <div className="flex items-center gap-2">
          <Button
            disabled={enCours}
            onClick={() =>
              agir(() =>
                confirmerMatch(createClient(), matchId, {
                  date: fDate || undefined,
                  heure: fHeure || undefined,
                  lieu: fLieu || undefined,
                  adversaire: fAdversaire || undefined,
                }),
                true,
              )
            }
          >
            Enregistrer et confirmer
          </Button>
          <Button variant="secondary" disabled={enCours} onClick={() => { setCorrection(false); setErreur(null); }}>
            Annuler
          </Button>
        </div>
        {etat.confirmeLe && (
          <button
            type="button"
            disabled={enCours}
            onClick={() => agir(() => retirerConfirmation(createClient(), matchId))}
            className="self-start text-[11.5px] font-bold text-text-faint underline underline-offset-2 hover:text-text disabled:opacity-50"
          >
            Retirer simplement ma confirmation
          </button>
        )}
      </div>
    );
  }

  // Pas encore confirmé. Celui qui n'a pas le droit de confirmer voit quand même l'information :
  // c'est elle qui lui dit de ne pas se fier aveuglément à l'horaire affiché.
  if (!etat.confirmable) {
    return (
      <div className="flex items-start gap-2.5 rounded-xl bg-surface-alt px-3.5 py-3">
        <AlertCircle className="mt-[1px] h-4 w-4 flex-none text-text-faint" aria-hidden />
        <span className="text-[11.5px] text-text-soft">
          Horaire et lieu <span className="font-bold">pas encore confirmés</span> par le club.
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-xl bg-warning-bg px-3.5 py-3">
      <div className="flex items-start gap-2.5">
        <AlertCircle className="mt-[1px] h-4 w-4 flex-none text-warning-fg" aria-hidden />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[12.5px] font-extrabold text-warning-fg">Cet horaire et ce lieu sont-ils exacts ?</span>
          <span className="text-[11.5px] text-warning-fg/80">
            Votre confirmation évite un déplacement pour rien à l&apos;équipe SportVision.
          </span>
        </div>
      </div>
      {erreur && <span className="text-[11.5px] font-bold text-danger-fg">{erreur}</span>}
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={enCours} onClick={() => agir(() => confirmerMatch(createClient(), matchId))}>
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          Oui, c&apos;est exact
        </Button>
        <Button variant="secondary" disabled={enCours} onClick={() => setCorrection(true)}>
          <PencilLine className="h-4 w-4" aria-hidden />
          Corriger
        </Button>
      </div>
    </div>
  );
}
