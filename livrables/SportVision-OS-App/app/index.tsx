// L'aiguillage : on ne montre rien tant qu'on ne sait pas qui regarde.
import React from "react";
import { ActivityIndicator, View } from "react-native";
import { Redirect } from "expo-router";
import { useSession } from "../src/lib/session";
import { C } from "../src/theme/couleurs";

export default function Aiguillage() {
  const { session, chargement } = useSession();

  if (chargement) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.fond }}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }
  // On atterrit sur l'Accueil, pas sur Missions : c'est le premier onglet de la barre, et deux
  // endroits differents pour « ou l'application s'ouvre » finissent toujours par diverger.
  return <Redirect href={session ? "/accueil" : "/connexion"} />;
}
