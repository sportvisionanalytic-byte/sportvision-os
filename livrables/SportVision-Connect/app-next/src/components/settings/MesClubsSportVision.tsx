"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { switchActiveSpace } from "@/lib/supabase/actions";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

// « Clubs que j'accompagne » — ce que voit un CM SportVision à la place de « Mon organisation ».
//
// Le vocabulaire compte ici (Fouka, 08/09/2026) : un CM n'appartient pas au club, il l'accompagne
// pour SportVision. « Mon organisation » lui faisait croire l'inverse, et n'en montrait qu'un seul
// alors qu'il peut en suivre plusieurs.
//
// La liste vient de `cm_espaces_clubs()`, la même source que le sélecteur d'espace en haut de la
// barre latérale : deux listes de clubs autorisés pour un même CM finiraient par diverger.

interface ClubAccompagne {
  club_id: string;
  nom: string;
  logo_url: string | null;
  origine: string;
  role: string | null;
  actif: boolean;
}

const ROLE_LB: Record<string, string> = {
  principal: "CM principal",
  secondaire: "CM secondaire",
};

const ORIGINE_LB: Record<string, string> = {
  affectation: "Affecté par SportVision",
  agence: "Accès agence",
  super: "Accès étendu",
};

function initiales(nom: string): string {
  return nom
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((m) => m[0]!.toUpperCase())
    .join("");
}

export function MesClubsSportVision() {
  const router = useRouter();
  const [clubs, setClubs] = useState<ClubAccompagne[] | null>(null);
  const [ouverture, setOuverture] = useState<string | null>(null);

  useEffect(() => {
    let vivant = true;
    createClient()
      .rpc("cm_espaces_clubs")
      .then(({ data }) => {
        if (vivant) setClubs((data as ClubAccompagne[] | null) ?? []);
      });
    return () => {
      vivant = false;
    };
  }, []);

  async function ouvrir(club: ClubAccompagne) {
    setOuverture(club.club_id);
    await switchActiveSpace({ kind: "delegated_club", id: club.club_id });
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-[17px] font-extrabold tracking-tight">Clubs que j&apos;accompagne</h2>
        <p className="mt-1 text-[13px] text-text-soft">
          Vous gérez ces clubs pour SportVision. Vous n&apos;en êtes pas membre : leurs présidents en restent
          propriétaires.
        </p>
      </div>

      {clubs === null ? (
        <Card className="p-8 text-center text-[13.5px] text-text-soft">Chargement…</Card>
      ) : clubs.length === 0 ? (
        <Card className="p-8 text-center text-[13.5px] text-text-soft">
          Aucun club ne vous est confié pour le moment. Votre responsable vous en affectera un depuis
          l&apos;OS SportVision.
        </Card>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-border">
            {clubs.map((club) => (
              <li key={club.club_id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                {club.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={club.logo_url}
                    alt=""
                    className="h-10 w-10 flex-none rounded-lg object-contain"
                  />
                ) : (
                  <span className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-gradient-to-br from-brand-blue-electric to-brand-violet text-[12px] font-extrabold text-white">
                    {initiales(club.nom)}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-extrabold">{club.nom}</span>
                  <span className="block text-[12px] text-text-soft">
                    {ROLE_LB[club.role ?? ""] ?? ORIGINE_LB[club.origine] ?? "Accès SportVision"}
                    {!club.actif && " · accès suspendu"}
                  </span>
                </span>
                <Button
                  variant="secondary"
                  className="h-9 flex-none px-4 text-[12.5px]"
                  loading={ouverture === club.club_id}
                  onClick={() => ouvrir(club)}
                >
                  Gérer le club
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
