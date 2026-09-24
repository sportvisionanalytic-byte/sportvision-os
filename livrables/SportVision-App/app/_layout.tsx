// L'ossature de l'application (22/09/2026).
//
// Un seul endroit sait qui est connecte, et un seul endroit decide de l'ecran a montrer. Sur le
// site, cette decision etait repartie entre plusieurs pages, et c'est ce qui avait fini par
// envoyer une recrue sur l'espace d'un collegue.
import React from "react";
import { StatusBar } from "expo-status-bar";
import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useFonts } from "expo-font";
import { Ionicons } from "@expo/vector-icons";
import { usePolices } from "../src/theme/polices";
import { View } from "react-native";
import { FournisseurSession } from "../src/lib/session";
import { FournisseurFamille } from "../src/lib/famille";
import { FournisseurBiometrie, useBiometrie } from "../src/lib/biometrie";
import { Verrou } from "../src/ui/Verrou";
import { C } from "../src/theme/couleurs";

/**
 * Les écrans, ou le verrou par-dessus.
 *
 * Posé ici et nulle part ailleurs : un verrou branché écran par écran finit toujours par en
 * oublier un, et c'est celui-là qu'on atteindra par une notification ou un lien.
 */
function Ecrans() {
  const { verrouille } = useBiometrie();
  if (verrouille) return <Verrou />;
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: C.fond },
        animation: "fade",
      }}
    />
  );
}

export default function Racine() {
  // Les polices : celles des icônes, et celles de la marque. On ne bloque JAMAIS l'affichage en
  // les attendant — sur le web, l'attente ne se terminait pas et la page restait noire (constaté
  // le 22/09). Le texte s'affiche dans la police système puis bascule.
  useFonts(Ionicons.font);
  usePolices();

  return (
    <SafeAreaProvider>
      <FournisseurSession>
        <FournisseurFamille>
          <FournisseurBiometrie>
            {/* Le fond est peint ici, sous les ecrans : sans lui, un blanc apparait le temps
                d'une transition, et l'application clignote a chaque changement de page. */}
            <View style={{ flex: 1, backgroundColor: C.fond }}>
              <StatusBar style="light" />
              <Ecrans />
            </View>
          </FournisseurBiometrie>
        </FournisseurFamille>
      </FournisseurSession>
    </SafeAreaProvider>
  );
}
