// Les polices de la marque (22/09/2026).
//
// Manrope pour les titres, Inter pour le texte : ce sont celles du site vitrine. L'application
// utilisait la police système, ce qui la rendait anonyme.
//
// Le chargement ne bloque jamais l'affichage : sur le web, attendre la fin du chargement laissait
// une page noire indéfiniment (constaté le 22/09). Tant que les polices ne sont pas là, le texte
// s'affiche dans la police système, puis bascule.
import {
  useFonts,
  Manrope_500Medium, Manrope_700Bold, Manrope_800ExtraBold,
} from "@expo-google-fonts/manrope";
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from "@expo-google-fonts/inter";

export function usePolices(): boolean {
  const [pretes] = useFonts({
    Manrope_500Medium, Manrope_700Bold, Manrope_800ExtraBold,
    Inter_400Regular, Inter_500Medium, Inter_600SemiBold,
  });
  return pretes;
}

/** Les familles, à poser dans les styles. Jamais un `fontWeight` seul sur un titre : avec une
 *  police chargée, le poids ne s'applique pas, c'est la famille qui le porte. */
export const P = {
  titre: "Manrope_800ExtraBold",
  titreFort: "Manrope_700Bold",
  titreDoux: "Manrope_500Medium",
  texte: "Inter_400Regular",
  texteMoyen: "Inter_500Medium",
  texteFort: "Inter_600SemiBold",
} as const;
