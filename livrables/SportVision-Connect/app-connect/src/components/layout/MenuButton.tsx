"use client";

import { Avatar } from "@/components/ui/Avatar";

// Le bouton qui ouvre le menu complet sur mobile.
//
// Il existait à l'identique dans les trois enveloppes (AppShell, ParticularShell, DemoShell), et
// tous les trois avaient le même défaut : le bouton ne contient qu'un avatar, donc un lecteur
// d'écran n'annonçait rien du tout — alors que c'est le SEUL accès au menu complet sur téléphone.
// Corriger les trois séparément aurait garanti qu'une quatrième copie réapparaisse un jour sans le
// correctif. Un composant, un comportement.
//
// `aria-expanded` autant que le libellé : sans lui, on annonce « bouton Menu » sans jamais dire si
// le menu est ouvert ou fermé, ce qui rend la navigation au clavier désorientante.
//
// Aucun changement visuel : mêmes classes, même avatar, même taille.

export function MenuButton({
  open,
  onToggle,
  avatarUrl,
  label,
  className = "",
}: {
  open: boolean;
  onToggle: () => void;
  avatarUrl: string | null;
  label: string;
  /** Positionnement propre à l'enveloppe (DemoShell pousse le bouton à droite). */
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={open ? "Fermer le menu de navigation" : "Ouvrir le menu de navigation"}
      aria-expanded={open}
      aria-haspopup="menu"
      className={`flex h-10 w-10 items-center justify-center rounded-sv bg-surface ${className}`}
    >
      <Avatar url={avatarUrl} label={label} size={32} className="text-[12px]" />
    </button>
  );
}
