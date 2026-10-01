"use client";

// La photo de référence d'un sportif, déposée par le club (migration v385).
//
// Fouka : « Chaque photo qu'on prend du joueur devient une photo de référence à ajouter en plus. »
// Et : « il y aura déjà le nom, prénom de l'enfant, ils vont dire c'est bien mon enfant, et boum, il
// y a déjà les photos. Ils auront juste à valider l'autorisation d'image. »
//
// ── LA SEULE CHOSE À COMPRENDRE DE CET ÉCRAN ──
// Il dépose une PHOTO. Il ne calcule aucune empreinte, et il ne peut pas en calculer : la photo
// attend dans une table que la chaîne de reconnaissance ne lit nulle part. Le jour où la famille
// donne son accord, la photo passe toute seule du côté des références et le moteur calcule
// l'empreinte. Avant cet accord, il n'y a rien à calculer et rien n'est calculé.
//
// C'est ce que dit le libellé affiché, mot pour mot, parce que c'est ce que la personne qui dépose
// doit pouvoir expliquer à un parent qui le lui demande.

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Check, Clock, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { createClient } from "@/lib/supabase/client";
import {
  PHOTOS_MAX,
  deposerPhotoEffectif,
  listerPhotosEffectif,
  retirerPhotoEffectif,
  signerPhotos,
  type PhotoEffectif,
} from "@/lib/data/club/effectif";

export function PhotoReferenceJoueur({
  playerId,
  nom,
  peutDeposer,
}: {
  playerId: string;
  nom: string;
  peutDeposer: boolean;
}) {
  const [photos, setPhotos] = useState<PhotoEffectif[] | null>(null);
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const champ = useRef<HTMLInputElement>(null);

  const charger = useCallback(async () => {
    const supabase = createClient();
    const liste = await listerPhotosEffectif(supabase, playerId);
    setPhotos(liste);
    setUrls(await signerPhotos(supabase, liste.map((p) => p.storagePath)));
  }, [playerId]);

  useEffect(() => {
    let vivant = true;
    charger().catch(() => {
      if (vivant) setPhotos([]);
    });
    return () => {
      vivant = false;
    };
  }, [charger]);

  async function choisir(e: React.ChangeEvent<HTMLInputElement>) {
    const fichier = e.target.files?.[0];
    e.target.value = "";
    if (!fichier) return;
    setErreur(null);
    setEnvoi(true);
    try {
      await deposerPhotoEffectif(createClient(), playerId, fichier);
      await charger();
    } catch (err) {
      setErreur(err instanceof Error && err.message ? err.message : "Dépôt impossible pour le moment.");
    } finally {
      setEnvoi(false);
    }
  }

  async function retirer(id: string) {
    setErreur(null);
    try {
      await retirerPhotoEffectif(createClient(), id);
      await charger();
    } catch (err) {
      setErreur(err instanceof Error && err.message ? err.message : "Retrait impossible pour le moment.");
    }
  }

  if (photos === null) {
    return <span className="text-[11.5px] text-text-soft">…</span>;
  }

  const plein = photos.length >= PHOTOS_MAX;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {photos.map((p) => (
          <div key={p.id} className="group relative">
            {urls.get(p.storagePath) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={urls.get(p.storagePath)}
                alt={`Photo de référence de ${nom}`}
                className="h-11 w-11 rounded-sv object-cover"
              />
            ) : (
              <div className="flex h-11 w-11 items-center justify-center rounded-sv bg-surface-alt">
                <Camera className="h-3.5 w-3.5 text-text-soft" aria-hidden />
              </div>
            )}
            {peutDeposer && (
              <button
                onClick={() => retirer(p.id)}
                title={`Retirer cette photo de ${nom}`}
                aria-label={`Retirer cette photo de ${nom}`}
                className="absolute -right-1.5 -top-1.5 hidden rounded-full bg-[#EF5B67] p-1 text-white group-hover:block"
              >
                <Trash2 className="h-2.5 w-2.5" aria-hidden />
              </button>
            )}
            <span className="sr-only">
              {p.promue ? "Photo de référence active" : "Photo en attente de l'accord de la famille"}
            </span>
          </div>
        ))}

        {peutDeposer && !plein && (
          <>
            <button
              onClick={() => champ.current?.click()}
              disabled={envoi}
              className="flex h-11 w-11 items-center justify-center rounded-sv border border-dashed border-border-strong text-text-soft transition-colors duration-sv hover:border-brand-blue-electric hover:text-brand-blue-electric disabled:cursor-wait"
              title={`Ajouter une photo de ${nom}`}
              aria-label={`Ajouter une photo de ${nom}`}
            >
              <Camera className="h-4 w-4" aria-hidden />
            </button>
            <input
              ref={champ}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              className="hidden"
              onChange={choisir}
            />
          </>
        )}
      </div>

      {photos.length > 0 && (
        <div className="flex items-center gap-1.5">
          {photos.every((p) => p.promue) ? (
            <Badge tone="success">
              <Check className="mr-1 h-2.5 w-2.5" aria-hidden />
              Référence active
            </Badge>
          ) : (
            <Badge tone="warning">
              <Clock className="mr-1 h-2.5 w-2.5" aria-hidden />
              En attente de l&apos;accord de la famille
            </Badge>
          )}
        </div>
      )}

      {erreur && <p className="text-[11.5px] font-semibold text-status-danger">{erreur}</p>}
    </div>
  );
}
