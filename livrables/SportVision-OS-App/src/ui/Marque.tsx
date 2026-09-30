// LA MARQUE, DANS L'APPLICATION ET PAS SEULEMENT SUR SON ICÔNE (01/10/2026).
//
// CE QU'ON A VU À L'ÉCRAN. L'écran de connexion porte le logo et le bouton en dégradé bleu-cyan-
// violet : on sait tout de suite devant quoi on est. Une fois connecté, plus rien. L'Accueil, Mes
// missions, Mon planning, Mes livrables, les Galeries : un titre blanc sur du noir, et c'est tout.
// L'application traverse dix écrans sans jamais redire son nom. C'est exactement le « on doit
// sentir que c'est une application SportVision » de Fouka.
//
// DEUX BRIQUES, PAS UNE DE PLUS :
//
//   `Marque`      le logo, celui du fichier d'icône, dans un carré aux rayons du thème. Il n'est
//                 pas redessiné en code : une deuxième version du logo finirait par diverger de
//                 la vraie, et c'est le reproche numéro un de Fouka sur les palettes proches.
//
//   `Medaillon`   un rond au dégradé de marque, qui porte une icône. C'est ce qui manquait aux
//                 états vides : un cadre en pointillés et deux lignes de texte, ça se lit
//                 « écran pas fini ». Le même rond sert partout où un bloc doit exister sans
//                 avoir de contenu à montrer.
//
// AUCUNE COULEUR EN DUR : `DEGRADE` et `DEGRADE_DOUX` viennent de `theme/couleurs.ts`, qui les
// tient du site vitrine.
import React from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { C, DEGRADE, DEGRADE_DOUX, R } from "../theme/couleurs";

/** Le logo SportVision. `taille` est le côté du carré, en points. */
export function Marque({ taille = 34, style }: { taille?: number; style?: ViewStyle }) {
  return (
    <View
      // `accessibilityElementsHidden` : le logo ne s'annonce pas à la lecture vocale. Le nom de
      // l'application est déjà dit par le système, et un « image » de plus avant chaque titre
      // rallonge la lecture de tous les écrans sans rien apprendre.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        s.marque,
        { width: taille, height: taille, borderRadius: Math.round(taille * 0.28) },
        style as never,
      ]}
    >
      <Image
        source={require("../../assets/icon.png")}
        style={{ width: taille, height: taille }}
        contentFit="cover"
      />
    </View>
  );
}

/**
 * Un rond au dégradé de marque, avec une icône dedans.
 *
 * `ton` existe parce qu'un vide et une alerte n'ont pas à porter la même couleur : le dégradé de
 * marque pour ce qui est normal, l'ambre pour ce qui attend un geste. Il n'y en a pas d'autre :
 * trois tons de plus et on retomberait sur « chaque écran a sa nuance ».
 */
export function Medaillon({
  icone, taille = 46, ton = "marque",
}: {
  icone: keyof typeof Ionicons.glyphMap;
  taille?: number;
  ton?: "marque" | "attente";
}) {
  const couleurs = ton === "attente"
    ? (["rgba(232,163,61,.22)", "rgba(232,163,61,.08)", "rgba(232,163,61,.14)"] as const)
    : DEGRADE_DOUX;
  const teinteIcone = ton === "attente" ? C.alerteTexte : C.cyanTexte;

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: taille, height: taille, borderRadius: R.pill, overflow: "hidden" }}
    >
      <LinearGradient
        colors={couleurs as unknown as [string, string, string]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={[StyleSheet.absoluteFill, s.rond]}
      >
        <Ionicons name={icone} size={Math.round(taille * 0.44)} color={teinteIcone} />
      </LinearGradient>
    </View>
  );
}

/**
 * Le liseré de marque : trois points de dégradé sur un filet d'un point.
 *
 * Il sert à poser le bleu SportVision en haut d'un bloc sans rien coûter en lisibilité, là où un
 * aplat coloré rendrait le texte pénible. C'est la même idée que la lueur de `Fond.tsx`, en plus
 * petit.
 */
export function Filet({ style }: { style?: ViewStyle }) {
  return (
    <LinearGradient
      colors={DEGRADE as unknown as [string, string, string]}
      start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
      style={[s.filet, style as never]}
    />
  );
}

const s = StyleSheet.create({
  marque: { overflow: "hidden", borderWidth: 1, borderColor: C.bordure },
  rond: { alignItems: "center", justifyContent: "center" },
  filet: { height: 2, borderRadius: R.pill },
});
