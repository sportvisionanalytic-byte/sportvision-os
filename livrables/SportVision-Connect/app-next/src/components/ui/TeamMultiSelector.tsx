"use client";

// Choisir PLUSIEURS équipes — le périmètre d'un encadrant.
//
// ── Pourquoi il fallait ce composant ──
// 13/09/2026, remarque de Fouka : « il y a des coachs qui font plusieurs équipes ou des dirigeants
// qui ont plusieurs équipes ». La base le savait déjà : `club_members.teams` est un tableau, et
// `is_team_educateur` teste l'appartenance du nom de l'équipe à ce tableau. Ce sont les écrans qui
// ne proposaient qu'une seule case : l'invitation envoyait `teams: [uneSeule]`, et rien ne
// permettait ensuite d'en ajouter une deuxième sans passer par du SQL.
//
// ── Ce qu'il ne fait pas ──
// Il n'invente pas de hiérarchie : un coach de U15 A et de U15 B a deux équipes, pas une catégorie.
// Le regroupement affiché vient de lib/teams/groupes.ts, comme pour le sélecteur simple.

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { estFeminine, filtrerGroupes, grouperEquipes, type EquipeChoisissable } from "@/lib/teams/groupes";

interface Props {
  equipes: EquipeChoisissable[];
  /** Noms des équipes retenues. On échange des NOMS, comme le sélecteur simple et comme la base. */
  valeurs: string[];
  onChange: (noms: string[]) => void;
  /** Texte affiché quand rien n'est coché. Un dirigeant sans équipe est un cas normal. */
  libelleVide?: string;
  /** Ouvre la liste DANS le flux plutôt qu'en surimpression. À utiliser dans une fenêtre étroite,
   *  où un panneau flottant recouvre le bouton d'enregistrement placé juste en dessous. */
  dansLeFlux?: boolean;
  className?: string;
}

export function TeamMultiSelector({
  equipes,
  valeurs,
  onChange,
  libelleVide = "Aucune équipe (dirigeant du club)",
  dansLeFlux = false,
  className,
}: Props) {
  const [ouvert, setOuvert] = useState(false);
  const [recherche, setRecherche] = useState("");
  const conteneur = useRef<HTMLDivElement>(null);

  const groupes = useMemo(() => grouperEquipes(equipes), [equipes]);
  const visibles = useMemo(() => filtrerGroupes(groupes, recherche), [groupes, recherche]);

  useEffect(() => {
    if (!ouvert) return;
    const auClic = (e: MouseEvent) => {
      if (conteneur.current && !conteneur.current.contains(e.target as Node)) setOuvert(false);
    };
    const auClavier = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // On ne laisse pas Échap traverser jusqu'à la modale qui nous contient : fermer la liste
        // et fermer la fenêtre d'invitation d'un même appui ferait perdre la saisie.
        e.stopPropagation();
        setOuvert(false);
      }
    };
    document.addEventListener("mousedown", auClic);
    document.addEventListener("keydown", auClavier, true);
    return () => {
      document.removeEventListener("mousedown", auClic);
      document.removeEventListener("keydown", auClavier, true);
    };
  }, [ouvert]);

  function basculer(nom: string) {
    onChange(valeurs.includes(nom) ? valeurs.filter((v) => v !== nom) : [...valeurs, nom]);
  }

  return (
    <div ref={conteneur} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOuvert((o) => !o)}
        aria-expanded={ouvert}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-divider bg-surface px-3.5 py-2.5 text-left text-[13px] font-semibold"
      >
        <span className={cn("truncate", valeurs.length === 0 && "text-text-soft")}>
          {valeurs.length === 0 ? libelleVide : valeurs.join(", ")}
        </span>
        <ChevronDown className={cn("h-4 w-4 flex-none text-text-soft transition-transform", ouvert && "rotate-180")} aria-hidden />
      </button>

      {valeurs.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {valeurs.map((nom) => (
            <span key={nom} className="flex items-center gap-1 rounded-full bg-surface-sunken px-2.5 py-1 text-[11.5px] font-bold">
              {nom}
              <button
                type="button"
                onClick={() => basculer(nom)}
                aria-label={`Retirer ${nom}`}
                className="text-text-soft hover:text-text"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </span>
          ))}
        </div>
      )}

      {ouvert && (
        <div
          className={cn(
            "mt-1.5 max-h-[320px] w-full overflow-y-auto rounded-xl border border-divider bg-surface",
            dansLeFlux ? "relative" : "absolute z-30 shadow-lg",
          )}
        >
          <div className="sticky top-0 flex items-center gap-2 border-b border-divider bg-surface px-3 py-2">
            <Search className="h-3.5 w-3.5 flex-none text-text-soft" aria-hidden />
            <input
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder="Rechercher une équipe"
              aria-label="Rechercher une équipe"
              className="w-full bg-transparent text-[13px] outline-none"
            />
          </div>
          {/* 13/09/2026 — Le panneau est en position absolue : ouvert, il recouvre le bouton
              principal du formulaire qui le contient (« Créer l'invitation », « Enregistrer »).
              Un clic à côté le referme, mais rien ne le disait : on offre une sortie visible,
              avec le compte de ce qui est retenu. */}
          <div className="sticky top-[41px] z-10 flex items-center justify-between gap-2 border-b border-divider bg-surface px-3.5 py-1.5">
            <span className="text-[11.5px] font-bold text-text-soft">
              {valeurs.length === 0
                ? "Aucune équipe cochée"
                : `${valeurs.length} équipe${valeurs.length > 1 ? "s" : ""} cochée${valeurs.length > 1 ? "s" : ""}`}
            </span>
            <button
              type="button"
              onClick={() => setOuvert(false)}
              className="rounded-lg bg-surface-sunken px-2.5 py-1 text-[11.5px] font-bold hover:brightness-95"
            >
              Terminé
            </button>
          </div>
          {visibles.length === 0 ? (
            <p className="px-3.5 py-3 text-[12.5px] text-text-soft">Aucune équipe ne correspond.</p>
          ) : (
            visibles.map((groupe) => (
              <div key={groupe.id}>
                <div className="bg-surface-sunken px-3.5 py-1.5 text-[11px] font-extrabold uppercase tracking-wide text-text-soft">
                  {groupe.label}
                </div>
                {groupe.equipes.map((eq) => {
                  const coche = valeurs.includes(eq.name);
                  return (
                    <button
                      key={eq.name}
                      type="button"
                      onClick={() => basculer(eq.name)}
                      aria-pressed={coche}
                      className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[13px] hover:bg-row-hover"
                    >
                      <span
                        className={cn(
                          "flex h-4 w-4 flex-none items-center justify-center rounded border",
                          coche ? "border-brand-blue bg-brand-blue text-white" : "border-divider",
                        )}
                        aria-hidden
                      >
                        {coche && <Check className="h-3 w-3" />}
                      </span>
                      <span className="truncate font-semibold">{eq.name}</span>
                      {estFeminine(eq) && <span className="flex-none text-[11px] text-text-soft">F</span>}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
