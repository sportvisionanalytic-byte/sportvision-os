// Les onglets de l'espace personnel (22/09/2026).
//
// Quatre, pas plus : au-dela, sur un telephone, les libelles se coupent et l'onglet actif devient
// difficile a lire. Les entrees rares (reglages, aide) vivent dans l'onglet Profil.
import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Redirect, Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { useSession } from "../../src/lib/session";
import { C, E } from "../../src/theme/couleurs";
import { P } from "../../src/theme/polices";

export default function OngletsEspace() {
  const { session, profil, chargement } = useSession();
  const parent = profil?.espace === "parent";

  if (chargement) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }
  // Barriere unique : aucun ecran de cet espace n'est atteignable sans session, quelle que soit
  // la facon dont on y arrive (lien, notification, retour d'arriere-plan).
  if (!session) return <Redirect href="/connexion" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: C.accentClair,
        tabBarInactiveTintColor: C.texteDoux,
        // La barre flotte au-dessus du contenu, comme dans les applications d'iOS : le contenu
        // passe dessous en transparence plutot que de s'arreter net sur un bandeau opaque.
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
        name="accueil"
        options={{
          title: "Accueil",
          tabBarIcon: ({ color, size }) => <Ionicons name="home" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="calendrier"
        options={{
          title: "Calendrier",
          tabBarIcon: ({ color, size }) => <Ionicons name="calendar" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="photos"
        options={{
          title: parent ? "Ses photos" : "Mes photos",
          tabBarIcon: ({ color, size }) => <Ionicons name="images" color={color} size={size} />,
        }}
      />
      {/* La galerie ouverte n'est pas un onglet : elle s'ouvre depuis « Mes photos » et garde la
          barre en bas, pour qu'on sache toujours ou l'on est. */}
      <Tabs.Screen name="galerie/[id]" options={{ href: null }} />
      <Tabs.Screen name="match/[id]" options={{ href: null }} />
      <Tabs.Screen name="acces" options={{ href: null }} />
      {/* Les pages de Connect (commandes, factures, cotisations, rattachements,
          reconnaissance, aide) et la reservation : atteignables depuis le profil et les
          raccourcis, jamais un onglet. Au-dela de quatre onglets, les libelles se coupent. */}
      <Tabs.Screen name="connect/[page]" options={{ href: null }} />
      <Tabs.Screen name="reserver" options={{ href: null }} />
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
