"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

// Écran de bienvenue après affiliation (JoinClubForm.tsx) : deux propositions facultatives,
// jamais bloquantes — Pass Photo puis photo de référence — avant de rejoindre Mes sportifs.
// Ordre voulu par Fouka (29/09/2026) : le Pass en premier (c'est lui qui retire le filigrane et
// permet le téléchargement), la photo de référence ensuite (sert à retrouver automatiquement les
// photos, mais la reconnaissance fonctionne pour tous, Pass ou non — jamais un prérequis l'un de
// l'autre). Les deux existent déjà ailleurs dans l'app (achat du Pass, reconnaissance) : on ne les
// duplique pas ici, on les présente au bon moment et on renvoie vers les vrais écrans.
export default function BienvenuePage() {
  const searchParams = useSearchParams();
  const playerId = searchParams.get("playerId");
  const nom = searchParams.get("nom") || "votre sportif";
  const [step, setStep] = useState<1 | 2>(1);

  if (!playerId) {
    return (
      <div className="flex max-w-[560px] flex-col gap-6">
        <Link href="/particulier/sportifs" className="self-start rounded-sv bg-sv-gradient px-5 py-3 font-sora text-[15px] font-semibold text-white hover:brightness-[1.12]">
          Mes sportifs
        </Link>
      </div>
    );
  }

  const primaryLinkClass =
    "rounded-sv bg-sv-gradient px-5 py-3 font-sora text-[15px] font-semibold text-white hover:brightness-[1.12]";
  const secondaryButtonClass =
    "rounded-sv border border-border-strong bg-white/[.06] px-5 py-3 font-sora text-[15px] font-semibold text-text-secondary hover:bg-white/[.1]";

  if (step === 1) {
    return (
      <div className="flex max-w-[560px] flex-col gap-6">
        <div className="flex flex-col gap-2">
          <p className="text-[12.5px] font-bold uppercase tracking-[.1em] text-text-tertiary">Bienvenue</p>
          <h1 className="font-sora text-[24px] font-bold tracking-tight">Une dernière chose</h1>
        </div>
        <div className="flex flex-col gap-4 rounded-sv-card border border-border bg-surface p-6">
          <span className="material-symbols-rounded !text-[32px] text-affiliations" aria-hidden="true">photo_library</span>
          <h2 className="font-sora text-[18px] font-bold tracking-tight">Le Pass Photo</h2>
          <p className="text-[14px] leading-relaxed text-text-tertiary">
            Retrouvez les photos de {nom} toute la saison, celles du groupe incluses, sans filigrane, et téléchargez-les
            en version numérique. Facultatif : les galeries de l&apos;équipe restent consultables sans y souscrire.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href={`/particulier/sportifs/club/${playerId}/photos`} className={primaryLinkClass}>
              Découvrir le Pass Photo
            </Link>
            <button type="button" onClick={() => setStep(2)} className={secondaryButtonClass}>
              Plus tard
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex max-w-[560px] flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="text-[12.5px] font-bold uppercase tracking-[.1em] text-text-tertiary">Bienvenue</p>
        <h1 className="font-sora text-[24px] font-bold tracking-tight">Encore une chose</h1>
      </div>
      <div className="flex flex-col gap-4 rounded-sv-card border border-border bg-surface p-6">
        <span className="material-symbols-rounded !text-[32px] text-affiliations" aria-hidden="true">face</span>
        <h2 className="font-sora text-[18px] font-bold tracking-tight">Photo de référence de {nom}</h2>
        <p className="text-[14px] leading-relaxed text-text-tertiary">
          Ajoutez une ou plusieurs photos pour retrouver automatiquement les photos de {nom} dans les galeries de
          l&apos;équipe, sans avoir à les chercher une par une. Entièrement facultatif, à faire à tout moment depuis sa
          fiche.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href={`/particulier/sportifs/club/${playerId}/reconnaissance`} className={primaryLinkClass}>
            Ajouter une photo
          </Link>
          <Link href="/particulier/sportifs" className={secondaryButtonClass}>
            Terminer
          </Link>
        </div>
      </div>
    </div>
  );
}
