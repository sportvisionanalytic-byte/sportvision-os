"use client";

// Sélecteur d'équipe — un seul, pour tous les écrans.
//
// ── Pourquoi un composant partagé ──
// On choisit une équipe au calendrier, aux résultats, dans les galeries, dans les invitations.
// Cinq sélecteurs, ce sont cinq comportements qui divergent, et cinq fois le même problème à
// résoudre le jour où un club dépasse trente équipes.
//
// ── Ce qu'il résout ──
// Un <select> aligne les équipes à plat, par ordre alphabétique. Chez SF Villemomble (38 équipes),
// trouver « U12 Espoir 2 » demande de parcourir quarante lignes où « Séniors D1 » côtoie
// « U10 Avenir ». Ici : quinze rubriques repliées, une recherche, un seul groupe ouvert à la fois.
//
// La règle de regroupement vit dans lib/teams/groupes.ts, pas ici : c'est du métier, et elle doit
// servir aux écrans qui n'ont pas ce composant.

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, Search, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { estFeminine, filtrerGroupes, grouperEquipes, type EquipeChoisissable } from "@/lib/teams/groupes";

interface TeamSelectorProps {
  equipes: EquipeChoisissable[];
  /** Nom de l'équipe choisie, ou "" pour « toutes ». On échange des NOMS et non des identifiants :
   *  c'est ce que portent les événements du calendrier, et changer cela demanderait de toucher au
   *  modèle de données pour un gain d'affichage. */
  valeur: string;
  onChange: (nom: string) => void;
  libelleToutes?: string;
  className?: string;
}

