"use client";

// « Est-ce bien vous ? » (migration v387, 01/10/2026)
//
// Le club a déjà créé la fiche du sportif, avec sa photo de référence. L'arrivant se reconnaît dans
// la liste de son équipe au lieu de tout resaisir. Il clique, le club confirme, et la fiche lui
// appartient — avec les photos qui l'attendaient.
//
// TROIS CHOSES QUE CET ÉCRAN DIT SANS DÉTOUR, parce que la personne a le droit de les savoir :
//   • rien n'est à elle tant que le club n'a pas confirmé ;
//   • un nom mal orthographié se corrige APRÈS, et c'est elle qui aura raison ;
//   • la photo déjà déposée ne sert à rien tant qu'elle n'a pas donné son autorisation de
//     reconnaissance, qui se demande plus tard et séparément.

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  fichesARevendiquer,
  revendiquerFiche,
  type FicheARevendiquer,
} from "@/lib/supabase/revendication";

export function RevendiquerFiche({
  code,
  qualite,
  nomApproximatif,
}: {
  code: string;
  /** « joueur » : c'est moi. « parent » : c'est mon enfant. La base trace la différence, et pour un
   *  parent elle alimente la file de rattachements que le club connaît déjà. */
  qualite: "joueur" | "parent";
  nomApproximatif?: string;
}) {
  const [fiches, setFiches] = useState<FicheARevendiquer[] | null>(null);
  const [enCours, setEnCours] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let vivant = true;
    fichesARevendiquer(createClient(), code, nomApproximatif)
      .then((r) => {
        if (vivant) setFiches(r);
      })
      .catch(() => {
        if (vivant) setFiches([]);
      });
    return () => {
      vivant = false;
    };
  }, [code, nomApproximatif]);

  async function revendiquer(f: FicheARevendiquer) {
    setEnCours(f.playerId);
    setErreur(null);
    try {
      const m = await revendiquerFiche(createClient(), f.playerId, code, qualite);
      setMessage(m);
      setFiches((liste) => (liste ?? []).filter((x) => x.playerId !== f.playerId));
    } catch (e) {
      setErreur(
        e instanceof Error && e.message ? e.message : "La demande n'a pas pu être envoyée.",
      );
    } finally {
      setEnCours(null);
    }
  }

  if (message) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-5">
        <div className="text-[14.5px] font-bold">Demande envoyée</div>
        <p className="mt-1.5 text-[13px] leading-relaxed text-text-soft">{message}</p>
        <p className="mt-2.5 text-[12.5px] leading-relaxed text-text-faint">
          Vous pourrez corriger l&apos;orthographe du nom une fois la fiche confirmée : c&apos;est
          vous qui avez raison, pas la saisie du club.
        </p>
      </div>
    );
  }

  // Rien à proposer : l'écran disparaît. Un encadré « aucune fiche trouvée » ferait douter de la
  // suite du parcours, qui est parfaitement normale — le club n'a simplement rien pré-créé.
  if (!fiches || fiches.length === 0) return null;

  const titre =
    qualite === "parent"
      ? "Votre enfant est peut-être déjà dans cette équipe"
      : "Vous êtes peut-être déjà dans cette équipe";

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="text-[14.5px] font-bold">{titre}</div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-text-soft">
        {qualite === "parent"
          ? "Le club a déjà préparé ces fiches. Si vous reconnaissez votre enfant, choisissez-le plutôt que de tout resaisir."
          : "Le club a déjà préparé ces fiches. Si vous vous reconnaissez, choisissez votre nom plutôt que de tout resaisir."}{" "}
        Le nom peut être mal orthographié, vous le corrigerez ensuite.
      </p>

      {erreur && <p className="mt-3 text-[12.5px] font-bold text-danger-fg">{erreur}</p>}

      <ul className="mt-3.5 flex flex-col gap-2">
        {fiches.map((f) => (
          <li
            key={f.playerId}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-bg px-3.5 py-3"
          >
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-bold">
                {f.prenom} {f.nom}
              </div>
              <div className="text-[12px] text-text-faint">
                né en {f.anneeNaissance}
                {f.equipeNom && ` · ${f.equipeNom}`}
                {f.aUnePhoto && " · une photo attend sur cette fiche"}
              </div>
            </div>
            <button
              type="button"
              disabled={enCours !== null}
              onClick={() => revendiquer(f)}
              className="rounded-sv bg-gradient-to-br from-brand-blue to-brand-violet px-4 py-2.5 text-[13px] font-bold text-white shadow-sv-button hover:brightness-[1.06] disabled:cursor-wait disabled:opacity-70"
            >
              {enCours === f.playerId
                ? "Envoi…"
                : qualite === "parent"
                  ? "C'est mon enfant"
                  : "C'est moi"}
            </button>
          </li>
        ))}
      </ul>

      <p className="mt-3.5 text-[12px] leading-relaxed text-text-faint">
        Le club vérifie votre demande avant de vous donner accès à la fiche : personne ne peut
        prendre celle de quelqu&apos;un d&apos;autre. La photo déjà déposée ne servira à retrouver
        les photos de match qu&apos;après votre autorisation de reconnaissance, qui vous sera
        demandée séparément.
      </p>
    </div>
  );
}
