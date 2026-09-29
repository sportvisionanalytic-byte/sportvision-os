import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library";

/**
 * Enregistrer une photo dans la pellicule du téléphone.
 *
 * POURQUOI ÇA EXISTE (Fouka, 28/09/2026). « Quand je reste appuyé, je peux même pas télécharger ma
 * photo. Faut qu'il puisse télécharger toutes ses photos du match. » L'application n'avait aucun
 * moyen d'enregistrer quoi que ce soit : une famille payait le Pass, voyait ses photos, et
 * repartait sans rien. C'est pourtant la seule chose qu'elle vient chercher.
 *
 * CE QU'ON ENREGISTRE. L'adresse signée que l'écran affiche déjà — donc la version sans filigrane
 * pour ses propres photos, et rien d'autre. On ne contourne aucun droit ici : si la base n'a pas
 * servi l'aperçu net, il n'y a rien à enregistrer de net.
 *
 * L'AUTORISATION EST DEMANDÉE AU PREMIER ENREGISTREMENT, jamais au lancement : une demande d'accès
 * à la pellicule qui tombe sans raison est refusée une fois sur deux, et un refus est définitif.
 */
export type Resultat =
  | { etat: "enregistre"; combien: number }
  | { etat: "refuse" }
  | { etat: "erreur"; message: string };

/** Vrai une fois que l'accès est donné. ON NE RETIENT JAMAIS UN REFUS — voir `autoriser`. */
let autorisation = false;

async function autoriser(): Promise<boolean> {
  if (autorisation) return true;
  // ON NE GARDE PAS EN MÉMOIRE UN REFUS (30/09/2026).
  //
  // Le refus était retenu pour toute la durée de l'application. L'écran dit pourtant, mot pour mot,
  // « Réglages → SportVision → Photos » : la personne y allait, donnait l'accès, revenait, appuyait
  // sur « Enregistrer », et relisait le même refus. La seule sortie était de tuer l'application —
  // sans que rien ne le dise. Une consigne qu'on donne doit marcher quand elle est suivie.
  //
  // Redemander ne rouvre pas la fenêtre du système quand elle a déjà été refusée : iOS et Android
  // répondent aussitôt avec la décision en cours. Cet appel coûte donc un aller-retour local, et
  // rien d'autre. Seul le OUI se retient.
  //
  // `granted` suffit : on ajoute seulement, on ne lit jamais la pellicule.
  const { granted } = await MediaLibrary.requestPermissionsAsync(true);
  if (granted) autorisation = true;
  return granted;
}

/** Une seule photo. Rend un verdict, jamais une exception : un échec se dit à l'écran. */
export async function enregistrerPhoto(url: string, nom: string): Promise<Resultat> {
  if (!(await autoriser())) return { etat: "refuse" };
  const cible = `${FileSystem.cacheDirectory}${nom}`;
  try {
    const { uri, status } = await FileSystem.downloadAsync(url, cible);
    if (status !== 200) return { etat: "erreur", message: "La photo n'a pas pu être téléchargée." };
    await MediaLibrary.saveToLibraryAsync(uri);
    // On ne garde pas de copie : la photo est dans la pellicule, le cache n'a plus de raison d'être.
    await FileSystem.deleteAsync(uri, { idempotent: true });
    return { etat: "enregistre", combien: 1 };
  } catch (e) {
    return { etat: "erreur", message: (e as Error)?.message ?? "Enregistrement impossible." };
  }
}

/**
 * Toutes les photos, l'une après l'autre.
 *
 * EN SÉRIE, PAS EN PARALLÈLE. Vingt téléchargements simultanés sur le réseau d'un stade, c'est la
 * moitié qui échoue sans qu'on sache lesquels. On avance une par une et on dit où on en est.
 */
export async function enregistrerToutes(
  photos: { url: string; id: string }[],
  surAvance?: (fait: number, total: number) => void,
): Promise<Resultat> {
  if (!photos.length) return { etat: "enregistre", combien: 0 };
  if (!(await autoriser())) return { etat: "refuse" };
  let faites = 0;
  for (const p of photos) {
    const r = await enregistrerPhoto(p.url, `sportvision-${p.id}.jpg`);
    if (r.etat === "enregistre") faites++;
    surAvance?.(faites, photos.length);
  }
  if (!faites) return { etat: "erreur", message: "Aucune photo n'a pu être enregistrée." };
  return { etat: "enregistre", combien: faites };
}
