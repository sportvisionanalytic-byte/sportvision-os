// LES ONGLETS DE L'OS (30/09/2026).
//
// TROIS, ET LE PREMIER CHANGE DE MÉTIER. L'application sert deux populations très différentes :
// dix opérateurs terrain, qui viennent voir LEURS missions, et deux responsables de production,
// qui viennent voir CELLES DE TOUS. Le même onglet, deux écrans — plutôt que quatre onglets dont
// la moitié serait vide pour chacun.
//
// « L'OS » est l'application complète, dans une vue web, déjà connectée. Tout ce que le natif ne
// sait pas encore faire y vit, et c'est elle qui reste l'autorité : on n'y réécrit aucune règle.
import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Redirect, Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { estProduction, useSession } from "../../src/lib/session";
import { C, E } from "../../src/theme/couleurs";
import { P } from "../../src/theme/polices";

export default function Onglets() {
  const { session, moi, chargement } = useSession();

  if (chargement) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.fond }}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }
  // Barrière unique : aucun écran n'est atteignable sans session, quelle que soit la façon dont on
  // y arrive — un lien, une notification, un retour d'arrière-plan.
  if (!session) return <Redirect href="/connexion" />;

  const production = estProduction(moi?.role ?? null);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: C.accentClair,
        tabBarInactiveTintColor: C.texteDoux,
        // La barre flotte au-dessus du contenu, comme dans l'application des familles : le contenu
        // passe dessous en transparence plutôt que de s'arrêter net sur un bandeau opaque.
        tabBarStyle: {
          position: "absolute",
          backgroundColor: "transparent",
          borderTopColor: C.bordure,
          borderTopWidth: StyleSheet.hairlineWidth,
          elevation: 0,
        },
        tabBarBackground: () => (
          <BlurView tint="dark" intensity={34} style={StyleSheet.absoluteFill}>
            <View style={{ flex: 1, backgroundColor: "rgba(7,11,24,.72)" }} />
          </BlurView>
        ),
        tabBarLabelStyle: { fontSize: 11, fontFamily: P.texteFort, marginBottom: 2 },
        tabBarItemStyle: { paddingTop: E.xs },
        sceneStyle: { backgroundColor: C.fond },
      }}
    >
      <Tabs.Screen
        name="missions"
        options={{
          title: production ? "Production" : "Mes missions",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name={production ? "grid" : "calendar"} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="os"
        options={{
          title: "L'OS",
          tabBarIcon: ({ color, size }) => <Ionicons name="apps" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="profil"
        options={{
          title: "Profil",
          tabBarIcon: ({ color, size }) => <Ionicons name="person" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
