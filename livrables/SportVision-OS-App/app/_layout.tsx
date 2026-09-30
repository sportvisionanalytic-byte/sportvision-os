// L'OSSATURE DE SPORTVISION OS (30/09/2026).
//
// Une application à part, et c'est une décision de Fouka : « il faut que l'OS ne soit pas dans
// l'application qui est exécutée actuellement, il faut créer une autre application dédiée ». La
// raison est aussi celle d'Apple : la règle 3.2 refuse sur l'App Store public une application
// destinée aux employés d'une entreprise nommée. L'OS avait donc été retiré de l'application des
// familles le 25/09 ; il a maintenant la sienne, distribuée par TestFlight puis en Custom App.
//
// LA MÊME DIRECTION ARTISTIQUE, AU JETON PRÈS. `src/theme/couleurs.ts` et `polices.ts` sont les
// fichiers de l'application des familles, copiés sans une valeur changée, et les briques `Ecran`,
// `Section`, `Bouton`, `Champ` avec eux. C'est la demande : « la même direction artistique et les
// mêmes typographies, couleurs, que Connect et les clubs ». Deux palettes proches mais pas
// identiques, c'est exactement ce qui donne l'impression de deux applications recollées.
import React from "react";
import { View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useFonts } from "expo-font";
import { Ionicons } from "@expo/vector-icons";
import { usePolices } from "../src/theme/polices";
import { FournisseurSession } from "../src/lib/session";
import { C } from "../src/theme/couleurs";

export default function Racine() {
  // On ne bloque JAMAIS l'affichage en attendant les polices : le texte s'affiche dans celle du
  // système puis bascule. Une attente qui ne se termine pas laisse un écran noir, et personne ne
  // sait si l'application est cassée ou lente.
  useFonts(Ionicons.font);
  usePolices();

  return (
    <SafeAreaProvider>
      <FournisseurSession>
        {/* Le fond est peint ici, sous les écrans : sans lui, un blanc apparaît le temps d'une
            transition, et il se voit d'autant plus que tout le reste est sombre. */}
        <View style={{ flex: 1, backgroundColor: C.fond }}>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: C.fond },
              animation: "fade",
            }}
          />
        </View>
        <StatusBar style="light" />
      </FournisseurSession>
    </SafeAreaProvider>
  );
}
