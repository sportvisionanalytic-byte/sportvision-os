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

// ── L'ÉCHELLE DES TAILLES (01/10/2026) ────────────────────────────────────────────────────────
//
// POURQUOI ELLE ARRIVE SI TARD. Mesuré écran par écran avant de l'écrire : le titre d'un écran
// valait 27 sur le Centre, la Messagerie et le Centre de formation, 26 sur huit autres écrans, et
// 24 sur « Mon espace ». Le sous-titre juste dessous valait 13,5 huit fois et 14,5 trois fois.
// Personne n'a choisi ces écarts : chaque écran a recopié le voisin qu'il avait sous les yeux, et
// la copie a dérivé. Trois tailles de titre pour une même chose, c'est ce qui fait qu'on sent,
// sans savoir le dire, que les écrans n'ont pas été dessinés ensemble.
//
// La règle est celle des couleurs : on n'écrit plus une taille en dur, on prend celle du thème. Si
// une taille manque ici, on l'ajoute ICI, et tout le monde en profite.
export const T = {
  /** Le titre d'un écran, celui qui est tout en haut. Une seule taille, partout. */
  titreEcran: 26,
  /** La ligne qui suit ce titre, et qui dit ce que l'écran contient. */
  sousEcran: 13.5,
  sousEcranHauteur: 19,
  /** Le titre d'une `Section`. */
  titreSection: 20,
  /** Le titre d'une carte, d'un état vide, d'un bloc. */
  titreBloc: 16,
  /** Le texte courant d'un paragraphe. */
  corps: 14,
  corpsHauteur: 20,
  /** Une ligne de détail sous un nom : une date, un lieu, une heure. */
  detail: 13.5,
  detailHauteur: 19,
  /** Une note de bas de bloc, plus discrète que le reste. */
  note: 12.5,
  noteHauteur: 18,
  /** Une étiquette en capitales, au-dessus d'un bloc. */
  etiquette: 11,
} as const;
