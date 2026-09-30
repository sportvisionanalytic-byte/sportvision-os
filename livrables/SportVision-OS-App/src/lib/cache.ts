import { useCallback, useEffect, useRef, useState } from "react";

/**
 * AFFICHER TOUT DE SUITE CE QU'ON SAIT DÉJÀ (29/09/2026).
 *
 * Fouka : « à peu près tous les écrans, il y a toujours une ou deux secondes de latence, c'est pas
 * fluide fluide fluide ».
 *
 * Mesuré avant d'écrire : la base répond en 150 ms, les images arrivent en 300 ms. Ce n'est donc
 * ni le réseau ni le serveur. C'est que CHAQUE écran repart de zéro — écran vide, roue qui tourne,
 * puis le contenu. Il n'y avait aucun cache nulle part dans l'application.
 *
 * Une application qu'on trouve fluide ne va pas plus vite : elle ne montre jamais de vide. On garde
 * donc en mémoire la dernière réponse de chaque écran, on l'affiche INSTANTANÉMENT au retour, et on
 * rafraîchit derrière sans rien faire clignoter. Deux secondes d'attente deviennent zéro.
 *
 * EN MÉMOIRE SEULEMENT, ET C'EST VOULU. Rien n'est écrit sur le téléphone : ces données sont celles
 * d'un enfant — ses photos, ses galeries. Elles disparaissent quand l'application se ferme.
 *
 * ET LE CACHE NE MENT JAMAIS LONGTEMPS. Au-delà de quelques minutes, on préfère la roue à une
 * information fausse : un Pass acheté ou une photo confirmée doivent se voir.
 */

type Entree = { valeur: unknown; posee: number };

const memoire = new Map<string, Entree>();

/** Au-delà, on n'affiche plus l'ancienne réponse : mieux vaut attendre que mentir. */
const DUREE_MAX = 5 * 60 * 1000;

export function lireCache<T>(cle: string): T | undefined {
  const e = memoire.get(cle);
  if (!e) return undefined;
  if (Date.now() - e.posee > DUREE_MAX) { memoire.delete(cle); return undefined; }
  return e.valeur as T;
}

export function poserCache(cle: string, valeur: unknown) {
  memoire.set(cle, { valeur, posee: Date.now() });
}

/**
 * Oublier ce qu'on croit savoir, après une action qui change les données.
 *
 * `oublier("galerie:")` efface tout ce qui commence ainsi : après un achat ou une confirmation,
 * plusieurs écrans deviennent faux d'un coup, et les oublier un par un se serait oublié un jour.
 */
export function oublier(prefixe: string) {
  for (const cle of [...memoire.keys()]) if (cle.startsWith(prefixe)) memoire.delete(cle);
}

export function viderCache() { memoire.clear(); }

/**
 * Le chargement d'un écran, avec affichage immédiat de ce qu'on avait.
 *
 * `chargement` ne vaut vrai que s'il n'y a RIEN à montrer : au retour sur un écran déjà vu, il
 * reste faux et la roue ne s'affiche jamais. `rafraichissement` dit qu'on relit en arrière-plan,
 * pour un indicateur discret si on en veut un.
 */
export function useDonnees<T>(
  cle: string | null,
  charger: () => Promise<T>,
  deps: unknown[] = [],
): { donnees: T | undefined; chargement: boolean; rafraichissement: boolean; erreur: unknown; relire: () => void } {
  const [donnees, setDonnees] = useState<T | undefined>(() => (cle ? lireCache<T>(cle) : undefined));
  const [rafraichissement, setRafraichissement] = useState(false);
  const [erreur, setErreur] = useState<unknown>(null);
  const vivant = useRef(true);
  const [tour, setTour] = useState(0);

  useEffect(() => { vivant.current = true; return () => { vivant.current = false; }; }, []);

  const relire = useCallback(() => setTour((t) => t + 1), []);

  useEffect(() => {
    if (!cle) return;
    const dejaLa = lireCache<T>(cle);
    if (dejaLa !== undefined) setDonnees(dejaLa);
    setRafraichissement(true);
    setErreur(null);
    (async () => {
      try {
        const v = await charger();
        if (!vivant.current) return;
        poserCache(cle, v);
        setDonnees(v);
      } catch (e) {
        if (vivant.current) setErreur(e);
      } finally {
        if (vivant.current) setRafraichissement(false);
      }
    })();
    // `charger` change à chaque rendu si on le met en dépendance : ce sont les vraies dépendances
    // de l'écran qui décident, plus le tour de rafraîchissement demandé.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle, tour, ...deps]);

  return { donnees, chargement: donnees === undefined && rafraichissement, rafraichissement, erreur, relire };
}

/**
 * LA MEME QUESTION POSEE D'UN SEUL ENDROIT (29/09/2026).
 *
 * L'accueil et le calendrier lisent exactement les memes evenements. En leur donnant la meme cle,
 * ouvrir le calendrier apres l'accueil ne coute plus rien : la reponse est deja la. Deux cles
 * differentes pour la meme donnee, c'etaient deux attentes et, un jour, deux verites.
 */
export function cleEvenements(parent: boolean, clubId?: string | null, refEnfant?: string | null) {
  return `evenements:${parent ? `p:${refEnfant ?? ""}` : `j:${clubId ?? ""}`}`;
}

/** Les galeries d'une equipe, vues par l'accueil (la derniere) et par l'onglet Photos (toutes). */
export function cleGaleries(
  clubId?: string | null, equipeId?: string | null,
  saisonId?: string | null, playerId?: string | null,
) {
  if (!clubId || !equipeId) return null;
  return `galeries:${clubId}:${equipeId}:${saisonId ?? ""}:${playerId ?? ""}`;
}
