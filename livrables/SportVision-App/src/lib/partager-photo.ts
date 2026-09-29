import * as Clipboard from "expo-clipboard";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

/**
 * PARTAGER UNE PHOTO (29/09/2026).
 *
 * POURQUOI ÇA EXISTE. Fouka : « qu'il puisse flex avec ses photos, qu'il puisse être fier de ses
 * photos, les partager. Il a un bouton pour publier sur Instagram. » Une famille qui paie un Pass
 * Photo ne vient pas chercher un fichier : elle vient chercher de quoi montrer son enfant.
 *
 * PAS D'API INSTAGRAM, ET C'EST MIEUX. Publier directement demanderait un compte professionnel, une
 * autorisation Meta par utilisateur et une revue de leur part — pour un résultat moins bon. La
 * feuille de partage du téléphone propose déjà Instagram, les stories, WhatsApp, les messages et
 * l'album partagé de la famille, et c'est l'endroit où les gens savent déjà aller. On lui donne ce
 * qu'il faut partager, il choisit où.
 *
 * LA LÉGENDE PART DANS LE PRESSE-PAPIER. Aucune application de partage n'accepte qu'on lui impose
 * un texte — Instagram le refuse depuis des années, et c'est volontaire de leur part. On copie donc
 * la légende, et l'écran DIT qu'elle est copiée : coller est un geste, mais l'inventer soi-même en
 * est un autre, et c'est celui qui fait que personne ne cite SportVision.
 */
export const COMPTE_INSTAGRAM = "@Sportvision_an";

export type ResultatPartage =
  | { etat: "partage" }
  | { etat: "indisponible" }
  | { etat: "erreur"; message: string };

/** La légende proposée. Le nom du match quand on le connaît, et le compte, jamais de faux hashtags
 *  ni de superlatif : c'est la photo qui parle. */
export function legende(titreGalerie?: string): string {
  return [titreGalerie?.trim(), `Photo ${COMPTE_INSTAGRAM}`].filter(Boolean).join(" · ");
}

export async function partagerPhoto(
  url: string, nom: string, titreGalerie?: string,
): Promise<ResultatPartage> {
  // Sur un téléphone la feuille de partage existe toujours ; sur le web, jamais. On le demande
  // plutôt que de le supposer : un bouton qui ne fait rien est pire qu'un bouton absent.
  if (!(await Sharing.isAvailableAsync())) return { etat: "indisponible" };
  const cible = `${FileSystem.cacheDirectory}${nom}`;
  try {
    const { uri, status } = await FileSystem.downloadAsync(url, cible);
    if (status !== 200) return { etat: "erreur", message: "La photo n'a pas pu être préparée." };
    // La légende AVANT la feuille de partage : une fois Instagram ouvert, l'application est en
    // arrière-plan et n'écrit plus rien.
    try { await Clipboard.setStringAsync(legende(titreGalerie)); } catch { /* le partage vaut sans */ }
    await Sharing.shareAsync(uri, {
      mimeType: "image/jpeg",
      dialogTitle: "Partager cette photo",
      UTI: "public.jpeg",
    });
    return { etat: "partage" };
  } catch (e) {
    return { etat: "erreur", message: String((e as Error)?.message ?? e).slice(0, 140) };
  }
}
