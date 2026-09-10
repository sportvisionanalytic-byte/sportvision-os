"use client";

// « À couvrir par SportVision » : le geste du CM sur un événement.
//
// Un seul geste, cinq réponses (demande de Fouka, 10/09/2026) : Photo, Vidéo, Photo + vidéo,
// Communication, Autre. Deux circuits existants derrière, et aucun nouveau :
//   • Photo, Vidéo, Photo + vidéo : une PRÉSENCE sur place. Le CM est SportVision, il la décide
//     directement (`cm_definir_couverture`) ; l'OS la voit aussitôt comme une présence planifiée.
//   • Communication, Autre : pas une présence sur le terrain. La demande part à l'OS
//     (`coverage_wishes`, source « initiée par le CM »), qui décidera de la suite.
// Avant ce fichier, le geste n'existait que dans la vue Liste, sous le libellé « SportVision sera
// présent », et sans Communication ni Autre.

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useSession } from "@/lib/session-context";
import { createClient } from "@/lib/supabase/client";
import {
  annulerCouverture,
  definirCouverture,
  TYPE_COUVERTURE_LABELS,
  type TypeCouverture,
} from "@/lib/data/club/calendar";
import { cancelCoverageWish, createCoverageWishes } from "@/lib/data/club/coverageWishes";
import type { CalendarEvent } from "@/lib/types/calendar";

type ChoixCouverture = TypeCouverture | "communication" | "autre";

const CHOIX: { id: ChoixCouverture; libelle: string }[] = [
  { id: "photo", libelle: TYPE_COUVERTURE_LABELS.photo },
  { id: "video", libelle: TYPE_COUVERTURE_LABELS.video },
  { id: "photo_video", libelle: TYPE_COUVERTURE_LABELS.photo_video },
  { id: "communication", libelle: "Communication" },
  { id: "autre", libelle: "Autre" },
];

export const TYPE_DEMANDE_LABELS: Record<string, string> = {
  photo: "Photo",
  video: "Vidéo",
  photo_video: "Photo + vidéo",
  interview: "Interview",
  communication: "Communication",
  autre: "Autre",
};

/** `match:<id>` ou `evenement:<id>` : ce qu'une demande sait référencer. Un entraînement projeté
 *  n'a pas de ligne à lui — il se couvre par une présence, pas par une demande. */
function cibleDemande(ref: string): { matchId?: string; calendarEventId?: string } | null {
  const [genre, id] = ref.split(":");
  if (!id) return null;
  if (genre === "match") return { matchId: id };
  if (genre === "evenement") return { calendarEventId: id };
  return null;
}

export function Couverture({ evenement, onFait }: { evenement: CalendarEvent; onFait: () => void }) {
  const { ctx } = useSession();
  const [ouvert, setOuvert] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const peutDecider = ctx.membership.role === "external_cm";
  const cible = cibleDemande(evenement.id);

  async function agir(action: () => Promise<unknown>, message: string) {
    setEnvoi(true);
    setErreur(null);
    try {
      await action();
      setOuvert(false);
      onFait();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : message);
    } finally {
      setEnvoi(false);
    }
  }

  function choisir(choix: ChoixCouverture) {
    if (choix === "communication" || choix === "autre") {
      if (!cible) return;
      void agir(
        () => createCoverageWishes(createClient(), ctx.organization.id, [{ ...cible, coverageType: choix, priority: "normale" }]),
        "La demande n'a pas pu être envoyée.",
      );
    } else {
      void agir(() => definirCouverture(createClient(), evenement.id, choix), "La couverture n'a pas pu être enregistrée.");
    }
  }

  const stop = (ev: React.MouseEvent) => ev.stopPropagation();

  // ── Une présence est décidée ──
  if (evenement.coverage) {
    return (
      <span className="mt-1 flex flex-wrap items-center gap-2" onClick={stop}>
        <span className="rounded-full bg-gradient-to-r from-brand-blue to-brand-violet px-2.5 py-1 text-[11.5px] font-bold text-white">
          📸 SportVision présent{evenement.coverageType ? ` · ${TYPE_DEMANDE_LABELS[evenement.coverageType] ?? evenement.coverageType}` : ""}
        </span>
        {peutDecider && (evenement.coverage === "prevu" || evenement.coverage === "mission_creee") && (
          <button
            type="button"
            disabled={envoi}
            onClick={() => void agir(() => annulerCouverture(createClient(), evenement.id), "La couverture n'a pas pu être retirée.")}
            className="text-[11.5px] font-bold text-text-faint hover:text-danger-fg disabled:opacity-60"
          >
            Retirer
          </button>
        )}
        {/* Depuis v126, la mission part à la production dès la décision ; la base refuse le
            retrait si une équipe est déjà invitée ou affectée, et le dit. */}
        {evenement.coverage === "mission_creee" && <span className="text-[11.5px] text-text-soft">mission chez la production</span>}
        {erreur && <span className="block w-full text-[11.5px] font-bold text-danger-fg">{erreur}</span>}
      </span>
    );
  }

  // ── Une demande attend l'OS ──
  if (evenement.wish) {
    const wish = evenement.wish;
    return (
      <span className="mt-1 flex flex-wrap items-center gap-2" onClick={stop}>
        <span className="rounded-full border border-brand-violet/60 bg-accent-bg px-2.5 py-1 text-[11.5px] font-bold text-accent-fg">
          À couvrir · {TYPE_DEMANDE_LABELS[wish.type] ?? wish.type}
        </span>
        <span className="text-[11.5px] text-text-soft">demande envoyée à SportVision</span>
        {peutDecider && (
          <button
            type="button"
            disabled={envoi}
            onClick={() => void agir(() => cancelCoverageWish(createClient(), wish.id), "La demande n'a pas pu être retirée.")}
            className="text-[11.5px] font-bold text-text-faint hover:text-danger-fg disabled:opacity-60"
          >
            Retirer
          </button>
        )}
        {erreur && <span className="block w-full text-[11.5px] font-bold text-danger-fg">{erreur}</span>}
      </span>
    );
  }

  if (!peutDecider) return null;

  if (!ouvert) {
    return (
      <span className="mt-1 block" onClick={stop}>
        <Button variant="secondary" className="h-9 w-full px-3 text-[12.5px] sm:w-auto" onClick={() => setOuvert(true)}>
          À couvrir par SportVision
        </Button>
      </span>
    );
  }

  return (
    <span className="mt-1 block" onClick={stop}>
      <span className="block text-[11.5px] font-bold text-text-soft">Comment SportVision couvrira cet événement ?</span>
      <span className="mt-1.5 flex flex-wrap gap-1.5">
        {CHOIX.filter((c) => cible || (c.id !== "communication" && c.id !== "autre")).map((c) => (
          <Button key={c.id} variant="secondary" className="h-9 px-3 text-[12.5px]" loading={envoi} onClick={() => choisir(c.id)}>
            {c.libelle}
          </Button>
        ))}
        <Button variant="tertiary" className="h-9 px-3 text-[12.5px]" onClick={() => setOuvert(false)}>
          Annuler
        </Button>
      </span>
      {erreur && <span className="mt-1 block text-[11.5px] font-bold text-danger-fg">{erreur}</span>}
    </span>
  );
}
