// La porte d'entree (22/09/2026).
//
// Trois publics, trois espaces. On demande une fois, on s'en souvient, et on laisse toujours
// revenir ici : c'est la difference entre un raccourci et une impasse.
import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { memoriserPorte, type Porte } from "../src/lib/espaces";
import { C, E, R } from "../src/theme/couleurs";

const PORTES: {
  cle: Porte;
  icone: keyof typeof Ionicons.glyphMap;
  titre: string;
  texte: string;
  teinte: string;
}[] = [
  {
    cle: "personnel",
    icone: "football",
    titre: "Joueur ou parent",
    texte: "Mon calendrier, les résultats de mon équipe et mes photos.",
    teinte: C.accent,
  },
  {
    cle: "club",
    icone: "shield-half",
    titre: "Mon club",
    texte: "Coach, président, secrétaire : l'espace de travail du club.",
    teinte: C.cyan,
  },
  {
    cle: "sportvision",
    icone: "videocam",
    titre: "Équipe SportVision",
    texte: "Missions, production et suivi des clubs.",
    teinte: C.violet,
  },
];

export default function Bienvenue() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [choix, setChoix] = useState<Porte | null>(null);

  async function ouvrir(p: Porte) {
    setChoix(p);
    await memoriserPorte(p);
    if (p === "personnel") router.replace("/");
    else router.replace({ pathname: "/espace-web", params: { porte: p } });
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.fond }}
      contentContainerStyle={[
        s.page,
        { paddingTop: insets.top + E.xl, paddingBottom: insets.bottom + E.xl },
      ]}
    >
      <View style={{ gap: E.s }}>
        <Image source={require("../assets/splash-icon.png")} style={s.logo} contentFit="contain" />
        <Text style={s.titre}>SportVision</Text>
        <Text style={s.sous}>Qui êtes-vous ? Nous ouvrirons directement le bon espace la prochaine fois.</Text>
      </View>

      <View style={{ gap: E.m }}>
        {PORTES.map((p) => (
          <Pressable
            key={p.cle}
            onPress={() => ouvrir(p.cle)}
            disabled={!!choix}
            style={({ pressed }) => [
              s.carte,
              { borderColor: pressed || choix === p.cle ? p.teinte + "88" : C.bordure },
              choix && choix !== p.cle ? { opacity: 0.45 } : null,
            ]}
          >
            <View style={[s.icone, { backgroundColor: p.teinte + "22" }]}>
              <Ionicons name={p.icone} size={22} color={p.teinte} />
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={s.carteTitre}>{p.titre}</Text>
              <Text style={s.carteTexte}>{p.texte}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={C.texteFaible} />
          </Pressable>
        ))}
      </View>

      <Text style={s.pied}>
        Vous pourrez revenir à cet écran à tout moment depuis « Changer d'espace ».
      </Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { flexGrow: 1, paddingHorizontal: E.l, gap: E.xl, justifyContent: "center" },
  logo: { width: 76, height: 76, marginBottom: E.xs, marginLeft: -6 },
  titre: { color: C.texte, fontSize: 28, fontWeight: "800", letterSpacing: -0.6 },
  sous: { color: C.texteDoux, fontSize: 15, lineHeight: 21 },
  carte: {
    flexDirection: "row", alignItems: "center", gap: E.m,
    backgroundColor: C.surface, borderRadius: R.l, borderWidth: 1, padding: E.m,
  },
  icone: { width: 46, height: 46, borderRadius: R.m, alignItems: "center", justifyContent: "center" },
  carteTitre: { color: C.texte, fontSize: 16.5, fontWeight: "700" },
  carteTexte: { color: C.texteDoux, fontSize: 13.5, lineHeight: 18 },
  pied: { color: C.texteFaible, fontSize: 12.5, textAlign: "center", lineHeight: 18 },
});
