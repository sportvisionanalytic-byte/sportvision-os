// L'écran posé devant l'application quand le verrou est fermé (24/09/2026).
//
// Il ne demande rien d'autre qu'un visage. Pas de mot de passe, pas de formulaire : la session
// est déjà ouverte, on vérifie seulement que c'est bien la bonne personne qui tient le téléphone.
//
// Deux sorties, toujours. Réessayer, parce qu'un visage rate parfois en plein soleil. Et se
// déconnecter, parce que quelqu'un qui n'arrive plus à lever le verrou ne doit pas se retrouver
// enfermé devant un écran sans issue — c'est exactement le genre de situation qui fait
// désinstaller une application.
import React, { useEffect, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useBiometrie } from "../lib/biometrie";
import { useSession } from "../lib/session";
import { Bouton } from "./Base";
import { Lueur } from "./Fond";
import { C, E, R } from "../theme/couleurs";
import { P } from "../theme/polices";

export function Verrou() {
  const { nom, demander, desactiver } = useBiometrie();
  const { deconnexion } = useSession();
  // Une seule demande automatique : relancer en boucle après un échec ferait clignoter la
  // fenêtre d'iOS sans jamais laisser le temps d'appuyer sur « Réessayer ».
  const dejaDemande = useRef(false);

  useEffect(() => {
    if (dejaDemande.current) return;
    dejaDemande.current = true;
    demander();
  }, [demander]);

  return (
    <View style={s.page}>
      <Lueur teinte="cyan" />
      <View style={s.rond}>
        <Ionicons name="lock-closed" size={30} color={C.cyan} />
      </View>
      <Text style={s.titre}>SportVision est verrouillé</Text>
      <Text style={s.texte}>
        {nom ? `Déverrouillez avec ${nom} pour retrouver vos photos et votre calendrier.`
             : "Déverrouillez pour retrouver vos photos et votre calendrier."}
      </Text>

      <View style={s.actions}>
        <Bouton titre="Déverrouiller" onPress={demander} />
        <Bouton titre="Ne plus verrouiller" onPress={desactiver} secondaire />
        <Text style={s.sortie} onPress={deconnexion} accessibilityRole="button">
          Se déconnecter
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, alignItems: "center", justifyContent: "center", padding: E.xl, gap: E.m, backgroundColor: C.fond },
  rond: {
    width: 68, height: 68, borderRadius: R.xl, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(0,199,255,.12)", borderWidth: 1, borderColor: "rgba(0,199,255,.28)",
  },
  titre: { color: C.texte, fontFamily: P.titre, fontSize: 22, textAlign: "center", letterSpacing: -0.4 },
  texte: { color: C.texteDoux, fontFamily: P.texte, fontSize: 15, lineHeight: 22, textAlign: "center", maxWidth: 320 },
  actions: { alignSelf: "stretch", maxWidth: 320, gap: E.s, paddingTop: E.m },
  sortie: {
    color: C.texteFaible, fontFamily: P.texteFort, fontSize: 13.5,
    textAlign: "center", paddingVertical: E.s,
  },
});
