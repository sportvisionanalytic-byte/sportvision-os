"use client";

// Changer les équipes d'un encadrant déjà en place.
//
// ── Le trou que ça bouche (13/09/2026, remarque de Fouka) ──
// Les équipes d'une personne ne se décidaient qu'au moment de l'invitation. Un coach qui prend une
// deuxième équipe en cours de saison, un dirigeant qui passe de deux catégories à quatre : il
// fallait du SQL. L'écran « Coachs & dirigeants » affichait le périmètre sans offrir de le
// modifier.
//
// ── Ce que ça change vraiment ──
// `club_members.teams` n'est pas un affichage : `is_team_educateur` s'en sert pour décider qui peut
// agir sur une équipe. Cocher une équipe ici donne des droits, la décocher les retire. C'est pour
// cela que la v97 a gelé l'auto-élargissement : personne n'ajuste son propre périmètre, et la base
// le refuse quoi qu'affiche cet écran.

import { useRef, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { X } from "lucide-react";
import { useModalA11y } from "@/lib/useModalA11y";
import { useFermetureEchap } from "@/lib/use-fermeture-echap";
import { TeamMultiSelector } from "@/components/ui/TeamMultiSelector";
import { createClient } from "@/lib/supabase/client";
import { setClubMemberTeams } from "@/lib/data/club/users";

interface Props {
  membershipId: string;
  nom: string;
  perimetreActuel: string[];
  equipes: { name: string; categorie?: string | null }[];
  onClose: () => void;
  onEnregistre: () => void;
}

export function PerimetreEquipesModal({
  membershipId,
  nom,
  perimetreActuel,
  equipes,
  onClose,
  onEnregistre,
}: Props) {
  useFermetureEchap(true, onClose);
  const [choix, setChoix] = useState<string[]>(perimetreActuel);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useModalA11y(ref, onClose);

  function enregistrer() {
    setOccupe(true);
    setErreur(null);
    setClubMemberTeams(createClient(), membershipId, choix)
      .then(() => {
        onEnregistre();
        onClose();
      })
      .catch((e: unknown) =>
        setErreur(e instanceof Error ? e.message : "Enregistrement impossible pour le moment."),
      )
      .finally(() => setOccupe(false));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div ref={ref} className="w-full max-w-[480px]" role="dialog" aria-modal="true" aria-label={`Équipes de ${nom}`}>
      <Card className="flex flex-col gap-4 p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[16px] font-extrabold">Équipes de {nom}</h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-text-soft">
              Ces équipes décident de ce que cette personne voit et de ce sur quoi elle peut agir.
              Cochez-en autant que nécessaire.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer" className="text-text-soft hover:text-text">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <TeamMultiSelector equipes={equipes} valeurs={choix} onChange={setChoix} />

        {erreur && <p className="text-[12.5px] font-bold text-danger-fg">{erreur}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={occupe}>
            Annuler
          </Button>
          <Button onClick={enregistrer} loading={occupe} disabled={occupe}>
            Enregistrer
          </Button>
        </div>
      </Card>
      </div>
    </div>
  );
}