export function TeamSelector({
  equipes,
  valeur,
  onChange,
  libelleToutes = "Toutes les équipes",
  className,
}: TeamSelectorProps) {
  const [ouvert, setOuvert] = useState(false);
  const [recherche, setRecherche] = useState("");
  // Un seul groupe déplié à la fois : deux groupes ouverts et on retrouve la liste à défiler que
  // ce composant existe pour éviter.
  const [groupeOuvert, setGroupeOuvert] = useState<string | null>(null);
  const conteneur = useRef<HTMLDivElement>(null);

  const groupes = useMemo(() => grouperEquipes(equipes), [equipes]);
  const visibles = useMemo(() => filtrerGroupes(groupes, recherche), [groupes, recherche]);
  // Pendant une recherche, tout est déplié : obliger à ouvrir un accordéon après avoir tapé un
  // nom reviendrait à demander deux fois la même chose.
  const enRecherche = recherche.trim().length > 0;

  useEffect(() => {
    if (!ouvert) return;
    const auClic = (e: MouseEvent) => {
      if (conteneur.current && !conteneur.current.contains(e.target as Node)) setOuvert(false);
    };
    const auClavier = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOuvert(false);
    };
    document.addEventListener("mousedown", auClic);
    document.addEventListener("keydown", auClavier);
    return () => {
      document.removeEventListener("mousedown", auClic);
      document.removeEventListener("keydown", auClavier);
    };
  }, [ouvert]);

  // À la fermeture, on efface la recherche : rouvrir sur un filtre qu'on ne se rappelle pas avoir
  // tapé donne l'impression d'une liste incomplète.
  useEffect(() => {
    if (!ouvert) setRecherche("");
  }, [ouvert]);

  function choisir(nom: string) {
    onChange(nom);
    setOuvert(false);
  }

  const liste = (
    <>
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-divider bg-surface px-3 py-2.5">
        <Search className="h-4 w-4 flex-none text-text-faint" aria-hidden />
        <input
          autoFocus
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          placeholder="Rechercher une équipe…"
          aria-label="Rechercher une équipe"
          className="min-w-0 flex-1 bg-transparent text-[13px] font-bold text-text outline-none placeholder:font-normal placeholder:text-text-faint"
        />
        {recherche && (
          <button onClick={() => setRecherche("")} aria-label="Effacer la recherche" className="flex-none text-text-faint hover:text-text">
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </div>

      <div className="max-h-[min(60vh,420px)] overflow-y-auto p-1.5">
        <button
          onClick={() => choisir("")}
          className={cn(
            "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-[13px] font-bold hover:bg-row-hover",
            !valeur && "text-brand-blue-electric",
          )}
        >
          {libelleToutes}
          {!valeur && <Check className="h-4 w-4 flex-none" aria-hidden />}
        </button>

        {visibles.length === 0 && (
          <p className="px-3 py-6 text-center text-[12.5px] text-text-faint">Aucune équipe ne correspond.</p>
        )}

        {visibles.map((g) => {
          const deplie = enRecherche || groupeOuvert === g.id;
          return (
            <div key={g.id}>
              <button
                onClick={() => setGroupeOuvert(deplie && !enRecherche ? null : g.id)}
                aria-expanded={deplie}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left hover:bg-row-hover"
              >
                {deplie ? (
                  <ChevronDown className="h-3.5 w-3.5 flex-none text-text-faint" aria-hidden />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 flex-none text-text-faint" aria-hidden />
                )}
                <span className="flex-1 text-[13px] font-extrabold">{g.label}</span>
                <span className="flex-none text-[11.5px] font-bold tabular-nums text-text-faint">{g.equipes.length}</span>
              </button>

              {deplie &&
                g.equipes.map((e) => (
                  <button
                    key={e.name}
                    onClick={() => choisir(e.name)}
                    className={cn(
                      // Indentation plutôt qu'une couleur par groupe : quinze teintes rendraient la
                      // liste plus difficile à lire, pas plus claire.
                      "flex w-full items-center gap-2 rounded-lg py-2 pl-9 pr-3 text-left text-[12.5px] hover:bg-row-hover",
                      valeur === e.name ? "font-extrabold text-brand-blue-electric" : "font-bold text-text-soft",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{e.name}</span>
                    {estFeminine(e) && (
                      <span className="flex-none rounded bg-surface-alt px-1.5 py-[1px] text-[9.5px] font-extrabold text-text-faint">
                        F
                      </span>
                    )}
                    {valeur === e.name && <Check className="h-3.5 w-3.5 flex-none" aria-hidden />}
                  </button>
                ))}
            </div>
          );
        })}
      </div>
    </>
  );

  return (
    <div ref={conteneur} className={cn("relative", className)}>
      <button
        onClick={() => setOuvert((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={ouvert}
        className="flex h-9 items-center gap-2 rounded-lg border border-border-strong bg-input-bg px-2.5 text-[12.5px] font-bold text-text outline-none hover:bg-surface-sunken focus-visible:border-brand-blue"
      >
        {/* Le bouton dit l'équipe choisie, pas son chemin : « Séniors R2 », jamais
            « Seniors › Séniors R2 » — le groupe a servi à trouver, il n'a plus à être répété. */}
        <span className="max-w-[190px] truncate">{valeur || libelleToutes}</span>
        <ChevronDown className="h-3.5 w-3.5 flex-none text-text-faint" aria-hidden />
      </button>

      {ouvert && (
        <>
          {/* Téléphone : une feuille qui monte du bas, pas un menu flottant de 250 px qu'on vise
              au doigt. Au-delà de `sm`, le popover ancré au bouton. Aucune détection de terminal,
              seulement deux rendus CSS — une tablette qu'on tourne change de forme toute seule. */}
          <div
            className="fixed inset-0 z-[90] bg-black/40 sm:hidden"
            onClick={() => setOuvert(false)}
            role="presentation"
          />
          <div className="fixed inset-x-0 bottom-0 z-[95] flex max-h-[85vh] flex-col overflow-hidden rounded-t-2xl border-t border-border bg-surface shadow-xl sm:hidden">
            <div className="flex items-center justify-between border-b border-divider px-4 py-3">
              <span className="text-[15px] font-extrabold">Choisir une équipe</span>
              <button onClick={() => setOuvert(false)} aria-label="Fermer" className="text-text-faint hover:text-text">
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            {liste}
          </div>

          <div className="absolute left-0 top-full z-[95] mt-1.5 hidden w-[300px] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xl sm:flex">
            {liste}
          </div>
        </>
      )}
    </div>
  );
}
