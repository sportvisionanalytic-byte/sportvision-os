// LES GESTES DU RESPONSABLE DE PRODUCTION (01/10/2026).
//
// == POURQUOI CE FICHIER EXISTE ================================================================
//
// Audit du 01/10 : `prod/livraisons.tsx`, `prod/equipe.tsx` et `prod/materiel.tsx` ne contenaient
// AUCUN élément appuyable. Zéro, compté. C'étaient trois listes à regarder.
//
// Le plus grave n'était pas l'ennui, c'était la boucle ouverte : « Mes livrables » dit à
// l'opérateur que sa mission reste bloquée tant que la Production n'a pas validé, et la Production
// ne pouvait pas valider depuis son téléphone. On demandait à quelqu'un d'attendre un geste qu'on
// avait rendu impossible.
//
// == CE QUE LA BASE AUTORISE, MESURÉ AVANT D'ÉCRIRE UNE LIGNE ===================================
//
// Jeton de Mikael (`prod`), `set local role authenticated`, transactions annulées. Les quatre
// gestes ci-dessous PASSENT :
//   · poser `valide` sur un lien
//   · poser `correction_demandee` avec son motif
//   · enregistrer le retour d'un kit
//   · remettre un kit en `disponible`
//
// On ne recopie donc aucune condition : on appelle, et on montre ce que la base répond.
//
// == PAS DE FAUX SUCCÈS (règle 4) ==============================================================
//
// PostgREST rend 0 ligne ET 0 erreur quand la RLS refuse. Chaque écriture se termine par
// `.select("id")` et lève si c'est vide. Aucun écran ne doit dire « validé » sur une ligne qui
// n'a pas bougé.
import { Linking } from "react-native";
import { supabase } from "./supabase";

/** Valider une livraison. C'est le verdict qui débloque la clôture, donc la rémunération. */
export async function validerLien(lienId: string): Promise<void> {
  const { data, error } = await supabase
    .from("media_liens")
    .update({ statut: "valide" })
    .eq("id", lienId)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) {
    throw new Error("La base n'a rien changé. Cette livraison n'est peut-être plus dans votre pôle.");
  }
}

/**
 * Demander une correction, avec son motif.
 *
 * LE MOTIF EST OBLIGATOIRE, ET C'EST UNE DÉCISION. `commentaire` est le seul champ qui porte la
 * demande, et depuis la v375 l'opérateur ne peut plus l'effacer. Une correction sans motif
 * renverrait quelqu'un au travail sans lui dire quoi refaire.
 */
export async function demanderCorrection(lienId: string, motif: string): Promise<void> {
  const texte = motif.trim();
  if (texte.length < 5) {
    throw new Error("Dites ce qu'il faut corriger : l'opérateur ne verra que cette phrase.");
  }
  const { data, error } = await supabase
    .from("media_liens")
    .update({ statut: "correction_demandee", commentaire: texte })
    .eq("id", lienId)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) {
    throw new Error("La base n'a rien changé. Cette livraison n'est peut-être plus dans votre pôle.");
  }
}

/**
 * Enregistrer le retour d'un kit.
 *
 * CE GESTE DÉBLOQUE LES RÉSERVATIONS, et c'est nouveau depuis la v369 : une réservation dont le
 * retour n'est ni prévu ni enregistré occupe le kit SANS FIN. Les deux kits de SportVision sont
 * sortis depuis le 12 septembre ; tant que personne n'enregistre leur retour, plus aucune
 * réservation n'est possible. Ce bouton est donc la sortie de ce blocage, depuis le terrain.
 */
export async function enregistrerRetourKit(reservationId: string, kitId: string | null): Promise<void> {
  const { data, error } = await supabase
    .from("kit_reservations")
    .update({ date_retour_effective: new Date().toISOString(), statut: "retourné" })
    .eq("id", reservationId)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("La base n'a rien changé. Ce retour n'a pas été enregistré.");

  // La fiche du kit suit, quand on sait laquelle. Son échec n'annule pas le retour : le fait
  // physique est enregistré, l'étiquette se rattrape. On ne lève donc pas ici.
  if (kitId) {
    await supabase.from("kits").update({ statut: "disponible" }).eq("id", kitId).select("id");
  }
}

/**
 * Appeler quelqu'un.
 *
 * LA SEULE EXCEPTION À LA RÈGLE 2 DU CONTRAT, et elle se défend : `tel:` n'ouvre pas une page web
 * dans un cadre, il passe la main au téléphone. Le motif existe déjà dans `terrain.tsx` pour le
 * contact du club. Un responsable qui voit « personne sur place » doit pouvoir appeler, pas
 * recopier dix chiffres.
 *
 * On rend VRAI ou FAUX plutôt que de lever : un numéro qu'iOS refuse n'est pas une panne de
 * l'application, et l'écran doit pouvoir le dire autrement qu'en rouge.
 */
export async function appeler(numero: string | null | undefined): Promise<boolean> {
  const n = (numero ?? "").replace(/[^+0-9]/g, "");
  if (n.length < 6) return false;
  try {
    const url = `tel:${n}`;
    if (!(await Linking.canOpenURL(url))) return false;
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}
