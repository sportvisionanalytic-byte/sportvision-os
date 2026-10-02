// LA GRILLE DE VISAGES (02/10/2026)
//
// Fouka : « il faut voir d'un coup d'œil qui n'a pas encore de photo ». Sur vingt-sept catégories,
// une liste ne le dit pas : il faut parcourir ligne à ligne. Une grille de vignettes le dit en une
// seconde — les fiches sans photo sont grises et portent un bouton, les autres montrent le visage.
//
// CE QUE CET ÉCRAN NE FAIT PAS, ET C'EST VOULU. Il ne calcule aucune empreinte et n'en affiche
// aucune. Déposer une photo n'enregistre qu'une PHOTO, qui attend l'accord de la famille et la
// date de naissance. La grille montre donc « photo déposée », jamais « reconnu ».
//
// POURQUOI LE CHARGEMENT EST GROUPÉ. Les photos se lisent par sportif (`photos_effectif_du_sportif`
// est bornée à un joueur, c'est ce qui la rend sûre). Pour une grille, on lance les lectures en
// parallèle et on signe les URL en UNE fois : vingt-sept allers-retours séquentiels feraient une
// grille qui se remplit pendant dix secondes.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, ImageOff, Loader2, X } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { createClient } from "@/lib/supabase/client";
import {
  PHOTOS_MAX,
  deposerPhotoEffectif,
  listerPhotosEffectif,
  refuserPhoto,
  retirerPhotoEffectif,
  signerPhotos,
  type PhotoEffectif,
} from "@/lib/data/club/effectif";
import type { TeamRosterPlayer } from "@/lib/data/club/team-detail";

interface Vignette {
  photos: PhotoEffectif[];
  /** L'adresse signée de CHAQUE photo, par identifiant : on en affiche une sur la grille, et
   *  toutes dans le panneau d'un sportif. */
  urls: Map<string, string>;
}

