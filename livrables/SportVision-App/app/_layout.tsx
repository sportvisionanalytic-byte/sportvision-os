// L'ossature de l'application (22/09/2026).
//
// Un seul endroit sait qui est connecte, et un seul endroit decide de l'ecran a montrer. Sur le
// site, cette decision etait repartie entre plusieurs pages, et c'est ce qui avait fini par
// envoyer une recrue sur l'espace d'un collegue.
import React from "react";
import { StatusBar } from "expo-status-bar";
import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { View } from "react-native";
import { FournisseurSession } from "../src/lib/session";
import { FournisseurFamille } from "../src/lib/famille";
import { C } from "../src/theme/couleurs";

export default function Racine() {
  return (
    <SafeAreaProvider>
      <FournisseurSession>
        <FournisseurFamille>
        {/* Le fond est peint ici, sous les ecrans : sans lui, un blanc apparait le temps d'une
            transition, et l'application clignote a chaque changement de page. */}
        <View style={{ flex: 1, backgroundColor: C.fond }}>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: C.fond },
              animation: "fade",
            }}
          />
        </View>
        </FournisseurFamille>
      </FournisseurSession>
    </SafeAreaProvider>
  );
}
