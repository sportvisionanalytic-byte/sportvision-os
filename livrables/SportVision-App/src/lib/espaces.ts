// Les trois portes de SportVision, et celle qu'on a choisie (22/09/2026).
//
// L'application se souvient du choix pour ne pas le reposer chaque matin, mais elle ne l'enferme
// jamais : la porte d'entree reste accessible depuis chaque espace. Le piege connu, c'est le
// choix memorise sans retour possible — une personne qui se trompe une fois reste coincee.
import AsyncStorage from "@react-native-async-storage/async-storage";

export type Porte = "personnel" | "club" | "sportvision";

const CLE = "sportvision.porte";

export const ADRESSES: Record<Exclude<Porte, "personnel">, string> = {
  club: "https://clubplus.sportvision-an.fr",
  sportvision: "https://bc6m3cgdz.sportvision-an.fr",
};

/**
 * Le choix memorise, ou null s'il n'y en a pas de valable.
 *
 * « SPORTVISION » EST UN RELIQUAT, ET ON LE TRAITE COMME TEL (30/09/2026).
 *
 * L'espace de production a ete RETIRE de l'application le 25/09, pour la directive 3.2 d'Apple :
 * une application destinee aux employes d'une entreprise nommee n'a pas sa place sur l'App Store
 * public. `bienvenue.tsx` ne le propose donc plus. Mais un telephone qui avait fait ce choix AVANT
 * gardait la valeur en memoire, et l'aiguillage l'y renvoyait a chaque lancement.
 *
 * Ce qu'il y voyait etait faux : `sourceClubPlus()` est appelee quel que soit l'espace, et l'adresse
 * de Club+ est ecrite en dur — le membre de la production tombait donc sur CLUB+ sous un titre
 * « Equipe de production ». On ne repare pas ca en rebranchant un pont vers l'OS, ce que la decision
 * du 25/09 exclut : on cesse de rendre un choix qui ne mene plus nulle part, et la personne choisit
 * a nouveau. L'OS reste accessible dans Safari, avec « Sur l'ecran d'accueil ».
 */
export async function porteMemorisee(): Promise<Porte | null> {
  try {
    const v = await AsyncStorage.getItem(CLE);
    if (v === "sportvision") {
      // On efface, sinon on repose la question a chaque lancement.
      try { await AsyncStorage.removeItem(CLE); } catch { /* le choix vaut pour cette session */ }
      return null;
    }
    return v === "personnel" || v === "club" ? v : null;
  } catch { return null; }
}

export async function memoriserPorte(p: Porte): Promise<void> {
  try { await AsyncStorage.setItem(CLE, p); } catch { /* le choix vaut pour cette session */ }
}

export async function oublierPorte(): Promise<void> {
  try { await AsyncStorage.removeItem(CLE); } catch { /* sans consequence */ }
}