export function GrilleEffectif({
  roster,
  peutDeposerPhoto,
}: {
  roster: TeamRosterPlayer[];
  peutDeposerPhoto: boolean;
}) {
  const [etat, setEtat] = useState<Map<string, Vignette>>(new Map());
  const [chargement, setChargement] = useState(true);
  const [enCours, setEnCours] = useState<string | null>(null);
  /** Le sportif dont on regarde toutes les photos, ouvert sous la grille. */
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback(async () => {
    if (!roster.length) {
      setEtat(new Map());
      setChargement(false);
      return;
    }
    setChargement(true);
    try {
      const supabase = createClient();
      const paires = await Promise.all(
        roster.map(async (p) => [p.id, await listerPhotosEffectif(supabase, p.id)] as const),
      );
      // Une seule signature pour toute la grille : on rassemble les CHEMINS puis on demande.
      // `signerPhotos` prend des chemins et rend une table indexée par chemin, pas par
      // identifiant — vérifié dans sa signature avant d'écrire ces lignes.
      const chemins = paires.flatMap(([, photos]) => photos.map((ph) => ph.storagePath));
      const urls = chemins.length ? await signerPhotos(supabase, chemins) : new Map<string, string>();
      const m = new Map<string, Vignette>();
      for (const [id, photos] of paires) {
        const parPhoto = new Map<string, string>();
        for (const ph of photos) {
          const u = urls.get(ph.storagePath);
          if (u) parPhoto.set(ph.id, u);
        }
        m.set(id, { photos, urls: parPhoto });
      }
      setEtat(m);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Les photos n'ont pas pu être chargées.");
    } finally {
      setChargement(false);
    }
  }, [roster]);

  useEffect(() => {
    void charger();
  }, [charger]);

  const sansPhoto = roster.filter((p) => !(etat.get(p.id)?.photos.length ?? 0)).length;

  if (!roster.length) return null;

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-[14px] font-extrabold">Photos de référence</div>
        <div className="text-[12px] text-text-soft">
          {chargement ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> chargement…
            </span>
          ) : sansPhoto === 0 ? (
            `${roster.length} sportif${roster.length > 1 ? "s" : ""}, tous ont leur photo`
          ) : (
            `${sansPhoto} sur ${roster.length} n'${sansPhoto > 1 ? "ont" : "a"} pas encore de photo`
          )}
        </div>
      </div>

      {erreur ? (
        <div className="rounded-sv border border-danger/40 bg-danger/5 px-3.5 py-2.5 text-[12.5px] text-danger">
          {erreur}
        </div>
      ) : null}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-3">
        {roster.map((p) => (
          <CaseJoueur
            key={p.id}
            joueur={p}
            vignette={etat.get(p.id)}
            peutDeposer={peutDeposerPhoto}
            occupe={enCours === p.id}
            ouvert={ouvert === p.id}
            onOuvrir={() => setOuvert((v) => (v === p.id ? null : p.id))}
            onDepot={async (fichiers) => {
              setErreur(null);
              const dejaLa = etat.get(p.id)?.photos.length ?? 0;
              const place = PHOTOS_MAX - dejaLa;
              if (place <= 0) {
                setErreur(`${p.firstName} ${p.lastName} : ${PHOTOS_MAX} photos au maximum.`);
                return;
              }
              // On dépose une par une et on NOMME celle qui échoue : « le dépôt a échoué » sur
              // cinq fichiers ne dit pas lequel, et oblige à tout recommencer.
              setEnCours(p.id);
              try {
                const supabase = createClient();
                for (const f of fichiers.slice(0, place)) {
                  const refus = refuserPhoto(f);
                  if (refus) {
                    setErreur(`${p.firstName} ${p.lastName} — ${f.name} : ${refus}`);
                    continue;
                  }
                  await deposerPhotoEffectif(supabase, p.id, f);
                }
                if (fichiers.length > place) {
                  setErreur(
                    `${p.firstName} ${p.lastName} : ${PHOTOS_MAX} photos au maximum, seules les ${place} premières ont été ajoutées.`,
                  );
                }
                await charger();
              } catch (e) {
                setErreur(
                  `${p.firstName} ${p.lastName} : ${e instanceof Error ? e.message : "le dépôt a échoué."}`,
                );
              } finally {
                setEnCours(null);
              }
            }}
            onRetirer={async (photoId) => {
              setErreur(null);
              setEnCours(p.id);
              try {
                await retirerPhotoEffectif(createClient(), photoId);
                await charger();
              } catch (e) {
                setErreur(
                  `${p.firstName} ${p.lastName} : ${e instanceof Error ? e.message : "le retrait a échoué."}`,
                );
              } finally {
                setEnCours(null);
              }
            }}
          />
        ))}
      </div>
    </Card>
  );
}

