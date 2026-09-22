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

export async function porteMemorisee(): Promise<Porte | null> {
  try {
    const v = await AsyncStorage.getItem(CLE);
    return v === "personnel" || v === "club" || v === "sportvision" ? v : null;
  } catch { return null; }
}

export async function memoriserPorte(p: Porte): Promise<void> {
  try { await AsyncStorage.setItem(CLE, p); } catch { /* le choix vaut pour cette session */ }
}

export async function oublierPorte(): Promise<void> {
  try { await AsyncStorage.removeItem(CLE); } catch { /* sans consequence */ }
}
