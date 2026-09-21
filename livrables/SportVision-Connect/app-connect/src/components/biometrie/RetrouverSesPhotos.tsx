"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  deposerPhotoReference,
  donnerAccordBiometrie,
  fetchEtatBiometrie,
  retirerAccordBiometrie,
  type EtatBiometrie,
} from "@/lib/supabase/biometrie";

// « Retrouver ses photos automatiquement » (21/09/2026)
//
// Fouka : « le parent donne son accord et dépose la photo. Pour un joueur majeur, ils donnent leur
// accord eux-mêmes. Choisis ce qui est le mieux, mais le plus simple. »
//
// LE PLUS SIMPLE, ICI, CE N'EST PAS LE PLUS COURT. Il s'agit de la photo d'un enfant et d'une
// donnée biométrique : un bouton nu « Activer » serait plus rapide à écrire et juridiquement
// intenable. Le parti pris est donc : une phrase qui dit ce qu'on fait, une qui dit ce qu'on ne
// fait pas, le dépôt de la photo dans le même geste, et un retrait toujours visible. Deux clics en
// tout, et rien à lire de plus que ce qui change quelque chose pour lui.
//
// Le texte intégral (livrables/juridique/consentement-reconnaissance-enfant.md) reste accessible
// d'un lien : ce qui est affiché ici en est le résumé fidèle, pas un raccourci commercial.

interface Props {
  playerId: string;
  /** Le prénom, pour parler de l'enfant plutôt que d'« un sportif ». */
  prenom: string;
  /** Vrai quand la personne connectée est le sportif lui-même (un senior, par exemple). */
  cestMoi?: boolean;
}

