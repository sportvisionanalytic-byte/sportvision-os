"use client";

// « On lui PROPOSE sa photo de profil, il gère » (Fouka, 01/10/2026, migration v386).
//
// SportVision photographie les encadrants sur le terrain comme elle photographie les joueurs. On a
// donc leur portrait, et il ferait une bonne photo de profil. Mais une photo de quelqu'un qui
// apparaît sur son profil sans qu'il l'ait acceptée n'est pas un service rendu : c'est une
// publication décidée à sa place.
//
// Cette carte est donc une PROPOSITION, et elle n'apparaît que s'il y en a une en attente. Deux
// boutons de poids égal : accepter, refuser. Pas de croix minuscule dans un coin, pas de « plus
// tard » qui fait revenir la question. Un refus efface le fichier, et cette photo-là ne sera jamais
// reproposée.

import { useCallback, useEffect, useState } from "react";
import { Check, UserCircle, X } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import {
  mesPhotosProfilProposees,
  repondrePhotoProfil,
  signerPhotos,
  type PhotoProfilProposee,
} from "@/lib/data/club/effectif";

export function PhotoProfilProposeeCard() {
  const [propositions, setPropositions] = useState<PhotoProfilProposee[] | null>(null);
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const [enCours, setEnCours] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback(async () => {
    const supabase = createClient();
    const liste = await mesPhotosProfilProposees(supabase);
    setPropositions(liste);
    setUrls(await signerPhotos(supabase, liste.map((p) => p.storagePath)));
  }, []);

  useEffect(() => {
    let vivant = true;
    charger().catch(() => {
      if (vivant) setPropositions([]);
    });
    return () => {
      vivant = false;
    };
  }, [charger]);

  async function repondre(id: string, accepte: boolean) {
    setEnCours(id);
    setErreur(null);
    try {
      await repondrePhotoProfil(createClient(), id, accepte);
      await charger();
    } catch (e) {
      setErreur(e instanceof Error && e.message ? e.message : "Enregistrement impossible pour le moment.");
    } finally {
      setEnCours(null);
    }
  }

  // Aucune proposition : aucune carte. Un encadré « rien à faire » prend la place de ce qui compte.
  if (!propositions || propositions.length === 0) return null;

  return (
    <Card className="flex flex-col gap-4 px-5 py-5">
      <div className="flex items-start gap-3">
        <UserCircle className="mt-0.5 h-4 w-4 shrink-0 text-brand-blue-electric" aria-hidden />
        <div>
          <div className="text-[14px] font-extrabold">
            Une photo vous est proposée pour votre profil
          </div>
          <p className="mt-1 max-w-[560px] text-[12.5px] leading-relaxed text-text-soft">
            Elle a été prise lors d&apos;une captation. Vous décidez : tant que vous ne
            l&apos;acceptez pas, elle n&apos;apparaît nulle part. Si vous la refusez, elle est
            effacée et ne vous sera pas reproposée.
          </p>
        </div>
      </div>

      <ul className="flex flex-col gap-3">
        {propositions.map((p) => (
          <li
            key={p.id}
            className="flex flex-wrap items-center gap-4 rounded-sv border border-border-strong/60 bg-surface-alt px-4 py-3"
          >
            {urls.get(p.storagePath) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={urls.get(p.storagePath)}
                alt="La photo qui vous est proposée"
                className="h-20 w-20 rounded-sv object-cover"
              />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-sv bg-surface">
                <UserCircle className="h-6 w-6 text-text-soft" aria-hidden />
              </div>
            )}
            <div className="min-w-[180px] flex-1">
              <div className="text-[13px] font-bold">{p.club}</div>
              {p.commentaire && (
                <p className="mt-0.5 text-[12px] leading-relaxed text-text-soft">{p.commentaire}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => repondre(p.id, true)}
                loading={enCours === p.id}
                disabled={enCours !== null}
              >
                <Check className="h-3.5 w-3.5" aria-hidden />
                L&apos;utiliser
              </Button>
              <Button
                variant="secondary"
                onClick={() => repondre(p.id, false)}
                disabled={enCours !== null}
              >
                <X className="h-3.5 w-3.5" aria-hidden />
                Refuser
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {erreur && <p className="text-[12.5px] font-semibold text-status-danger">{erreur}</p>}
    </Card>
  );
}