function CaseJoueur({
  joueur,
  vignette,
  peutDeposer,
  occupe,
  ouvert,
  onOuvrir,
  onDepot,
  onRetirer,
}: {
  joueur: TeamRosterPlayer;
  vignette: Vignette | undefined;
  peutDeposer: boolean;
  occupe: boolean;
  ouvert: boolean;
  onOuvrir: () => void;
  onDepot: (fichiers: File[]) => Promise<void>;
  onRetirer: (photoId: string) => Promise<void>;
}) {
  const champ = useRef<HTMLInputElement>(null);
  const photos = vignette?.photos ?? [];
  const nb = photos.length;
  const premiere = photos[0];
  const url = premiere ? (vignette?.urls.get(premiere.id) ?? null) : null;
  const prenom = joueur.firstName || joueur.lastName || "Sportif";
  const complet = nb >= PHOTOS_MAX;

  const cadre = (
    <div
      className={`relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-sv border ${
        nb
          ? "border-border-strong bg-surface-alt"
          : "border-dashed border-border-strong/70 bg-surface-alt/40"
      }`}
    >
      {occupe ? (
        <Loader2 className="h-5 w-5 animate-spin text-text-soft" aria-hidden />
      ) : url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : nb ? (
        <ImageOff className="h-5 w-5 text-text-soft" aria-hidden />
      ) : (
        <span className="flex flex-col items-center gap-1 text-text-soft">
          <Camera className="h-4 w-4" aria-hidden />
          <span className="text-[10.5px] font-bold">{peutDeposer ? "Ajouter" : "Sans photo"}</span>
        </span>
      )}
      {nb > 1 ? (
        <span className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 text-[10px] font-bold text-white">
          {nb}
        </span>
      ) : null}
    </div>
  );

  return (
    <div className="flex flex-col gap-1">
      {peutDeposer && !complet ? (
        <label
          className="cursor-pointer"
          aria-label={`Ajouter des photos de référence pour ${prenom} ${joueur.lastName}`}
        >
          {cadre}
          <input
            ref={champ}
            type="file"
            accept="image/*"
            capture="user"
            multiple
            className="sr-only"
            disabled={occupe}
            onChange={async (e) => {
              const f = Array.from(e.target.files ?? []);
              if (champ.current) champ.current.value = "";
              if (f.length) await onDepot(f);
            }}
          />
        </label>
      ) : (
        cadre
      )}
      <div className="truncate text-[11.5px] font-bold" title={`${prenom} ${joueur.lastName}`}>
        {prenom}
      </div>
      <div className="truncate text-[10.5px] text-text-soft">{joueur.lastName}</div>

      {/* Dès qu'il y a une photo, on peut les voir toutes et en retirer une. Le bouton ne
          s'affiche pas sur une case vide : il n'y aurait rien à montrer. */}
      {nb ? (
        <button
          type="button"
          onClick={onOuvrir}
          className="text-left text-[10.5px] font-bold text-brand-blue-electric hover:underline"
        >
          {ouvert ? "Masquer" : `${nb} photo${nb > 1 ? "s" : ""}`}
        </button>
      ) : null}

      {ouvert ? (
        <div className="flex flex-wrap gap-1.5 rounded-sv border border-border-strong/60 bg-surface-alt p-1.5">
          {photos.map((ph) => {
            const u = vignette?.urls.get(ph.id) ?? null;
            return (
              <div
                key={ph.id}
                className="relative h-[42px] w-[42px] overflow-hidden rounded-sv border border-border-strong"
                title={ph.promue ? "Référence active" : "En attente de l'accord et de la date de naissance"}
              >
                {u ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={u} alt="" className="h-full w-full object-cover" />
                ) : (
                  <ImageOff className="m-auto h-4 w-4 text-text-soft" aria-hidden />
                )}
                {!ph.promue ? (
                  <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-center text-[8px] font-bold text-white">
                    attente
                  </span>
                ) : null}
                {peutDeposer ? (
                  <button
                    type="button"
                    disabled={occupe}
                    onClick={() => void onRetirer(ph.id)}
                    aria-label="Retirer cette photo"
                    className="absolute right-0 top-0 flex h-4 w-4 items-center justify-center rounded-bl-sv bg-black/70 text-white"
                  >
                    <X className="h-2.5 w-2.5" aria-hidden />
                  </button>
                ) : null}
              </div>
            );
          })}
          {peutDeposer && !complet ? (
            <label className="flex h-[42px] w-[42px] cursor-pointer items-center justify-center rounded-sv border-2 border-dashed border-border-strong bg-surface hover:border-brand-blue-electric">
              <Camera className="h-3.5 w-3.5 text-text-soft" aria-hidden />
              <input
                type="file"
                accept="image/*"
                capture="user"
                multiple
                className="sr-only"
                disabled={occupe}
                onChange={async (e) => {
                  const f = Array.from(e.target.files ?? []);
                  e.currentTarget.value = "";
                  if (f.length) await onDepot(f);
                }}
              />
            </label>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