export function RetrouverSesPhotos({ playerId, prenom, cestMoi = false }: Props) {
  const [etat, setEtat] = useState<EtatBiometrie | null>(null);
  const [ouvert, setOuvert] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const champ = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let vivant = true;
    fetchEtatBiometrie(createClient(), playerId)
      .then((e) => vivant && setEtat(e))
      .catch(() => vivant && setEtat({ autorise: false, photoDeposee: false }));
    return () => {
      vivant = false;
    };
  }, [playerId]);

  async function agir(action: () => Promise<void>) {
    setEnCours(true);
    setErreur(null);
    try {
      await action();
      setEtat(await fetchEtatBiometrie(createClient(), playerId));
    } catch (e) {
      // Les messages de la base sont écrits pour être lus (« Avant 15 ans, cet accord doit être
      // donné par un parent… ») : on les montre tels quels.
      setErreur(e instanceof Error ? e.message : "L'opération n'a pas abouti.");
    } finally {
      setEnCours(false);
    }
  }

  function choisirPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setErreur("Choisissez une photo (JPEG ou PNG).");
      return;
    }
    if (f.size > 12 * 1024 * 1024) {
      setErreur("Photo trop lourde : 12 Mo au maximum.");
      return;
    }
    agir(() => deposerPhotoReference(createClient(), playerId, f));
  }

  if (!etat) return null;

  const qui = cestMoi ? "vous" : prenom;

  // ── Accordé et photo déposée : l'état normal, réduit au minimum ───────────
  if (etat.autorise && etat.photoDeposee) {
    return (
      <div className="flex flex-col gap-2 rounded-sv-card border border-border bg-surface p-4">
        <div className="flex items-start gap-2.5">
          <span className="material-symbols-rounded !text-[20px] text-contenus" aria-hidden="true">check_circle</span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="font-sora text-[14px] font-semibold">
              {cestMoi ? "Vos photos sont retrouvées automatiquement" : `Les photos de ${prenom} sont retrouvées automatiquement`}
            </span>
            <span className="text-[12.5px] text-text-tertiary">
              Dans les prochaines galeries de {cestMoi ? "votre" : "son"} club.
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={enCours}
            onClick={() => champ.current?.click()}
            className="text-[12.5px] font-semibold text-text-secondary underline underline-offset-2 hover:text-text disabled:opacity-50"
          >
            Changer la photo
          </button>
          <button
            type="button"
            disabled={enCours}
            onClick={() => agir(() => retirerAccordBiometrie(createClient(), playerId))}
            className="text-[12.5px] text-text-tertiary underline underline-offset-2 hover:text-text disabled:opacity-50"
          >
            Retirer mon accord
          </button>
        </div>
        {erreur && <span className="text-[12px] font-semibold text-danger">{erreur}</span>}
        <input ref={champ} type="file" accept="image/*" className="hidden" onChange={choisirPhoto} />
      </div>
    );
  }

  // ── Accordé mais aucune photo : il reste un geste, et un seul ────────────
  if (etat.autorise) {
    return (
      <div className="flex flex-col gap-3 rounded-sv-card border border-border bg-surface p-4">
        <div className="flex flex-col gap-0.5">
          <span className="font-sora text-[14px] font-semibold">Il manque la photo de {qui}</span>
          <span className="text-[12.5px] leading-relaxed text-text-tertiary">
            Une photo de face, {cestMoi ? "vous" : prenom} bien visible. C&apos;est elle qui permet de
            {cestMoi ? " vous" : " le"} reconnaître sur les photos des matchs.
          </span>
        </div>
        {erreur && <span className="text-[12px] font-semibold text-danger">{erreur}</span>}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={enCours}
            onClick={() => champ.current?.click()}
            className="flex h-11 items-center gap-2 rounded-sv bg-sv-gradient px-4 font-sora text-[14px] font-semibold text-white hover:brightness-[1.12] disabled:opacity-60"
          >
            <span className="material-symbols-rounded !text-[19px]" aria-hidden="true">add_a_photo</span>
            {enCours ? "Envoi…" : "Déposer la photo"}
          </button>
          <button
            type="button"
            disabled={enCours}
            onClick={() => agir(() => retirerAccordBiometrie(createClient(), playerId))}
            className="text-[12.5px] text-text-tertiary underline underline-offset-2 hover:text-text disabled:opacity-50"
          >
            Finalement, non
          </button>
        </div>
        <input ref={champ} type="file" accept="image/*" className="hidden" onChange={choisirPhoto} />
      </div>
    );
  }

  // ── Rien encore : la proposition ─────────────────────────────────────────
  return (
    <div className="flex flex-col gap-3 rounded-sv-card border border-border bg-surface p-4">
      <div className="flex items-start gap-2.5">
        <span className="material-symbols-rounded !text-[20px] text-text-tertiary" aria-hidden="true">face_retouching_natural</span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-sora text-[14px] font-semibold">
            Retrouver {cestMoi ? "vos photos" : `les photos de ${prenom}`} automatiquement
          </span>
          <span className="text-[12.5px] leading-relaxed text-text-tertiary">
            N&apos;achetez que {cestMoi ? "vos" : "ses"} photos, au lieu de toute la galerie.
          </span>
        </div>
      </div>

      {!ouvert ? (
        <button
          type="button"
          onClick={() => setOuvert(true)}
          className="self-start text-[13px] font-semibold text-text-secondary underline underline-offset-2 hover:text-text"
        >
          Comment ça marche
        </button>
      ) : (
        <div className="flex flex-col gap-2 rounded-sv bg-white/[.05] p-3.5 text-[12.5px] leading-relaxed text-text-secondary">
          <p>
            Vous déposez une photo de face. SportVision en calcule une empreinte numérique et s&apos;en
            sert pour {cestMoi ? "vous" : `retrouver ${prenom}`} sur les photos des prochaines galeries
            de {cestMoi ? "votre" : "son"} club. Quand la ressemblance est très sûre, la photo
            {cestMoi ? " vous" : " lui"} est attribuée ; sinon, une personne de SportVision vérifie avant.
          </p>
          <p>
            Nous ne conservons que cette photo et son empreinte. Elles ne servent qu&apos;à cela, ne
            sont transmises ni au club ni à personne, et les visages des autres enfants présents sur
            une photo ne sont jamais enregistrés.
          </p>
          <p>
            Vous pouvez retirer votre accord à tout moment : la photo et l&apos;empreinte sont
            effacées immédiatement.
          </p>
        </div>
      )}

      {erreur && <span className="text-[12px] font-semibold text-danger">{erreur}</span>}

      <button
        type="button"
        disabled={enCours}
        onClick={() => agir(() => donnerAccordBiometrie(createClient(), playerId))}
        className="flex h-11 items-center gap-2 self-start rounded-sv bg-sv-gradient px-4 font-sora text-[14px] font-semibold text-white hover:brightness-[1.12] disabled:opacity-60"
      >
        <span className="material-symbols-rounded !text-[19px]" aria-hidden="true">check</span>
        {enCours ? "Un instant…" : "J’accepte, activer"}
      </button>
    </div>
  );
}
