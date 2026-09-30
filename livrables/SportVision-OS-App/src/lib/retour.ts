import { router } from "expo-router";

/** Sortir d'un écran, toujours.
 *
 *  `router.back()` ne fait RIEN quand la pile est vide, et sans rien signaler. Ça arrive plus
 *  souvent qu'on croit : une notification qui ouvre une galerie, un lien partagé, l'app relancée
 *  sur son dernier écran. L'utilisateur appuie sur la flèche, et l'écran ne bouge pas.
 *
 *  Fouka s'est retrouvé bloqué le 28/09/2026. Un écran dont on ne sort pas, c'est un refus Apple
 *  immédiat, et une famille perdue.
 *
 *  La règle vit ici et nulle part ailleurs : trois écrans en avaient chacun leur copie, et deux
 *  d'entre elles avaient oublié le cas de la pile vide. */
export function retourner(repli: string) {
  if (router.canGoBack()) router.back();
  else router.replace(repli as never);
}
