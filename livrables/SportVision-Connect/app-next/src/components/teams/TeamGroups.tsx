"use client";

// Les équipes d'un club, repliées par catégorie.
//
// ── Le problème ──
// SF Villemomble a 43 équipes. L'écran les alignait en 43 cartes de même poids, chacune répétant
// « Générer un lien pour inviter des joueurs ». Trouver « U12 Espoir 2 » demandait de balayer la
// page entière, et l'action la plus rare y était répétée 43 fois — donc plus visible que le nom
// des équipes.
//
// ── Ce que ce composant fait, et ne fait pas ──
// Il REGROUPE et RECHERCHE. Il ne redéfinit pas ce qu'est une carte d'équipe : `TeamCard` reste
// seule responsable de son contenu, et le jour où l'on allègera cette carte, ce fichier n'aura pas
// à changer.
//
// La règle de regroupement vient de `lib/teams/groupes.ts`, la même que le sélecteur du
// calendrier. Deux implémentations du même classement finiraient par ne plus s'accorder.

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search, X } from "lucide-react";
import type { Team } from "@/lib/types/teams";
import { TeamCard } from "@/components/teams/TeamCard";
import { filtrerGroupes, grouperEquipes } from "@/lib/teams/groupes";
import { cn } from "@/lib/cn";

export function TeamGroups({ teams }: { teams: Team[] }) {
  const [recherche, setRecherche] = useState("");
  // Un seul groupe ouvert à la fois : deux, et on retrouve la page à défiler qu'on veut éviter.
  const [ouvert, setOuvert] = useState<string | null>(null);

  const groupes = useMemo(
    () => grouperEquipes(teams.map((t) => ({ name: t.name, categorie: t.category }))),
    [teams],
  );
  const visibles = useMemo(() => filtrerGroupes(groupes, recherche), [groupes, recherche]);
  const enRecherche = recherche.trim().length > 0;

  // Les équipes complètes, retrouvées par leur nom : `grouperEquipes` ne manipule que l'identité
  // minimale d'une équipe, la carte a besoin de tout le reste.
  const parNom = useMemo(() => new Map(teams.map((t) => [t.name, t])), [teams]);

  // En dessous d'une douzaine d'équipes, replier dessert : tout tient à l'écran, et l'accordéon
  // ajoute un clic pour rien. Le seuil vaut pour n'importe quel club, il n'est pas propre à un
  // effectif particulier.
  if (teams.length <= 12) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {teams.map((team) => (
          <TeamCard key={team.id} team={team} />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 rounded-xl border border-border-strong bg-input-bg px-3 py-2">
        <Search className="h-4 w-4 flex-none text-text-faint" aria-hidden />
        <input
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          placeholder="Rechercher une équipe…"
          aria-label="Rechercher une équipe"
          className="min-w-0 flex-1 bg-transparent text-[13px] font-bold text-text outline-none placeholder:font-normal placeholder:text-text-faint"
        />
        {recherche && (
          <button onClick={() => setRecherche("")} aria-label="Effacer la recherche" className="flex-none text-text-faint hover:text-text">
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>

      {visibles.length === 0 && (
        <p className="px-1 py-6 text-center text-[13px] text-text-faint">Aucune équipe ne correspond.</p>
      )}

      {visibles.map((g) => {
        const deplie = enRecherche || ouvert === g.id;
        return (
          <div key={g.id} className="overflow-hidden rounded-xl border border-border">
            <button
              onClick={() => setOuvert(deplie && !enRecherche ? null : g.id)}
              aria-expanded={deplie}
              className="flex w-full items-center gap-2.5 px-4 py-3 text-left hover:bg-row-hover"
            >
              {deplie ? (
                <ChevronDown className="h-4 w-4 flex-none text-text-faint" aria-hidden />
              ) : (
                <ChevronRight className="h-4 w-4 flex-none text-text-faint" aria-hidden />
              )}
              <span className="flex-1 text-[14px] font-extrabold">{g.label}</span>
              <span
                className={cn(
                  "flex-none rounded-full px-2 py-[1px] text-[11.5px] font-extrabold tabular-nums",
                  deplie ? "bg-brand-blue/15 text-brand-blue-electric" : "bg-surface-alt text-text-faint",
                )}
              >
                {g.equipes.length}
              </span>
            </button>

            {deplie && (
              <div className="grid grid-cols-1 gap-4 border-t border-divider p-4 sm:grid-cols-2 lg:grid-cols-3">
                {g.equipes.map((e) => {
                  const team = parNom.get(e.name);
                  return team ? <TeamCard key={team.id} team={team} /> : null;
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
