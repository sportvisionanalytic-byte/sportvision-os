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

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";
import { useSession } from "@/lib/session-context";
import { createClient } from "@/lib/supabase/client";
import {
  annulerCouverture,
  definirCouverture,
  TYPE_COUVERTURE_LABELS,
  type TypeCouverture,
} from "@/lib/data/club/calendar";
import {
  cancelCoverageWish,
  cibleDeReference,
  createCoverageWishes,
  rejectCoverageWish,
  ROLES_DEMANDE_PRESENCE,
  selectCoverageWish,
} from "@/lib/data/club/coverageWishes";
import { canAccess } from "@/lib/permissions";
import { RequestPresenceModal } from "@/components/presences/RequestPresenceModal";
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

// Ce qu'une demande sait viser : un match, un événement du club, ou UNE séance d'entraînement
// (`entrainement:<créneau>:<date>`, la même référence que la présence ; v132). Voir cibleDeReference.

export function Couverture({ evenement, onFait }: { evenement: CalendarEvent; onFait: () => void }) {
  const { ctx } = useSession();
  const [ouvert, setOuvert] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [demande, setDemande] = useState(false);
  const envoyee = useRef(false);
  const peutDecider = ctx.membership.role === "external_cm";
  // Le club (président, admin, communication, direction sportive) ne décide pas : il DEMANDE.
  // Même modale que la page Présences, préremplie avec cet événement (refonte du 10/09/2026).
  const peutDemander = !peutDecider && ROLES_DEMANDE_PRESENCE.has(ctx.membership.role) && canAccess(ctx, "presences");
  const cible = cibleDeReference(evenement.id);
  const [refus, setRefus] = useState<string | null>(null);

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

  // ── Une demande attend une réponse ──
  if (evenement.wish) {
    const wish = evenement.wish;
    const demandeDuClub = wish.source === "club_request";
    const enAttente = wish.status === "wished" || wish.status === "reviewing";
    // Le club demande, le CM décide (v132) : c'est ici qu'il répond, sur l'événement lui-même.
    if (peutDecider && demandeDuClub && enAttente) {
      return (
        <span className="mt-1 flex flex-col gap-1.5" onClick={stop}>
          <span className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-brand-violet/60 bg-accent-bg px-2.5 py-1 text-[11.5px] font-bold text-accent-fg">
              Demande du club · {TYPE_DEMANDE_LABELS[wish.type] ?? wish.type}
            </span>
            {refus === null && (
              <>
                <Button
                  className="h-8 px-3 text-[12px]"
                  loading={envoi}
                  onClick={() => void agir(() => selectCoverageWish(createClient(), wish.id), "La demande n'a pas pu être acceptée.")}
                >
                  Accepter
                </Button>
                <Button variant="secondary" className="h-8 px-3 text-[12px]" disabled={envoi} onClick={() => setRefus("")}>
                  Refuser
                </Button>
              </>
            )}
          </span>
          {refus !== null && (
            <span className="flex flex-wrap items-center gap-2">
              <input
                value={refus}
                onChange={(e) => setRefus(e.target.value)}
                placeholder="Motif pour le club (facultatif)"
                aria-label="Motif du refus"
                className="h-8 min-w-0 flex-1 rounded-lg border border-border-strong bg-input-bg px-2.5 text-[12.5px] text-text outline-none focus-visible:border-brand-blue"
              />
              <Button
                variant="secondary"
                className="h-8 px-3 text-[12px]"
                loading={envoi}
                onClick={() => void agir(() => rejectCoverageWish(createClient(), wish.id, refus), "Le refus n'a pas pu être enregistré.")}
              >
                Confirmer le refus
              </Button>
              <button type="button" onClick={() => setRefus(null)} className="text-[11.5px] font-bold text-text-faint hover:text-text">
                Annuler
              </button>
            </span>
          )}
          {erreur && <span className="block w-full text-[11.5px] font-bold text-danger-fg">{erreur}</span>}
        </span>
      );
    }
    return (
      <span className="mt-1 flex flex-wrap items-center gap-2" onClick={stop}>
        <span className="rounded-full border border-brand-violet/60 bg-accent-bg px-2.5 py-1 text-[11.5px] font-bold text-accent-fg">
          À couvrir · {TYPE_DEMANDE_LABELS[wish.type] ?? wish.type}
        </span>
        <span className="text-[11.5px] text-text-soft">
          {demandeDuClub ? "demande envoyée à votre CM SportVision" : "demande envoyée à SportVision"}
        </span>
        {peutDecider && !demandeDuClub && (
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

  if (!peutDecider) {
    if (!peutDemander || !cible) return null;
    return (
      <span className="mt-1 block" onClick={stop}>
        <Button variant="secondary" className="h-9 w-full px-3 text-[12.5px] sm:w-auto" onClick={() => setDemande(true)}>
          Demander une présence SportVision
        </Button>
        {/* Portail : ouverte depuis une carte du calendrier, la modale ne doit pas hériter du cadre
            d'un parent animé (un `transform` ferait de lui le repère de `position: fixed`). */}
        {demande && createPortal(
          <RequestPresenceModal
            supabase={createClient()}
            clubId={ctx.organization.id}
            evenement={{
              ...cible,
              titre: evenement.title,
              startsAt: evenement.startsAt,
              allDay: evenement.allDay,
              kind: evenement.kind,
              teamName: evenement.teamName,
              location: evenement.location,
            }}
            onClose={() => {
              setDemande(false);
              // Recharger à la fermeture, pas à l'envoi : le calendrier rechargé remplacerait ce
              // composant avant que le club lise « Demande envoyée ».
              if (envoyee.current) onFait();
            }}
            onSubmitted={() => {
              envoyee.current = true;
            }}
          />,
          document.body,
        )}
      </span>
    );
  }

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
