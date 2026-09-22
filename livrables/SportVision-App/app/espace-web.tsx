// Les espaces Club+ et OS, en attendant leur version native (22/09/2026).
//
// Ils sont ouverts ici dans l'application, avec une vraie barre : un titre, un retour qui suit
// l'historique de la page, et surtout la sortie vers le choix d'espace. Une page pleine ecran
// sans barre, c'est exactement l'impasse qu'on veut eviter.
import React, { useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { WebView } from "react-native-webview";
import { ADRESSES, oublierPorte, type Porte } from "../src/lib/espaces";
import { C, E, R } from "../src/theme/couleurs";

const TITRES: Record<Exclude<Porte, "personnel">, string> = {
  club: "Mon club",
  sportvision: "Équipe SportVision",
};

export default function EspaceWeb() {
  const { porte } = useLocalSearchParams<{ porte?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const vue = useRef<WebView>(null);
  const [peutReculer, setPeutReculer] = useState(false);
  const [charge, setCharge] = useState(false);

  const cle: Exclude<Porte, "personnel"> = porte === "sportvision" ? "sportvision" : "club";

  async function changerEspace() {
    await oublierPorte();
    router.replace("/bienvenue");
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.fond }}>
      <View style={[s.barre, { paddingTop: insets.top + 6 }]}>
        <Pressable
          onPress={() => vue.current?.goBack()}
          disabled={!peutReculer}
          hitSlop={10}
          style={[s.boutonBarre, !peutReculer && { opacity: 0.3 }]}
        >
          <Ionicons name="chevron-back" size={20} color={C.texte} />
        </Pressable>

        <Text style={s.titre} numberOfLines={1}>{TITRES[cle]}</Text>

        <Pressable onPress={changerEspace} hitSlop={10} style={s.changer}>
          <Ionicons name="swap-horizontal" size={15} color={C.accentClair} />
          <Text style={s.changerTexte}>Changer</Text>
        </Pressable>
      </View>

      <WebView
        ref={vue}
        source={{ uri: ADRESSES[cle] }}
        style={{ flex: 1, backgroundColor: C.fond }}
        onLoadEnd={() => setCharge(true)}
        onNavigationStateChange={(etat) => setPeutReculer(etat.canGoBack)}
        // Le geste de bord, en plus du bouton : sur iOS, c'est le reflexe naturel pour revenir.
        allowsBackForwardNavigationGestures
        sharedCookiesEnabled
        // La session du site doit survivre a la fermeture de l'application, sinon il faut se
        // reconnecter a chaque ouverture.
        thirdPartyCookiesEnabled
        domStorageEnabled
        pullToRefreshEnabled
      />

      {!charge ? (
        <View style={s.attente} pointerEvents="none">
          <ActivityIndicator color={C.accent} />
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  barre: {
    flexDirection: "row", alignItems: "center", gap: E.s,
    paddingHorizontal: E.m, paddingBottom: E.s,
    backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.bordure,
  },
  boutonBarre: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  titre: { flex: 1, color: C.texte, fontSize: 16, fontWeight: "700" },
  changer: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: E.s, paddingVertical: 6, borderRadius: R.pill,
    backgroundColor: "rgba(79,125,255,.14)",
  },
  changerTexte: { color: C.accentClair, fontSize: 13, fontWeight: "700" },
  attente: {
    position: "absolute", left: 0, right: 0, bottom: 0, top: 90,
    alignItems: "center", justifyContent: "center", backgroundColor: C.fond,
  },
});
