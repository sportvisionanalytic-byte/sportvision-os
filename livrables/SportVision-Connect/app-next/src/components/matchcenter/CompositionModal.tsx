"use client";

import { useEffect, useMemo, useState } from "react";
import { EyeOff, Users, X } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { useFermetureEchap } from "@/lib/use-fermeture-echap";
import { fetchTeamRoster, type TeamRosterPlayer } from "@/lib/data/club/team-detail";
import {
  enregistrerComposition,
  fetchComposition,
  type RoleConvocation,
} from "@/lib/data/club/composition";

// « La composition du match » (v242, 21/09/2026)
//
// Fouka : « s'il y a un match à venir, qu'il puisse mettre la composition en avance. Les joueurs
// ne doivent pas la voir, mais moi, community manager, je dois pouvoir voir la composition ou
// alors les 14 convoqués. »
//
// Deux partis pris d'écran :
//
// 1. Un coach ne compose pas en remplissant un formulaire, il parcourt son effectif et décide pour
//    chacun. L'écran est donc la liste de l'équipe, et chaque ligne porte ses trois choix. Rien à
//    faire glisser, rien à ordonner : sur un téléphone, au bord du terrain, c'est ce qui marche.
// 2. La phrase « les joueurs ne voient pas cette composition » est affichée, pas sous-entendue.
//    C'est la première question que se posera celui qui prépare son onze la veille, et une
//    garantie qu'on ne lui donne nulle part ailleurs vaut un doute permanent.

const ROLES: Array<{ cle: RoleConvocation; court: string; long: string }> = [
  { cle: "titulaire", court: "Titulaire", long: "Il commence le match" },
  { cle: "remplacant", court: "Remplaçant", long: "Il est sur le banc" },
  { cle: "reserve", court: "Non retenu", long: "Convoqué, hors groupe" },
];

interface CompositionModalProps {
  matchId: string;
  teamId: string | null;
  titre: string;
  /** Vrai si la personne qui regarde a le droit de composer. La base tranche de toute façon. */
  peutComposer: boolean;
  onClose: () => void;
  onEnregistre?: () => void;
}

export function CompositionModal({ matchId, teamId, titre, peutComposer, onClose, onEnregistre }: CompositionModalProps) {
  useFermetureEchap(true, onClose);
  const [effectif, setEffectif] = useState<TeamRosterPlayer[] | null>(null);
  const [choix, setChoix] = useState<Map<string, RoleConvocation>>(new Map());
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let vivant = true;
    const supabase = createClient();
    Promise.all([
      teamId ? fetchTeamRoster(supabase, teamId) : Promise.resolve([]),
      fetchComposition(supabase, matchId).catch(() => []),
    ])
      .then(([roster, compo]) => {
        if (!vivant) return;
        setEffectif(roster);
        setChoix(new Map(compo.map((c) => [c.playerId, c.role])));
      })
      .catch((e) => vivant && setErreur(e instanceof Error ? e.message : "Chargement impossible."));
    return () => {
      vivant = false;
    };
  }, [matchId, teamId]);

  const compte = useMemo(() => {
    let titulaires = 0;
    let remplacants = 0;
    for (const r of choix.values()) {
      if (r === "titulaire") titulaires++;
      else if (r === "remplacant") remplacants++;
    }
    return { titulaires, remplacants, total: titulaires + remplacants };
  }, [choix]);

  function basculer(playerId: string, role: RoleConvocation) {
    setChoix((prev) => {
      const suite = new Map(prev);
      // Recliquer sur le même choix le retire : c'est ainsi qu'on sort un joueur du groupe sans
      // chercher un bouton « enlever » de plus.
      if (suite.get(playerId) === role) suite.delete(playerId);
      else suite.set(playerId, role);
      return suite;
    });
  }

  async function enregistrer() {
    setEnCours(true);
    setErreur(null);
    try {
      const groupe = [...choix.entries()].map(([player_id, role], i) => ({ player_id, role, ordre: i + 1 }));
      await enregistrerComposition(createClient(), matchId, groupe);
      onEnregistre?.();
      onClose();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "L'enregistrement a échoué.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex justify-end bg-[rgba(7,10,23,.55)]">
      <Card className="animate-svfade flex h-full w-full max-w-[480px] flex-col gap-4 overflow-y-auto rounded-none p-5 shadow-sv-panel sm:rounded-l-sv-panel sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[11px] font-extrabold uppercase tracking-[.06em] text-text-faint">Composition</span>
            <h2 className="text-[19px] font-extrabold leading-tight tracking-tight">{titre}</h2>
          </div>
          <button
            aria-label="Fermer"
            onClick={onClose}
            className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-text-faint hover:bg-surface-sunken hover:text-text"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="flex items-start gap-2.5 rounded-xl bg-surface-alt px-3.5 py-3">
          <EyeOff className="mt-[1px] h-4 w-4 flex-none text-text-faint" aria-hidden />
          <span className="text-[12px] text-text-soft">
            Les joueurs et les familles <b>ne voient pas</b> cette composition. Seuls le staff du club
            et l&apos;équipe SportVision y ont accès.
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
          <span className="rounded-lg bg-success-bg px-2.5 py-1 font-extrabold text-success-fg">
            {compte.titulaires} titulaire{compte.titulaires > 1 ? "s" : ""}
          </span>
          <span className="rounded-lg bg-surface-alt px-2.5 py-1 font-bold text-text-soft">
            {compte.remplacants} remplaçant{compte.remplacants > 1 ? "s" : ""}
          </span>
          <span className="text-text-faint">·</span>
          <span className="font-bold text-text-soft">{compte.total} convoqué{compte.total > 1 ? "s" : ""}</span>
        </div>

        {erreur && <span className="text-[12px] font-bold text-danger-fg">{erreur}</span>}

        {effectif === null ? (
          <span className="text-[13px] text-text-soft">Chargement de l&apos;effectif…</span>
        ) : effectif.length === 0 ? (
          <div className="flex items-start gap-2.5 rounded-xl bg-surface-alt px-3.5 py-3">
            <Users className="mt-[1px] h-4 w-4 flex-none text-text-faint" aria-hidden />
            <span className="text-[12.5px] text-text-soft">
              Aucun joueur rattaché à cette équipe. Ajoutez votre effectif depuis la fiche de
              l&apos;équipe, puis revenez composer.
            </span>
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {effectif.map((j) => {
              const role = choix.get(j.id);
              return (
                <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-alt px-3 py-2.5">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-[13px] font-bold text-text">
                      {j.firstName} {j.lastName}
                    </span>
                    {role && (
                      <span className="text-[11px] text-text-faint">
                        {ROLES.find((r) => r.cle === role)?.long}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-none gap-1">
                    {ROLES.map((r) => (
                      <button
                        key={r.cle}
                        type="button"
                        disabled={!peutComposer || enCours}
                        onClick={() => basculer(j.id, r.cle)}
                        className={
                          role === r.cle
                            ? "rounded-lg bg-accent px-2.5 py-1.5 text-[11px] font-extrabold text-surface disabled:opacity-50"
                            : "rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-bold text-text-soft hover:text-text disabled:opacity-50"
                        }
                      >
                        {r.court}
                      </button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {peutComposer && (
          <div className="mt-auto flex items-center gap-2 pt-2">
            <Button disabled={enCours || effectif === null} onClick={enregistrer}>
              Enregistrer la composition
            </Button>
            <Button variant="secondary" disabled={enCours} onClick={onClose}>
              Annuler
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
