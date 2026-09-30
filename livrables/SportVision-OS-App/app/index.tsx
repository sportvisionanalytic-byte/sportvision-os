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
  return <Redirect href={session ? "/missions" : "/connexion"} />;
}
