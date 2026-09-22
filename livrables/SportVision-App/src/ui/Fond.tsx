// La lueur de marque en haut des écrans (22/09/2026).
//
// Un fond uni sur toute la hauteur fait « page web sombre ». Une lueur qui descend depuis le haut
// donne de la profondeur sans rien coûter en lisibilité, parce qu'elle s'éteint avant le texte.
import React from "react";
import { StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { C } from "../theme/couleurs";

export function Lueur({ teinte = "violet" }: { teinte?: "violet" | "cyan" | "bleu" }) {
  const couleurs =
    teinte === "cyan" ? ["rgba(0,199,255,.16)", "rgba(36,84,255,.07)", "rgba(7,10,23,0)"]
    : teinte === "bleu" ? ["rgba(36,84,255,.22)", "rgba(0,199,255,.06)", "rgba(7,10,23,0)"]
    : ["rgba(131,45,255,.20)", "rgba(36,84,255,.07)", "rgba(7,10,23,0)"];
  return (
    <View pointerEvents="none" style={s.enveloppe}>
      <LinearGradient
        colors={couleurs as [string, string, string]}
        locations={[0, 0.42, 1]}
        // Strictement vertical : en diagonale, le bas de la lueur n'était transparent que d'un
        // côté, et laissait une ligne nette en travers de l'écran.
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

const s = StyleSheet.create({
  // 340 points : la lueur couvre l'en-tête et la première carte, puis disparaît.
  enveloppe: { position: "absolute", top: 0, left: 0, right: 0, height: 420, backgroundColor: C.fond },
});
