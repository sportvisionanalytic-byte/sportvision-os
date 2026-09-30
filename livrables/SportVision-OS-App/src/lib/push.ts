// LES NOTIFICATIONS QUI ARRIVENT QUAND L'APPLICATION EST FERMÉE (30/09/2026).
//
// == LE DÉFAUT QUE ÇA CORRIGE ===================================================================
//
// Une ligne de `notifications` ne se voyait qu'en OUVRANT l'application. Une proposition de
// mission envoyée un vendredi soir restait invisible jusqu'à ce que l'opérateur pense à regarder.
// Pire : `send_prestation_reminders()`, la relance automatique qui tourne toutes les heures,
// écrivait elle aussi dans `notifications` — elle relançait donc dans le vide.
//
// == ON NE DEMANDE PAS L'AUTORISATION AU DÉMARRAGE ==============================================
//
// Une application qui réclame les notifications sur son premier écran se fait refuser, et iOS ne
// redemande JAMAIS : le refus est définitif jusqu'à ce que la personne aille le changer dans les
// Réglages, ce que personne ne fait. On attend donc d'être connecté — à ce moment-là on sait à
// quoi ça sert, et on peut le dire.
//
// == CE QU'ON ENREGISTRE, ET CE QU'ON N'ENREGISTRE PAS ==========================================
//
// Le jeton APNs, et lui seul. Il appartient au couple (personne, appareil) et il CHANGE :
// réinstallation, restauration de sauvegarde, mise à jour du système. On ne remplace donc pas, on
// ajoute, et la base éteint ceux qu'Apple déclare morts. Quelqu'un avec un iPhone et un iPad a
// deux lignes, et c'est normal.
//
// == PAS DE FAUX SUCCÈS (règle 4) ===============================================================
//
// Chaque étape peut échouer pour une raison légitime — simulateur, autorisation refusée, réseau —
// et aucune ne doit casser l'application. On rend donc un VERDICT lisible plutôt qu'un booléen,
// pour que l'écran puisse dire pourquoi, au lieu de prétendre que c'est fait.
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { supabase } from "./supabase";

export type VerdictPush =
  | { etat: "actif"; jeton: string }
  | { etat: "simulateur" }
  | { etat: "refuse" }
  | { etat: "erreur"; detail: string };

/** Ce que fait le téléphone quand une notification arrive alors que l'application est OUVERTE.
 *  Sans ça, elle n'affiche rien du tout : on la recevrait sans jamais la voir. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Demander l'autorisation, récupérer le jeton, l'enregistrer.
 *
 * À appeler UNE FOIS CONNECTÉ, jamais avant : l'enregistrement est borné par la RLS à
 * `user_id = auth.uid()`, et sans session il serait refusé.
 */
export async function activerPush(): Promise<VerdictPush> {
  // Un simulateur n'a pas d'APNs. Ce n'est pas une panne, c'est un fait, et l'écran doit pouvoir
  // le dire autrement que par « échec ».
  if (!Device.isDevice) return { etat: "simulateur" };

  try {
    const { status: dejaDonne } = await Notifications.getPermissionsAsync();
    let statut = dejaDonne;
    if (statut !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      statut = status;
    }
    if (statut !== "granted") return { etat: "refuse" };

    // LE JETON APNs, PAS LE JETON EXPO. On parle à Apple directement depuis notre propre fonction,
    // avec notre propre clé : rien ne transite par les serveurs d'Expo.
    const { data: jeton } = await Notifications.getDevicePushTokenAsync();
    if (!jeton || typeof jeton !== "string") {
      return { etat: "erreur", detail: "Le téléphone n'a pas rendu de jeton." };
    }

    const { data: session } = await supabase.auth.getSession();
    const moi = session.session?.user?.id;
    if (!moi) return { etat: "erreur", detail: "Session absente." };

    // `upsert` sur (jeton, application) : rouvrir l'application ne crée pas une ligne de plus, et
    // un jeton qu'on avait éteint se rallume s'il revient vraiment.
    const { error } = await supabase
      .from("appareils_push")
      .upsert(
        {
          user_id: moi,
          jeton,
          plateforme: Platform.OS === "android" ? "android" : "ios",
          application: "os",
          actif: true,
          raison_inactif: null,
          vu_le: new Date().toISOString(),
        },
        { onConflict: "jeton,application" },
      )
      .select("id");

    if (error) return { etat: "erreur", detail: error.message };
    return { etat: "actif", jeton };
  } catch (e) {
    return { etat: "erreur", detail: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Éteindre cet appareil à la déconnexion.
 *
 * SANS ÇA, UN TÉLÉPHONE RENDU CONTINUE DE RECEVOIR LES MISSIONS DE SON ANCIEN PROPRIÉTAIRE. On ne
 * supprime pas la ligne, on l'éteint : garder la trace permet de comprendre, plus tard, pourquoi
 * un jeton a cessé de servir.
 *
 * L'échec est avalé volontairement : une déconnexion ne doit jamais rester bloquée parce que le
 * réseau est tombé. Le pire cas est un jeton éteint plus tard, au premier refus d'Apple.
 */
export async function desactiverPush(): Promise<void> {
  try {
    if (!Device.isDevice) return;
    const { data: jeton } = await Notifications.getDevicePushTokenAsync();
    if (!jeton || typeof jeton !== "string") return;
    await supabase
      .from("appareils_push")
      .update({ actif: false, raison_inactif: "déconnexion" })
      .eq("jeton", jeton)
      .eq("application", "os");
  } catch {
    // Silence volontaire : voir plus haut.
  }
}
